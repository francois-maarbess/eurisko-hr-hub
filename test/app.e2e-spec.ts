import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const JWT_SECRET = 'e2e-test-secret';

describe('Service Request Flow (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let employeeToken: string;
  let agentToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const dbPath = require('path').resolve(__dirname, '..', 'prisma', 'dev.db');
    process.env.DATABASE_URL = `file:${dbPath}`;
    process.env.JWT_SECRET = JWT_SECRET;

    prisma = new PrismaClient();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    // Deterministic AI path: e2e must not depend on network or a real key.
    // Deleted AFTER init because PrismaClient construction reloads .env
    // (which may contain GROQ_API_KEY on a dev machine).
    delete process.env['GROQ_API_KEY'];

    const emp = await prisma.user.findFirst({ where: { email: 'alice@acme.com' } });
    const agent = await prisma.user.findFirst({ where: { email: 'bob@acme.com' } });
    const admin = await prisma.user.findFirst({ where: { email: 'admin@acme.com' } });
    expect(emp && agent && admin).toBeTruthy();

    // Sign tokens using the same JWT secret
    const jwt = app.get(JwtService);
    employeeToken = jwt.sign(
      { sub: emp!.id, email: emp!.email, name: emp!.displayName, role: emp!.platformRole },
      { secret: JWT_SECRET },
    );
    agentToken = jwt.sign(
      { sub: agent!.id, email: agent!.email, name: agent!.displayName, role: agent!.platformRole },
      { secret: JWT_SECRET },
    );
    adminToken = jwt.sign(
      { sub: admin!.id, email: admin!.email, name: admin!.displayName, role: admin!.platformRole },
      { secret: JWT_SECRET },
    );
  }, 30000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('should return 401 without a token', async () => {
    const res = await request(app.getHttpServer()).get('/requests');
    expect(res.status).toBe(401);
  });

  it('should return requests for authenticated user', async () => {
    const res = await request(app.getHttpServer())
      .get('/requests')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('employee can create a request', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });

    const res = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'New Laptop Needed',
        description: 'My current laptop is broken and needs replacement urgently',
        priority: 'URGENT',
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.title).toBe('New Laptop Needed');
  });

  it('agent can claim a PENDING request in their department', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Claimable Laptop',
        description: 'This request will be claimed by the agent for testing',
        priority: 'STANDARD',
      });

    const res = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
  });

  it('employee (non-member) cannot claim a request — authorization denied', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Auth Denial Test',
        description: 'This request tests that non-members cannot claim department requests',
        priority: 'STANDARD',
      });

    const res = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/claim`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(409);
  });

  it('cannot transition PENDING -> COMPLETED (skip denied)', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Skip Test',
        description: 'Testing that skipping from PENDING directly to COMPLETED is rejected',
        priority: 'STANDARD',
      });

    const res = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'COMPLETED', resolutionNote: 'Done' });
    expect(res.status).toBe(400);
  });

  it('cannot complete without resolution note — expected failure', async () => {
    // Create a fresh request, claim it, then try to complete without note
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'No Note Test',
        description: 'Testing that completing without a resolution note is rejected',
        priority: 'STANDARD',
      });
    await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);

    const res = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'COMPLETED' });
    expect(res.status).toBe(400);
  });

  it('agent can complete with resolution note', async () => {
    // Create a fresh request, claim it, then complete it
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Complete Test',
        description: 'Testing that completing with a resolution note succeeds',
        priority: 'STANDARD',
      });
    await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);

    const res = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'COMPLETED', resolutionNote: 'VPN access configured and delivered.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
  });

  it('rejects invalid transition from COMPLETED — regression protection', async () => {
    // Complete a fresh request, then try to reopen it
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Regression Test',
        description: 'Testing that COMPLETED requests cannot be transitioned back',
        priority: 'STANDARD',
      });
    await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);
    await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'COMPLETED', resolutionNote: 'Done.' });

    const res = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(400);
  });

  it('rejects request with invalid DTO (forbidden field rejected by ValidationPipe)', async () => {
    const res = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: 'x',
        requestTypeId: 'x',
        title: 'Bad',
        description: 'Short',
        priority: 'INVALID',
        sneakyField: 'hacked',
      });
    expect(res.status).toBe(400);
  });

  it('AI draft structures free text into a validated candidate (advisory, creates nothing)', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const before = await prisma.request.count();

    const res = await request(app.getHttpServer())
      .post('/requests/ai-draft')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ text: 'My laptop screen is cracked and I need a replacement ASAP' });

    expect(res.status).toBe(200);
    expect(res.body.departmentId).toBe(dept!.id);
    expect(res.body.requestTypeId).toBe(rt!.id);
    expect(res.body.priority).toBe('URGENT');
    expect(res.body.confidence).toBe('high');
    expect(res.body.provider).toBe('local');
    expect(res.body.title.length).toBeGreaterThanOrEqual(3);
    expect(res.body.description.length).toBeGreaterThanOrEqual(10);

    // Advisory only: no request row was created.
    expect(await prisma.request.count()).toBe(before);
  });

  it('AI draft rejects empty text and requires auth', async () => {
    const empty = await request(app.getHttpServer())
      .post('/requests/ai-draft')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ text: '   ' });
    expect(empty.status).toBe(400);

    const anon = await request(app.getHttpServer())
      .post('/requests/ai-draft')
      .send({ text: 'my laptop is broken' });
    expect(anon.status).toBe(401);
  });

  it('catalog lists departments and filters types without duplicates', async () => {
    const depts = await request(app.getHttpServer())
      .get('/catalog/departments')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(depts.status).toBe(200);
    const codes = depts.body.map((d: any) => d.code);
    expect(codes).toEqual(expect.arrayContaining(['IT', 'HR', 'FINANCE']));

    const it = depts.body.find((d: any) => d.code === 'IT');
    const types = await request(app.getHttpServer())
      .get(`/catalog/request-types?departmentId=${it.id}`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(types.status).toBe(200);
    const typeCodes = types.body.map((t: any) => t.code);
    expect(typeCodes).toEqual(expect.arrayContaining(['LAPTOP', 'VPN', 'SOFTWARE', 'ACCESS']));
    expect(new Set(typeCodes).size).toBe(typeCodes.length);

    const anon = await request(app.getHttpServer()).get('/catalog/departments');
    expect(anon.status).toBe(401);
  });

  it('admin creates a user who can log in; employees cannot; wrong password fails', async () => {
    const email = `e2e-${Date.now()}@acme.com`;
    const created = await request(app.getHttpServer())
      .post('/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, displayName: 'E2E User', password: 'e2e-password-123' });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe(email);
    expect((created.body as any).passwordHash).toBeUndefined();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'e2e-password-123' });
    expect(login.status).toBe(201);
    expect(login.body.accessToken).toBeTruthy();

    const wrongPw = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'nope-nope-nope' });
    expect(wrongPw.status).toBe(401);

    const forbidden = await request(app.getHttpServer())
      .post('/auth/users')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ email: `other-${Date.now()}@acme.com`, password: 'e2e-password-123' });
    expect(forbidden.status).toBe(403);
  });

  it('scoped views: mine by default, queue by membership, claimed by claimant', async () => {
    const emp = await prisma.user.findFirst({ where: { email: 'alice@acme.com' } });
    const agent = await prisma.user.findFirst({ where: { email: 'bob@acme.com' } });

    const mine = await request(app.getHttpServer())
      .get('/requests')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.length).toBeGreaterThanOrEqual(1);
    for (const t of mine.body) expect(t.employeeId).toBe(emp!.id);

    const queue = await request(app.getHttpServer())
      .get('/requests?view=queue')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(queue.status).toBe(200);
    const bobDepts = (
      await prisma.departmentMember.findMany({ where: { userId: agent!.id, active: true } })
    ).map((m) => m.departmentId);
    for (const t of queue.body) {
      expect(bobDepts).toContain(t.departmentId);
      expect(['PENDING', 'IN_PROGRESS']).toContain(t.status);
    }

    const claimed = await request(app.getHttpServer())
      .get('/requests?view=claimed')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(claimed.status).toBe(200);
    for (const t of claimed.body) expect(t.claimedById).toBe(agent!.id);

    const adminQueue = await request(app.getHttpServer())
      .get('/requests?view=queue')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminQueue.status).toBe(200);
    expect(adminQueue.body.length).toBeGreaterThanOrEqual(1);

    const anon = await request(app.getHttpServer()).get('/requests?view=mine');
    expect(anon.status).toBe(401);
  });

  it('admin controls roles and memberships; employees are forbidden', async () => {
    const email = `ctl-${Date.now()}@acme.com`;
    const created = await request(app.getHttpServer())
      .post('/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, password: 'e2e-password-123' });
    expect(created.status).toBe(201);
    const userId = created.body.id;

    const role = await request(app.getHttpServer())
      .patch(`/auth/users/${userId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ platformRole: 'SYSTEM_ADMIN' });
    expect(role.status).toBe(200);
    expect(role.body.platformRole).toBe('SYSTEM_ADMIN');

    const badRole = await request(app.getHttpServer())
      .patch(`/auth/users/${userId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ platformRole: 'GOD' });
    expect(badRole.status).toBe(400);

    const it = await prisma.department.findFirst({ where: { code: 'IT' } });
    const added = await request(app.getHttpServer())
      .post(`/auth/users/${userId}/memberships`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ departmentId: it!.id, departmentRole: 'AGENT' });
    expect(added.status).toBe(201);
    expect(added.body.memberships.some((m: any) => m.departmentId === it!.id)).toBe(true);

    const badDept = await request(app.getHttpServer())
      .post(`/auth/users/${userId}/memberships`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ departmentId: 'nope', departmentRole: 'AGENT' });
    expect(badDept.status).toBe(400);

    const removed = await request(app.getHttpServer())
      .delete(`/auth/users/${userId}/memberships/${it!.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removed.status).toBe(200);

    const empRole = await request(app.getHttpServer())
      .patch(`/auth/users/${userId}/role`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ platformRole: 'EMPLOYEE' });
    expect(empRole.status).toBe(403);

    const empMember = await request(app.getHttpServer())
      .post(`/auth/users/${userId}/memberships`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ departmentId: it!.id });
    expect(empMember.status).toBe(403);
  });

  it('deactivated users cannot log in until reactivated', async () => {
    const email = `deact-${Date.now()}@acme.com`;
    const created = await request(app.getHttpServer())
      .post('/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, password: 'e2e-password-123' });
    expect(created.status).toBe(201);

    const off = await request(app.getHttpServer())
      .patch(`/auth/users/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);

    const loginOff = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'e2e-password-123' });
    expect(loginOff.status).toBe(401);

    const on = await request(app.getHttpServer())
      .patch(`/auth/users/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true });
    expect(on.status).toBe(200);

    const loginOn = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'e2e-password-123' });
    expect(loginOn.status).toBe(201);
  });
});
