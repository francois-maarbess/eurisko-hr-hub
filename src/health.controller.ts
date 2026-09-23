import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT_TOKEN } from './prisma.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json');

/**
 * Liveness probe (architecture §6): checks API dependencies without
 * exposing internals — status word plus timestamp only, never errors
 * or connection strings. Returns 503 when unhealthy so orchestrators
 * (Render, Docker, uptime monitors) actually restart or alert.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const base = {
      version,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'connected', ...base };
    } catch {
      res.status(503);
      return { status: 'degraded', database: 'error', ...base };
    }
  }
}
