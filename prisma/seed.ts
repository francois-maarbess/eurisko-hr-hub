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

  const operations = await prisma.department.upsert({
    where: { code: 'OPERATIONS' },
    update: {},
    create: { code: 'OPERATIONS', name: 'Operations & Facilities', description: 'Maintenance, repairs, office supplies and facilities' },
  });

  // Users (all password-protected; see README demo accounts)
  const employee = await prisma.user.upsert({
    where: { email: 'alice@acme.com' },
    update: { passwordHash },
    create: { email: 'alice@acme.com', displayName: 'Alice Employee', platformRole: 'EMPLOYEE', passwordHash },
  });

  const agent = await prisma.user.upsert({
    where: { email: 'bob@acme.com' },
    update: { passwordHash },
    create: { email: 'bob@acme.com', displayName: 'Bob Agent', platformRole: 'EMPLOYEE', passwordHash },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@acme.com' },
    update: { passwordHash },
    create: { email: 'admin@acme.com', displayName: 'Admin User', platformRole: 'SYSTEM_ADMIN', passwordHash },
  });

  const financeAgent = await prisma.user.upsert({
    where: { email: 'carol@acme.com' },
    update: { passwordHash },
    create: { email: 'carol@acme.com', displayName: 'Carol Agent', platformRole: 'EMPLOYEE', passwordHash },
  });

  // Department memberships (one person may serve several departments)
  await prisma.departmentMember.upsert({
    where: { userId_departmentId: { userId: agent.id, departmentId: it.id } },
    update: {},
    create: { userId: agent.id, departmentId: it.id, departmentRole: 'AGENT' },
  });

  await prisma.departmentMember.upsert({
    where: { userId_departmentId: { userId: agent.id, departmentId: hr.id } },
    update: {},
    create: { userId: agent.id, departmentId: hr.id, departmentRole: 'AGENT' },
  });

  await prisma.departmentMember.upsert({
    where: { userId_departmentId: { userId: admin.id, departmentId: it.id } },
    update: {},
    create: { userId: admin.id, departmentId: it.id, departmentRole: 'MANAGER' },
  });

  await prisma.departmentMember.upsert({
    where: { userId_departmentId: { userId: financeAgent.id, departmentId: finance.id } },
    update: {},
    create: { userId: financeAgent.id, departmentId: finance.id, departmentRole: 'AGENT' },
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

  const softwareType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: it.id, code: 'SOFTWARE' } },
    update: {},
    create: { departmentId: it.id, code: 'SOFTWARE', name: 'Software Request', description: 'Request software installation or licenses' },
  });

  const accessType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: it.id, code: 'ACCESS' } },
    update: {},
    create: { departmentId: it.id, code: 'ACCESS', name: 'Account Access', description: 'Request account creation, reset, or permissions' },
  });

  const empLetterType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: hr.id, code: 'EMP_LETTER' } },
    update: {},
    create: { departmentId: hr.id, code: 'EMP_LETTER', name: 'Employment Letter', description: 'Request employment verification letter' },
  });

  const onboardingType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: hr.id, code: 'ONBOARDING' } },
    update: {},
    create: { departmentId: hr.id, code: 'ONBOARDING', name: 'Onboarding Request', description: 'Onboarding checklist for a new joiner' },
  });

  const expenseType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: finance.id, code: 'EXPENSE' } },
    update: {},
    create: { departmentId: finance.id, code: 'EXPENSE', name: 'Expense Reimbursement', description: 'Claim reimbursement for work expenses' },
  });

  const invoiceType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: finance.id, code: 'INVOICE' } },
    update: {},
    create: { departmentId: finance.id, code: 'INVOICE', name: 'Invoice Request', description: 'Request or dispute a vendor invoice' },
  });

  const printerType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: it.id, code: 'PRINTER' } },
    update: {},
    create: { departmentId: it.id, code: 'PRINTER', name: 'Printer & Peripherals', description: 'Printer setup, toner, scanners and peripherals' },
  });

  const leaveType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: hr.id, code: 'LEAVE' } },
    update: {},
    create: { departmentId: hr.id, code: 'LEAVE', name: 'Leave Request', description: 'Vacation, sick leave and time off' },
  });

  const budgetType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: finance.id, code: 'BUDGET' } },
    update: {},
    create: { departmentId: finance.id, code: 'BUDGET', name: 'Budget Approval', description: 'Request budget approval or allocation' },
  });

  const maintenanceType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: operations.id, code: 'MAINTENANCE' } },
    update: {},
    create: { departmentId: operations.id, code: 'MAINTENANCE', name: 'Maintenance Request', description: 'Repairs, plumbing, electrical and facility issues' },
  });

  const suppliesType = await prisma.requestType.upsert({
    where: { departmentId_code: { departmentId: operations.id, code: 'SUPPLIES' } },
    update: {},
    create: { departmentId: operations.id, code: 'SUPPLIES', name: 'Office Supplies', description: 'Order stationery, furniture and office stock' },
  });

  // Requests across every state for a lived-in demo queue
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

  await prisma.request.upsert({
    where: { id: 'req-4' },
    update: {},
    create: {
      id: 'req-4',
      employeeId: employee.id,
      departmentId: it.id,
      requestTypeId: softwareType.id,
      title: 'Design Software License',
      description: 'Employee needs a Figma professional license for the new project.',
      priority: 'STANDARD',
      status: 'PENDING',
    },
  });

  await prisma.request.upsert({
    where: { id: 'req-5' },
    update: {},
    create: {
      id: 'req-5',
      employeeId: employee.id,
      departmentId: finance.id,
      requestTypeId: expenseType.id,
      title: 'Travel Expense Claim',
      description: 'Reimbursement for client-site travel: flights and hotel.',
      priority: 'STANDARD',
      status: 'PENDING',
    },
  });

  await prisma.request.upsert({
    where: { id: 'req-6' },
    update: {},
    create: {
      id: 'req-6',
      employeeId: employee.id,
      departmentId: hr.id,
      requestTypeId: onboardingType.id,
      title: 'New Joiner Onboarding',
      description: 'Onboarding checklist for a new backend developer starting Monday.',
      priority: 'URGENT',
      status: 'IN_PROGRESS',
      claimedById: agent.id,
    },
  });

  await prisma.request.upsert({
    where: { id: 'req-7' },
    update: {},
    create: {
      id: 'req-7',
      employeeId: employee.id,
      departmentId: finance.id,
      requestTypeId: invoiceType.id,
      title: 'Vendor Invoice Dispute',
      description: 'Invoice #INV-2041 charged twice for the same license seat.',
      priority: 'STANDARD',
      status: 'COMPLETED',
      claimedById: financeAgent.id,
      resolutionNote: 'Vendor credited the duplicate charge.',
    },
  });

  await prisma.request.upsert({
    where: { id: 'req-8' },
    update: {},
    create: {
      id: 'req-8',
      employeeId: employee.id,
      departmentId: operations.id,
      requestTypeId: maintenanceType.id,
      title: 'AC Not Cooling',
      description: 'The air conditioning in meeting room B stopped cooling yesterday.',
      priority: 'URGENT',
      status: 'PENDING',
    },
  });

  await prisma.request.upsert({
    where: { id: 'req-9' },
    update: {},
    create: {
      id: 'req-9',
      employeeId: employee.id,
      departmentId: hr.id,
      requestTypeId: leaveType.id,
      title: 'Summer Vacation',
      description: 'Requesting five days off in August for a family trip.',
      priority: 'LOW',
      status: 'PENDING',
    },
  });

  await prisma.request.upsert({
    where: { id: 'req-10' },
    update: {},
    create: {
      id: 'req-10',
      employeeId: employee.id,
      departmentId: finance.id,
      requestTypeId: budgetType.id,
      title: 'Q4 Team Budget',
      description: 'Approval needed for the Q4 contractor budget of $12,000.',
      priority: 'STANDARD',
      status: 'IN_PROGRESS',
      claimedById: financeAgent.id,
    },
  });

  await prisma.request.upsert({
    where: { id: 'req-11' },
    update: {},
    create: {
      id: 'req-11',
      employeeId: employee.id,
      departmentId: it.id,
      requestTypeId: printerType.id,
      title: 'Printer Toner',
      description: 'The second-floor printer is out of black toner.',
      priority: 'LOW',
      status: 'COMPLETED',
      claimedById: agent.id,
      resolutionNote: 'Toner cartridge replaced.',
    },
  });

  await prisma.request.upsert({
    where: { id: 'req-12' },
    update: {},
    create: {
      id: 'req-12',
      employeeId: employee.id,
      departmentId: operations.id,
      requestTypeId: suppliesType.id,
      title: 'Standing Desk',
      description: 'Requesting a standing desk converter for back pain.',
      priority: 'STANDARD',
      status: 'REJECTED',
      rejectionReason: 'Furniture budget frozen until next quarter.',
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
