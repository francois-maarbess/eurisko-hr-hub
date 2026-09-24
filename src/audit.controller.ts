import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { Roles, RolesGuard } from './auth/roles.guard';
import { AuditService } from './audit.service';

/**
 * Global audit search (admin only). Per-ticket history stays on
 * GET /requests/:id/activity; this is the cross-ticket compliance view.
 */
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  search(
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('requestId') requestId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit != null ? parseInt(limit, 10) : undefined;
    return this.audit.search({
      actor,
      action,
      requestId,
      from,
      to,
      limit: n != null && !Number.isNaN(n) ? n : undefined,
    });
  }
}
