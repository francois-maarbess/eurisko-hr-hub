import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Inject, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CreateChildRequestDto, CreateRequestDto } from './dto/create-request.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { PRISMA_CLIENT_TOKEN } from './prisma.service';
import { AuditService } from './audit.service';
import { NotificationsService } from './notifications.service';
import { AiIntakeService } from './ai/ai-intake.service';
import { fallbackSlaDurationMs } from './sla-policy';

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED', 'REJECTED'],
  IN_PROGRESS: ['COMPLETED', 'REJECTED'],
};

const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED'];

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, STANDARD: 1, LOW: 2 };

const STOPWORDS = new Set(
  'a,an,and,are,as,at,be,by,for,from,has,have,how,in,into,is,it,its,of,on,or,that,the,their,this,to,was,what,when,with,need,needs,please,help,request,my,me,get,got,has,had,been,are,was,were,will,would,can,could,should,our,you,your,our,for,than,then,there,they,them,do,does,did,not,no,yes,if,else,than,too,very,just,about,into,over,after,before,up,down,out,off,on,again,once,here,there,when,where,which,who,whom,this,that,these,those,am,an,are,as,at,be,because,been,before,being,below,between,both,but,by,doing,each,few,further,had,having,he,her,hers,herself,him,himself,his,i,me,more,most,my,myself,nor,now,once,only,other,ought,same,she,so,some,such,than,too,until,very,was,were,yours,yourself'.split(','),
);

function titleOverlap(left: string, right: string): number {
  const tokens = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((word) => word.length > 2));
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common++;
  return common / Math.min(a.size, b.size);
}

export interface Viewer {
  id: string;
  platformRole: string;
}

@Injectable()
export class RequestsService {
  constructor(
    @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    // Optional so unit specs can construct the service without the AI module.
    private readonly ai?: AiIntakeService,
  ) {}

  /** AI-decided deadline with static fallback — never throws, never blocks. */
  private async slaFor(title: string, description: string, priority: string) {
    try {
      if (this.ai) {
        const { durationMs, source } = await this.ai.decideSlaMs(`${title}\n${description}`, priority);
        return { slaDueAt: new Date(Date.now() + durationMs), slaSource: source };
      }
    } catch {
      // Fall through to the rule-based deadline below.
    }
    return { slaDueAt: new Date(Date.now() + fallbackSlaDurationMs(priority)), slaSource: 'RULE' as const };
  }

  private openWhere() {
    return { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } };
  }

  private readonly fullInclude = {
    department: true,
    requestType: true,
    owner: true,
    claimant: true,
    _count: {
      select: {
        documents: true,
        staffNotes: true,
      },
    },
  } as const;

  /**
   * Scoped views (single company, no tenancy here — scoping is by person).
   * - mine (default): only requests I created. Nobody sees other people's
   *   tickets unless they have a reason to.
   * - queue: open tickets in MY departments (agents), everything open (admin).
   * - claimed: in-progress or completed tickets claimed by me.
   * - mywork: open tickets claimed by me. unassigned: open + unclaimed.
   * Pagination: DB-orderable views use real skip/take; queue uses a custom
   * in-memory priority sort so the slice happens after sorting to keep
   * global URGENT-first order correct. claimedBy narrows queue/claimed
   * ('me' | 'unassigned' | userId); unknown ids return [] rather than leak.
   */
  async findAll(userId: string, view?: string, page?: number, pageSize?: number, claimedBy?: string) {
    const paged = page != null || pageSize != null;
    const size = Math.min(Math.max(1, pageSize || 50), 200);
    const skip = Math.max(0, ((page || 1) - 1) * size);
    const take = size;
    // Pagination slices AFTER fetching: queue ordering is a custom
    // in-memory sort that no DB ORDER BY can express, so slicing before
    // sorting would break global order. Uniform across all views.
    const paginate = <T>(rows: T[]): T[] => {
      if (!paged) return rows;
      return rows.slice(skip, skip + size);
    };
    const claimedByFilter = (): Record<string, unknown> | null => {
      if (!claimedBy) return null;
      if (claimedBy === 'me') return { claimedById: userId };
      if (claimedBy === 'unassigned' || claimedBy === 'null') return { claimedById: null };
      // Specific agent id: must look like a cuid to avoid leaking via garbage.
      if (!/^[a-z0-9]{10,}$/i.test(claimedBy)) return { claimedById: '__none__' };
      return { claimedById: claimedBy };
    };
    if (view === 'claimed') {
      const extra = claimedByFilter();
      const rows = await this.prisma.request.findMany({
        where: { claimedById: userId, status: { in: ['IN_PROGRESS', 'COMPLETED'] }, ...(extra ?? {}) },
        include: this.fullInclude,
        orderBy: { createdAt: 'desc' },
        ...(paged ? { skip, take } : {}),
      });
      return rows;
    }

    if (view === 'mywork') {
      const extra = claimedByFilter();
      const rows = await this.prisma.request.findMany({
        where: { claimedById: userId, ...this.openWhere(), ...(extra ?? {}) },
        include: this.fullInclude,
        orderBy: { createdAt: 'desc' },
        ...(paged ? { skip, take } : {}),
      });
      return rows;
    }

    if (view === 'queue' || view === 'unassigned') {
      const rank = (r: { priority: string; createdAt: Date }) =>
        (PRIORITY_RANK[r.priority] ?? 99) * 1e15 + r.createdAt.getTime();
      // Acceptance 10: URGENT before STANDARD before LOW, then oldest first.
      // Sorted in memory (priority order isn't expressible in a DB ORDER BY),
      // so pagination slices AFTER sorting to keep global order correct.
      const paginate = (rows: { priority: string; createdAt: Date }[]) => {
        const sorted = [...rows].sort((a, b) => rank(a) - rank(b));
        if (!paged) return sorted;
        return sorted.slice(skip, skip + size);
      };
      const extra = claimedByFilter();

      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.platformRole === 'SYSTEM_ADMIN') {
        const all = await this.prisma.request.findMany({
          where: { ...this.openWhere(), ...(view === 'unassigned' ? { claimedById: null } : {}), ...(extra ?? {}) },
          include: this.fullInclude,
        });
        return paginate(all);
      }
      const memberships = await this.prisma.departmentMember.findMany({
        where: { userId, active: true },
      });
      if (memberships.length === 0) return [];
      const scoped = await this.prisma.request.findMany({
        where: {
          departmentId: { in: memberships.map((m) => m.departmentId) },
          ...this.openWhere(),
          ...(view === 'unassigned' ? { claimedById: null } : {}),
          ...(extra ?? {}),
        },
        include: this.fullInclude,
      });
      return paginate(scoped);
    }

    if (paged) {
      return this.prisma.request.findMany({
        where: { employeeId: userId },
        include: this.fullInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      });
    }
    return paginate(
      await this.prisma.request.findMany({
        where: { employeeId: userId },
        include: this.fullInclude,
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /**
   * SLA breach center: open tickets past their deadline, scoped exactly
   * like the queue (my departments for agents, everything for admins),
   * most overdue first. Tickets without a stored deadline never appear.
   */
  async getBreached(userId: string) {
    const overdue = {
      status: { notIn: TERMINAL_STATUSES },
      slaDueAt: { lt: new Date() },
    };
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.platformRole === 'SYSTEM_ADMIN') {
      return this.prisma.request.findMany({
        where: overdue,
        include: this.fullInclude,
        orderBy: { slaDueAt: 'asc' },
      });
    }
    const memberships = await this.prisma.departmentMember.findMany({
      where: { userId, active: true },
    });
    if (memberships.length === 0) return [];
    return this.prisma.request.findMany({
      where: {
        departmentId: { in: memberships.map((m) => m.departmentId) },
        ...overdue,
      },
      include: this.fullInclude,
      orderBy: { slaDueAt: 'asc' },
    });
  }

  /**
   * Resource-level read gate (acceptance 2/3): the owner, an active member
   * of the owning department, or a system admin. Anything else is 403 —
   * existence of the row is never confirmed to strangers.
   */
  async findOne(id: string, viewer: Viewer) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: {
        department: true,
        requestType: true,
        owner: true,
        claimant: true,
        parent: { select: { id: true, title: true, departmentId: true } },
        children: {
          include: { department: true, requestType: true, claimant: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!request) throw new NotFoundException('Request not found');
    const unrestricted = viewer.platformRole === 'SYSTEM_ADMIN' || request.employeeId === viewer.id;
    if (unrestricted) {
      const completed = request.children.filter((child) => child.status === 'COMPLETED').length;
      return { ...request, macroProgress: { completed, total: request.children.length } };
    }
    const membership = await this.prisma.departmentMember.findUnique({
      where: { userId_departmentId: { userId: viewer.id, departmentId: request.departmentId } },
    });
    if (!membership?.active) {
      throw new ForbiddenException('You do not have access to this request.');
    }
    // A department agent sees only child work routed to their department.
    // This deliberately avoids leaking other teams' task titles or details.
    const children = request.children.filter((child) => child.departmentId === request.departmentId);
    const completed = children.filter((child) => child.status === 'COMPLETED').length;
    return { ...request, parent: undefined, children, macroProgress: { completed, total: children.length } };
  }

  async create(dto: CreateRequestDto, employeeId: string) {
    if (dto.submissionKey) {
      const existing = await this.prisma.request.findUnique({
        where: { submissionKey: dto.submissionKey },
        include: { department: true, requestType: true, children: { include: { department: true, requestType: true } } },
      });
      if (existing) {
        if (existing.employeeId !== employeeId) throw new ConflictException('Submission key has already been used.');
        return existing;
      }
    }

    // Validate department + request type belong together
    const requestType = await this.prisma.requestType.findUnique({
      where: { id: dto.requestTypeId },
      include: { department: true },
    });
    if (!requestType) throw new BadRequestException('Invalid request type');
    if (requestType.departmentId !== dto.departmentId) {
      throw new BadRequestException('Request type does not belong to the specified department');
    }
    if (!requestType.active) {
      throw new BadRequestException('Request type is inactive');
    }
    if (!requestType.department.active) throw new BadRequestException('Department is inactive');

    const childTasks = dto.childTasks || [];
    if (childTasks.length > 6) throw new BadRequestException('A workflow can contain at most six child requests.');
    const validatedChildren: CreateChildRequestDto[] = [];
    for (const child of childTasks) {
      if (child.title.trim().length < 8 || child.title.length > 240 || child.description.trim().length < 8 || child.description.length > 400) {
        throw new BadRequestException('Each child request needs a specific title and description.');
      }
      if (child.departmentId === dto.departmentId && child.requestTypeId === dto.requestTypeId &&
          titleOverlap(child.title.trim(), dto.title.trim()) >= 0.8) {
        throw new BadRequestException('A child request cannot duplicate its parent.');
      }
      const type = await this.prisma.requestType.findUnique({ where: { id: child.requestTypeId }, include: { department: true } });
      if (!type || !type.active || !type.department.active || type.departmentId !== child.departmentId) {
        throw new BadRequestException('A child request must use an active request type in its selected department.');
      }
      if (validatedChildren.some((prior) => titleOverlap(prior.title, child.title) >= 0.8)) {
        throw new BadRequestException('Duplicate child requests are not allowed.');
      }
      validatedChildren.push({ ...child, title: child.title.trim(), description: child.description.trim() });
    }

    // Request row + audit row atomically; notifications fan out after commit
    // and can never fail the write. The SLA deadline is decided BEFORE the
    // transaction so no LLM call ever holds a database transaction open.
    const sla = await this.slaFor(dto.title, dto.description, dto.priority);
    // Child SLAs use the deterministic published priority policy so a macro
    // requires only one bounded Groq request, never one slow call per child.
    const childSlas = validatedChildren.map((child) => {
      return { slaDueAt: new Date(Date.now() + fallbackSlaDurationMs(child.priority)), slaSource: 'RULE' as const };
    });
    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const req = await tx.request.create({
          data: {
          employeeId,
          departmentId: dto.departmentId,
          requestTypeId: dto.requestTypeId,
          title: dto.title,
          description: dto.description,
          priority: dto.priority,
          status: 'PENDING',
          slaDueAt: sla.slaDueAt,
          slaSource: sla.slaSource,
          submissionKey: dto.submissionKey,
        },
          include: { department: true, requestType: true },
        });
        await tx.auditLog.create({
          data: {
            requestId: req.id,
            actorId: employeeId,
            action: 'REQUEST_CREATED',
            newValue: req.title,
            metadata: validatedChildren.length ? JSON.stringify({ workflow: 'parent', childCount: validatedChildren.length }) : null,
          },
        });
        const children: Awaited<ReturnType<typeof tx.request.create>>[] = [];
        for (let i = 0; i < validatedChildren.length; i++) {
          const child = validatedChildren[i];
          const childReq = await tx.request.create({
            data: {
              employeeId,
              departmentId: child.departmentId,
              requestTypeId: child.requestTypeId,
              title: child.title,
              description: child.description,
              priority: child.priority,
              status: 'PENDING',
              parentRequestId: req.id,
              slaDueAt: childSlas[i].slaDueAt,
              slaSource: childSlas[i].slaSource,
            },
            include: { department: true, requestType: true },
          });
          await tx.auditLog.create({
            data: {
              requestId: childReq.id,
              actorId: employeeId,
              action: 'REQUEST_CREATED',
              newValue: childReq.title,
              metadata: JSON.stringify({ parentRequestId: req.id }),
            },
          });
          children.push(childReq);
        }
        return { ...req, children };
      });
    } catch (error) {
      if (dto.submissionKey && error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        const existing = await this.prisma.request.findUnique({
          where: { submissionKey: dto.submissionKey },
          include: { department: true, requestType: true, children: { include: { department: true, requestType: true } } },
        });
        if (existing?.employeeId === employeeId) return existing;
        throw new ConflictException('Submission key has already been used.');
      }
      throw error;
    }

    await this.notifications.emit({
      requestId: created.id,
      eventType: 'request.created',
      payload: { departmentId: created.departmentId, priority: created.priority, title: created.title },
      idempotencyKey: `req-${created.id}-created`,
    });
    await this.notifications.fanout({ requestId: created.id, eventType: 'request.created', actorId: employeeId });
    for (const child of created.children) {
      await this.notifications.emit({
        requestId: child.id,
        eventType: 'request.created',
        payload: { departmentId: child.departmentId, priority: child.priority, title: child.title, parentRequestId: created.id },
        idempotencyKey: `req-${child.id}-created`,
      });
      await this.notifications.fanout({ requestId: child.id, eventType: 'request.created', actorId: employeeId });
    }
    return created;
  }

  async claim(id: string, userId: string) {
    const viewer = await this.viewerOf(userId);
    const request = await this.findOne(id, viewer);

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING requests can be claimed');
    }

    // The request owner cannot claim their own request — no exceptions,
    // not even for admins: self-service is never self-dealing.
    if (request.employeeId === userId) {
      throw new ConflictException('You cannot claim your own request');
    }

    // Authorization: an active member of the owning department, or a system
    // administrator (data-model §4: admins operate all departments).
    if (viewer.platformRole !== 'SYSTEM_ADMIN') {
      const membership = await this.prisma.departmentMember.findUnique({
        where: {
          userId_departmentId: { userId, departmentId: request.departmentId },
        },
      });
      if (!membership || !membership.active) {
        throw new ConflictException('You are not a member of this department');
      }
    }

    // Atomic claim: only one agent can claim
    const updated = await this.prisma.request.updateMany({
      where: { id, status: 'PENDING', claimedById: null },
      data: { status: 'IN_PROGRESS', claimedById: userId },
    });
    if (updated.count === 0) {
      throw new ConflictException('Request was already claimed by another agent');
    }

    const claimed = await this.findOne(id, viewer);
    await this.audit.append({
      requestId: id,
      actorId: userId,
      action: 'REQUEST_CLAIMED',
      oldValue: 'PENDING',
      newValue: 'IN_PROGRESS',
    });
    await this.notifications.emit({
      requestId: id,
      eventType: 'request.claimed',
      payload: { claimedById: userId },
      idempotencyKey: `req-${id}-claimed-${userId}`,
    });
    await this.notifications.fanout({ requestId: id, eventType: 'request.claimed', actorId: userId });
    return claimed;
  }

  async generateResolutionPlaybook(id: string, userId: string) {
    const viewer = await this.viewerOf(userId);
    const request = await this.findOne(id, viewer);
    if (request.status !== 'IN_PROGRESS') {
      throw new ConflictException('Only in-progress requests can receive a resolution draft.');
    }
    if (request.employeeId === userId || request.claimedById !== userId) {
      throw new ForbiddenException('Only the agent currently assigned to this request can draft its resolution.');
    }
    if (!this.ai) throw new ServiceUnavailableException('AI resolution drafting is unavailable. Add a resolution note manually.');
    return this.ai.generateResolutionPlaybook({
      title: request.title,
      description: request.description,
      department: request.department.name,
      requestType: request.requestType.name,
    });
  }

  /**
   * Explicit ownership changes — nothing silent. Takeover moves a claimed
   * ticket to yourself; reassign moves it to a chosen agent. Both require
   * manager-or-admin authority and write prev/new owner audit events.
   */
  private async requireManager(userId: string, platformRole: string, departmentId: string) {
    if (platformRole === 'SYSTEM_ADMIN') return;
    if (!(await this.isManagerOf(userId, departmentId))) {
      throw new ForbiddenException('Only department managers can change ownership.');
    }
  }

  async takeover(id: string, userId: string, reason?: string) {
    const viewer = await this.viewerOf(userId);
    const request = await this.findOne(id, viewer);
    if (request.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Only in-progress tickets can be taken over.');
    }
    if (request.employeeId === userId) {
      throw new ConflictException('You cannot take over your own request.');
    }
    if (!request.claimedById) {
      throw new BadRequestException('This ticket is unclaimed — claim it normally.');
    }
    if (request.claimedById === userId) {
      throw new ConflictException('This ticket is already yours.');
    }
    await this.requireManager(userId, viewer.platformRole, request.departmentId);
    const prev = await this.prisma.user.findUnique({ where: { id: request.claimedById } });
    const me = await this.prisma.user.findUnique({ where: { id: userId } });
    await this.prisma.$transaction(async (tx) => {
      await tx.request.update({ where: { id }, data: { claimedById: userId } });
      await tx.auditLog.create({
        data: {
          requestId: id,
          actorId: userId,
          action: 'REQUEST_TAKEOVER',
          oldValue: prev?.displayName || prev?.email || 'previous agent',
          newValue: me?.displayName || me?.email || 'new agent',
          metadata: reason?.trim() ? JSON.stringify({ reason: reason.trim() }) : null,
        },
      });
    });
    await this.notifications.emit({
      requestId: id,
      eventType: 'request.reassigned',
      payload: { claimedById: userId, prevClaimedById: request.claimedById },
      idempotencyKey: `req-${id}-takeover-${userId}`,
    });
    await this.notifications.fanout({ requestId: id, eventType: 'request.reassigned', actorId: userId, newClaimantId: userId });
    return this.findOne(id, viewer);
  }

  async reassign(id: string, targetUserId: string, userId: string, reason?: string) {
    const viewer = await this.viewerOf(userId);
    const request = await this.findOne(id, viewer);
    if (request.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Only in-progress tickets can be reassigned.');
    }
    if (targetUserId === request.employeeId) {
      throw new BadRequestException('A ticket cannot be assigned to its requester.');
    }
    await this.requireManager(userId, viewer.platformRole, request.departmentId);
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target || !target.active) {
      throw new BadRequestException('Target user not found or deactivated.');
    }
    if (viewer.platformRole !== 'SYSTEM_ADMIN') {
      const tm = await this.prisma.departmentMember.findUnique({
        where: { userId_departmentId: { userId: targetUserId, departmentId: request.departmentId } },
      });
      if (!tm?.active) {
        throw new BadRequestException('Target user is not an active member of this department.');
      }
    }
    const prev = request.claimedById
      ? await this.prisma.user.findUnique({ where: { id: request.claimedById } })
      : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.request.update({ where: { id }, data: { claimedById: targetUserId } });
      await tx.auditLog.create({
        data: {
          requestId: id,
          actorId: userId,
          action: 'REQUEST_REASSIGNED',
          oldValue: prev?.displayName || prev?.email || 'unassigned',
          newValue: target.displayName || target.email,
          metadata: reason?.trim() ? JSON.stringify({ reason: reason.trim() }) : null,
        },
      });
    });
    await this.notifications.emit({
      requestId: id,
      eventType: 'request.reassigned',
      payload: { claimedById: targetUserId, prevClaimedById: request.claimedById },
      idempotencyKey: `req-${id}-reassign-${targetUserId}`,
    });
    await this.notifications.fanout({ requestId: id, eventType: 'request.reassigned', actorId: userId, newClaimantId: targetUserId });
    return this.findOne(id, viewer);
  }

  async updateStatus(id: string, dto: UpdateStatusDto, userId: string) {
    const viewer = await this.viewerOf(userId);
    const request = await this.findOne(id, viewer);

    // Validate transition
    const allowed = VALID_TRANSITIONS[request.status];
    if (!allowed || !allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid transition: ${request.status} -> ${dto.status}`,
      );
    }

    // Cancellation is the requester's own right: only the owner may cancel,
    // and only while PENDING (enforced by the table above).
    if (dto.status === 'CANCELLED' && request.employeeId !== userId) {
      throw new ForbiddenException('Only the requesting employee can cancel this request.');
    }

    // Completion requires a resolution artifact: a note, an attached
    // document, or both (acceptance 5).
    if (dto.status === 'COMPLETED' && (!dto.resolutionNote || dto.resolutionNote.trim() === '')) {
      const doc = await this.prisma.document.findFirst({
        where: { requestId: id, deletedAt: null },
        select: { id: true },
      });
      if (!doc) {
        throw new BadRequestException(
          'A resolution note or an attached document is required when transitioning to COMPLETED',
        );
      }
    }

    // Rejection requires reason
    if (dto.status === 'REJECTED' && (!dto.rejectionReason || dto.rejectionReason.trim() === '')) {
      throw new BadRequestException('A rejection reason is required when rejecting a request');
    }

    // The request owner cannot resolve their own request — only department agents can
    if (dto.status === 'COMPLETED' || dto.status === 'REJECTED') {
      if (request.employeeId === userId) {
        throw new ConflictException('You cannot resolve your own request');
      }

      if (dto.status === 'COMPLETED' && request.claimedById !== userId) {
        throw new ConflictException('Only the agent who claimed this request can complete it');
      }

      // Must be an active department member — or a system administrator,
      // who operates all departments (data-model §4).
      if (viewer.platformRole !== 'SYSTEM_ADMIN') {
        const membership = await this.prisma.departmentMember.findUnique({
          where: {
            userId_departmentId: { userId, departmentId: request.departmentId },
          },
        });
        if (!membership || !membership.active) {
          throw new ConflictException('You are not a member of this department');
        }
      }
    }

    const updateData: Record<string, any> = { status: dto.status };
    if (dto.resolutionNote) updateData.resolutionNote = dto.resolutionNote;
    if (dto.rejectionReason) updateData.rejectionReason = dto.rejectionReason;
    // Acceptance: completion timestamp recorded at the moment of completion.
    if (dto.status === 'COMPLETED') updateData.completedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      if (dto.status === 'COMPLETED') {
        const unfinishedChildren = await tx.request.count({
          where: { parentRequestId: id, status: { not: 'COMPLETED' } },
        });
        if (unfinishedChildren > 0) {
          throw new BadRequestException('Complete every child request before completing the parent workflow.');
        }
      }
      // Conditional write: the row must still be in the state we validated
      // against. A concurrent transition wins the race; the loser gets 409
      // instead of writing contradictory history.
      const won = await tx.request.updateMany({
        where: { id, status: request.status },
        data: updateData,
      });
      if (won.count === 0) {
        throw new ConflictException('This ticket changed while you were working on it — refresh and retry.');
      }
      await tx.auditLog.create({
        data: {
          requestId: id,
          actorId: userId,
          action: 'STATUS_CHANGED',
          oldValue: request.status,
          newValue: dto.status,
        },
      });
      if (dto.status === 'COMPLETED') {
        // Retention clock starts at completion (acceptance 11): attached
        // payloads purge 30 days from now, never from upload time.
        await tx.document.updateMany({
          where: { requestId: id, deletedAt: null },
          data: { purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        });
      }
    });

    const eventType =
      dto.status === 'COMPLETED'
        ? 'request.completed'
        : dto.status === 'REJECTED'
          ? 'request.rejected'
          : dto.status === 'CANCELLED'
            ? 'request.cancelled'
            : null;
    if (eventType) {
      await this.notifications.emit({
        requestId: id,
        eventType,
        payload: { status: dto.status },
        idempotencyKey: `req-${id}-${dto.status.toLowerCase()}`,
      });
      await this.notifications.fanout({ requestId: id, eventType, actorId: userId });
    }
    return this.findOne(id, viewer);
  }

  private async viewerOf(userId: string): Promise<Viewer> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return { id: user.id, platformRole: user.platformRole };
  }

  private async isManagerOf(userId: string, departmentId: string): Promise<boolean> {
    const membership = await this.prisma.departmentMember.findUnique({
      where: { userId_departmentId: { userId, departmentId } },
    });
    return !!membership?.active && membership.departmentRole === 'MANAGER';
  }

  /**
   * Audited re-routing: moves a non-terminal ticket to another department
   * (and type), releasing any claim and reopening it as PENDING. Only a
   * MANAGER of the owning department or a SYSTEM_ADMIN may do this — the
   * reason is mandatory and stored in audit metadata.
   */
  async reroute(
    id: string,
    input: { newDepartmentId: string; newRequestTypeId: string; reason: string },
    userId: string,
  ) {
    const viewer = await this.viewerOf(userId);
    const request = await this.findOne(id, viewer);

    const manager = await this.isManagerOf(userId, request.departmentId);
    if (viewer.platformRole !== 'SYSTEM_ADMIN' && !manager) {
      throw new ForbiddenException('Only a department manager or system administrator can re-route requests.');
    }

    if (TERMINAL_STATUSES.includes(request.status)) {
      throw new BadRequestException(`Cannot re-route a ${request.status} request.`);
    }

    const newDepartment = await this.prisma.department.findUnique({
      where: { id: input.newDepartmentId },
    });
    if (!newDepartment || !newDepartment.active) {
      throw new BadRequestException('Target department not found or inactive.');
    }
    const newType = await this.prisma.requestType.findFirst({
      where: { id: input.newRequestTypeId, departmentId: input.newDepartmentId, active: true },
    });
    if (!newType) {
      throw new BadRequestException('Target request type does not belong to the target department.');
    }
    if (input.newDepartmentId === request.departmentId) {
      throw new BadRequestException('Ticket is already in that department.');
    }

    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestException('A reason is required to re-route a request.');
    }

    const metadata = JSON.stringify({
      fromDepartment: request.department.code,
      fromType: request.requestType.code,
      toDepartment: newDepartment.code,
      toType: newType.code,
      reason,
    });

    // Re-routed tickets reopen as PENDING with a fresh deadline, decided
    // BEFORE the transaction so no LLM call ever holds it open.
    const sla = await this.slaFor(request.title, request.description, request.priority);
    await this.prisma.$transaction(async (tx) => {
      await tx.request.update({
        where: { id },
        data: {
          departmentId: input.newDepartmentId,
          requestTypeId: input.newRequestTypeId,
          status: 'PENDING',
          claimedById: null,
          resolutionNote: null,
          rejectionReason: null,
          completedAt: null,
          slaDueAt: sla.slaDueAt,
          slaSource: sla.slaSource,
        },
      });
      await tx.auditLog.create({
        data: {
          requestId: id,
          actorId: userId,
          action: 'REQUEST_REROUTED',
          oldValue: `${request.department.code}/${request.requestType.code}`,
          newValue: `${newDepartment.code}/${newType.code}`,
          metadata,
        },
      });
    });

    await this.notifications.emit({
      requestId: id,
      eventType: 'request.rerouted',
      payload: { fromDepartment: request.department.code, toDepartment: newDepartment.code },
      idempotencyKey: `req-${id}-rerouted-${Date.now()}`,
    });
    await this.notifications.fanout({ requestId: id, eventType: 'request.rerouted', actorId: userId });
    return this.findOne(id, viewer);
  }

  /**
   * Duplicate warning (advisory only, never blocks creation): open requests
   * in the same department sharing significant title words with the draft.
   */
  async findDuplicates(input: {
    departmentId?: string;
    title: string;
    description?: string;
    excludeId?: string;
    viewer?: Viewer;
  }) {
    // Length 3 keeps short but meaningful words (vpn, HR-adjacent codes)
    // while stopwords kill noise like "for" and "the".
    const tokens = (input.title + ' ' + (input.description || ''))
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    if (tokens.length === 0 || !input.departmentId) return [];

    // Privacy gate: titles are sensitive. Only department staff and system
    // admins may scan a department's open tickets — anyone else gets [] so
    // the creation form keeps working without leaking anything.
    if (input.viewer && input.viewer.platformRole !== 'SYSTEM_ADMIN') {
      const membership = await this.prisma.departmentMember.findUnique({
        where: {
          userId_departmentId: { userId: input.viewer.id, departmentId: input.departmentId },
        },
      });
      if (!membership?.active) return [];
    }

    // No take-window: capping to newest-N could hide the best matches behind
    // recent noise (seeded twins are old by definition). 500 rows of small
    // projections is trivial for this scale.
    const open = await this.prisma.request.findMany({
      where: {
        departmentId: input.departmentId,
        status: { notIn: TERMINAL_STATUSES },
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
      select: { id: true, title: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    return open
      .map((r) => {
        const haystack = new Set(
          r.title.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
        );
        const shared = tokens.filter((t) => haystack.has(t)).length;
        return { id: r.id, title: r.title, status: r.status, shared };
      })
      .filter((r) => r.shared >= 2)
      .sort((a, b) => b.shared - a.shared)
      .slice(0, 5);
  }

  /**
   * Internal staff notes: private working notes on a ticket. Department
   * staff and admins only — the requesting employee is always forbidden,
   * even when they belong to the department in another role.
   */
  async addStaffNote(id: string, content: string, userId: string) {
    const viewer = await this.viewerOf(userId);
    const request = await this.findOne(id, viewer);
    if (request.employeeId === userId) {
      throw new ForbiddenException('Requesters cannot post internal staff notes.');
    }
    const text = (content || '').trim();
    if (!text) {
      throw new BadRequestException('Note content is required.');
    }
    if (text.length > 2000) {
      throw new BadRequestException('Note is too long (max 2000 characters).');
    }
    if (viewer.platformRole !== 'SYSTEM_ADMIN') {
      const membership = await this.prisma.departmentMember.findUnique({
        where: { userId_departmentId: { userId, departmentId: request.departmentId } },
      });
      if (!membership?.active) {
        throw new ForbiddenException('Only department staff can post internal notes.');
      }
    }
    const note = await this.prisma.staffNote.create({
      data: { requestId: id, authorId: userId, content: text },
    });
    // Timeline records THAT a note was added — never its contents. Note
    // bodies stay in the staff-only notes table; the audit trail (visible
    // to request owners) must not become a side channel.
    await this.audit.append({
      requestId: id,
      actorId: userId,
      action: 'STAFF_NOTE_ADDED',
      newValue: note.id,
    });
    return note;
  }

  /** Staff-gate shared by timelines: system admins and active department
   * members may see staff-activity rows; request owners may not. */
  async canSeeStaffActivity(userId: string, platformRole: string, departmentId: string): Promise<boolean> {
    if (platformRole === 'SYSTEM_ADMIN') return true;
    const membership = await this.prisma.departmentMember.findUnique({
      where: { userId_departmentId: { userId, departmentId } },
    });
    return !!membership?.active;
  }

  async listStaffNotes(id: string, userId: string) {
    const viewer = await this.viewerOf(userId);
    const request = await this.findOne(id, viewer);
    // Requesters can't read internal notes — unless they're a system admin
    // (admins routinely own test/demo tickets and must still see staff work).
    if (request.employeeId === userId && viewer.platformRole !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException('Requesters cannot read internal staff notes.');
    }
    if (viewer.platformRole !== 'SYSTEM_ADMIN') {
      const membership = await this.prisma.departmentMember.findUnique({
        where: { userId_departmentId: { userId, departmentId: request.departmentId } },
      });
      if (!membership?.active) {
        throw new ForbiddenException('Only department staff can read internal notes.');
      }
    }
    const notes = await this.prisma.staffNote.findMany({
      where: { requestId: id },
      include: { author: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return notes;
  }

  /**
   * Resolution feedback (CSAT): only the requesting employee, only on a
   * COMPLETED ticket, rated once. Feeds the admin CSAT average.
   */
  async submitFeedback(id: string, input: { rating: number; feedbackNote?: string }, userId: string) {
    const viewer = await this.viewerOf(userId);
    const request = await this.findOne(id, viewer);
    if (request.employeeId !== userId) {
      throw new ForbiddenException('Only the requesting employee can rate this ticket.');
    }
    if (request.status !== 'COMPLETED') {
      throw new BadRequestException('Only completed tickets can be rated.');
    }
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new BadRequestException('Rating must be an integer from 1 to 5.');
    }
    if (request.rating != null) {
      throw new ConflictException('This ticket has already been rated.');
    }
    const note = (input.feedbackNote || '').trim();
    if (note.length > 2000) {
      throw new BadRequestException('Feedback note is too long (max 2000 characters).');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.request.update({
        where: { id },
        data: { rating: input.rating, feedbackNote: note || null },
      });
      await tx.auditLog.create({
        data: {
          requestId: id,
          actorId: userId,
          action: 'FEEDBACK_SUBMITTED',
          newValue: `${input.rating}/5`,
        },
      });
      return row;
    });
    return updated;
  }

  /**
   * Cross-department report for system admins (product-spec §3).
   */
  async getReport() {
    const byStatus = await this.prisma.request.groupBy({
      by: ['status'],
      _count: true,
    });
    const departments = await this.prisma.department.findMany({ orderBy: { code: 'asc' } });
    const openByDept = await this.prisma.request.groupBy({
      by: ['departmentId'],
      where: { status: { notIn: TERMINAL_STATUSES } },
      _count: true,
    });
    const openMap = new Map(openByDept.map((r) => [r.departmentId, r._count]));
    const totalByDept = await this.prisma.request.groupBy({
      by: ['departmentId'],
      _count: true,
    });
    const totalMap = new Map(totalByDept.map((r) => [r.departmentId, r._count]));
    const breachedByDept = await this.prisma.request.groupBy({
      by: ['departmentId'],
      where: { status: { notIn: TERMINAL_STATUSES }, slaDueAt: { lt: new Date() } },
      _count: true,
    });
    const breachedMap = new Map(breachedByDept.map((r) => [r.departmentId, r._count]));
    const csat = await this.prisma.request.aggregate({
      where: { rating: { not: null } },
      _avg: { rating: true },
      _count: { rating: true },
    });
    // Org-wide creation volume, last 7 days inclusive, zero-filled so
    // charts always receive exactly 7 points.
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const rawVolume = await this.prisma.$queryRaw<{ day: string; count: bigint }[]>`
      SELECT date("createdAt") AS day, COUNT(*) AS count
      FROM "Request"
      WHERE date("createdAt") >= date('now', '-6 days')
      GROUP BY day ORDER BY day ASC
    `;
    const volumeMap = new Map(rawVolume.map((r) => [r.day, Number(r.count)]));
    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      volume: dayKeys.map((day) => ({ day, count: volumeMap.get(day) ?? 0 })),
      departments: departments.map((d) => ({
        code: d.code,
        name: d.name,
        open: openMap.get(d.id) || 0,
        total: totalMap.get(d.id) || 0,
        breached: breachedMap.get(d.id) || 0,
      })),
      csatAverage: csat._avg.rating == null ? null : Math.round(csat._avg.rating * 100) / 100,
      csatCount: csat._count.rating,
    };
  }

  /**
   * Operations CSV export (admin only): every request as one row.
   * Returned as a string; the controller sets text/csv headers.
   * Optional filters mirror the queue so exports honor what the admin
   * is actually looking at — omitted filters mean everything.
   */
  async exportCsv(filters?: { status?: string; departmentId?: string; priority?: string }): Promise<string> {
    const where: Record<string, unknown> = {};
    if (filters?.status) where['status'] = filters.status;
    if (filters?.departmentId) where['departmentId'] = filters.departmentId;
    if (filters?.priority) where['priority'] = filters.priority;
    const rows = await this.prisma.request.findMany({
      where,
      include: {
        department: { select: { name: true } },
        requestType: { select: { name: true } },
        owner: { select: { email: true } },
        claimant: { select: { email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const cell = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = ['ID', 'Title', 'Department', 'Type', 'Status', 'Priority', 'Requester', 'Claimant', 'CreatedAt', 'CompletedAt', 'Rating'];
    const lines = [
      header.map(cell).join(','),
      ...rows.map((r) =>
        [
          r.id, r.title, r.department.name, r.requestType.name, r.status, r.priority,
          r.owner.email, r.claimant?.email ?? '', r.createdAt.toISOString(),
          r.completedAt ? r.completedAt.toISOString() : '', r.rating ?? '',
        ].map(cell).join(','),
      ),
    ];
    return lines.join('\n');
  }

  /**
   * Admin analytics, computed from existing rows — no schema change.
   * Time-to-claim/complete come from audit timestamps; workload from
   * claimedById; rates from status/action counts; aging from open rows.
   */
  async getAnalytics() {
    const [total, byStatus, requests, audits] = await Promise.all([
      this.prisma.request.count(),
      this.prisma.request.groupBy({ by: ['status'], _count: true }),
      this.prisma.request.findMany({
        select: { id: true, status: true, createdAt: true, completedAt: true, claimedById: true },
      }),
      this.prisma.auditLog.findMany({
        where: { action: { in: ['REQUEST_CREATED', 'REQUEST_CLAIMED', 'STATUS_CHANGED', 'REQUEST_REROUTED'] } },
        select: { requestId: true, action: true, newValue: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 5000,
      }),
    ]);
    const createdAtByReq = new Map<string, number>();
    const claimedAtByReq = new Map<string, number>();
    let reroutes = 0;
    for (const a of audits) {
      if (!a.requestId) continue;
      if (a.action === 'REQUEST_CREATED' && !createdAtByReq.has(a.requestId)) {
        createdAtByReq.set(a.requestId, new Date(a.createdAt).getTime());
      } else if (a.action === 'REQUEST_CLAIMED' && !claimedAtByReq.has(a.requestId)) {
        claimedAtByReq.set(a.requestId, new Date(a.createdAt).getTime());
      } else if (a.action === 'REQUEST_REROUTED') {
        reroutes++;
      }
    }
    // Fall back to request.createdAt when the audit row predates logging.
    for (const r of requests) {
      if (!createdAtByReq.has(r.id)) createdAtByReq.set(r.id, new Date(r.createdAt).getTime());
    }
    const claimGaps: number[] = [];
    for (const [reqId, claimedAt] of claimedAtByReq) {
      const created = createdAtByReq.get(reqId);
      if (created != null && claimedAt >= created) claimGaps.push((claimedAt - created) / 3600_000);
    }
    const completeGaps: number[] = [];
    for (const r of requests) {
      if (r.status === 'COMPLETED' && r.completedAt) {
        const created = createdAtByReq.get(r.id);
        const done = new Date(r.completedAt).getTime();
        if (created != null && done >= created) completeGaps.push((done - created) / 3600_000);
      }
    }
    const avg = (xs: number[]) => (xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10);
    const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, r._count]));
    const now = Date.now();
    const aging = { under1d: 0, d1to3: 0, d3to7: 0, over7d: 0 };
    const workload = new Map<string, number>();
    for (const r of requests) {
      const isOpen = !TERMINAL_STATUSES.includes(r.status);
      if (isOpen) {
        const ageH = (now - new Date(r.createdAt).getTime()) / 3600_000;
        if (ageH < 24) aging.under1d++;
        else if (ageH < 72) aging.d1to3++;
        else if (ageH < 168) aging.d3to7++;
        else aging.over7d++;
      }
      if (r.claimedById) workload.set(r.claimedById, (workload.get(r.claimedById) || 0) + 1);
    }
    const claimants = workload.size > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: [...workload.keys()] } },
          select: { id: true, displayName: true, email: true },
        })
      : [];
    const nameOf = new Map(claimants.map((u) => [u.id, u.displayName || u.email]));
    return {
      total,
      byStatus: statusMap,
      timeToClaimAvgHours: avg(claimGaps),
      timeToClaimCount: claimGaps.length,
      timeToCompleteAvgHours: avg(completeGaps),
      timeToCompleteCount: completeGaps.length,
      rejectionRate: total === 0 ? 0 : Math.round(((statusMap['REJECTED'] || 0) / total) * 1000) / 10,
      rerouteRate: total === 0 ? 0 : Math.round((reroutes / total) * 1000) / 10,
      rerouteCount: reroutes,
      aging,
      workloadByAgent: [...workload.entries()]
        .map(([userId, count]) => ({ userId, name: nameOf.get(userId) || userId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }
}
