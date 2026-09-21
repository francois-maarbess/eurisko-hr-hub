import { Controller, Get, Query, UseGuards, Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CurrentUser } from './auth/current-user.decorator';
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

  // Everyone sees active entries. Admins may pass ?includeInactive=1 to
  // manage retired entries back to life (otherwise deactivation is a
  // one-way door in the UI).
  @Get('departments')
  departments(@Query('includeInactive') includeInactive?: string, @CurrentUser() user?: any) {
    const showAll = includeInactive === '1' && user?.platformRole === 'SYSTEM_ADMIN';
    return this.prisma.department.findMany({
      where: showAll ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('request-types')
  requestTypes(
    @Query('departmentId') departmentId?: string,
    @Query('includeInactive') includeInactive?: string,
    @CurrentUser() user?: any,
  ) {
    const showAll = includeInactive === '1' && user?.platformRole === 'SYSTEM_ADMIN';
    return this.prisma.requestType.findMany({
      where: {
        ...(showAll ? {} : { active: true }),
        ...(departmentId ? { departmentId } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }
}
