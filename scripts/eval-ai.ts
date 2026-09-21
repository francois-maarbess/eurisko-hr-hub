/**
 * Week 4 AI evals (v0.4 PROVE): 6 representative cases, one command.
 * Runs fully offline against the local provider + a fake catalog mirroring
 * prisma/seed.ts — no API key, no database, fully deterministic.
 *
 *   npm run eval:ai
 */
import { AiIntakeService, validateCandidate } from '../src/ai/ai-intake.service';
import { LocalAiProvider } from '../src/ai/local-ai.provider';
import { CatalogDepartment } from '../src/ai/ai.provider';

const CATALOG: CatalogDepartment[] = [
  {
    code: 'HR', name: 'Human Resources', description: 'Employment letters, benefits, onboarding',
    types: [{ code: 'EMP_LETTER', name: 'Employment Letter', description: 'Request employment verification letter' }],
  },
  {
    code: 'IT', name: 'IT & Technical Support', description: 'Laptop problems, software, account access',
    types: [
      { code: 'LAPTOP', name: 'Laptop Request', description: 'Request a new or replacement laptop' },
      { code: 'VPN', name: 'VPN Access', description: 'Request VPN access' },
    ],
  },
  {
    code: 'PEO', name: 'People Operations', description: 'Wellbeing and training',
    types: [
      { code: 'WELLBEING', name: 'Employee Wellbeing', description: 'Wellbeing support, grievances and resources' },
    ],
  },
];

const ROWS = [
  {
    id: 'dept-hr', code: 'HR', name: 'Human Resources', description: 'Employment letters',
    requestTypes: [{ id: 'type-letter', code: 'EMP_LETTER', name: 'Employment Letter', description: 'letter', active: true }],
  },
  {
    id: 'dept-it', code: 'IT', name: 'IT & Technical Support', description: 'Laptop problems',
    requestTypes: [
      { id: 'type-laptop', code: 'LAPTOP', name: 'Laptop Request', description: 'laptop', active: true },
      { id: 'type-vpn', code: 'VPN', name: 'VPN Access', description: 'vpn', active: true },
    ],
  },
  {
    id: 'dept-peo', code: 'PEO', name: 'People Operations', description: 'Wellbeing and training',
    requestTypes: [{ id: 'type-wellbeing', code: 'WELLBEING', name: 'Employee Wellbeing', description: 'Wellbeing support, grievances and resources', active: true }],
  },
];

const stubPrisma = { department: { findMany: async () => ROWS } } as any;

type Case = { name: string; run: () => Promise<void> };
const cases: Case[] = [
  {
    name: 'clear input routes urgent laptop with high confidence',
    run: async () => {
      const r = await new LocalAiProvider().extractDraft(
        'My laptop screen is cracked and I need a replacement ASAP, I cannot work like this', CATALOG);
      assert(r.draft.departmentCode === 'IT' && r.draft.requestTypeCode === 'LAPTOP'
        && r.draft.priority === 'URGENT' && r.confidence === 'high', JSON.stringify(r));
    },
  },
  {
    name: 'thin input ("vpn") still resolves with padded description',
    run: async () => {
      const r = await new LocalAiProvider().extractDraft('vpn', CATALOG);
      assert(r.draft.requestTypeCode === 'VPN', JSON.stringify(r));
      const v = validateCandidate(r.draft, ROWS);
      assert(v.description.length >= 10, JSON.stringify(v));
    },
  },
  {
    name: 'ambiguous input stays in-catalog and flags low confidence',
    run: async () => {
      const r = await new LocalAiProvider().extractDraft('help me get set up', CATALOG);
      assert(r.confidence === 'low', JSON.stringify(r));
      validateCandidate(r.draft, ROWS); // must not throw
    },
  },
  {
    name: 'invalid model output is rejected, never created',
    run: async () => {
      let threw = false;
      try {
        validateCandidate(
          { departmentCode: 'NOPE', requestTypeCode: 'X', title: 't', description: 'long enough', priority: 'URGENT' }, ROWS);
      } catch { threw = true; }
      assert(threw, 'expected BadRequest for unknown department');
    },
  },
  {
    name: 'provider failure falls back to local and still drafts',
    run: async () => {
      const failing = { name: 'down', extractDraft: async () => { throw new Error('boom'); } };
      const svc = new AiIntakeService(stubPrisma, new LocalAiProvider(), undefined as any);
      const out = await svc.draft('vpn access please, urgent', failing as any);
      assert(out.provider === 'local' && out.requestTypeId === 'type-vpn', JSON.stringify(out));
    },
  },
  {
    name: 'calm input defaults to STANDARD (conditional behavior)',
    run: async () => {
      const r = await new LocalAiProvider().extractDraft('please fix my laptop at your convenience, no rush', CATALOG);
      assert(r.draft.priority === 'STANDARD', JSON.stringify(r));
    },
  },
  {
    name: 'distressed typo’d input routes to wellbeing, sensitive, high confidence',
    run: async () => {
      const svc = new AiIntakeService(stubPrisma, new LocalAiProvider(), undefined as any);
      const out = await svc.draft('please i need help im crying i feel sick and my employee is harrassing me');
      assert(out.departmentId === 'dept-peo' && out.requestTypeId === 'type-wellbeing'
        && out.sensitive === true && out.confidence === 'high', JSON.stringify(out));
    },
  },
  {
    name: 'off-topic input gets a clean human error, never a forced ticket',
    run: async () => {
      const svc = new AiIntakeService(stubPrisma, new LocalAiProvider(), undefined as any);
      let msg = '';
      try {
        await svc.draft('who won the formula 1 race yesterday');
      } catch (e: any) {
        msg = e.message || '';
      }
      assert(/workplace requests/.test(msg), `unexpected message: ${msg}`);
    },
  },
];

function assert(cond: boolean, detail: string) {
  if (!cond) throw new Error(`assertion failed: ${detail}`);
}

// Deterministic evals: never touch the network or a real key. Prisma's
// import chain auto-loads .env (which may hold GROQ_API_KEY locally),
// so strip it before any draft runs.
delete process.env['GROQ_API_KEY'];

(async () => {
  let failed = 0;
  for (const c of cases) {
    try {
      await c.run();
      console.log(`PASS  ${c.name}`);
    } catch (e: any) {
      failed++;
      console.log(`FAIL  ${c.name} :: ${e.message}`);
    }
  }
  console.log(failed === 0 ? `\n${cases.length}/${cases.length} eval cases passed.` : `\n${failed} eval case(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
})();
