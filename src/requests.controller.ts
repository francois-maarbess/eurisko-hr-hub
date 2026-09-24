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
import { ReassignDto, TakeoverDto } from './dto/assignment.dto';
import { FeedbackDto } from './dto/feedback.dto';
import { StaffNoteDto } from './dto/staff-note.dto';
import { AiCorrectionDto } from './dto/ai-correction.dto';
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
    case 'AI_CORRECTION':
      return `AI classification corrected${newValue && newValue !== 'flagged' ? `: ${newValue}` : ''}`;
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
  findAll(
    @CurrentUser() user: any,
    @Query('view') view?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('claimedBy') claimedBy?: string,
  ) {
    const p = page != null ? Math.max(1, parseInt(page, 10) || 1) : undefined;
    const ps = pageSize != null ? Math.min(Math.max(1, parseInt(pageSize, 10) || 50), 200) : undefined;
    return this.requestsService.findAll(user.id, view, p, ps, claimedBy);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Get('report')
  report() {
    return this.requestsService.getReport();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Get('analytics')
  analytics() {
    return this.requestsService.getAnalytics();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Get('export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="requests-export.csv"')
  exportCsv(
    @Query('status') status?: string,
    @Query('departmentId') departmentId?: string,
    @Query('priority') priority?: string,
  ) {
    return this.requestsService.exportCsv({ status, departmentId, priority });
  }

  @Get('breach')
  breached(@CurrentUser() user: any) {
    return this.requestsService.getBreached(user.id);
  }

  @Get(':id/audit')
  async auditTrail(@Param('id') id: string, @CurrentUser() user: any) {
    // findOne enforces the same read gate: existence never leaks to strangers.
    const req = await this.requestsService.findOne(id, { id: user.id, platformRole: user.platformRole });
    const rows = await this.audit.forRequest(id);
    // Staff-note rows are invisible to non-staff (see STAFF_NOTE_ADDED).
    const staff = await this.requestsService.canSeeStaffActivity(user.id, user.platformRole, req.departmentId);
    return staff ? rows : rows.filter((r) => r.action !== 'STAFF_NOTE_ADDED');
  }

  @Get(':id/activity')
  async activity(@Param('id') id: string, @CurrentUser() user: any) {
    const viewer = { id: user.id, platformRole: user.platformRole };
    const req = await this.requestsService.findOne(id, viewer);
    const all = await this.audit.forRequest(id);
    const staff = await this.requestsService.canSeeStaffActivity(user.id, user.platformRole, req.departmentId);
    const rows = staff ? all : all.filter((r) => r.action !== 'STAFF_NOTE_ADDED');
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

  @Post(':id/ai-correction')
  @HttpCode(HttpStatus.CREATED)
  async aiCorrection(@Param('id') id: string, @Body() dto: AiCorrectionDto, @CurrentUser() user: any) {
    // Same read gate as notes/activity: only someone who can see the ticket
    // can correct its AI classification. Stored on the audit trail so evals
    // and instructors see what the model got wrong.
    await this.requestsService.findOne(id, { id: user.id, platformRole: user.platformRole });
    await this.audit.append({
      requestId: id,
      actorId: user.id,
      action: 'AI_CORRECTION',
      newValue: [dto.departmentCode, dto.requestTypeCode].filter(Boolean).join('/') || 'flagged',
      metadata: JSON.stringify({
        departmentCode: dto.departmentCode || null,
        requestTypeCode: dto.requestTypeCode || null,
        note: (dto.note || '').slice(0, 500),
      }),
    });
    return { corrected: true };
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.requestsService.findOne(id, { id: user.id, platformRole: user.platformRole });
  }

  @Post('check-duplicates')
  @HttpCode(HttpStatus.OK)
  checkDuplicates(
    @Body() body: { departmentId?: string; title?: string; description?: string; excludeId?: string },
    @CurrentUser() user: any,
  ) {
    return this.requestsService.findDuplicates({
      departmentId: body.departmentId,
      title: body.title || '',
      description: body.description,
      excludeId: body.excludeId,
      viewer: { id: user.id, platformRole: user.platformRole },
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

  @Patch(':id/takeover')
  @HttpCode(HttpStatus.OK)
  takeover(@Param('id') id: string, @Body() dto: TakeoverDto, @CurrentUser() user: any) {
    return this.requestsService.takeover(id, user.id, dto.reason);
  }

  @Patch(':id/reassign')
  @HttpCode(HttpStatus.OK)
  reassign(@Param('id') id: string, @Body() dto: ReassignDto, @CurrentUser() user: any) {
    return this.requestsService.reassign(id, dto.userId, user.id, dto.reason);
  }
}
