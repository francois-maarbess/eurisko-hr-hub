import { createHash, randomBytes } from 'crypto';
import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import * as OTPAuth from 'otpauth';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import { PRISMA_CLIENT_TOKEN } from '../prisma.service';

const BACKUP_CODE_COUNT = 10;
const MFA_TOKEN_TTL = '5m' as const;

/**
 * TOTP two-factor authentication (RFC 6238, 6 digits, 30s period).
 *
 * Enrol:   POST /auth/mfa/setup  (authed)  -> otpauth URI + QR data URL.
 * Enable:  POST /auth/mfa/verify (authed, 6-digit code) -> 10 single-use
 *          backup codes (plaintext once, sha256 at rest).
 * Login:   password OK + mfaEnabled -> { mfaRequired, mfaToken } (5 min,
 *          purpose-bound; rejected by JwtStrategy on normal routes).
 *          POST /auth/mfa/challenge { mfaToken, code } accepts a TOTP code
 *          or an unused backup code (consumed on use).
 * Disable: POST /auth/mfa/disable (authed + current password).
 */
@Injectable()
export class MfaService {
  constructor(
    @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient,
    private readonly jwtService: JwtService,
  ) {}

  private totpFor(email: string, base32: string) {
    return new OTPAuth.TOTP({
      issuer: 'EuriskoHub',
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(base32),
    });
  }

  async setup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const uri = this.totpFor(user.email, secret).toString();
    // Stored unenrolled; harmless until verify() flips the flag.
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecret: secret, mfaEnabled: false } });
    return { otpauthUrl: uri, qrDataUrl: await QRCode.toDataURL(uri) };
  }

  async verifySetup(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(user as any).mfaSecret) throw new BadRequestException('Run setup first.');
    const valid = this.totpFor(user.email, (user as any).mfaSecret).validate({ token: code, window: 1 });
    if (valid == null) throw new UnauthorizedException('Invalid authenticator code.');
    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      randomBytes(4).toString('hex'),
    );
    const hashed = backupCodes.map((c) => createHash('sha256').update(c).digest('hex'));
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true, mfaBackupCodes: JSON.stringify(hashed) } as any,
    });
    return { backupCodes };
  }

  issueMfaToken(user: { id: string; email: string }) {
    return this.jwtService.sign(
      { sub: user.id, email: user.email, purpose: 'mfa' },
      { expiresIn: MFA_TOKEN_TTL },
    );
  }

  async challenge(mfaToken: string, code: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(mfaToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired verification token.');
    }
    if (!payload?.sub || payload.purpose !== 'mfa') {
      throw new UnauthorizedException('Invalid verification token.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active || !(user as any).mfaEnabled || !(user as any).mfaSecret) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const clean = (code || '').replace(/\s/g, '');
    const totpOk =
      this.totpFor(user.email, (user as any).mfaSecret).validate({ token: clean, window: 1 }) != null;
    if (totpOk) return this.signFull(user as any);
    // Backup codes: compare hashes, consume on use.
    const stored: string[] = JSON.parse((user as any).mfaBackupCodes || '[]');
    const digest = createHash('sha256').update(clean).digest('hex');
    const idx = stored.indexOf(digest);
    if (idx === -1) throw new UnauthorizedException('Invalid authenticator code.');
    stored.splice(idx, 1);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaBackupCodes: JSON.stringify(stored) } as any,
    });
    return this.signFull(user as any);
  }

  async disable(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash || !(await bcrypt.compare(password || '', user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabled: false, mfaBackupCodes: null } as any,
    });
    return { disabled: true };
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return { enabled: !!user && !!(user as any).mfaEnabled };
  }

  private signFull(user: { id: string; email: string; displayName: string; platformRole: string }) {
    return {
      accessToken: this.jwtService.sign({
        sub: user.id,
        email: user.email,
        name: user.displayName,
        role: user.platformRole,
      }),
    };
  }
}
