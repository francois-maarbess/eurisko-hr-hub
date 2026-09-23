import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // registerAsync (not register): the factory runs at instantiation,
    // so the secret is read AFTER env is loaded — never baked in from
    // whatever happened to exist at import time.
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET || 'week3-dev-secret',
        signOptions: { expiresIn: '24h' as const },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, AuthService, MfaService],
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}
