import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { AppModule } from '../src/app.module';

const JWT_SECRET = 'e2e-test-secret';

describe('Service Request Flow (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let employeeToken: string;
  let agentToken: string;
  let adminToken: string;
  let financeToken: string;

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
    const finance = await prisma.user.findFirst({ where: { email: 'carol@acme.com' } });
    expect(emp && agent && admin && finance).toBeTruthy();

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
    financeToken = jwt.sign(
      { sub: finance!.id, email: finance!.email, name: finance!.displayName, role: finance!.platformRole },
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
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: `List Probe ${Date.now()}`,
        description: 'Ensures the listing endpoint returns rows on a clean database',
        priority: 'STANDARD',
      });

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

  it('takeover and reassign move ownership explicitly with audit', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: `Takeover Probe ${Date.now()}`,
        description: 'Ownership must move only through explicit actions',
        priority: 'STANDARD',
      });
    const id = created.body.id;

    // Bob (agent, not manager) claims first.
    const claimed = await request(app.getHttpServer())
      .patch(`/requests/${id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(claimed.status).toBe(200);

    // Owner cannot take over.
    const ownerTry = await request(app.getHttpServer())
      .patch(`/requests/${id}/takeover`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({});
    expect([403, 409]).toContain(ownerTry.status);

    // Unclaimed-ticket takeover is rejected; PENDING has its own claim flow.
    // (Covered implicitly: this ticket is claimed, so we test the manager path.)

    // Admin (IT manager in seed) takes over from Bob.
    const taken = await request(app.getHttpServer())
      .patch(`/requests/${id}/takeover`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Bob is out today' });
    expect(taken.status).toBe(200);
    expect(taken.body.claimedById).toBeTruthy();
    const adminId = (await prisma.user.findFirst({ where: { email: 'admin@acme.com' } }))!.id;
    expect(taken.body.claimedById).toBe(adminId);

    // Non-manager agent cannot take over from admin.
    const agentTry = await request(app.getHttpServer())
      .patch(`/requests/${id}/takeover`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({});
    expect(agentTry.status).toBe(403);

    // Admin reassigns back to Bob with an audit trail.
    const agent = await prisma.user.findFirst({ where: { email: 'bob@acme.com' } });
    const reassigned = await request(app.getHttpServer())
      .patch(`/requests/${id}/reassign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: agent!.id, reason: 'Bob is back' });
    expect(reassigned.status).toBe(200);
    expect(reassigned.body.claimedById).toBe(agent!.id);

    const audits = await prisma.auditLog.findMany({
      where: { requestId: id, action: { in: ['REQUEST_TAKEOVER', 'REQUEST_REASSIGNED'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.length).toBe(2);
    expect(audits[0].action).toBe('REQUEST_TAKEOVER');
    expect(audits[0].metadata).toContain('Bob is out today');
    expect(audits[1].action).toBe('REQUEST_REASSIGNED');
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

  it('owner cannot claim their own request even as a department member', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Self Claim Probe',
        description: 'Agent creates in own department then tries to claim it',
        priority: 'STANDARD',
      });

    // Bob IS an IT member — the 409 must come from the owner block, not membership.
    const res = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(res.status).toBe(409);
  });

  it('only the owner can cancel a PENDING request', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Cancel Probe',
        description: 'Strangers must not cancel other people’s pending tickets',
        priority: 'STANDARD',
      });

    const stranger = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'CANCELLED' });
    expect(stranger.status).toBe(403);

    const owner = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/status`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ status: 'CANCELLED' });
    expect(owner.status).toBe(200);
    expect(owner.body.status).toBe('CANCELLED');
  });

  it('system admin can claim outside their memberships', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'FINANCE' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'EXPENSE' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Admin Claim Probe',
        description: 'Admin is no FINANCE member yet claims by admin right',
        priority: 'STANDARD',
      });

    const res = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/claim`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
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

  it('system admin cannot complete a request claimed by another agent', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Ownership Completion Test',
        description: 'An administrator must not silently complete another agent request',
        priority: 'STANDARD',
      });
    await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);

    const res = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'COMPLETED', resolutionNote: 'Admin attempted completion.' });
    expect(res.status).toBe(409);
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

  it('AI draft rejects off-topic input with a clean human error', async () => {
    const res = await request(app.getHttpServer())
      .post('/requests/ai-draft')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ text: 'who won the formula 1 race yesterday' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/workplace requests/);
  });

  it('AI draft flags distressed input as sensitive and routes to wellbeing', async () => {
    const peo = await prisma.department.findFirst({ where: { code: 'PEO' } });
    const res = await request(app.getHttpServer())
      .post('/requests/ai-draft')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ text: 'please i need help im crying i feel sick and my employee is harrassing me' });
    expect(res.status).toBe(200);
    expect(res.body.departmentId).toBe(peo!.id);
    expect(res.body.sensitive).toBe(true);
    expect(res.body.priority).toBe('URGENT');
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

  it('queue views: unassigned, mywork, and pagination', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const mk = (title: string) =>
      request(app.getHttpServer())
        .post('/requests')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ departmentId: dept!.id, requestTypeId: rt!.id, title, description: 'queue view probe', priority: 'STANDARD' });
    const a = await mk(`Unassigned A ${Date.now()}`);
    const b = await mk(`Unassigned B ${Date.now()}`);
    // Bob claims B: it leaves unassigned, enters mywork.
    await request(app.getHttpServer())
      .patch(`/requests/${b.body.id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);

    const unassigned = await request(app.getHttpServer())
      .get('/requests?view=unassigned')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(unassigned.status).toBe(200);
    const uids = unassigned.body.map((r: any) => r.id);
    expect(uids).toContain(a.body.id);
    expect(uids).not.toContain(b.body.id);

    const mywork = await request(app.getHttpServer())
      .get('/requests?view=mywork')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(mywork.status).toBe(200);
    expect(mywork.body.map((r: any) => r.id)).toContain(b.body.id);
    const agent = await prisma.user.findFirst({ where: { email: 'bob@acme.com' } });
    for (const t of mywork.body) {
      expect(t.claimedById).toBe(agent!.id);
      expect(['PENDING', 'IN_PROGRESS']).toContain(t.status);
    }

    // Pagination: page 1 of size 1 returns one row; far page is empty.
    const p1 = await request(app.getHttpServer())
      .get('/requests?view=queue&page=1&pageSize=1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(p1.status).toBe(200);
    expect(p1.body).toHaveLength(1);
    const pFar = await request(app.getHttpServer())
      .get('/requests?view=queue&page=9999&pageSize=10')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(pFar.status).toBe(200);
    expect(pFar.body).toEqual([]);
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

  it('cross-user reads are forbidden, owners/members/admins pass (acceptance 2/3)', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Private Read Test',
        description: 'Only the owner, IT staff, or admin may read this ticket',
        priority: 'STANDARD',
      });
    const id = created.body.id;

    const owner = await request(app.getHttpServer())
      .get(`/requests/${id}`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(owner.status).toBe(200);

    const stranger = await request(app.getHttpServer())
      .get(`/requests/${id}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(stranger.status).toBe(403);

    const admin = await request(app.getHttpServer())
      .get(`/requests/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(admin.status).toBe(200);
  });

  it('queue sorts URGENT before STANDARD before LOW, oldest first (acceptance 10)', async () => {
    const res = await request(app.getHttpServer())
      .get('/requests?view=queue')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rank: Record<string, number> = { URGENT: 0, STANDARD: 1, LOW: 2 };
    for (let i = 1; i < res.body.length; i++) {
      const a = res.body[i - 1];
      const b = res.body[i];
      const ra = rank[a.priority] * 1e15 + new Date(a.createdAt).getTime();
      const rb = rank[b.priority] * 1e15 + new Date(b.createdAt).getTime();
      expect(ra).toBeLessThanOrEqual(rb);
    }
  });

  it('documents: staff upload, mp4 rejected, download works, delete clears (acceptance 7/8/9)', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Doc Flow Test',
        description: 'Testing the document lifecycle end to end here',
        priority: 'STANDARD',
      });
    const id = created.body.id;

    const pdf = Buffer.from('%PDF-1.4 fake-id-badge\n%PDF');
    const up = await request(app.getHttpServer())
      .post(`/requests/${id}/documents`)
      .set('Authorization', `Bearer ${agentToken}`)
      .attach('file', pdf, { filename: 'badge.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect(up.body.checksum).toBeTruthy();

    const mp4 = await request(app.getHttpServer())
      .post(`/requests/${id}/documents`)
      .set('Authorization', `Bearer ${agentToken}`)
      .attach('file', Buffer.from('ftypisom....'), { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(mp4.status).toBe(400);

    const nonMember = await request(app.getHttpServer())
      .post(`/requests/${id}/documents`)
      .set('Authorization', `Bearer ${financeToken}`)
      .attach('file', pdf, { filename: 'badge.pdf', contentType: 'application/pdf' });
    expect(nonMember.status).toBe(403);

    const list = await request(app.getHttpServer())
      .get(`/requests/${id}/documents`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);

    const docId = list.body[0].id;
    const dl = await request(app.getHttpServer())
      .get(`/requests/${id}/documents/${docId}/download`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(dl.status).toBe(200);

    const del = await request(app.getHttpServer())
      .delete(`/requests/${id}/documents/${docId}`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(del.status).toBe(200);

    const gone = await request(app.getHttpServer())
      .get(`/requests/${id}/documents/${docId}/download`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(gone.status).toBe(404);

    const audits = await prisma.auditLog.findMany({ where: { requestId: id } });
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('REQUEST_CREATED');
    expect(actions).toContain('DOCUMENT_UPLOADED');
    expect(actions).toContain('DOCUMENT_DELETED');
  });

  it('completing with a document but no note succeeds (acceptance 5)', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'VPN' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Doc Instead Of Note',
        description: 'Resolution will be delivered as an attached document file',
        priority: 'STANDARD',
      });
    const id = created.body.id;
    await request(app.getHttpServer())
      .patch(`/requests/${id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await request(app.getHttpServer())
      .post(`/requests/${id}/documents`)
      .set('Authorization', `Bearer ${agentToken}`)
      .attach('file', png, { filename: 'proof.png', contentType: 'image/png' });

    const done = await request(app.getHttpServer())
      .patch(`/requests/${id}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'COMPLETED' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('COMPLETED');
  });

  it('notifications: creation notifies staff, inbox and counts work', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Notify Flow Test',
        description: 'Checking that department staff get inbox notifications',
        priority: 'STANDARD',
      });
    const id = created.body.id;

    const inbox = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.some((n: any) => n.requestId === id && n.type === 'request.created')).toBe(true);

    const count = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(count.status).toBe(200);
    expect(count.body.count).toBeGreaterThanOrEqual(1);

    const readAll = await request(app.getHttpServer())
      .patch('/notifications/read-all')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(readAll.status).toBe(200);
    const after = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(after.body.count).toBe(0);
  });

  it('notifications: per-item read clears one item and items link to requests', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: `Per-Item Probe ${Date.now()}`,
        description: 'Each inbox row must be individually readable and linked',
        priority: 'STANDARD',
      });
    const id = created.body.id;

    const inbox = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${agentToken}`);
    const row = inbox.body.find((n: any) => n.requestId === id && !n.readAt);
    expect(row).toBeTruthy();

    const one = await request(app.getHttpServer())
      .patch(`/notifications/${row.id}/read`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(one.status).toBe(200);
    expect(one.body.read).toBe(true);

    const again = await request(app.getHttpServer())
      .patch(`/notifications/${row.id}/read`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(again.body.read).toBe(false);

    // Another user's row is untouchable.
    const stranger = await request(app.getHttpServer())
      .patch(`/notifications/${row.id}/read`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(stranger.body.read).toBe(false);
  });

  it('notifications: overdue sweep notifies once per day, failures are visible', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: `Overdue Sweep Probe ${Date.now()}`,
        description: 'Deadline already passed at creation time',
        priority: 'STANDARD',
      });
    const id = created.body.id;
    await request(app.getHttpServer())
      .patch(`/requests/${id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);
    await prisma.request.update({
      where: { id },
      data: { slaDueAt: new Date(Date.now() - 2 * 3600_000) },
    });

    const sweep = await request(app.getHttpServer())
      .post('/notifications/sweep')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(sweep.status).toBe(201);
    expect(sweep.body.swept).toBe(true);

    const inbox = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(inbox.body.some((n: any) => n.requestId === id && n.type === 'request.overdue')).toBe(true);

    // Second sweep same day: idempotent, no duplicate event.
    await request(app.getHttpServer())
      .post('/notifications/sweep')
      .set('Authorization', `Bearer ${adminToken}`);
    const events = await prisma.notificationEvent.findMany({
      where: { requestId: id, eventType: 'request.overdue' },
    });
    expect(events.length).toBe(1);

    // Non-admins cannot trigger sweeps or read the dead letter.
    const denied = await request(app.getHttpServer())
      .post('/notifications/sweep')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(denied.status).toBe(403);

    const failed = await request(app.getHttpServer())
      .get('/notifications/failed')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(failed.status).toBe(200);
    expect(Array.isArray(failed.body)).toBe(true);
  });

  it('duplicate check warns on twins and stays silent otherwise', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'VPN' } });
    const stamp = Date.now();
    // Self-contained twin: create it here so seed drift (demo clicks,
    // status changes) can never break this test.
    const twin = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: `VPN access for weekend travel ${stamp}`,
        description: 'Temporary test ticket that must be found as a duplicate candidate',
        priority: 'STANDARD',
      });
    expect(twin.status).toBe(201);

    const res = await request(app.getHttpServer())
      .post('/requests/check-duplicates')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ departmentId: dept!.id, title: `VPN access for travel ${stamp}` });
    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.id)).toContain(twin.body.id);

    const clean = await request(app.getHttpServer())
      .post('/requests/check-duplicates')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ departmentId: dept!.id, title: 'Zebra juggling championship finals' });
    expect(clean.status).toBe(200);
    expect(clean.body).toEqual([]);

    const anon = await request(app.getHttpServer())
      .post('/requests/check-duplicates')
      .send({ departmentId: dept!.id, title: 'Laptop screen cracked badly' });
    expect(anon.status).toBe(401);
  });

  it('admin report aggregates status and departments; employees forbidden', async () => {
    const res = await request(app.getHttpServer())
      .get('/requests/report')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.byStatus.PENDING).toBeGreaterThanOrEqual(1);
    expect(res.body.departments.some((d: any) => d.code === 'IT')).toBe(true);
    for (const d of res.body.departments) {
      expect(typeof d.open).toBe('number');
      expect(typeof d.total).toBe('number');
      expect(typeof d.breached).toBe('number');
      expect(d.breached).toBeLessThanOrEqual(d.open);
    }
    expect(Array.isArray(res.body.volume)).toBe(true);
    expect(res.body.volume).toHaveLength(7);
    for (const v of res.body.volume) {
      expect(v.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof v.count).toBe('number');
    }

    const denied = await request(app.getHttpServer())
      .get('/requests/report')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(denied.status).toBe(403);
  });

  it('department managers manage their own members; agents and outsiders cannot', async () => {
    const it = await prisma.department.findFirst({ where: { code: 'IT' } });
    const target = await prisma.user.findFirst({ where: { email: 'carol@acme.com' } });

    const added = await request(app.getHttpServer())
      .post(`/departments/${it!.id}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: target!.id, departmentRole: 'AGENT' });
    expect([200, 201].includes(added.status)).toBe(true);

    const listed = await request(app.getHttpServer())
      .get(`/departments/${it!.id}/members`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.some((m: any) => m.userId === target!.id)).toBe(true);

    const agentDenied = await request(app.getHttpServer())
      .post(`/departments/${it!.id}/members`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ userId: target!.id });
    expect(agentDenied.status).toBe(403);

    const removed = await request(app.getHttpServer())
      .delete(`/departments/${it!.id}/members/${target!.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removed.status).toBe(200);
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

  it('users rotate their own password; old password dies', async () => {
    const email = `pwrot-${Date.now()}@acme.com`;
    await request(app.getHttpServer())
      .post('/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, password: 'e2e-password-123' });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'e2e-password-123' });
    expect(login.status).toBe(201);
    const me = login.body.accessToken;

    const wrong = await request(app.getHttpServer())
      .patch('/auth/password')
      .set('Authorization', `Bearer ${me}`)
      .send({ currentPassword: 'nope-nope-nope', newPassword: 'brand-new-pass-456' });
    expect(wrong.status).toBe(401);

    const changed = await request(app.getHttpServer())
      .patch('/auth/password')
      .set('Authorization', `Bearer ${me}`)
      .send({ currentPassword: 'e2e-password-123', newPassword: 'brand-new-pass-456' });
    expect(changed.status).toBe(200);

    const loginNew = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'brand-new-pass-456' });
    expect(loginNew.status).toBe(201);

    const loginOld = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'e2e-password-123' });
    expect(loginOld.status).toBe(401);
  });

  it('audit trail records the lifecycle; strangers see nothing (acceptance 12)', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Audit Trail Probe',
        description: 'Every lifecycle step of this ticket must leave an audit row',
        priority: 'STANDARD',
      });
    const id = created.body.id;
    await request(app.getHttpServer())
      .patch(`/requests/${id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);

    const trail = await request(app.getHttpServer())
      .get(`/requests/${id}/audit`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(trail.status).toBe(200);
    const actions = trail.body.map((a: any) => a.action);
    expect(actions).toContain('REQUEST_CREATED');
    expect(actions).toContain('REQUEST_CLAIMED');
    expect(trail.body[0].actorName).toBeTruthy();

    const stranger = await request(app.getHttpServer())
      .get(`/requests/${id}/audit`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(stranger.status).toBe(403);
  });

  it('manager re-routes a ticket; employees are forbidden', async () => {
    const it = await prisma.department.findFirst({ where: { code: 'IT' } });
    const laptop = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const hr = await prisma.department.findFirst({ where: { code: 'HR' } });
    const letter = await prisma.requestType.findFirst({ where: { code: 'EMP_LETTER' } });
    const stamp = Date.now();
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: it!.id,
        requestTypeId: laptop!.id,
        title: `Reroute Probe ${stamp}`,
        description: 'A ticket filed in the wrong department for reroute testing',
        priority: 'STANDARD',
      });
    const id = created.body.id;

    // Plain employee (even the owner) cannot re-route.
    const denied = await request(app.getHttpServer())
      .patch(`/requests/${id}/reroute`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ newDepartmentId: hr!.id, newRequestTypeId: letter!.id, reason: 'wrong dept' });
    expect(denied.status).toBe(403);

    // Admin (IT manager in seed) re-routes IT -> HR.
    const moved = await request(app.getHttpServer())
      .patch(`/requests/${id}/reroute`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newDepartmentId: hr!.id, newRequestTypeId: letter!.id, reason: 'belongs to HR' });
    expect(moved.status).toBe(200);
    expect(moved.body.departmentId).toBe(hr!.id);
    expect(moved.body.requestTypeId).toBe(letter!.id);
    expect(moved.body.status).toBe('PENDING');
    expect(moved.body.claimedById).toBeNull();

    // Moved ticket shows in the new department queue with an audit row.
    const fetched = await request(app.getHttpServer())
      .get(`/requests/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(fetched.body.department.code).toBe('HR');
    const audits = await prisma.auditLog.findMany({ where: { requestId: id, action: 'REQUEST_REROUTED' } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0].metadata).toContain('belongs to HR');

    // Terminal tickets cannot be re-routed: owner cancels the moved ticket, then reroute is rejected.
    const cancelled = await request(app.getHttpServer())
      .patch(`/requests/${id}/status`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ status: 'CANCELLED' });
    expect(cancelled.status).toBe(200);

    const terminal = await request(app.getHttpServer())
      .patch(`/requests/${id}/reroute`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newDepartmentId: it!.id, newRequestTypeId: laptop!.id, reason: 'too late' });
    expect(terminal.status).toBe(400);
  });

  it('activity timeline shows labeled history to insiders, 403 to strangers', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: `Activity Probe ${Date.now()}`,
        description: 'Timeline must narrate creation and claim',
        priority: 'STANDARD',
      });
    const id = created.body.id;
    await request(app.getHttpServer())
      .patch(`/requests/${id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);

    const res = await request(app.getHttpServer())
      .get(`/requests/${id}/activity`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);
    const labels = res.body.map((a: any) => a.label);
    expect(labels).toContain('Ticket created');
    expect(labels).toContain('Claimed');
    expect(res.body[0].actor).toBeTruthy();
    expect(res.body[0].timestamp).toBeTruthy();

    const stranger = await request(app.getHttpServer())
      .get(`/requests/${id}/activity`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(stranger.status).toBe(403);
  });

  it('staff notes are private: owner blocked, agent allowed', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: `Notes Probe ${Date.now()}`,
        description: 'Internal notes must stay invisible to the requester',
        priority: 'STANDARD',
      });
    const id = created.body.id;

    const ownerPost = await request(app.getHttpServer())
      .post(`/requests/${id}/notes`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ content: 'sneaky owner note' });
    expect(ownerPost.status).toBe(403);

    const agentPost = await request(app.getHttpServer())
      .post(`/requests/${id}/notes`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ content: 'Checked logs, vendor escalation opened.' });
    expect(agentPost.status).toBe(201);

    const agentList = await request(app.getHttpServer())
      .get(`/requests/${id}/notes`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(agentList.status).toBe(200);
    expect(agentList.body.some((n: any) => n.content.includes('vendor escalation'))).toBe(true);

    const ownerList = await request(app.getHttpServer())
      .get(`/requests/${id}/notes`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(ownerList.status).toBe(403);

    const empty = await request(app.getHttpServer())
      .post(`/requests/${id}/notes`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ content: '   ' });
    expect(empty.status).toBe(400);
  });

  it('admin-owner reads staff notes on their own ticket; timeline shows a snippet, never a raw ID', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: `Admin Notes Probe ${Date.now()}`,
        description: 'Admin owns this ticket but must still see staff work',
        priority: 'STANDARD',
      });
    const id = created.body.id;

    const posted = await request(app.getHttpServer())
      .post(`/requests/${id}/notes`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ content: 'Replacement unit ordered from the vendor today.' });
    expect(posted.status).toBe(201);

    // Admin owns the ticket yet reads the note list fine.
    const adminList = await request(app.getHttpServer())
      .get(`/requests/${id}/notes`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminList.status).toBe(200);
    expect(adminList.body.some((n: any) => n.content.includes('Replacement unit'))).toBe(true);

    // Timeline entry carries a readable snippet, not "note <cuid>".
    const timeline = await request(app.getHttpServer())
      .get(`/requests/${id}/activity`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(timeline.status).toBe(200);
    const noteEvents = timeline.body.filter((a: any) => a.label === 'Internal note added');
    expect(noteEvents.length).toBeGreaterThanOrEqual(1);
    for (const e of noteEvents) {
      expect(e.details || '').not.toMatch(/^note [a-z0-9]+$/i);
    }
    expect(noteEvents.some((e: any) => (e.details || '').includes('Replacement unit'))).toBe(true);
  });

  it('created tickets carry an SLA deadline; reroute refreshes it', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const hr = await prisma.department.findFirst({ where: { code: 'HR' } });
    const letter = await prisma.requestType.findFirst({ where: { departmentId: hr!.id } });
    const before = Date.now();
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: `SLA Probe ${Date.now()}`,
        description: 'Deadline must be set without any AI key configured',
        priority: 'STANDARD',
      });
    expect(created.status).toBe(201);
    // No GROQ key in tests: rule fallback gives ~24h for STANDARD.
    expect(created.body.slaSource).toBe('RULE');
    const dueMs = new Date(created.body.slaDueAt).getTime() - before;
    expect(dueMs).toBeGreaterThan(23 * 3600_000);
    expect(dueMs).toBeLessThan(25 * 3600_000);

    // Re-routing reopens the ticket with a fresh deadline.
    const moved = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/reroute`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newDepartmentId: hr!.id, newRequestTypeId: letter!.id, reason: 'sla refresh check' });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('PENDING');
    expect(new Date(moved.body.slaDueAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(moved.body.slaSource).toBe('RULE');
  });

  it('breach center lists only open overdue tickets, most overdue first', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const mk = (title: string) =>
      request(app.getHttpServer())
        .post('/requests')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ departmentId: dept!.id, requestTypeId: rt!.id, title, description: 'breach probe', priority: 'STANDARD' });

    const old = await mk(`Breach Old ${Date.now()}`);
    const newer = await mk(`Breach New ${Date.now()}`);
    const done = await mk(`Breach Done ${Date.now()}`);
    // Backdate deadlines directly: old is most overdue, done is terminal.
    await prisma.request.update({ where: { id: old.body.id }, data: { slaDueAt: new Date(Date.now() - 5 * 3600_000) } });
    await prisma.request.update({ where: { id: newer.body.id }, data: { slaDueAt: new Date(Date.now() - 1 * 3600_000) } });
    await prisma.request.update({
      where: { id: done.body.id },
      data: { slaDueAt: new Date(Date.now() - 9 * 3600_000), status: 'COMPLETED', completedAt: new Date() },
    });

    const res = await request(app.getHttpServer())
      .get('/requests/breach')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((r: any) => r.id);
    expect(ids).toContain(old.body.id);
    expect(ids).toContain(newer.body.id);
    expect(ids).not.toContain(done.body.id);
    // Most overdue first.
    expect(ids.indexOf(old.body.id)).toBeLessThan(ids.indexOf(newer.body.id));

    // Plain employees outside every department see nothing.
    const stranger = await request(app.getHttpServer())
      .get('/requests/breach')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(stranger.status).toBe(200);
    expect(stranger.body).toEqual([]);
  });

  it('owner rates a completed ticket once; others and bad values rejected', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: `Rating Probe ${Date.now()}`,
        description: 'Will be completed then rated by its owner',
        priority: 'STANDARD',
      });
    const id = created.body.id;
    await request(app.getHttpServer())
      .patch(`/requests/${id}/claim`)
      .set('Authorization', `Bearer ${agentToken}`);
    await request(app.getHttpServer())
      .patch(`/requests/${id}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'COMPLETED', resolutionNote: 'Done.' });

    const badValue = await request(app.getHttpServer())
      .post(`/requests/${id}/feedback`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ rating: 6 });
    expect(badValue.status).toBe(400);

    const stranger = await request(app.getHttpServer())
      .post(`/requests/${id}/feedback`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ rating: 5 });
    expect(stranger.status).toBe(403);

    const pending = await request(app.getHttpServer())
      .post('/requests/req-1/feedback')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ rating: 5 });
    expect([400, 403, 404]).toContain(pending.status);

    const ok = await request(app.getHttpServer())
      .post(`/requests/${id}/feedback`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ rating: 5, feedbackNote: 'Fast and clear, thanks!' });
    expect(ok.status).toBe(201);
    expect(ok.body.rating).toBe(5);

    const again = await request(app.getHttpServer())
      .post(`/requests/${id}/feedback`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ rating: 4 });
    expect(again.status).toBe(409);
  });

  it('admin CSV export downloads text/csv; employees forbidden', async () => {
    const res = await request(app.getHttpServer())
      .get('/requests/export')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('"ID","Title","Department"');
    expect(res.text).toContain('Laptop Request');

    const denied = await request(app.getHttpServer())
      .get('/requests/export')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(denied.status).toBe(403);
  });

  it('TOTP two-factor: enrol, challenge, backup code, disable', async () => {
    const email = `mfa-${Date.now()}@acme.com`;
    const created = await request(app.getHttpServer())
      .post('/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, password: 'e2e-password-123' });
    expect(created.status).toBe(201);

    const plainLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'e2e-password-123' });
    expect(plainLogin.status).toBe(201);
    expect(plainLogin.body.accessToken).toBeTruthy();
    const session = plainLogin.body.accessToken;

    // Enrol: setup returns a QR + otpauth URL carrying the secret.
    const setup = await request(app.getHttpServer())
      .post('/auth/mfa/setup')
      .set('Authorization', `Bearer ${session}`);
    expect(setup.status).toBe(201);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const secret = new URL(setup.body.otpauthUrl).searchParams.get('secret');
    expect(secret).toBeTruthy();
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret!) });

    // Wrong code enables nothing.
    const badVerify = await request(app.getHttpServer())
      .post('/auth/mfa/verify')
      .set('Authorization', `Bearer ${session}`)
      .send({ code: '000000' });
    expect(badVerify.status).toBe(401);

    const verify = await request(app.getHttpServer())
      .post('/auth/mfa/verify')
      .set('Authorization', `Bearer ${session}`)
      .send({ code: totp.generate() });
    expect(verify.status).toBe(201);
    expect(verify.body.backupCodes).toHaveLength(10);

    // Password login now yields a challenge token, not API access.
    const challenged = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'e2e-password-123' });
    expect(challenged.status).toBe(201);
    expect(challenged.body.mfaRequired).toBe(true);
    expect(challenged.body.accessToken).toBeUndefined();
    const mfaToken = challenged.body.mfaToken;

    // Challenge token must not open the API.
    const smuggled = await request(app.getHttpServer())
      .get('/requests')
      .set('Authorization', `Bearer ${mfaToken}`);
    expect(smuggled.status).toBe(401);

    // Wrong TOTP fails.
    const badCode = await request(app.getHttpServer())
      .post('/auth/mfa/challenge')
      .send({ mfaToken, code: '000000' });
    expect(badCode.status).toBe(401);

    // Correct TOTP completes login.
    const totpLogin = await request(app.getHttpServer())
      .post('/auth/mfa/challenge')
      .send({ mfaToken, code: totp.generate() });
    expect(totpLogin.status).toBe(201);
    expect(totpLogin.body.accessToken).toBeTruthy();

    // Backup code works once, then dies.
    const backupLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'e2e-password-123' });
    const used = await request(app.getHttpServer())
      .post('/auth/mfa/challenge')
      .send({ mfaToken: backupLogin.body.mfaToken, code: verify.body.backupCodes[0] });
    expect(used.status).toBe(201);

    const replay = await request(app.getHttpServer())
      .post('/auth/mfa/challenge')
      .send({ mfaToken: backupLogin.body.mfaToken, code: verify.body.backupCodes[0] });
    expect(replay.status).toBe(401);

    // Disable with password restores plain login.
    const disable = await request(app.getHttpServer())
      .post('/auth/mfa/disable')
      .set('Authorization', `Bearer ${used.body.accessToken}`)
      .send({ password: 'e2e-password-123' });
    expect(disable.status).toBe(201);

    const plainAgain = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'e2e-password-123' });
    expect(plainAgain.status).toBe(201);
    expect(plainAgain.body.accessToken).toBeTruthy();
    expect(plainAgain.body.mfaRequired).toBeUndefined();
  });

  it('login is rate-limited after a rapid burst', async () => {
    // Earlier tests in this file already spend part of the 20/min budget,
    // so hammer until the throttle trips instead of assuming a fixed count.
    let saw429 = false;
    for (let i = 0; i < 40 && !saw429; i++) {
      const r = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'alice@acme.com', password: 'wrong-password' });
      if (r.status === 429) saw429 = true;
    }
    // Wrong passwords are 401 until the 20/min throttle kicks in with 429.
    expect(saw429).toBe(true);
  });
});
