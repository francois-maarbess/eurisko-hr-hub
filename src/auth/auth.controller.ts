import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  MinLength,
} from 'class-validator';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles, RolesGuard } from './roles.guard';
import { PRISMA_CLIENT_TOKEN } from '../prisma.service';
import { AuthService } from './auth.service';

class LoginDto {
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  platformRole?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  departmentRole?: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class SetActiveDto {
  @IsBoolean()
  active!: boolean;
}

class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

class SetRoleDto {
  @IsString()
  @IsNotEmpty()
  platformRole!: string;
}

class AddMembershipDto {
  @IsString()
  @IsNotEmpty()
  departmentId!: string;

  @IsOptional()
  @IsString()
  departmentRole?: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Password login. The Week-3 mock (email-only) is replaced by real
   * credential verification; unknown users and wrong passwords both
   * return the same 401 so accounts can't be enumerated.
   */
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Request() req: any) {
    return req.user;
  }

  @UseGuards(JwtAuthGuard)
  @Patch('password')
  changePassword(@Body() dto: ChangePasswordDto, @Request() req: any) {
    return this.authService.changePassword(req.user.id, dto.currentPassword, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Get('users')
  listUsers() {
    return this.authService.listUsers();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.authService.createUser(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Patch('users/:id')
  setActive(@Param('id') id: string, @Body() dto: SetActiveDto) {
    return this.authService.setActive(id, dto.active);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Patch('users/:id/role')
  setRole(@Param('id') id: string, @Body() dto: SetRoleDto) {
    return this.authService.setRole(id, dto.platformRole);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Post('users/:id/memberships')
  addMembership(@Param('id') id: string, @Body() dto: AddMembershipDto) {
    return this.authService.addMembership(id, dto.departmentId, dto.departmentRole);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Delete('users/:id/memberships/:departmentId')
  removeMembership(@Param('id') id: string, @Param('departmentId') departmentId: string) {
    return this.authService.removeMembership(id, departmentId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('memberships')
  myMemberships(@Request() req: any) {
    return this.authService.myMemberships(req.user.id);
  }
}
