import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CreateRequestDto } from './dto/create-request.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { PRISMA_CLIENT_TOKEN } from './prisma.service';
import { AuditService } from './audit.service';
import { NotificationsService } from './notifications.service';

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED', 'REJECTED'],
  IN_PROGRESS: ['COMPLETED', 'REJECTED'],
};

const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED'];

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, STANDARD: 1, LOW: 2 };

const STOPWORDS = new Set(
  'a,an,and,are,as,at,be,by,for,from,has,have,how,in,into,is,it,its,of,on,or,that,the,their,this,to,was,what,when,with,need,needs,please,help,request,my,me,get,got,has,had,been,are,was,were,will,would,can,could,should,our,you,your,our,for,than,then,there,they,them,do,does,did,not,no,yes,if,else,than,too,very,just,about,into,over,after,before,up,down,out,off,on,again,once,here,there,when,where,which,who,whom,this,that,these,those,am,an,are,as,at,be,because,been,before,being,below,between,both,but,by,doing,each,few,further,had,having,he,her,hers,herself,him,himself,his,i,me,more,most,my,myself,nor,now,once,only,other,ought,same,she,so,some,such,than,too,until,very,was,were,yours,yourself'.split(','),
);

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
  ) {}

  private openWhere() {
    return { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } };
  }

  private readonly fullInclude = {
    department: true,
    requestType: true,
    owner: true,
    claimant: true,
  } as const;

  /**
   * Scoped views (single company, no tenancy here — scoping is by person).
   * - mine (default): only requests I created. Nobody sees other people's
   *   tickets unless they have a reason to.
   * - queue: open tickets in MY departments (agents), everything open (admin).
   * - claimed: open tickets claimed by me.
   */
  async findAll(userId: string, view?: string) {
    if (view === 'claimed') {
      return this.prisma.request.findMany({
        where: { claimedById: userId, ...this.openWhere() },
        include: this.fullInclude,
        orderBy: { createdAt: 'desc' },
      });
    }

    if (view === 'queue') {
      const rank = (r: { priority: string; createdAt: Date }) =>
        (PRIORITY_RANK[r.priority] ?? 99) * 1e15 + r.createdAt.getTime();
      // Acceptance 10: URGENT before STANDARD before LOW, then oldest first.
      const byPriority = (rows: { priority: string; createdAt: Date }[]) =>
        [...rows].sort((a, b) => rank(a) - rank(b));

      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.platformRole === 'SYSTEM_ADMIN') {
        const all = await this.prisma.request.findMany({
          where: this.openWhere(),
          include: this.fullInclude,
        });
        return byPriority(all);
      }
      const memberships = await this.prisma.departmentMember.findMany({
        where: { userId, active: true },
      });
      if (memberships.length === 0) return [];
      const scoped = await this.prisma.request.findMany({
        where: {
          departmentId: { in: memberships.map((m) => m.departmentId) },
          ...this.openWhere(),
        },
        include: this.fullInclude,
      });
      return byPriority(scoped);
    }

    return this.prisma.request.findMany({
      where: { employeeId: userId },
      include: this.fullInclude,
      orderBy: { createdAt: 'desc' },
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
      include: { department: true, requestType: true, owner: true, claimant: true },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (viewer.platformRole === 'SYSTEM_ADMIN') return request;
    if (request.employeeId === viewer.id) return request;
    const membership = await this.prisma.departmentMember.findUnique({
      where: { userId_departmentId: { userId: viewer.id, departmentId: request.departmentId } },
    });
    if (!membership?.active) {
      throw new ForbiddenException('You do not have access to this request.');
    }
    return request;
  }

  async create(dto: CreateRequestDto, employeeId: string) {
    // Validate department + request type belong together
    const requestType = await this.prisma.requestType.findUnique({
      where: { id: dto.requestTypeId },
    });
    if (!requestType) throw new BadRequestException('Invalid request type');
    if (requestType.departmentId !== dto.departmentId) {
      throw new BadRequestException('Request type does not belong to the specified department');
    }
    if (!requestType.active) {
      throw new BadRequestException('Request type is inactive');
    }

    // Request row + audit row atomically; notifications fan out after commit
    // and can never fail the write.
    const created = await this.prisma.$transaction(async (tx) => {
      const req = await tx.request.create({
        data: {
          employeeId,
          departmentId: dto.departmentId,
          requestTypeId: dto.requestTypeId,
          title: dto.title,
          description: dto.description,
          priority: dto.priority,
          status: 'PENDING',
        },
        include: { department: true, requestType: true },
      });
      await tx.auditLog.create({
        data: { requestId: req.id, actorId: employeeId, action: 'REQUEST_CREATED', newValue: req.title },
      });
      return req;
    });

    await this.notifications.emit({
      requestId: created.id,
      eventType: 'request.created',
      payload: { departmentId: created.departmentId, priority: created.priority, title: created.title },
      idempotencyKey: `req-${created.id}-created`,
    });
    await this.notifications.fanout({ requestId: created.id, eventType: 'request.created', actorId: employeeId });
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
      await tx.request.update({ where: { id }, data: updateData });
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
  }) {
    // Length 3 keeps short but meaningful words (vpn, HR-adjacent codes)
    // while stopwords kill noise like "for" and "the".
    const tokens = (input.title + ' ' + (input.description || ''))
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    if (tokens.length === 0 || !input.departmentId) return [];

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
    await this.audit.append({
      requestId: id,
      actorId: userId,
      action: 'STAFF_NOTE_ADDED',
      newValue: `note ${note.id}`,
    });
    return note;
  }

  async listStaffNotes(id: string, userId: string) {
    const viewer = await this.viewerOf(userId);
    const request = await this.findOne(id, viewer);
    if (request.employeeId === userId) {
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
    const csat = await this.prisma.request.aggregate({
      where: { rating: { not: null } },
      _avg: { rating: true },
      _count: { rating: true },
    });
    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      departments: departments.map((d) => ({
        code: d.code,
        name: d.name,
        open: openMap.get(d.id) || 0,
        total: totalMap.get(d.id) || 0,
      })),
      csatAverage: csat._avg.rating == null ? null : Math.round(csat._avg.rating * 100) / 100,
      csatCount: csat._count.rating,
    };
  }

  /**
   * Operations CSV export (admin only): every request as one row.
   * Returned as a string; the controller sets text/csv headers.
   */
  async exportCsv(): Promise<string> {
    const rows = await this.prisma.request.findMany({
      include: {
        department: { select: { code: true } },
        requestType: { select: { code: true } },
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
          r.id, r.title, r.department.code, r.requestType.code, r.status, r.priority,
          r.owner.email, r.claimant?.email ?? '', r.createdAt.toISOString(),
          r.completedAt ? r.completedAt.toISOString() : '', r.rating ?? '',
        ].map(cell).join(','),
      ),
    ];
    return lines.join('\n');
  }
}
