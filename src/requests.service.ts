import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CreateRequestDto } from './dto/create-request.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED', 'REJECTED'],
  IN_PROGRESS: ['COMPLETED', 'REJECTED'],
};

@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll() {
    return this.prisma.request.findMany({
      include: { department: true, requestType: true, owner: true, claimant: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: { department: true, requestType: true, owner: true, claimant: true },
    });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  async create(dto: CreateRequestDto, employeeId: string) {
    // Validate department + request type belong together
    const requestType = await this.prisma.requestType.findUnique({
      where: { id: dto.requestTypeId },
    });
    if (!requestType) throw new BadRequestException('Invalid request type');
    if (requestType.departmentId !== dto.departmentId) {
      throw new BadRequestException('Request type does not belong to the specified department');
    }
    if (!requestType.active) {
      throw new BadRequestException('Request type is inactive');
    }

    return this.prisma.request.create({
      data: {
        employeeId,
        departmentId: dto.departmentId,
        requestTypeId: dto.requestTypeId,
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        status: 'PENDING',
      },
      include: { department: true, requestType: true },
    });
  }

  async claim(id: string, userId: string) {
    const request = await this.findOne(id);

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING requests can be claimed');
    }

    // The request owner cannot claim their own request
    if (request.employeeId === userId) {
      throw new ConflictException('You cannot claim your own request');
    }

    // Authorization: user must be a member of the request's department
    const membership = await this.prisma.departmentMember.findUnique({
      where: {
        userId_departmentId: { userId, departmentId: request.departmentId },
      },
    });
    if (!membership || !membership.active) {
      throw new ConflictException('You are not a member of this department');
    }

    // Atomic claim: only one agent can claim
    const updated = await this.prisma.request.updateMany({
      where: { id, status: 'PENDING', claimedById: null },
      data: { status: 'IN_PROGRESS', claimedById: userId },
    });
    if (updated.count === 0) {
      throw new ConflictException('Request was already claimed by another agent');
    }

    return this.findOne(id);
  }

  async updateStatus(id: string, dto: UpdateStatusDto, userId: string) {
    const request = await this.findOne(id);

    // Validate transition
    const allowed = VALID_TRANSITIONS[request.status];
    if (!allowed || !allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid transition: ${request.status} -> ${dto.status}`,
      );
    }

    // Completion requires resolution note
    if (dto.status === 'COMPLETED' && (!dto.resolutionNote || dto.resolutionNote.trim() === '')) {
      throw new BadRequestException('A resolution note is required when transitioning to COMPLETED');
    }

    // Rejection requires reason
    if (dto.status === 'REJECTED' && (!dto.rejectionReason || dto.rejectionReason.trim() === '')) {
      throw new BadRequestException('A rejection reason is required when rejecting a request');
    }

    // The request owner cannot resolve their own request — only department agents can
    if (dto.status === 'COMPLETED' || dto.status === 'REJECTED') {
      if (request.employeeId === userId) {
        throw new ConflictException('You cannot resolve your own request');
      }

      // Must be a department member
      const membership = await this.prisma.departmentMember.findUnique({
        where: {
          userId_departmentId: { userId, departmentId: request.departmentId },
        },
      });
      if (!membership || !membership.active) {
        throw new ConflictException('You are not a member of this department');
      }
    }

    const updateData: Record<string, any> = { status: dto.status };
    if (dto.resolutionNote) updateData.resolutionNote = dto.resolutionNote;
    if (dto.rejectionReason) updateData.rejectionReason = dto.rejectionReason;

    await this.prisma.request.update({ where: { id }, data: updateData });
    return this.findOne(id);
  }
}
