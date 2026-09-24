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
import { Throttle } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles, RolesGuard } from './roles.guard';
import { PRISMA_CLIENT_TOKEN } from '../prisma.service';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';

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

class MfaCodeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

class MfaChallengeDto {
  @IsString()
  @IsNotEmpty()
  mfaToken!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}

class MfaDisableDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}

class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly mfa: MfaService,
  ) {}

  /**
   * Password login. The Week-3 mock (email-only) is replaced by real
   * credential verification; unknown users and wrong passwords both
   * return the same 401 so accounts can't be enumerated.
   */
  @Post('login')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Request() req: any) {
    return this.authService.logout(req.user.id);
  }

  /**
   * Second factor. Challenge is intentionally public (it consumes the
   * short-lived mfaToken, not a session) and tightly throttled: TOTP
   * codes must not be brute-forceable.
   */
  @Post('mfa/challenge')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async mfaChallenge(@Body() dto: MfaChallengeDto) {
    return this.mfa.challenge(dto.mfaToken, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mfa/status')
  async mfaStatus(@Request() req: any) {
    return this.mfa.status(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/setup')
  async mfaSetup(@Request() req: any) {
    return this.mfa.setup(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/verify')
  async mfaVerify(@Request() req: any, @Body() dto: MfaCodeDto) {
    return this.mfa.verifySetup(req.user.id, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/disable')
  async mfaDisable(@Request() req: any, @Body() dto: MfaDisableDto) {
    return this.mfa.disable(req.user.id, dto.password);
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
