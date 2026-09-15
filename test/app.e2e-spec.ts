import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const JWT_SECRET = 'e2e-test-secret';

describe('Service Request Flow (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let employeeToken: string;
  let agentToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./prisma/dev.db';
    process.env.JWT_SECRET = JWT_SECRET;

    const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL });
    prisma = new PrismaClient({ adapter });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const emp = await prisma.user.findFirst({ where: { email: 'alice@acme.com' } });
    const agent = await prisma.user.findFirst({ where: { email: 'bob@acme.com' } });
    expect(emp && agent).toBeTruthy();

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
});
