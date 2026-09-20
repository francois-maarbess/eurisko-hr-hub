import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
// bcryptjs (not bcrypt): pure-JavaScript hashing with the same API, so no
// native build toolchain is needed on any developer machine.
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT_TOKEN } from '../prisma.service';

const PLATFORM_ROLES = ['EMPLOYEE', 'SYSTEM_ADMIN'];
const DEPARTMENT_ROLES = ['AGENT', 'MANAGER'];

export interface CreateUserInput {
  email: string;
  displayName?: string;
  platformRole?: string;
  departmentId?: string;
  departmentRole?: string;
  password: string;
}

/**
 * Real account logic: password hashing, password login, admin-managed
 * user creation. Guards (JWT + roles) live on the controller; resource
 * rules live here next to the data.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
    const normalized = (email || '').trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException('Account has no password set. Ask an admin.');
    }
    const ok = await bcrypt.compare(password || '', user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.sign(user);
  }

  async createUser(input: CreateUserInput) {
    const email = (input.email || '').trim().toLowerCase();
    if (!email.includes('@')) throw new BadRequestException('A valid email address is required.');
    const displayName = (input.displayName || '').trim() || email.split('@')[0];
    const platformRole = input.platformRole || 'EMPLOYEE';
    if (!PLATFORM_ROLES.includes(platformRole)) {
      throw new BadRequestException('Invalid platform role.');
    }
    if (!input.password || input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.active) {
      throw new ConflictException('A user with this email already exists.');
    }

    let departmentRole = input.departmentRole || 'AGENT';
    if (!DEPARTMENT_ROLES.includes(departmentRole)) {
      throw new BadRequestException('Invalid department role.');
    }
    let department: { id: string; active: boolean } | null = null;
    if (input.departmentId) {
      department = await this.prisma.department.findUnique({ where: { id: input.departmentId } });
      if (!department || !department.active) {
        throw new BadRequestException('Selected department was not found.');
      }
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { active: true, passwordHash, displayName, platformRole },
        })
      : await this.prisma.user.create({
          data: { email, displayName, platformRole, passwordHash },
        });

    if (department) {
      await this.prisma.departmentMember.upsert({
        where: { userId_departmentId: { userId: user.id, departmentId: department.id } },
        update: { departmentRole, active: true },
        create: { userId: user.id, departmentId: department.id, departmentRole },
      });
    }
    return this.safeUser(user);
  }

  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      include: { departmentMemberships: { include: { department: true } } },
    });
    return users.map((u) => this.safeUser(u));
  }

  async setActive(userId: string, active: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found.');
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { active } });
    return this.safeUser(updated);
  }

  private sign(user: { id: string; email: string; displayName: string; platformRole: string }) {
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      name: user.displayName,
      role: user.platformRole,
    });
    return { accessToken: token };
  }

  private safeUser(user: any) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      platformRole: user.platformRole,
      active: user.active,
      createdAt: user.createdAt,
      memberships: (user.departmentMemberships || []).map((m: any) => ({
        departmentId: m.departmentId,
        departmentCode: m.department?.code,
        departmentName: m.department?.name,
        departmentRole: m.departmentRole,
        active: m.active,
      })),
    };
  }
}
