import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  purpose?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
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
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      platformRole: payload.role,
    };
  }
}
