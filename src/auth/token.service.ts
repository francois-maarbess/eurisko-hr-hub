import { createHash, randomBytes } from 'crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT_TOKEN } from '../prisma.service';

export interface TokenUser {
  id: string;
  email: string;
  displayName: string;
  platformRole: string;
}

/**
 * Session tokens. Access JWTs are short-lived (default 15m) and never
 * stored; refresh tokens are opaque random strings, sha256-hashed at
 * rest, single-use with rotation. Reusing a rotated token signals theft
 * and revokes the whole session family.
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient,
    private readonly jwtService: JwtService,
  ) {}

  private accessTtl(): string {
    return process.env['ACCESS_TOKEN_TTL'] || '15m';
  }

  private refreshTtlMs(): number {
    const days = Number(process.env['REFRESH_TOKEN_TTL_DAYS'] || 7);
    return (Number.isFinite(days) && days > 0 ? days : 7) * 24 * 3600_000;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issuePair(user: TokenUser) {
    const accessToken = this.jwtService.sign(
      { sub: user.id, email: user.email, name: user.displayName, role: user.platformRole },
      { expiresIn: this.accessTtl() as any },
    );
    const refreshToken = randomBytes(32).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlMs()),
      },
    });
    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string) {
    // Opportunistic janitor: expired rows can never be used again.
    await this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
    const hashed = this.hash(refreshToken || '');
    // Atomic claim: exactly one concurrent refresh can win a live row.
    // The loser falls through to the reuse/invalid path below.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashed, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      const row = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: hashed },
        include: { user: true },
      });
      if (row?.revokedAt && row.expiresAt.getTime() > Date.now()) {
        // Rotated token reused: possible theft — kill every session.
        await this.prisma.refreshToken.updateMany({
          where: { userId: row.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashed },
      include: { user: true },
    });
    if (!row || !row.user.active) throw new UnauthorizedException('Invalid credentials');
    return this.issuePair(row.user as unknown as TokenUser);
  }

  async revokeAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }
}
