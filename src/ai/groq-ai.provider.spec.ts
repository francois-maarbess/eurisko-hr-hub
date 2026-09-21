import { GroqAiProvider } from './groq-ai.provider';
import { CatalogDepartment } from './ai.provider';

const CATALOG: CatalogDepartment[] = [
  {
    code: 'IT',
    name: 'IT & Technical Support',
    description: null,
    types: [{ code: 'LAPTOP', name: 'Laptop Request', description: null }],
  },
];

function mockGroqReply(payload: object) {
  (global as any).fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  });
}

describe('GroqAiProvider confidence (Week 4 follow-up)', () => {
  const OLD_KEY = process.env['GROQ_API_KEY'];
  const OLD_FETCH = (global as any).fetch;

  beforeEach(() => {
    process.env['GROQ_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env['GROQ_API_KEY'];
    else process.env['GROQ_API_KEY'] = OLD_KEY;
    (global as any).fetch = OLD_FETCH;
  });

  it('passes through an explicit high confidence + sensitive flag', async () => {
    mockGroqReply({
      departmentCode: 'IT',
      requestTypeCode: 'LAPTOP',
      title: 'Laptop Screen Replacement Request',
      description: 'Screen is cracked.',
      priority: 'URGENT',
      sensitive: true,
      confidence: 'high',
    });
    const res = await new GroqAiProvider().extractDraft('my screen is cracked', CATALOG);
    expect(res.confidence).toBe('high');
    expect(res.sensitive).toBe(true);
    expect(res.draft.departmentCode).toBe('IT');
  });

  it('degrades missing or vague confidence to low (never confident by default)', async () => {
    mockGroqReply({
      departmentCode: 'IT',
      requestTypeCode: 'LAPTOP',
      title: 'General Assistance Request',
      description: 'Needs help.',
      priority: 'URGENT',
      sensitive: false,
    });
    const vague = await new GroqAiProvider().extractDraft('i need help asap', CATALOG);
    expect(vague.confidence).toBe('low');
    expect(vague.sensitive).toBe(false);

    mockGroqReply({
      departmentCode: 'IT',
      requestTypeCode: 'LAPTOP',
      title: 'General Assistance Request',
      description: 'Needs help.',
      priority: 'URGENT',
      sensitive: false,
      confidence: 'low',
    });
    const explicit = await new GroqAiProvider().extractDraft('i need help asap', CATALOG);
    expect(explicit.confidence).toBe('low');
  });

  it('throws without a key so the service falls back to local', async () => {
    delete process.env['GROQ_API_KEY'];
    await expect(new GroqAiProvider().extractDraft('laptop broken', CATALOG)).rejects.toThrow();
  });
});
