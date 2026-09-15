import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

describe('Database Integration', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    const adapter = new PrismaBetterSqlite3({ url: 'file:./prisma/dev.db' });
    prisma = new PrismaClient({ adapter });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should read seeded data and verify relations', async () => {
    const requests = await prisma.request.findMany({
      include: { owner: true, department: true, requestType: true },
    });

    expect(requests.length).toBeGreaterThanOrEqual(1);

    const req = requests.find((r) => r.id === 'req-1');
    expect(req).toBeDefined();
    expect(req!.status).toBe('PENDING');
    expect(req!.owner.email).toBe('alice@acme.com');
    expect(req!.department.code).toBe('IT');
    expect(req!.requestType.code).toBe('LAPTOP');
  });

  it('should create a full request lifecycle in the database', async () => {
    const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
    const user = await prisma.user.findFirst({ where: { email: 'alice@acme.com' } });
    const agent = await prisma.user.findFirst({ where: { email: 'bob@acme.com' } });
    const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });

    expect(dept && user && agent && rt).toBeTruthy();

    // Create
    const req = await prisma.request.create({
      data: {
        employeeId: user!.id,
        departmentId: dept!.id,
        requestTypeId: rt!.id,
        title: 'Integration Test Request',
        description: 'This request is created by the integration test to verify the full lifecycle',
        priority: 'STANDARD',
        status: 'PENDING',
      },
    });
    expect(req.status).toBe('PENDING');

    // Claim
    const claimed = await prisma.request.update({
      where: { id: req.id },
      data: { status: 'IN_PROGRESS', claimedById: agent!.id },
    });
    expect(claimed.status).toBe('IN_PROGRESS');
    expect(claimed.claimedById).toBe(agent!.id);

    // Complete
    const completed = await prisma.request.update({
      where: { id: req.id },
      data: { status: 'COMPLETED', resolutionNote: 'Integration test passed.' },
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.resolutionNote).toBe('Integration test passed.');

    // Verify full relation chain
    const full = await prisma.request.findUnique({
      where: { id: req.id },
      include: { owner: true, claimant: true, department: true, requestType: true },
    });
    expect(full!.owner.email).toBe('alice@acme.com');
    expect(full!.claimant!.email).toBe('bob@acme.com');
    expect(full!.department.code).toBe('IT');
    expect(full!.requestType.code).toBe('LAPTOP');
  });

  it('should enforce department-requestType relationship', async () => {
    const types = await prisma.requestType.findMany({ include: { department: true } });
    for (const rt of types) {
      expect(rt.departmentId).toBe(rt.department.id);
    }
  });
});
