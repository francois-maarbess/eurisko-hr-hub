import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PRISMA_CLIENT_TOKEN } from './prisma.service';
import { AuditService } from './audit.service';
import { NotificationsService } from './notifications.service';

const MAX_BYTES = 5 * 1024 * 1024;
/** Per-user quota across live payloads (env-overridable). Keeps one careless
 * uploader from bloating the SQLite file instructors carry around. */
function quotaBytes(): number {
  const n = Number(process.env['UPLOAD_QUOTA_BYTES'] || 50 * 1024 * 1024);
  return Number.isFinite(n) && n > 0 ? n : 50 * 1024 * 1024;
}
const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']);
const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

const MAGIC_BYTES: Record<string, number[][]> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/jpg': [[0xff, 0xd8, 0xff]],
};

/**
 * Document attachments (product-spec §6, ADR-001/ADR-003).
 *
 * Payloads live in the `data` bytea column on localhost (capped at 5MB);
 * the three private persist/read/drop methods are the documented swap seam
 * for an S3-compatible backend in production — see ADR-003. All transfers
 * are brokered by the API: no public URLs, no client storage credentials.
 */
@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private lastSweepAt: string | null = null;
  private lastSweepDropped = 0;

  onModuleInit() {
    // Purge once at boot (a restart must not skip retention) then daily.
    // Same in-process pattern as the notification outbox sweep.
    void this.purgeExpired()
      .then((dropped) => {
        this.lastSweepAt = new Date().toISOString();
        this.lastSweepDropped = dropped;
        if (dropped > 0) this.logger.log(`Retention boot purge: dropped ${dropped} expired document payload(s).`);
      })
      .catch((e) => this.logger.error(`Retention boot purge failed: ${(e as Error).message}`));
    // Daily retention sweep in-process (same pattern as the notification
    // outbox sweep). Self-healing; a failed run retries next interval.
    const timer = setInterval(() => {
      this.purgeExpired()
        .then((dropped) => {
          this.lastSweepAt = new Date().toISOString();
          this.lastSweepDropped = dropped;
        })
        .catch((e) => this.logger.error(`Retention sweep failed: ${(e as Error).message}`));
    }, 24 * 60 * 60 * 1000);
    const maybeUnref = (timer as unknown as { unref?: () => void }).unref;
    if (typeof maybeUnref === 'function') maybeUnref.call(timer);
  }

  /** Surfaced on /health so staleness is visible without a metrics stack. */
  sweepStatus() {
    return { lastSweepAt: this.lastSweepAt, lastSweepDropped: this.lastSweepDropped };
  }

  private ext(name: string): string {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i).toLowerCase() : '';
  }

  private checkMagic(mime: string, buffer: Buffer): boolean {
    const signatures = MAGIC_BYTES[mime] || [];
    return signatures.some((sig) => sig.every((byte, i) => buffer[i] === byte));
  }

  /**
   * Malware-scan seam (week-5: ClamAV/S3). Default allows — magic bytes +
   * size + type allowlist are the localhost controls. Override this method
   * (or the injected scanner later) without touching upload().
   */
  protected async scanBuffer(_buffer: Buffer): Promise<{ clean: boolean; reason?: string }> {
    return { clean: true };
  }

  private async canManage(userId: string, platformRole: string, departmentId: string): Promise<boolean> {
    if (platformRole === 'SYSTEM_ADMIN') return true;
    const membership = await this.prisma.departmentMember.findUnique({
      where: { userId_departmentId: { userId, departmentId } },
    });
    return !!membership?.active;
  }

  async upload(
    requestId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    user: { id: string; platformRole: string },
  ) {
    const request = await this.prisma.request.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');
    if (!(await this.canManage(user.id, user.platformRole, request.departmentId))) {
      throw new ForbiddenException('Only department staff can attach documents.');
    }
    if (!file?.buffer?.length) throw new BadRequestException('No file received.');
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('File too large (max 5MB).');
    }
    const extension = this.ext(file.originalname || '');
    if (!ALLOWED_EXT.has(extension) || !ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Unsupported file type. Allowed: PDF, PNG, JPEG.');
    }
    if (!this.checkMagic(file.mimetype, file.buffer)) {
      throw new BadRequestException('File content does not match its declared type.');
    }
    const scan = await this.scanBuffer(file.buffer);
    if (!scan.clean) {
      throw new BadRequestException(scan.reason || 'File rejected by content scan.');
    }
    const used = await this.prisma.document.aggregate({
      where: { uploadedBy: user.id, deletedAt: null },
      _sum: { byteSize: true },
    });
    if ((used._sum.byteSize || 0) + file.size > quotaBytes()) {
      throw new BadRequestException('Upload quota exceeded (50MB of live attachments per user). Delete old files first.');
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = `req-${requestId}/${randomUUID()}-${Date.now()}`;
    const purgeAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const doc = await this.prisma.document.create({
      data: {
        requestId,
        storageKey,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        byteSize: file.size,
        checksum,
        data: new Uint8Array(file.buffer),
        uploadedBy: user.id,
        purgeAt,
      },
    });

    await this.audit.append({
      requestId,
      actorId: user.id,
      action: 'DOCUMENT_UPLOADED',
      newValue: doc.originalFilename,
    });
    await this.notifications.emit({
      requestId,
      eventType: 'document.uploaded',
      payload: { documentId: doc.id },
      idempotencyKey: `doc-${doc.id}-uploaded`,
    });
    await this.notifications.fanout({ requestId, eventType: 'document.uploaded', actorId: user.id });

    const meta = { ...doc };
    delete (meta as Record<string, unknown>)['data'];
    return meta;
  }

  async list(requestId: string, user: { id: string; platformRole: string }) {
    const request = await this.prisma.request.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');
    const terminal = ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(request.status);
    const staff = await this.canManage(user.id, user.platformRole, request.departmentId);
    if (!staff && !(request.employeeId === user.id && terminal)) {
      throw new ForbiddenException('You cannot view these documents.');
    }
    const docs = await this.prisma.document.findMany({
      where: { requestId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, originalFilename: true, mimeType: true, byteSize: true,
        checksum: true, uploadedBy: true, createdAt: true,
      },
    });
    return docs;
  }

  async download(requestId: string, docId: string, user: { id: string; platformRole: string }) {
    const request = await this.prisma.request.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');
    const terminal = ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(request.status);
    const staff = await this.canManage(user.id, user.platformRole, request.departmentId);
    if (!staff && !(request.employeeId === user.id && terminal)) {
      throw new ForbiddenException('You cannot download this document.');
    }
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, requestId, deletedAt: null },
    });
    if (!doc || !doc.data) {
      // Missing row or purged payload: 404, never a broken download.
      throw new NotFoundException('Document not found.');
    }
    return {
      filename: doc.originalFilename,
      contentType: doc.mimeType,
      checksum: doc.checksum,
      content: Buffer.from(doc.data),
    };
  }

  async remove(requestId: string, docId: string, user: { id: string; platformRole: string }) {
    const request = await this.prisma.request.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');
    if (!(await this.canManage(user.id, user.platformRole, request.departmentId))) {
      throw new ForbiddenException('Only department staff can delete documents.');
    }
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, requestId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found.');

    // Remove the payload first, then clear the active reference, one row —
    // the row stays for audit while the bytes are gone for good.
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { data: null, deletedAt: new Date() },
    });
    await this.audit.append({
      requestId,
      actorId: user.id,
      action: 'DOCUMENT_DELETED',
      oldValue: doc.originalFilename,
    });
    return { deleted: true };
  }

  /**
   * Retention purge (acceptance 11): permanently drops payloads older than
   * their purge date. Rows stay for audit; purged payloads never come back.
   * Wired to a daily cron below; unit-tested directly for determinism.
   */
  async purgeExpired(now = new Date()): Promise<number> {
    const res = await this.prisma.document.updateMany({
      where: { purgeAt: { lte: now }, deletedAt: null, NOT: { data: null } },
      data: { data: null },
    });
    if (res.count > 0) {
      this.logger.log(`Retention purge: dropped ${res.count} expired document payload(s).`);
    }
    return res.count;
  }
}
