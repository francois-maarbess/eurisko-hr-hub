import { PrismaClient } from '@prisma/client';

describe('Database Integration', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    // Self-sufficient: suites share one SQLite file and run in whatever
    // order the sequencer chooses, so never depend on leftover rows.
    const existing = await prisma.request.findFirst({ select: { id: true } });
    if (!existing) {
      const dept = await prisma.department.findFirst({ where: { code: 'IT' } });
      const user = await prisma.user.findFirst({ where: { email: 'alice@acme.com' } });
      const rt = await prisma.requestType.findFirst({ where: { code: 'LAPTOP' } });
      if (dept && user && rt) {
        await prisma.request.create({
          data: {
            employeeId: user.id,
            departmentId: dept.id,
            requestTypeId: rt.id,
            title: 'Integration Seed Request',
            description: 'Ensures relation checks have at least one row',
            priority: 'STANDARD',
            status: 'PENDING',
          },
        });
      }
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should read seeded data and verify relations', async () => {
    const requests = await prisma.request.findMany({
      include: { owner: true, department: true, requestType: true },
    });

    expect(requests.length).toBeGreaterThanOrEqual(1);

    // Find any request and verify its relations are intact
    const req = requests[0];
    expect(req.owner).toBeDefined();
    expect(req.owner.email).toBeTruthy();
    expect(req.department).toBeDefined();
    expect(req.department.code).toBeTruthy();
    expect(req.requestType).toBeDefined();
    expect(req.requestType.code).toBeTruthy();
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
