import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Demo password for every seeded account (documented in README + login page).
// Real accounts get their own password from an admin (see AuthService).
const DEMO_PASSWORD = 'Password123!';

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

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

  const finance = await prisma.department.upsert({
    where: { code: 'FINANCE' },
    update: {},
    create: { code: 'FINANCE', name: 'Finance', description: 'Expenses, invoices, budgets and reimbursements' },
  });

  const fac = await prisma.department.upsert({
    where: { code: 'FAC' },
    update: {},
    create: { code: 'FAC', name: 'Facilities & Workplace', description: 'Maintenance, repairs, supplies, badges and workspace' },
  });

  const peo = await prisma.department.upsert({
    where: { code: 'PEO' },
    update: {},
    create: { code: 'PEO', name: 'People Operations', description: 'Training, performance, wellbeing and feedback' },
  });

  // Users: Alice (employee), Bob (IT agent), Admin (system admin).
  // Exactly three accounts — the demo login. E2E tests self-provision any
  // extra users they need and clean up after themselves.
  await prisma.user.upsert({
    where: { email: 'alice@acme.com' },
    update: { displayName: 'Alice Employee', platformRole: 'EMPLOYEE', passwordHash, active: true },
    create: { email: 'alice@acme.com', displayName: 'Alice Employee', platformRole: 'EMPLOYEE', passwordHash, active: true },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@acme.com' },
    update: { displayName: 'Bob Agent', platformRole: 'EMPLOYEE', passwordHash, active: true },
    create: { email: 'bob@acme.com', displayName: 'Bob Agent', platformRole: 'EMPLOYEE', passwordHash, active: true },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@acme.com' },
    update: { displayName: 'Admin User', platformRole: 'SYSTEM_ADMIN', passwordHash, active: true },
    create: { email: 'admin@acme.com', displayName: 'Admin User', platformRole: 'SYSTEM_ADMIN', passwordHash, active: true },
  });

  // Ensure admin has manager membership in IT
  await prisma.departmentMember.upsert({
    where: { userId_departmentId: { userId: admin.id, departmentId: it.id } },
    update: { departmentRole: 'MANAGER', active: true },
    create: { userId: admin.id, departmentId: it.id, departmentRole: 'MANAGER', active: true },
  });

  // Ensure Bob is an agent in IT (claim/queue flows + README demo login depend on him)
  await prisma.departmentMember.upsert({
    where: { userId_departmentId: { userId: bob.id, departmentId: it.id } },
    update: { departmentRole: 'AGENT', active: true },
    create: { userId: bob.id, departmentId: it.id, departmentRole: 'AGENT', active: true },
  });

  // Request types
  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: it.id, code: 'LAPTOP' } },
    update: {},
    create: { departmentId: it.id, code: 'LAPTOP', name: 'Laptop Request', description: 'Request a new or replacement laptop' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: it.id, code: 'VPN' } },
    update: {},
    create: { departmentId: it.id, code: 'VPN', name: 'VPN Access', description: 'Request VPN access' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: it.id, code: 'SOFTWARE' } },
    update: {},
    create: { departmentId: it.id, code: 'SOFTWARE', name: 'Software Request', description: 'Request software installation or licenses' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: it.id, code: 'ACCESS' } },
    update: {},
    create: { departmentId: it.id, code: 'ACCESS', name: 'Account Access', description: 'Request account creation, reset, or permissions' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: hr.id, code: 'EMP_LETTER' } },
    update: {},
    create: { departmentId: hr.id, code: 'EMP_LETTER', name: 'Employment Letter', description: 'Request employment verification letter' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: hr.id, code: 'ONBOARDING' } },
    update: {},
    create: { departmentId: hr.id, code: 'ONBOARDING', name: 'Onboarding Request', description: 'Onboarding checklist for a new joiner' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: finance.id, code: 'EXPENSE' } },
    update: {},
    create: { departmentId: finance.id, code: 'EXPENSE', name: 'Expense Reimbursement', description: 'Claim reimbursement for work expenses' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: finance.id, code: 'INVOICE' } },
    update: {},
    create: { departmentId: finance.id, code: 'INVOICE', name: 'Invoice Request', description: 'Request or dispute a vendor invoice' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: it.id, code: 'PRINTER' } },
    update: {},
    create: { departmentId: it.id, code: 'PRINTER', name: 'Printer & Peripherals', description: 'Printer setup, toner, scanners and peripherals' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: hr.id, code: 'LEAVE' } },
    update: {},
    create: { departmentId: hr.id, code: 'LEAVE', name: 'Leave Request', description: 'Vacation, sick leave and time off' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: finance.id, code: 'BUDGET' } },
    update: {},
    create: { departmentId: finance.id, code: 'BUDGET', name: 'Budget Approval', description: 'Request budget approval or allocation' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: fac.id, code: 'MAINTENANCE' } },
    update: {},
    create: { departmentId: fac.id, code: 'MAINTENANCE', name: 'Maintenance Request', description: 'Repairs, plumbing, electrical and facility issues' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: fac.id, code: 'SUPPLIES' } },
    update: {},
    create: { departmentId: fac.id, code: 'SUPPLIES', name: 'Office Supplies', description: 'Order stationery, furniture and office stock' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: fac.id, code: 'BADGE' } },
    update: {},
    create: { departmentId: fac.id, code: 'BADGE', name: 'Badge & Building Access', description: 'Access badges and building entry' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: fac.id, code: 'DESK' } },
    update: {},
    create: { departmentId: fac.id, code: 'DESK', name: 'Desk & Meeting Room', description: 'Desk issues, meeting rooms and workspace moves' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: hr.id, code: 'PAYROLL' } },
    update: {},
    create: { departmentId: hr.id, code: 'PAYROLL', name: 'Payroll & Payslip', description: 'Payroll questions and payslip copies' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: hr.id, code: 'BENEFITS' } },
    update: {},
    create: { departmentId: hr.id, code: 'BENEFITS', name: 'Benefits & Insurance', description: 'Health insurance and employee benefits' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: it.id, code: 'EMAIL' } },
    update: {},
    create: { departmentId: it.id, code: 'EMAIL', name: 'Email & Calendar', description: 'Email and calendar problems' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: it.id, code: 'EQUIPMENT' } },
    update: {},
    create: { departmentId: it.id, code: 'EQUIPMENT', name: 'Equipment Request', description: 'Request or replace non-laptop hardware' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: finance.id, code: 'PAYMENT' } },
    update: {},
    create: { departmentId: finance.id, code: 'PAYMENT', name: 'Payment & Banking', description: 'Payment and banking questions' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: peo.id, code: 'TRAINING' } },
    update: {},
    create: { departmentId: peo.id, code: 'TRAINING', name: 'Training Request', description: 'Courses, certifications and workshops' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: peo.id, code: 'WELLBEING' } },
    update: { description: 'Wellbeing support, workplace safety concerns, grievances and resources' },
    create: { departmentId: peo.id, code: 'WELLBEING', name: 'Employee Wellbeing', description: 'Wellbeing support, workplace safety concerns, grievances and resources' },
  });

  await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: peo.id, code: 'FEEDBACK' } },
    update: {},
    create: { departmentId: peo.id, code: 'FEEDBACK', name: 'Workplace Feedback', description: 'Suggestions about the workplace experience' },
  });

  console.log('Seed completed: departments, request types, Alice (employee), Bob (IT agent), and Admin (system admin) initialized.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
