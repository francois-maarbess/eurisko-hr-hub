import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, displayName: true, platformRole: true, active: true },
  });
  const requests = await prisma.request.count();
  const docs = await prisma.document.count();
  const notes = await prisma.staffNote.count();
  const audits = await prisma.auditLog.count();
  const notifs = await prisma.notification.count();
  const depts = await prisma.department.findMany({ select: { code: true, name: true } });

  console.log('--- DATABASE STATUS ---');
  console.log('Users count:', users.length);
  for (const u of users) {
    console.log(` - ${u.email} (${u.displayName}) [${u.platformRole}] active: ${u.active}`);
  }
  console.log('Requests count:', requests);
  console.log('Documents count:', docs);
  console.log('Staff notes count:', notes);
  console.log('Audit logs count:', audits);
  console.log('Notifications count:', notifs);
  console.log('Departments count:', depts.length);
}

check().finally(() => prisma.$disconnect());
