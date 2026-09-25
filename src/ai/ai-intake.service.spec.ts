import { BadRequestException } from '@nestjs/common';
import { AiIntakeService, validateCandidate } from './ai-intake.service';
import { LocalAiProvider } from './local-ai.provider';
import { CatalogDepartment } from './ai.provider';

// Deterministic tests: strip any locally configured key (Prisma's import
// chain auto-loads .env) so drafts always take the offline path.
delete process.env['GROQ_API_KEY'];

// Mirrors prisma/seed.ts so unit tests never touch the database.
const CATALOG: CatalogDepartment[] = [
  {
    code: 'HR',
    name: 'Human Resources',
    description: 'Employment letters, benefits, onboarding',
    types: [
      { code: 'EMP_LETTER', name: 'Employment Letter', description: 'Request employment verification letter' },
    ],
  },
  {
    code: 'IT',
    name: 'IT & Technical Support',
    description: 'Laptop problems, software, account access',
    types: [
      { code: 'LAPTOP', name: 'Laptop Request', description: 'Request a new or replacement laptop' },
      { code: 'VPN', name: 'VPN Access', description: 'Request VPN access' },
    ],
  },
];

const ROWS = [
  {
    id: 'dept-hr', code: 'HR', name: 'Human Resources', description: 'Employment letters', active: true,
    requestTypes: [{ id: 'type-letter', code: 'EMP_LETTER', name: 'Employment Letter', description: 'letter', active: true }],
  },
  {
    id: 'dept-it', code: 'IT', name: 'IT & Technical Support', description: 'Laptop problems', active: true,
    requestTypes: [
      { id: 'type-laptop', code: 'LAPTOP', name: 'Laptop Request', description: 'laptop', active: true },
      { id: 'type-vpn', code: 'VPN', name: 'VPN Access', description: 'vpn', active: true },
    ],
  },
  {
    id: 'dept-peo', code: 'PEO', name: 'People Operations', description: 'Wellbeing and training', active: true,
    requestTypes: [
      { id: 'type-wellbeing', code: 'WELLBEING', name: 'Employee Wellbeing', description: 'Wellbeing support, grievances and resources', active: true },
    ],
  },
];

const stubPrisma = { department: { findMany: async () => ROWS } } as any;

describe('AI-assisted intake (Week 4)', () => {
  const local = new LocalAiProvider();

  it('clear input: routes an urgent laptop request with high confidence', async () => {
    const res = await local.extractDraft(
      'My laptop screen is cracked and I need a replacement ASAP, I cannot work like this',
      CATALOG,
    );
    expect(res.draft.departmentCode).toBe('IT');
    expect(res.draft.requestTypeCode).toBe('LAPTOP');
    expect(res.draft.priority).toBe('URGENT');
    expect(res.confidence).toBe('high');
  });

  it('does not let shared department keywords make a clear laptop request ambiguous', async () => {
    const svc = new AiIntakeService(stubPrisma, new LocalAiProvider(), undefined as any);
    const out = await svc.draft('my laptop screen is cracked, need it asap');
    expect(out.departmentId).toBe('dept-it');
    expect(out.requestTypeId).toBe('type-laptop');
    expect(out.needsClarification).toBe(false);
  });

  it('thin input: a single word asks for clarification rather than guessing missing details', async () => {
    const res = await local.extractDraft('vpn', CATALOG);
    expect(res.draft.departmentCode).toBe('IT');
    expect(res.draft.requestTypeCode).toBe('VPN');
    expect(res.confidence).toBe('low');
    const draft = await new AiIntakeService(stubPrisma, new LocalAiProvider(), undefined as any).draft('vpn');
    expect(draft.needsClarification).toBe(true);
    expect(draft.departmentId).toBeNull();
    expect(draft.clarificationQuestions.length).toBeGreaterThan(0);
  });

  it('ambiguous input: asks a focused question and does not choose a category', async () => {
    const res = await new AiIntakeService(stubPrisma, new LocalAiProvider(), undefined as any).draft('help me get set up');
    expect(res.needsClarification).toBe(true);
    expect(res.departmentId).toBeNull();
    expect(res.requestTypeId).toBeNull();
    expect(res.clarificationQuestions.length).toBeGreaterThan(0);
  });

  it('calm input: no urgency words means STANDARD, never forced URGENT', async () => {
    const res = await local.extractDraft(
      'please fix my laptop at your convenience, no rush',
      CATALOG,
    );
    expect(res.draft.priority).toBe('STANDARD');
  });

  it('invalid model output: unknown department or category is rejected, never created', () => {
    expect(() =>
      validateCandidate(
        { departmentCode: 'NOPE', requestTypeCode: 'LAPTOP', title: 't', description: 'long enough desc', priority: 'URGENT' },
        ROWS.map((d) => ({ id: d.id, code: d.code, requestTypes: d.requestTypes })),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validateCandidate(
        { departmentCode: 'IT', requestTypeCode: 'NOPE', title: 't', description: 'long enough desc', priority: 'URGENT' },
        ROWS.map((d) => ({ id: d.id, code: d.code, requestTypes: d.requestTypes })),
      ),
    ).toThrow(BadRequestException);
  });

  it('unknown priority is coerced to STANDARD instead of rejected', () => {
    const out = validateCandidate(
      { departmentCode: 'IT', requestTypeCode: 'VPN', title: 't', description: 'long enough desc', priority: 'HYPER' },
      ROWS.map((d) => ({ id: d.id, code: d.code, requestTypes: d.requestTypes })),
    );
    expect(out.priority).toBe('STANDARD');
  });

  it('provider failure: a throwing provider falls back to local and still drafts', async () => {
    const failing = { name: 'broken', extractDraft: async () => { throw new Error('provider down'); } };
    const svc = new AiIntakeService(stubPrisma, new LocalAiProvider(), undefined as any);
    const out = await svc.draft('my laptop screen is cracked, need it asap', failing as any);
    expect(out.provider).toBe('local');
    expect(out.departmentId).toBe('dept-it');
    expect(out.requestTypeId).toBe('type-laptop');
  });

  it('empty input is rejected before any provider runs', async () => {
    const svc = new AiIntakeService(stubPrisma, new LocalAiProvider(), undefined as any);
    await expect(svc.draft('   ')).rejects.toThrow(BadRequestException);
  });

  it('distressed, typo’d input routes to wellbeing as sensitive (never UNKNOWN)', async () => {
    const svc = new AiIntakeService(stubPrisma, new LocalAiProvider(), undefined as any);
    const out = await svc.draft('please i need help im crying i feel sick and my employee is harrassing me');
    expect(out.provider).toBe('local');
    expect(out.departmentId).toBe('dept-peo');
    expect(out.requestTypeId).toBe('type-wellbeing');
    expect(out.sensitive).toBe(true);
    // Three clean keyword hits (crying, sick, employee) with daylight behind
    // them: high confidence AND a sensitive flag coexist — the human still
    // reviews every word before anything is created.
    expect(out.confidence).toBe('high');
  });

  it('off-topic input gets a clean human error, not a forced guess', async () => {
    const svc = new AiIntakeService(stubPrisma, new LocalAiProvider(), undefined as any);
    await expect(svc.draft('who won the formula 1 race yesterday')).rejects.toThrow(
      /workplace requests/,
    );
  });

  it('SLA estimator falls back to priority targets in milliseconds without a key', async () => {
    const svc = new AiIntakeService(stubPrisma, new LocalAiProvider(), undefined as any);
    await expect(svc.decideSlaMs('my laptop is on fire', 'URGENT')).resolves.toEqual({
      durationMs: 4 * 3600_000,
      source: 'RULE',
    });
    await expect(svc.decideSlaMs('need a new mouse', 'STANDARD')).resolves.toEqual({
      durationMs: 24 * 3600_000,
      source: 'RULE',
    });
    await expect(svc.decideSlaMs('new mouse when convenient', 'LOW')).resolves.toEqual({
      durationMs: 48 * 3600_000,
      source: 'RULE',
    });
  });

  it('resolution drafting uses a safe local template without a Groq key', async () => {
    const svc = new AiIntakeService(stubPrisma, new LocalAiProvider(), undefined as any);
    const draft = await svc.generateResolutionPlaybook({
      title: 'Laptop screen issue',
      description: 'The screen flickers after waking the device.',
      department: 'IT',
      requestType: 'Laptop Request',
    });
    expect(draft.provider).toBe('local-template');
    expect(draft.confidence).toBe('low');
    expect(draft.resolutionNote).toContain('[Confirm]');
    expect(draft.assumptions.every((item) => item.startsWith('[Confirm]'))).toBe(true);
  });
});
