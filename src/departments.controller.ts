import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaClient } from '@prisma/client';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { Roles, RolesGuard } from './auth/roles.guard';
import { CurrentUser } from './auth/current-user.decorator';
import { PRISMA_CLIENT_TOKEN } from './prisma.service';
import { AuditService } from './audit.service';

class AddMemberDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsOptional()
  @IsString()
  departmentRole?: string;
}

/**
 * Department-scoped management. Department MANAGERs administer their own
 * department's members; system admins administer everything. Unlike the
 * admin panel (platform-wide), every route here is bounded to one
 * department the caller demonstrably runs.
 */
@Controller('departments')
@UseGuards(JwtAuthGuard)
export class DepartmentsController {
  constructor(
    @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  private async canManageDept(userId: string, platformRole: string, departmentId: string): Promise<boolean> {
    if (platformRole === 'SYSTEM_ADMIN') return true;
    const membership = await this.prisma.departmentMember.findUnique({
      where: { userId_departmentId: { userId, departmentId } },
    });
    return !!membership?.active && membership.departmentRole === 'MANAGER';
  }

  @Get(':id/members')
  async members(@Param('id') id: string, @CurrentUser() user: any) {
    if (!(await this.canManageDept(user.id, user.platformRole, id))) {
      throw new ForbiddenException('Only department managers can view members.');
    }
    return this.prisma.departmentMember.findMany({
      where: { departmentId: id },
      include: { user: { select: { id: true, email: true, displayName: true, active: true } } },
    });
  }

  @Post(':id/members')
  async addMember(@Param('id') id: string, @Body() dto: AddMemberDto, @CurrentUser() user: any) {
    if (!(await this.canManageDept(user.id, user.platformRole, id))) {
      throw new ForbiddenException('Only department managers can add members.');
    }
    const role = dto.departmentRole || 'AGENT';
    if (!['AGENT', 'MANAGER'].includes(role)) {
      throw new BadRequestException('Invalid department role.');
    }
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!target || !target.active) {
      throw new BadRequestException('User not found or deactivated.');
    }
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department || !department.active) {
      throw new BadRequestException('Department not found.');
    }
    const membership = await this.prisma.departmentMember.upsert({
      where: { userId_departmentId: { userId: dto.userId, departmentId: id } },
      update: { departmentRole: role, active: true },
      create: { userId: dto.userId, departmentId: id, departmentRole: role },
    });
    await this.audit.append({
      actorId: user.id,
      action: 'MEMBER_ADDED',
      newValue: `${target.email} -> ${department.code} as ${role}`,
    });
    return membership;
  }

  @Delete(':id/members/:userId')
  async removeMember(@Param('id') id: string, @Param('userId') targetId: string, @CurrentUser() user: any) {
    if (!(await this.canManageDept(user.id, user.platformRole, id))) {
      throw new ForbiddenException('Only department managers can remove members.');
    }
    const membership = await this.prisma.departmentMember.findUnique({
      where: { userId_departmentId: { userId: targetId, departmentId: id } },
    });
    if (!membership) throw new BadRequestException('Membership not found.');
    await this.prisma.departmentMember.delete({
      where: { userId_departmentId: { userId: targetId, departmentId: id } },
    });
    await this.audit.append({
      actorId: user.id,
      action: 'MEMBER_REMOVED',
      oldValue: `${targetId} x ${id}`,
    });
    return { removed: true };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Post()
  async createDepartment(@Body() dto: { code?: string; name?: string; description?: string }, @CurrentUser() user: any) {
    const code = (dto.code || '').trim().toUpperCase();
    const name = (dto.name || '').trim();
    if (!code || !name) throw new BadRequestException('Department code and name are required.');
    const existing = await this.prisma.department.findUnique({ where: { code } });
    if (existing) throw new BadRequestException('Department code already exists.');
    const dept = await this.prisma.department.create({ data: { code, name, description: dto.description?.trim() || null } });
    await this.audit.append({ actorId: user.id, action: 'CATALOG_DEPARTMENT_CREATED', newValue: code });
    return dept;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Post(':id/request-types')
  async createRequestType(
    @Param('id') id: string,
    @Body() dto: { code?: string; name?: string; description?: string },
    @CurrentUser() user: any,
  ) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department || !department.active) throw new BadRequestException('Department not found.');
    const code = (dto.code || '').trim().toUpperCase();
    const name = (dto.name || '').trim();
    if (!code || !name) throw new BadRequestException('Request type code and name are required.');
    const existing = await this.prisma.requestType.findUnique({
      where: { departmentId_code: { departmentId: id, code } },
    });
    if (existing) throw new BadRequestException('Request type code already exists in this department.');
    const type = await this.prisma.requestType.create({
      data: { departmentId: id, code, name, description: dto.description?.trim() || null },
    });
    await this.audit.append({ actorId: user.id, action: 'CATALOG_TYPE_CREATED', newValue: `${department.code}/${code}` });
    return type;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Patch(':id')
  async updateDepartment(
    @Param('id') id: string,
    @Body() dto: { name?: string; description?: string; active?: boolean },
    @CurrentUser() user: any,
  ) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) throw new BadRequestException('Department not found.');
    const data: any = {};
    if (dto.name?.trim()) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (typeof dto.active === 'boolean') data.active = dto.active;
    const updated = await this.prisma.department.update({ where: { id }, data });
    await this.audit.append({ actorId: user.id, action: 'CATALOG_DEPARTMENT_UPDATED', newValue: department.code });
    return updated;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Patch(':deptId/request-types/:typeId')
  async updateRequestType(
    @Param('deptId') deptId: string,
    @Param('typeId') typeId: string,
    @Body() dto: { name?: string; description?: string; active?: boolean },
    @CurrentUser() user: any,
  ) {
    const type = await this.prisma.requestType.findFirst({ where: { id: typeId, departmentId: deptId } });
    if (!type) throw new BadRequestException('Request type not found.');
    const data: any = {};
    if (dto.name?.trim()) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (typeof dto.active === 'boolean') data.active = dto.active;
    const updated = await this.prisma.requestType.update({ where: { id: typeId }, data });
    await this.audit.append({ actorId: user.id, action: 'CATALOG_TYPE_UPDATED', newValue: type.code });
    return updated;
  }
}
