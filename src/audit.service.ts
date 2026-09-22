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
}
