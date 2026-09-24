import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import type { Response } from 'express';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT_TOKEN } from './prisma.service';
import { AiIntakeService } from './ai/ai-intake.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json');

/**
 * Liveness + readiness probe (architecture §6): database, migration
 * state, outbox worker backlog, and AI provider — status words and
 * counts only, never errors or connection strings. Returns 503 when
 * unhealthy so orchestrators (Render, Docker, uptime monitors)
 * actually restart or alert.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient,
    @Optional() private readonly ai?: AiIntakeService,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const base = {
      version,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      res.status(503);
      return { status: 'degraded', database: 'error', ...base };
    }

    const [migrations, outbox] = await Promise.all([
      this.migrationStatus().catch(() => ({ applied: -1, pending: -1 })),
      this.outboxStatus().catch(() => ({ pending: -1, failed: -1 })),
    ]);
    const unhealthy = migrations.pending > 0;
    if (unhealthy) res.status(503);
    return {
      status: unhealthy ? 'degraded' : 'ok',
      database: 'connected',
      migrations,
      outbox,
      ai: this.ai?.providerStatus() || { provider: 'local', model: 'offline-rules', lastErrorAt: null, lastErrorMessage: null },
      ...base,
    };
  }

  /** Compares migration files on disk with rows in _prisma_migrations. */
  private async migrationStatus() {
    const dir = join(__dirname, '..', 'prisma', 'migrations');
    const entries = await fs.readdir(dir);
    const onDisk = entries.filter((e) => !e.startsWith('.') && e !== 'migration_lock.toml');
    let applied: string[] = [];
    try {
      const rows = (await this.prisma.$queryRawUnsafe(
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL',
      )) as { migration_name: string }[];
      applied = rows.map((r) => r.migration_name);
    } catch {
      // Fresh database where the migrations table may not exist yet.
      applied = [];
    }
    const pending = onDisk.filter((m) => !applied.includes(m)).length;
    return { applied: applied.length, pending };
  }

  private async outboxStatus() {
    const [pending, failed] = await Promise.all([
      (this.prisma as any).notificationEvent.count({ where: { status: 'PENDING' } }),
      (this.prisma as any).notificationEvent.count({ where: { status: 'FAILED' } }),
    ]);
    return { pending, failed };
  }
}
