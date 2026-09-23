import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Patch,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { RerouteDto } from './dto/reroute.dto';
import { FeedbackDto } from './dto/feedback.dto';
import { StaffNoteDto } from './dto/staff-note.dto';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { Roles, RolesGuard } from './auth/roles.guard';
import { CurrentUser } from './auth/current-user.decorator';
import { AuditService } from './audit.service';

/** Human-friendly labels for audit actions (activity timeline). */
function activityLabel(action: string, oldValue?: string | null, newValue?: string | null): string {
  switch (action) {
    case 'REQUEST_CREATED':
      return 'Ticket created';
    case 'REQUEST_CLAIMED':
      return 'Claimed';
    case 'STATUS_CHANGED':
      return `Status changed: ${oldValue || '?'} → ${newValue || '?'}`;
    case 'REQUEST_REROUTED':
      return `Re-routed to ${newValue || 'another department'}`;
    case 'DOCUMENT_UPLOADED':
      return 'Document attached';
    case 'DOCUMENT_DELETED':
      return 'Document removed';
    case 'STAFF_NOTE_ADDED':
      return 'Internal note added';
    case 'FEEDBACK_SUBMITTED':
      return `Rated ${newValue || ''}`.trim();
    case 'MEMBER_ADDED':
      return 'Team member added';
    case 'MEMBER_REMOVED':
      return 'Team member removed';
    default:
      return action
        .toLowerCase()
        .split('_')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(' ');
  }
}

function activityDetails(
  action: string,
  oldValue?: string | null,
  newValue?: string | null,
  metadata?: string | null,
): string | null {
  if (action === 'REQUEST_REROUTED' && metadata) {
    try {
      const m = JSON.parse(metadata) as { reason?: string };
      return m.reason || null;
    } catch {
      return null;
    }
  }
  if (action === 'STATUS_CHANGED') return null;
  return newValue || oldValue || null;
}

@Controller('requests')
@UseGuards(JwtAuthGuard)
export class RequestsController {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query('view') view?: string) {
    return this.requestsService.findAll(user.id, view);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Get('report')
  report() {
    return this.requestsService.getReport();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Get('export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="requests-export.csv"')
  exportCsv() {
    return this.requestsService.exportCsv();
  }

  @Get('breach')
  breached(@CurrentUser() user: any) {
    return this.requestsService.getBreached(user.id);
  }

  @Get(':id/audit')
  async auditTrail(@Param('id') id: string, @CurrentUser() user: any) {
    // findOne enforces the same read gate: existence never leaks to strangers.
    await this.requestsService.findOne(id, { id: user.id, platformRole: user.platformRole });
    return this.audit.forRequest(id);
  }

  @Get(':id/activity')
  async activity(@Param('id') id: string, @CurrentUser() user: any) {
    const viewer = { id: user.id, platformRole: user.platformRole };
    await this.requestsService.findOne(id, viewer);
    const rows = await this.audit.forRequest(id);
    return rows.map((r) => ({
      id: r.id,
      label: activityLabel(r.action, r.oldValue, r.newValue),
      actor: r.actorName,
      timestamp: r.createdAt,
      details: activityDetails(r.action, r.oldValue, r.newValue, r.metadata),
    }));
  }

  @Get(':id/notes')
  listNotes(@Param('id') id: string, @CurrentUser() user: any) {
    return this.requestsService.listStaffNotes(id, user.id);
  }

  @Post(':id/notes')
  @HttpCode(HttpStatus.CREATED)
  addNote(@Param('id') id: string, @Body() dto: StaffNoteDto, @CurrentUser() user: any) {
    return this.requestsService.addStaffNote(id, dto.content, user.id);
  }

  @Post(':id/feedback')
  @HttpCode(HttpStatus.CREATED)
  feedback(@Param('id') id: string, @Body() dto: FeedbackDto, @CurrentUser() user: any) {
    return this.requestsService.submitFeedback(id, dto, user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.requestsService.findOne(id, { id: user.id, platformRole: user.platformRole });
  }

  @Post('check-duplicates')
  @HttpCode(HttpStatus.OK)
  checkDuplicates(
    @Body() body: { departmentId?: string; title?: string; description?: string; excludeId?: string },
  ) {
    return this.requestsService.findDuplicates({
      departmentId: body.departmentId,
      title: body.title || '',
      description: body.description,
      excludeId: body.excludeId,
    });
  }

  @Post()
  create(@Body() dto: CreateRequestDto, @CurrentUser() user: any) {
    return this.requestsService.create(dto, user.id);
  }

  @Patch(':id/claim')
  @HttpCode(HttpStatus.OK)
  claim(@Param('id') id: string, @CurrentUser() user: any) {
    return this.requestsService.claim(id, user.id);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.requestsService.updateStatus(id, dto, user.id);
  }

  @Patch(':id/reroute')
  @HttpCode(HttpStatus.OK)
  reroute(@Param('id') id: string, @Body() dto: RerouteDto, @CurrentUser() user: any) {
    return this.requestsService.reroute(id, dto, user.id);
  }
}
