/**
 * DB doctor: answers "is my database healthy?" without touching anything.
 * Checks the file, the seed users, the catalog, and (read-only) row counts.
 *
 *   npm run db:doctor
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, statSync } from 'fs';
import { join, resolve } from 'path';

const prisma = new PrismaClient();
let failed = false;

function ok(label: string, detail = '') {
  console.log(`ok   ${label}${detail ? ` (${detail})` : ''}`);
}
function bad(label: string, fix: string) {
  failed = true;
  console.log(`FAIL ${label} -> ${fix}`);
}

async function main() {
  const dbUrl = process.env['DATABASE_URL'] || 'file:./dev.db';
  // Prisma resolves relative SQLite paths against the schema directory.
  const file = dbUrl.startsWith('file:')
    ? resolve(join(__dirname, '..', 'prisma'), dbUrl.slice('file:'.length))
    : dbUrl;
  if (!existsSync(file)) {
    bad(`database file missing (${file})`, 'run: npm run db:reset');
  } else {
    ok('database file present', `${(statSync(file).size / 1024).toFixed(0)} KB`);
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    ok('database reachable');
  } catch (e) {
    bad('database unreachable', `run: npm run db:reset (${(e as Error).message})`);
    return;
  }

  for (const email of ['alice@acme.com', 'bob@acme.com', 'admin@acme.com']) {
    const u = await prisma.user.findUnique({ where: { email } }).catch(() => null);
    if (u?.active) ok(`seed user ${email}`);
    else bad(`seed user ${email} missing/inactive`, 'run: npm run db:reset');
  }

  const depts = await prisma.department.count().catch(() => -1);
  const types = await prisma.requestType.count().catch(() => -1);
  if (depts > 0 && types > 0) ok('catalog seeded', `${depts} departments, ${types} types`);
  else bad('catalog empty', 'run: npm run db:reset');

  const reqs = await prisma.request.count().catch(() => -1);
  const users = await prisma.user.count().catch(() => -1);
  console.log(`info ${reqs} request(s), ${users} user(s) in database`);
  if (users !== 3) console.log('hint exactly 3 users expected (alice, bob, admin) — run: npx tsx scripts/clean-db.ts');
}

main()
  .then(() => process.exit(failed ? 1 : 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
