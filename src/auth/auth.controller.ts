import { Controller, Post, Body, Get, UseGuards, Request, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PRISMA_CLIENT_TOKEN } from '../prisma.service';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Mock login endpoint for Week 3.
   * In production this would be replaced by SSO.
   * Accepts an email and returns a JWT for that user.
   */
  @Post('login')
  async login(@Body() body: { email: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    if (!user) {
      return { error: 'User not found', hint: 'Try alice@acme.com or bob@acme.com' };
    }
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      name: user.displayName,
      role: user.platformRole,
    });
    return { accessToken: token };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Request() req: any) {
    return req.user;
  }
}
