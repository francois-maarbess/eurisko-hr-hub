import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT_TOKEN } from './prisma.service';

/**
 * Liveness probe (architecture §6): checks API dependencies without
 * exposing internals — status word plus timestamp only, never errors
 * or connection strings.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'connected', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'degraded', database: 'error', timestamp: new Date().toISOString() };
    }
  }
}
