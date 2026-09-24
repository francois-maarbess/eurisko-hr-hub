import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'Password123!';

async function clean() {
  console.log('Cleaning database...');
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // 1. Remove all ticket-dependent records and requests
  await prisma.staffNote.deleteMany();
  await prisma.document.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notificationEvent.deleteMany();
  await prisma.request.deleteMany();

  // 2. Remove any users other than alice, bob, and admin (exactly 3 accounts)
  await prisma.departmentMember.deleteMany({
    where: {
      user: {
        email: { notIn: ['alice@acme.com', 'bob@acme.com', 'admin@acme.com'] },
      },
    },
  });
  await prisma.user.deleteMany({
    where: {
      email: { notIn: ['alice@acme.com', 'bob@acme.com', 'admin@acme.com'] },
    },
  });

  // 3. Ensure alice, bob, and admin exist and have proper roles and password
  await prisma.user.upsert({
    where: { email: 'alice@acme.com' },
    update: { displayName: 'Alice Employee', platformRole: 'EMPLOYEE', passwordHash: hash, active: true },
    create: { email: 'alice@acme.com', displayName: 'Alice Employee', platformRole: 'EMPLOYEE', passwordHash: hash, active: true },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@acme.com' },
    update: { displayName: 'Bob Agent', platformRole: 'EMPLOYEE', passwordHash: hash, active: true },
    create: { email: 'bob@acme.com', displayName: 'Bob Agent', platformRole: 'EMPLOYEE', passwordHash: hash, active: true },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@acme.com' },
    update: { displayName: 'Admin User', platformRole: 'SYSTEM_ADMIN', passwordHash: hash, active: true },
    create: { email: 'admin@acme.com', displayName: 'Admin User', platformRole: 'SYSTEM_ADMIN', passwordHash: hash, active: true },
  });

  // Ensure admin has manager membership in IT so all role capabilities work smoothly
  const itDept = await prisma.department.findUnique({ where: { code: 'IT' } });
  if (itDept) {
    await prisma.departmentMember.upsert({
      where: { userId_departmentId: { userId: admin.id, departmentId: itDept.id } },
      update: { departmentRole: 'MANAGER', active: true },
      create: { userId: admin.id, departmentId: itDept.id, departmentRole: 'MANAGER', active: true },
    });
    // Bob is the demo IT agent (claim/queue flows, e2e, and README login depend on him)
    await prisma.departmentMember.upsert({
      where: { userId_departmentId: { userId: bob.id, departmentId: itDept.id } },
      update: { departmentRole: 'AGENT', active: true },
      create: { userId: bob.id, departmentId: itDept.id, departmentRole: 'AGENT', active: true },
    });
  }

  // Count check
  const users = await prisma.user.findMany({ select: { email: true, platformRole: true } });
  const reqCount = await prisma.request.count();
  const deptCount = await prisma.department.count();
  const typeCount = await prisma.requestType.count();

  console.log('Database cleaned successfully!');
  console.log('Users in database:', users);
  console.log(`Requests: ${reqCount}`);
  console.log(`Departments: ${deptCount}, Request Types: ${typeCount}`);
}

clean()
  .catch((err) => {
    console.error('Clean failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
