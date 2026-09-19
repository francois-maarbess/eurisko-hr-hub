import { BadRequestException } from '@nestjs/common';
import { AiIntakeService, validateCandidate } from './ai-intake.service';
import { LocalAiProvider } from './local-ai.provider';
import { CatalogDepartment } from './ai.provider';

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

  it('thin input: a single word still resolves, validation pads description to DTO minimums', async () => {
    const res = await local.extractDraft('vpn', CATALOG);
    expect(res.draft.departmentCode).toBe('IT');
    expect(res.draft.requestTypeCode).toBe('VPN');
    expect(res.draft.priority).toBe('STANDARD');
    const validated = validateCandidate(
      res.draft,
      ROWS.map((d) => ({ id: d.id, code: d.code, requestTypes: d.requestTypes })),
    );
    expect(validated.description.length).toBeGreaterThanOrEqual(10);
  });

  it('ambiguous input: returns valid in-catalog values flagged low-confidence', async () => {
    const res = await local.extractDraft('help me get set up', CATALOG);
    expect(res.confidence).toBe('low');
    const validated = validateCandidate(
      res.draft,
      ROWS.map((d) => ({ id: d.id, code: d.code, requestTypes: d.requestTypes })),
    );
    expect(validated.departmentId).toBeTruthy();
    expect(validated.requestTypeId).toBeTruthy();
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
});
