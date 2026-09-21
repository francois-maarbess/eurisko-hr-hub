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
});
