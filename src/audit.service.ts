import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT_TOKEN } from './prisma.service';

/**
 * Append-only audit trail (data-model §1, product-spec §6).
 * Writes never throw: an audit failure is logged server-side but must not
 * break the business mutation it accompanies.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient) {}

  async append(data: {
    requestId?: string;
    actorId: string;
    action: string;
    oldValue?: string;
    newValue?: string;
    metadata?: string;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          requestId: data.requestId,
          actorId: data.actorId,
          action: data.action,
          oldValue: data.oldValue,
          newValue: data.newValue,
          metadata: data.metadata,
        },
      });
    } catch (e) {
      this.logger.error(`Audit append failed (${data.action}): ${(e as Error).message}`);
    }
  }

  async forRequest(requestId: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: { requestId },
      orderBy: { createdAt: 'asc' },
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, displayName: true, email: true },
    });
    const names = new Map(users.map((u) => [u.id, u.displayName || u.email]));
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      oldValue: r.oldValue,
      newValue: r.newValue,
      metadata: r.metadata,
      createdAt: r.createdAt,
      actorName: names.get(r.actorId) || 'System',
    }));
  }

  /**
   * Global audit search (admin only via controller guard). All filters
   * optional; capped at 200 rows newest-first so the UI stays fast.
   */
  async search(filters: { actor?: string; action?: string; requestId?: string; from?: string; to?: string; limit?: number }) {
    const where: Record<string, unknown> = {};
    if (filters.requestId) where['requestId'] = filters.requestId;
    if (filters.action) where['action'] = filters.action;
    if (filters.from || filters.to) {
      const createdAt: Record<string, Date> = {};
      if (filters.from) {
        const d = new Date(filters.from);
        if (!Number.isNaN(d.getTime())) createdAt['gte'] = d;
      }
      if (filters.to) {
        const d = new Date(filters.to);
        if (!Number.isNaN(d.getTime())) createdAt['lte'] = d;
      }
      if (Object.keys(createdAt).length > 0) where['createdAt'] = createdAt;
    }
    // Actor matches display name or email (contains, case-insensitive).
    let actorIds: string[] | undefined;
    if (filters.actor) {
      const users = await this.prisma.user.findMany({
        where: {
          OR: [
            { displayName: { contains: filters.actor } },
            { email: { contains: filters.actor } },
          ],
        },
        select: { id: true },
        take: 50,
      });
      actorIds = users.map((u) => u.id);
      if (actorIds.length === 0) return [];
      where['actorId'] = { in: actorIds };
    }
    const limit = Math.min(Math.max(1, filters.limit || 100), 200);
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const ids = [...new Set(rows.map((r) => r.actorId))];
    const users = ids.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, displayName: true, email: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.displayName || u.email]));
    return rows.map((r) => ({
      id: r.id,
      requestId: r.requestId,
      action: r.action,
      oldValue: r.oldValue,
      newValue: r.newValue,
      createdAt: r.createdAt,
      actorName: names.get(r.actorId) || 'System',
    }));
  }
}
