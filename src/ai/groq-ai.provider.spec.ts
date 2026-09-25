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

function draftPayload(overrides: Record<string, unknown> = {}) {
  return {
    departmentCode: 'IT', requestTypeCode: 'LAPTOP', title: 'Laptop Screen Replacement Request',
    description: 'My laptop screen is cracked and I cannot work.', priority: 'URGENT',
    sensitive: false, confidence: 'high', rationale: 'The user says the screen is cracked and they cannot work.',
    needsClarification: false, clarificationQuestions: [], macro: null,
    ...overrides,
  };
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
    mockGroqReply(draftPayload({ sensitive: true }));
    const res = await new GroqAiProvider().extractDraft('my screen is cracked', CATALOG);
    expect(res.confidence).toBe('high');
    expect(res.sensitive).toBe(true);
    expect(res.draft.departmentCode).toBe('IT');
    expect(res.trace?.rationale).toContain('cracked');
  });

  it('rejects omitted and extra fields instead of silently trusting an incomplete response', async () => {
    const missing = draftPayload();
    delete (missing as Record<string, unknown>).confidence;
    mockGroqReply(missing);
    await expect(new GroqAiProvider().extractDraft('laptop broken', CATALOG)).rejects.toThrow(/invalid draft shape/i);

    mockGroqReply(draftPayload({ unexpected: 'untrusted' }));
    await expect(new GroqAiProvider().extractDraft('laptop broken', CATALOG)).rejects.toThrow(/invalid draft shape/i);
  });

  it('returns a validated clarification instead of a guessed department', async () => {
    mockGroqReply(draftPayload({
      departmentCode: '', requestTypeCode: '', confidence: 'low', needsClarification: true,
      clarificationQuestions: ['Which workplace issue needs attention?'],
    }));
    const response = await new GroqAiProvider().extractDraft('help me', CATALOG);
    expect(response.needsClarification).toBe(true);
    expect(response.clarificationQuestions).toHaveLength(1);
  });

  it('accepts only bounded integer SLA durations and rejects malformed estimates', async () => {
    mockGroqReply({ durationMs: 90 * 60 * 1000, rationale: 'Several employees are blocked from core work.' });
    await expect(new GroqAiProvider().estimateSlaMs('team cannot access system', 'URGENT')).resolves.toBe(90 * 60 * 1000);
    mockGroqReply({ durationMs: 1, rationale: 'fast' });
    await expect(new GroqAiProvider().estimateSlaMs('ticket', 'URGENT')).rejects.toThrow(/out-of-policy/i);
  });

  it('generates a strict resolution-note draft that requires verification', async () => {
    const payload = {
      resolutionNote: 'Suggested checks: verify the laptop display connection and test with an approved external monitor. [Confirm the exact device and observed result before completing.]',
      assumptions: ['Confirm the device model and reproduce the reported display fault.'],
    };
    const fetchMock = jest.fn(async (_url: string, init: any) => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      requestBody: JSON.parse(init.body),
    }));
    (global as any).fetch = fetchMock;
    const draft = await new GroqAiProvider().generateResolutionPlaybook({
      title: 'Laptop display issue', description: 'Laptop display flickers after wake.',
      department: 'IT', requestType: 'Laptop Request',
    });
    expect(draft.resolutionNote).toContain('[Confirm');
    expect(draft.assumptions).toHaveLength(1);
    expect(JSON.stringify(fetchMock.mock.calls[0][1].body)).toBeDefined();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.messages[0].content).toContain('Do not say or imply any action was already taken');
    expect(sent.messages[0].content).toContain('untrusted data');
    expect(sent.messages[0].content).toContain('valid JSON');
    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
  });

  it('rejects an unusable resolution note instead of returning unsafe text', async () => {
    mockGroqReply({ resolutionNote: 'It is fixed.', assumptions: [], extra: true });
    await expect(new GroqAiProvider().generateResolutionPlaybook({
      title: 'Issue', description: 'Workplace issue needs review.', department: 'IT', requestType: 'Laptop',
    })).rejects.toThrow(/invalid resolution playbook/i);
  });

  it('throws without a key so the service falls back to local', async () => {
    delete process.env['GROQ_API_KEY'];
    await expect(new GroqAiProvider().extractDraft('laptop broken', CATALOG)).rejects.toThrow();
  });
});
