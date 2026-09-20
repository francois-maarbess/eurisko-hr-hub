import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT_TOKEN } from './prisma.service';

const MAX_ATTEMPTS = 5;

/**
 * Durable notification outbox + in-app inbox (product-spec §6/§8).
 *
 * Two halves with different fates:
 * - Inbox rows (`Notification`) are written by fanout() right after each
 *   request event and served to the app bell immediately. This always works.
 * - Outbox rows (`NotificationEvent`) are picked up by the minutely cron and
 *   POSTed to NOTIFY_WEBHOOK_URL (a Slack bot, push worker, digest job…).
 *   With no URL configured they stay PENDING as an audit trail — visible,
 *   never silently dropped. Firebase push is a future provider, not a flag.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient) {}

  onModuleInit() {
    // Minutely outbox sweep without a scheduler dependency (keeps the
    // ts-jest CommonJS setup intact). Never throws; each run is self-healing.
    const timer = setInterval(() => {
      this.deliverPendingEvents().catch((e) =>
        this.logger.error(`Outbox sweep failed: ${(e as Error).message}`),
      );
    }, 60_000);
    const maybeUnref = (timer as unknown as { unref?: () => void }).unref;
    if (typeof maybeUnref === 'function') maybeUnref.call(timer);
  }

  async emit(input: {
    requestId?: string;
    eventType: string;
    payload?: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<void> {
    try {
      await this.prisma.notificationEvent.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        update: {},
        create: {
          requestId: input.requestId,
          eventType: input.eventType,
          payload: JSON.stringify(input.payload || {}),
          status: 'PENDING',
          idempotencyKey: input.idempotencyKey,
        },
      });
    } catch (e) {
      this.logger.error(`Outbox emit failed (${input.eventType}): ${(e as Error).message}`);
    }
  }

  /**
   * In-app inbox fan-out. Runs post-commit; never throws — inbox projection
   * must not break the request mutation it accompanies.
   * Rules: employee hears about claim/complete/reject/cancel on their own
   * requests (unless they did it themselves); department staff hear about
   * new and cancelled requests in their departments.
   */
  async fanout(input: { requestId: string; eventType: string; actorId: string }): Promise<void> {
    try {
      const req = await this.prisma.request.findUnique({
        where: { id: input.requestId },
        select: {
          id: true, title: true, employeeId: true, departmentId: true,
          department: { select: { id: true, name: true } },
        },
      });
      if (!req) return;
      const members = await this.prisma.departmentMember.findMany({
        where: { departmentId: req.departmentId, active: true },
        select: { userId: true },
      });
      const staffIds = members.map((m) => m.userId).filter((id) => id !== input.actorId);
      const short = req.title.length > 60 ? `${req.title.slice(0, 57)}...` : req.title;
      const rows: { userId: string; type: string; title: string; body: string }[] = [];
      const toEmployee = (title: string, body: string) => {
        if (req.employeeId !== input.actorId) {
          rows.push({ userId: req.employeeId, type: input.eventType, title, body });
        }
      };
      switch (input.eventType) {
        case 'request.created':
          for (const id of staffIds) {
            rows.push({ userId: id, type: input.eventType, title: `New request in ${req.department.name}`, body: short });
          }
          break;
        case 'request.claimed':
          toEmployee('Your request was claimed', `“${short}” is now being handled.`);
          break;
        case 'request.completed':
          toEmployee('Your request was completed', `“${short}” is resolved — open it to review.`);
          break;
        case 'request.rejected':
          toEmployee('Your request was rejected', `“${short}” was rejected — open it for the reason.`);
          break;
        case 'request.cancelled':
          for (const id of staffIds) {
            rows.push({ userId: id, type: input.eventType, title: 'A request was cancelled', body: short });
          }
          break;
        case 'document.uploaded':
          toEmployee('A document was added to your request', `“${short}” has a new attachment.`);
          break;
        default:
          return;
      }
      if (rows.length === 0) return;
      const created = await this.prisma.notification.createMany({
        data: rows.map((r) => ({ ...r, requestId: req.id })),
      });
      this.logger.log(`Inbox fan-out: ${created.count} notification(s) for ${input.eventType} on ${input.requestId}`);
    } catch (e) {
      this.logger.error(`Inbox fan-out failed for ${input.eventType}: ${(e as Error).message}`);
    }
  }

  async listForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    const res = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return res.count > 0;
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return res.count;
  }

  async deliverPendingEvents() {
    const webhook = process.env['NOTIFY_WEBHOOK_URL'];
    const pending = await this.prisma.notificationEvent.findMany({
      where: { status: 'PENDING', attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    if (pending.length === 0) return;

    if (!webhook) {
      // Debug level on purpose: with no receiver configured this would
      // otherwise spam one warning per minute forever. The rows remain
      // queryable as the durable trail.
      this.logger.debug(
        `Notification delivery deferred: ${pending.length} event(s) pending, NOTIFY_WEBHOOK_URL not configured`,
      );
      return;
    }

    for (const event of pending) {
      try {
        const res = await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': event.idempotencyKey },
          body: JSON.stringify({
            id: event.id,
            type: event.eventType,
            requestId: event.requestId,
            payload: JSON.parse(event.payload || '{}'),
            createdAt: event.createdAt,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`webhook responded ${res.status}`);
        await this.prisma.notificationEvent.update({
          where: { id: event.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
      } catch (e) {
        const attempts = event.attempts + 1;
        await this.prisma.notificationEvent.update({
          where: { id: event.id },
          data: {
            attempts,
            lastError: (e as Error).message?.slice(0, 500),
            ...(attempts >= MAX_ATTEMPTS ? { status: 'FAILED' } : {}),
          },
        });
        this.logger.error(`Notification ${event.id} delivery failed (attempt ${attempts}): ${(e as Error).message}`);
      }
    }
  }
}
