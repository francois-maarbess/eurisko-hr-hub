import { PrismaClient } from '@prisma/client';

/**
 * Guided-demo storyline (DEMO.md). Run ONCE on a fresh database:
 *
 *   npm run db:reset && npx tsx scripts/demo-scenario.ts
 *
 * Builds three tickets that showcase the whole product in ~2 minutes:
 *  1. URGENT "laptop smoking" ticket with a live ~50min SLA countdown.
 *  2. IN_PROGRESS ticket claimed by Bob with a private staff note.
 *  3. COMPLETED + 5-star rated ticket (feeds the CSAT average).
 *
 * Deterministic by design: explicit slaDueAt values, no LLM calls.
 */
const prisma = new PrismaClient();

async function main() {
  const now = Date.now();
  const alice = await prisma.user.findUniqueOrThrow({ where: { email: 'alice@acme.com' } });
  const bob = await prisma.user.findUniqueOrThrow({ where: { email: 'bob@acme.com' } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@acme.com' } });
  const it = await prisma.department.findUniqueOrThrow({ where: { code: 'IT' } });
  const laptop = await prisma.requestType.findFirstOrThrow({ where: { departmentId: it.id, code: 'LAPTOP' } });

  // Wipe any previous run so the demo is repeatable.
  await prisma.staffNote.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.request.deleteMany();

  // 1. The fire ticket: URGENT, PENDING, ~50 minutes of SLA left.
  const fire = await prisma.request.create({
    data: {
      employeeId: alice.id,
      departmentId: it.id,
      requestTypeId: laptop.id,
      title: 'Laptop smoking on my desk',
      description: 'My laptop started smoking during a client call. I need a replacement unit today.',
      priority: 'URGENT',
      status: 'PENDING',
      createdAt: new Date(now - 10 * 60_000),
      slaDueAt: new Date(now + 50 * 60_000),
      slaSource: 'RULE',
    },
  });
  await prisma.auditLog.create({
    data: { requestId: fire.id, actorId: alice.id, action: 'REQUEST_CREATED', newValue: fire.title },
  });

  // 2. Mid-flight ticket: claimed by Bob, one private staff note.
  const mid = await prisma.request.create({
    data: {
      employeeId: alice.id,
      departmentId: it.id,
      requestTypeId: laptop.id,
      title: 'VPN drops every hour',
      description: 'VPN disconnects roughly every hour since Monday, breaking my remote sessions.',
      priority: 'STANDARD',
      status: 'IN_PROGRESS',
      claimedById: bob.id,
      createdAt: new Date(now - 3 * 3600_000),
      slaDueAt: new Date(now + 21 * 3600_000),
      slaSource: 'RULE',
    },
  });
  await prisma.auditLog.createMany({
    data: [
      { requestId: mid.id, actorId: alice.id, action: 'REQUEST_CREATED', newValue: mid.title },
      { requestId: mid.id, actorId: bob.id, action: 'REQUEST_CLAIMED', newValue: 'Bob Agent' },
    ],
  });
  const note = await prisma.staffNote.create({
    data: { requestId: mid.id, authorId: bob.id, content: 'Reproduced on the test rig. Escalated to the network vendor, case #44192.' },
  });
  await prisma.auditLog.create({
    data: {
      requestId: mid.id,
      actorId: bob.id,
      action: 'STAFF_NOTE_ADDED',
      newValue: 'Reproduced on the test rig. Escalated to the network vendor, case #44192.',
    },
  });

  // 3. Done deal: completed inside SLA, rated 5 stars.
  const done = await prisma.request.create({
    data: {
      employeeId: alice.id,
      departmentId: it.id,
      requestTypeId: laptop.id,
      title: 'New hire laptop request',
      description: 'Standard laptop for the new designer starting Monday.',
      priority: 'STANDARD',
      status: 'COMPLETED',
      claimedById: bob.id,
      resolutionNote: 'Issued from stock, asset tag LT-2204.',
      createdAt: new Date(now - 30 * 3600_000),
      completedAt: new Date(now - 8 * 3600_000),
      slaDueAt: new Date(now - 8 * 3600_000 + 24 * 3600_000),
      slaSource: 'RULE',
      rating: 5,
      feedbackNote: 'Fast and clear, thanks!',
    },
  });
  await prisma.auditLog.createMany({
    data: [
      { requestId: done.id, actorId: alice.id, action: 'REQUEST_CREATED', newValue: done.title },
      { requestId: done.id, actorId: bob.id, action: 'REQUEST_CLAIMED', newValue: 'Bob Agent' },
      { requestId: done.id, actorId: bob.id, action: 'STATUS_CHANGED', oldValue: 'IN_PROGRESS', newValue: 'COMPLETED' },
    ],
  });

  console.log('Demo scenario ready:');
  console.log(`  1. URGENT fire ticket (PENDING, live SLA):   ${fire.id}`);
  console.log(`  2. Claimed ticket with staff note:           ${mid.id}  (note ${note.id})`);
  console.log(`  3. Completed + 5-star ticket (CSAT):         ${done.id}`);
  console.log(`Admin for the tour: ${admin.email} / Password123!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
