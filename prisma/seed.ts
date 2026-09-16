import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Departments
  const it = await prisma.department.upsert({
    where: { code: 'IT' },
    update: {},
    create: { code: 'IT', name: 'IT & Technical Support', description: 'Laptop problems, software, account access' },
  });

  const hr = await prisma.department.upsert({
    where: { code: 'HR' },
    update: {},
    create: { code: 'HR', name: 'Human Resources', description: 'Employment letters, benefits, onboarding' },
  });

  // Users
  const employee = await prisma.user.upsert({
    where: { email: 'alice@acme.com' },
    update: {},
    create: { email: 'alice@acme.com', displayName: 'Alice Employee', platformRole: 'EMPLOYEE' },
  });

  const agent = await prisma.user.upsert({
    where: { email: 'bob@acme.com' },
    update: {},
    create: { email: 'bob@acme.com', displayName: 'Bob Agent', platformRole: 'EMPLOYEE' },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@acme.com' },
    update: {},
    create: { email: 'admin@acme.com', displayName: 'Admin User', platformRole: 'SYSTEM_ADMIN' },
  });

  // Department memberships
  await prisma.departmentMember.upsert({
    where: { userId_departmentId: { userId: agent.id, departmentId: it.id } },
    update: {},
    create: { userId: agent.id, departmentId: it.id, departmentRole: 'AGENT' },
  });

  await prisma.departmentMember.upsert({
    where: { userId_departmentId: { userId: admin.id, departmentId: it.id } },
    update: {},
    create: { userId: admin.id, departmentId: it.id, departmentRole: 'MANAGER' },
  });

  // Request types
  const laptopType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: it.id, code: 'LAPTOP' } },
    update: {},
    create: { departmentId: it.id, code: 'LAPTOP', name: 'Laptop Request', description: 'Request a new or replacement laptop' },
  });

  const vpnType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: it.id, code: 'VPN' } },
    update: {},
    create: { departmentId: it.id, code: 'VPN', name: 'VPN Access', description: 'Request VPN access' },
  });

  const empLetterType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: hr.id, code: 'EMP_LETTER' } },
    update: {},
    create: { departmentId: hr.id, code: 'EMP_LETTER', name: 'Employment Letter', description: 'Request employment verification letter' },
  });

  // Initial requests
  await prisma.request.upsert({
    where: { id: 'req-1' },
    update: {},
    create: {
      id: 'req-1',
      employeeId: employee.id,
      departmentId: it.id,
      requestTypeId: laptopType.id,
      title: 'Laptop Request',
      description: 'Employee needs a replacement work laptop for onboarding.',
      priority: 'URGENT',
      status: 'PENDING',
    },
  });

  await prisma.request.upsert({
    where: { id: 'req-2' },
    update: {},
    create: {
      id: 'req-2',
      employeeId: employee.id,
      departmentId: it.id,
      requestTypeId: vpnType.id,
      title: 'VPN Access Request',
      description: 'Employee needs temporary access to the finance VPN for travel.',
      priority: 'STANDARD',
      status: 'IN_PROGRESS',
      claimedById: agent.id,
    },
  });

  await prisma.request.upsert({
    where: { id: 'req-3' },
    update: {},
    create: {
      id: 'req-3',
      employeeId: employee.id,
      departmentId: hr.id,
      requestTypeId: empLetterType.id,
      title: 'Employment Letter',
      description: 'Employee requests an employment verification letter for a visa application.',
      priority: 'LOW',
      status: 'COMPLETED',
      resolutionNote: 'Letter sent to employee email.',
    },
  });

  console.log('Seed data created successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
