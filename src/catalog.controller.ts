import { Controller, Get, Query, UseGuards, Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PRISMA_CLIENT_TOKEN } from './prisma.service';

/**
 * Product catalog: departments with their active request types.
 * The create form loads its pickers from here — never derived from
 * existing tickets (which caused duplicate options per request).
 */
@Controller('catalog')
@UseGuards(JwtAuthGuard)
export class CatalogController {
  constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient) {}

  @Get('departments')
  departments() {
    return this.prisma.department.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('request-types')
  requestTypes(@Query('departmentId') departmentId?: string) {
    return this.prisma.requestType.findMany({
      where: {
        active: true,
        ...(departmentId ? { departmentId } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }
}
