import { UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

function stubPrisma(user: any) {
  return {
    user: {
      findUnique: async () => user,
      findMany: async () => (user ? [user] : []),
      create: async (args: any) => ({ id: 'u-new', active: true, createdAt: new Date(), ...args.data }),
      update: async (args: any) => ({ ...(user || {}), ...args.data }),
    },
    department: {
      findUnique: async () => null,
    },
    departmentMember: {
      upsert: async () => ({}),
    },
  } as any;
}

const stubJwt = { sign: () => 'signed-token' } as any;

const baseUser = (overrides: any = {}) => ({
  id: 'u-1',
  email: 'test@acme.com',
  displayName: 'Test User',
  platformRole: 'EMPLOYEE',
  active: true,
  passwordHash: null as string | null,
  createdAt: new Date(),
  departmentMemberships: [],
  ...overrides,
});

describe('AuthService (password accounts)', () => {
  it('login succeeds with correct password and returns a token', async () => {
    const hash = await bcrypt.hash('secret123', 4);
    const svc = new AuthService(stubPrisma(baseUser({ passwordHash: hash })), stubJwt);
    const res = await svc.login('test@acme.com', 'secret123');
    expect(res.accessToken).toBe('signed-token');
  });

  it('login rejects unknown users, wrong passwords, inactive and passwordless accounts', async () => {
    const hash = await bcrypt.hash('secret123', 4);
    const svc = new AuthService(stubPrisma(baseUser({ passwordHash: hash })), stubJwt);
    await expect(svc.login('test@acme.com', 'wrongpass')).rejects.toThrow(UnauthorizedException);
    await expect(
      new AuthService(stubPrisma(null), stubJwt).login('nobody@acme.com', 'secret123'),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      new AuthService(stubPrisma(baseUser({ passwordHash: hash, active: false })), stubJwt).login('test@acme.com', 'secret123'),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      new AuthService(stubPrisma(baseUser({ passwordHash: null })), stubJwt).login('test@acme.com', 'anything'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('createUser hashes the password and never returns the hash', async () => {
    const svc = new AuthService(stubPrisma(null), stubJwt);
    const created = await svc.createUser({
      email: 'new@acme.com',
      displayName: 'Newbie',
      platformRole: 'EMPLOYEE',
      password: 'longenoughpassword',
    });
    expect(created.email).toBe('new@acme.com');
    expect((created as any).passwordHash).toBeUndefined();
  });

  it('createUser rejects duplicates, bad roles, short passwords, unknown departments', async () => {
    const svc = new AuthService(stubPrisma(baseUser({})), stubJwt);
    await expect(
      svc.createUser({ email: 'x@acme.com', displayName: 'X', password: 'longenoughpassword' }),
    ).rejects.toThrow(ConflictException);
    const fresh = new AuthService(stubPrisma(null), stubJwt);
    await expect(
      fresh.createUser({ email: 'x@acme.com', displayName: 'X', platformRole: 'GOD', password: 'longenoughpassword' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      fresh.createUser({ email: 'x@acme.com', displayName: 'X', password: 'short' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('listUsers excludes password hashes', async () => {
    const hash = await bcrypt.hash('secret123', 4);
    const svc = new AuthService(
      stubPrisma(baseUser({ passwordHash: hash })),
      stubJwt,
    );
    const users = await svc.listUsers();
    expect(users.length).toBe(1);
    expect((users[0] as any).passwordHash).toBeUndefined();
    expect(users[0].email).toBe('test@acme.com');
  });

  it('setActive rejects unknown users', async () => {
    const svc = new AuthService(stubPrisma(null), stubJwt);
    await expect(svc.setActive('nope', false)).rejects.toThrow(BadRequestException);
  });

  it('changePassword verifies the current one and rotates the hash', async () => {
    const hash = await bcrypt.hash('old-password-123', 4);
    let stored = baseUser({ passwordHash: hash });
    const prisma = {
      ...stubPrisma(stored).user,
      user: {
        ...stubPrisma(stored).user,
        update: async (args: any) => {
          stored = { ...stored, ...args.data };
          return stored;
        },
      },
    } as any;
    const svc = new AuthService(prisma, stubJwt);
    const res = await svc.changePassword('u-1', 'old-password-123', 'brand-new-password-1');
    expect(res).toEqual({ changed: true });
    expect(await bcrypt.compare('brand-new-password-1', stored.passwordHash)).toBe(true);
    expect(await bcrypt.compare('old-password-123', stored.passwordHash)).toBe(false);
  });

  it('changePassword rejects wrong current, short or identical passwords', async () => {
    const hash = await bcrypt.hash('old-password-123', 4);
    const svc = new AuthService(stubPrisma(baseUser({ passwordHash: hash })), stubJwt);
    await expect(svc.changePassword('u-1', 'nope-nope-nope', 'brand-new-password-1')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(svc.changePassword('u-1', 'old-password-123', 'short')).rejects.toThrow(BadRequestException);
    await expect(svc.changePassword('u-1', 'old-password-123', 'old-password-123')).rejects.toThrow(
      BadRequestException,
    );
  });
});
