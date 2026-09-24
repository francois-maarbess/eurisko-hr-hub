import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT_TOKEN } from '../prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  purpose?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'week3-dev-secret',
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Invalid token payload');
    }
    // Short-lived MFA challenge tokens authorize nothing but the challenge.
    if (payload.purpose === 'mfa') {
      throw new UnauthorizedException('Verification token cannot access the API');
    }
    // Deactivated or deleted users lose API access immediately — the token
    // alone is not enough. Lookup is by primary key, single row.
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, displayName: true, platformRole: true, active: true },
      });
      if (!user || !user.active) {
        throw new UnauthorizedException('Account is no longer active');
      }
      return {
        id: user.id,
        email: user.email,
        name: user.displayName,
        platformRole: user.platformRole,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // DB down: fail closed but don't leak internals. AuthGuard maps this
      // to 401; health endpoint reports the real outage.
      throw new UnauthorizedException('Unable to verify account');
    }
  }
}
