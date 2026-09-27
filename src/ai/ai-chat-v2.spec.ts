import { ForbiddenException } from '@nestjs/common';
import { AiChatService } from './ai-chat.service';
import { routeIntent } from './assistant-router';

function harness() {
  const notificationModel = { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) };
  const prisma: any = {
    chatSession: {
      create: jest.fn(async ({ data }: any) => ({ id: 'session-1', userId: data.userId, pendingConfirmation: null })),
      findFirst: jest.fn(async () => ({ id: 'session-1', userId: 'alice', pendingConfirmation: null })),
      update: jest.fn(async () => ({})),
    },
    chatMessage: { create: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
    user: {
      findUnique: jest.fn(async (args: any) => {
        if (args?.where?.email === 'alice@acme.com') return { id: 'u-alice', email: 'alice@acme.com', displayName: 'Alice', platformRole: 'EMPLOYEE', active: true };
        if (args?.where?.id === 'u-alice') return { id: 'u-alice', email: 'alice@acme.com', displayName: 'Alice', platformRole: 'EMPLOYEE', active: true };
        if (args?.where?.id === 'admin') return { id: 'admin', email: 'admin@acme.com', displayName: 'Admin', platformRole: 'SYSTEM_ADMIN', active: true };
        return { id: 'alice', email: 'alice@acme.com', displayName: 'Alice', platformRole: 'EMPLOYEE', departmentMemberships: [] };
      }),
      findMany: jest.fn(async () => [
        { id: 'u-alice', email: 'alice@acme.com', displayName: 'Alice', active: true },
        { id: 'u-alicia', email: 'alicia@acme.com', displayName: 'Alicia', active: true },
      ]),
    },
    departmentMember: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    department: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    requestType: { findUnique: jest.fn(async () => null) },
    request: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    notification: notificationModel,
  };
  const requests: any = {
    findAll: jest.fn(async () => []),
    create: jest.fn(async () => ({ id: 'c'.repeat(25) })),
    findOne: jest.fn(async () => ({ id: 't1', status: 'PENDING', title: 'T', department: { name: 'IT' }, requestType: { name: 'L' }, claimant: null })),
    findDuplicates: jest.fn(async () => []),
    updateStatus: jest.fn(async () => ({ id: 't1', status: 'COMPLETED' })),
    claim: jest.fn(async (id: string) => ({ id, status: 'IN_PROGRESS', claimedById: 'alice' })),
    takeover: jest.fn(async (id: string) => ({ id })),
    reassign: jest.fn(async (id: string) => ({ id })),
    reroute: jest.fn(async (id: string) => ({ id })),
    claimAndResolve: jest.fn(),
    getReport: jest.fn(async () => ({ byStatus: {}, departments: [], csatAverage: null, csatCount: 0 })),
    generateResolutionPlaybook: jest.fn(async () => ({ resolutionNote: 'Verified fix applied and tested OK today with follow-up steps documented here.', assumptions: [] })),
  };
  const auth: any = {
    createUser: jest.fn(async (p: any) => ({ id: 'u-new', ...p })),
    setActive: jest.fn(async (id: string, active: boolean) => ({ id, active })),
    setRole: jest.fn(async (id: string, role: string) => ({ id, platformRole: role })),
    addMembership: jest.fn(async () => ({ added: true })),
    removeMembership: jest.fn(async () => ({ removed: true })),
  };
  const audit = { append: jest.fn(async () => undefined), search: jest.fn(async () => []) } as any;
  const ai = {
    providerStatus: () => ({ provider: 'local' }),
    reportChatError: jest.fn(),
    draft: jest.fn(async (text: string) => ({
      departmentId: 'dept-it', requestTypeId: 'type-laptop', title: text.slice(0, 40),
      description: text, priority: 'STANDARD', confidence: 'high', provider: 'local',
    })),
  } as any;
  const service = new AiChatService(prisma, requests, auth, { setup: jest.fn(async () => ({})) } as any, audit, ai);
  return { service, prisma, requests, auth, audit, ai };
}

const CATALOG = [
  { id: 'dept-it', code: 'IT', name: 'IT & Technical Support', requestTypes: [{ id: 'type-laptop', code: 'LAPTOP', name: 'Laptop Request', active: true }] },
];

describe('assistant V2 — composite workflows, confirmations, reliability', () => {
  const oldFlag = process.env['ASSISTANT_ROUTER_V2'];
  const oldKey = process.env['GROQ_API_KEY'];
  beforeEach(() => { process.env['ASSISTANT_ROUTER_V2'] = 'full'; });
  afterEach(() => {
    if (oldFlag === undefined) delete process.env['ASSISTANT_ROUTER_V2'];
    else process.env['ASSISTANT_ROUTER_V2'] = oldFlag;
    if (oldKey === undefined) delete process.env['GROQ_API_KEY'];
    else process.env['GROQ_API_KEY'] = oldKey;
  });

  it('understands "make Alice a simple employee again" as role EMPLOYEE + remove-all (one confirmation)', async () => {
    const { service, prisma } = harness();
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'u-alice', email: 'alice@acme.com', displayName: 'Alice', active: true }]);
    prisma.departmentMember.findMany.mockResolvedValueOnce([{ departmentId: 'dept-it' }, { departmentId: 'dept-hr' }]);
    const route = routeIntent('Make Alice a simple employee again');
    expect(route.intent).toBe('make_plain_employee');
    const res: any = await (service as any).proposeMakePlainEmployee({ id: 'admin', platformRole: 'SYSTEM_ADMIN' }, 'session-1', { user: 'Alice', mode: 'plain' });
    expect(res.requiresConfirmation).toBe(true);
    const stored = JSON.parse(prisma.chatSession.update.mock.calls[0][0].data.pendingConfirmation)[0];
    expect(stored.kind).toBe('make-plain-employee');
    expect(stored.payload.targetUserId).toBe('u-alice');
    expect(stored.summary).toMatch(/plain employee/i);
  });

  it('never asks for a department when the user said no departments', async () => {
    const { service, prisma } = harness();
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'u-alice', email: 'alice@acme.com', displayName: 'Alice', active: true }]);
    prisma.departmentMember.findMany.mockResolvedValueOnce([]);
    const res: any = await (service as any).proposeMakePlainEmployee({ id: 'admin', platformRole: 'SYSTEM_ADMIN' }, 'session-1', { user: 'alice@acme.com', mode: 'plain' });
    expect(res.requiresConfirmation).toBe(true);
    expect(res.confirmation.summary).not.toMatch(/which department/i);
  });

  it('removes from every department as a standalone composite (remove-all only)', async () => {
    const { service, prisma } = harness();
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'u-alice', email: 'alice@acme.com', displayName: 'Alice', active: true }]);
    prisma.departmentMember.findMany.mockResolvedValueOnce([{ departmentId: 'd1' }]);
    const res: any = await (service as any).proposeMakePlainEmployee({ id: 'admin', platformRole: 'SYSTEM_ADMIN' }, 'session-1', { user: 'Alice', mode: 'remove-all' });
    const stored = JSON.parse(prisma.chatSession.update.mock.calls[0][0].data.pendingConfirmation)[0];
    expect(stored.kind).toBe('remove-all-memberships');
    expect(res.requiresConfirmation).toBe(true);
  });

  it('executes make-plain-employee atomically: role + all memberships, idempotent on retry', async () => {
    const { service, auth, prisma } = harness();
    prisma.user.findUnique.mockResolvedValue({ id: 'u-alice', email: 'alice@acme.com', displayName: 'Alice', platformRole: 'SYSTEM_ADMIN', active: true });
    prisma.departmentMember.findMany.mockResolvedValue([{ departmentId: 'd1' }, { departmentId: 'd2' }]);
    await (service as any).executeConfirmed({ id: 'admin', platformRole: 'SYSTEM_ADMIN' }, { id: 'a1', kind: 'make-plain-employee', summary: 'x', payload: { targetUserId: 'u-alice', email: 'alice@acme.com' } });
    expect(auth.setRole).toHaveBeenCalledWith('u-alice', 'EMPLOYEE');
    expect(auth.removeMembership).toHaveBeenCalledTimes(2);
    // Idempotent: already plain + no memberships → no further writes.
    prisma.user.findUnique.mockResolvedValue({ id: 'u-alice', email: 'alice@acme.com', displayName: 'Alice', platformRole: 'EMPLOYEE', active: true });
    prisma.departmentMember.findMany.mockResolvedValue([]);
    auth.setRole.mockClear();
    auth.removeMembership.mockClear();
    const again: any = await (service as any).executeConfirmed({ id: 'admin', platformRole: 'SYSTEM_ADMIN' }, { id: 'a1', kind: 'make-plain-employee', summary: 'x', payload: { targetUserId: 'u-alice', email: 'alice@acme.com' } });
    expect(again.idempotent).toBe(true);
    expect(auth.setRole).not.toHaveBeenCalled();
  });

  it('uses exact resolution notes verbatim; drafts only when the user did not supply one', async () => {
    const { service, prisma, requests } = harness();
    requests.findOne.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS', title: 'T', department: { name: 'IT' }, requestType: { name: 'L' }, claimant: null });
    await (service as any).proposeComplete({ id: 'alice', platformRole: 'EMPLOYEE' }, 'session-1', { requestId: 't1', resolutionNote: 'Replaced the screen and verified boot twice.' });
    const storedExact = JSON.parse(prisma.chatSession.update.mock.calls[0][0].data.pendingConfirmation)[0];
    expect(storedExact.payload.resolutionNote).toBe('Replaced the screen and verified boot twice.');
    expect(requests.generateResolutionPlaybook).not.toHaveBeenCalled();
    requests.generateResolutionPlaybook.mockClear();
    const drafted: any = await (service as any).proposeComplete({ id: 'alice', platformRole: 'EMPLOYEE' }, 'session-1', { requestId: 't1' });
    expect(requests.generateResolutionPlaybook).toHaveBeenCalled();
    expect(drafted.requiresConfirmation).toBe(true);
  });

  it('claim-and-resolve proposes one composite confirmation and executes claim then resolve exactly once', async () => {
    const { service, prisma, requests } = harness();
    requests.findOne.mockResolvedValue({ id: 't1', status: 'PENDING', title: 'T', department: { name: 'IT' }, requestType: { name: 'L' }, claimant: null });
    await (service as any).proposeClaimAndResolve({ id: 'bob', platformRole: 'EMPLOYEE' }, 'session-1', { requestId: 't1', resolutionNote: 'Reimaged the laptop and verified login works now.' });
    const stored = JSON.parse(prisma.chatSession.update.mock.calls[0][0].data.pendingConfirmation)[0];
    expect(stored.kind).toBe('claim-and-resolve');
    await (service as any).executeConfirmed({ id: 'bob', platformRole: 'EMPLOYEE' }, stored);
    expect(requests.claim).toHaveBeenCalledWith('t1', 'bob');
    expect(requests.updateStatus).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'COMPLETED' }), 'bob');
  });

  it('typing "yes" confirms the single pending action without calling the model', async () => {
    const { service, prisma, requests } = harness();
    process.env['GROQ_API_KEY'] = 'test-key';
    await (service as any).storeProposal('session-1', { kind: 'claim', summary: 'Claim REQ-T1', payload: { requestId: 't1' } });
    const stored = JSON.parse(prisma.chatSession.update.mock.calls[0][0].data.pendingConfirmation);
    const head = stored[0];
    const session = { id: 'session-1', userId: 'alice', pendingConfirmation: JSON.stringify([head]) };
    prisma.chatSession.findFirst.mockResolvedValue(session);
    prisma.chatMessage.findMany.mockResolvedValue([]);
    const fetchSpy = jest.spyOn(global as any, 'fetch');
    const result = await service.chat({ id: 'alice', platformRole: 'EMPLOYEE' }, { sessionId: 'session-1', message: 'yes' });
    expect(result.message).toMatch(/confirmed/i);
    expect(requests.claim).toHaveBeenCalledWith('t1', 'alice');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('typing "no" cancels without mutation; multiple pendings ask which one', async () => {
    const { service, prisma, requests } = harness();
    process.env['GROQ_API_KEY'] = 'test-key';
    await (service as any).storeProposal('session-1', { kind: 'claim', summary: 'Claim A', payload: { requestId: 'a' } });
    await (service as any).storeProposal('session-1', { kind: 'claim', summary: 'Claim B', payload: { requestId: 'b' } });
    const queue = JSON.parse(prisma.chatSession.update.mock.calls[1][0].data.pendingConfirmation);
    prisma.chatSession.findFirst.mockResolvedValue({ id: 'session-1', userId: 'alice', pendingConfirmation: JSON.stringify(queue) });
    const ask = await service.chat({ id: 'alice', platformRole: 'EMPLOYEE' }, { sessionId: 'session-1', message: 'yes' });
    expect(ask.message).toMatch(/2 pending|which one/i);
    expect(requests.claim).not.toHaveBeenCalled();
    // Single pending + "no" cancels.
    prisma.chatSession.findFirst.mockResolvedValue({ id: 'session-1', userId: 'alice', pendingConfirmation: JSON.stringify([queue[0]]) });
    (service as any).pendingActions.set('session-1', [queue[0]]);
    const cancelled = await service.chat({ id: 'alice', platformRole: 'EMPLOYEE' }, { sessionId: 'session-1', message: 'no' });
    expect(cancelled.message).toMatch(/cancelled/i);
  });

  it('duplicate confirms report already-done instead of duplicating', async () => {
    const { service, prisma, requests } = harness();
    requests.create.mockResolvedValue({ id: 'c'.repeat(25) });
    await (service as any).storeProposal('session-1', { kind: 'create-request', summary: 'Create x', payload: { departmentId: 'd', requestTypeId: 't', title: 'T', description: 'Long enough description.', priority: 'STANDARD' } });
    const stored = JSON.parse(prisma.chatSession.update.mock.calls[0][0].data.pendingConfirmation)[0];
    prisma.chatSession.findFirst.mockResolvedValue({ id: 'session-1', userId: 'alice', pendingConfirmation: JSON.stringify(stored) });
    await service.chat({ id: 'alice', platformRole: 'EMPLOYEE' }, { sessionId: 'session-1', confirmationId: stored.id, confirmationAction: 'confirm' });
    expect(requests.create).toHaveBeenCalledTimes(1);
    prisma.chatSession.findFirst.mockResolvedValue({ id: 'session-1', userId: 'alice', pendingConfirmation: null });
    const again = await service.chat({ id: 'alice', platformRole: 'EMPLOYEE' }, { sessionId: 'session-1', confirmationId: stored.id, confirmationAction: 'confirm' });
    expect(again.message).toMatch(/expired|already completed/i);
  });

  it('resolves natural user references (name → id) and flags ambiguous names', async () => {
    const { service } = harness();
    const one = await (service as any).resolveUserByRef('alice@acme.com');
    expect(one.email).toBe('alice@acme.com');
    await expect((service as any).resolveUserByRef('ali')).rejects.toThrow(/several people|exact email/i);
    await expect((service as any).resolveUserByRef('ghostperson')).rejects.toThrow(/not found/i);
  });

  it('resolves latest, department, requester, and claimed-ticket references server-side', async () => {
    const { service, prisma } = harness();
    const ticket = {
      id: 'req-laptop-12345678901234567890', title: 'Laptop is on fire', status: 'PENDING', priority: 'URGENT',
      createdAt: new Date(), department: { name: 'IT' }, requestType: { name: 'Laptop' }, claimant: null,
      owner: { displayName: 'Alice' },
    };
    prisma.request.findMany.mockResolvedValueOnce([ticket]);
    const resolved: any = await (service as any).resolveRequestContext(
      { id: 'admin', platformRole: 'SYSTEM_ADMIN' },
      { relation: 'latest-created', reference: 'Alice just sent the latest request to the IT department', requester: 'Alice', department: 'IT' },
    );
    expect(resolved.selected.title).toBe('Laptop is on fire');
    expect(resolved.candidates).toHaveLength(1);
    expect(prisma.request.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' } }));

    prisma.request.findMany.mockResolvedValueOnce([ticket]);
    const hinted: any = await (service as any).requestContextHint(
      { id: 'admin', platformRole: 'SYSTEM_ADMIN' },
      'resolve the ticket I just claimed',
    );
    expect(hinted.selected.title).toBe('Laptop is on fire');
  });

  it('switches topics without retaining an old unconfirmed proposal and handles physical danger safely', async () => {
    const { service, prisma } = harness();
    await (service as any).storeProposal('session-1', { kind: 'create-request', summary: 'Create the old request', payload: {} });
    const stored = JSON.parse(prisma.chatSession.update.mock.calls[0][0].data.pendingConfirmation);
    prisma.chatSession.findFirst.mockResolvedValue({ id: 'session-1', userId: 'alice', pendingConfirmation: JSON.stringify(stored) });
    await (service as any).supersedePendingOnNewTask('session-1', 'nevermind, add a new request type to HR called money letter');
    expect(prisma.chatSession.update).toHaveBeenLastCalledWith({ where: { id: 'session-1' }, data: { pendingConfirmation: null } });

    const realFetch = global.fetch;
    process.env['GROQ_API_KEY'] = 'test-key';
    (global as any).fetch = jest.fn();
    try {
      const result = await service.chat({ id: 'alice', platformRole: 'EMPLOYEE' }, { sessionId: 'session-1', message: 'laptop is on fire' });
      expect(result.message).toMatch(/move away|emergency services/i);
      expect((global as any).fetch).not.toHaveBeenCalled();
    } finally {
      (global as any).fetch = realFetch;
    }
  });

  it('refuses unauthorized admin actions server-side (never a chat message)', async () => {
    const { service } = harness();
    await expect((service as any).proposeMakePlainEmployee({ id: 'bob', platformRole: 'EMPLOYEE' }, 'session-1', { user: 'alice@acme.com' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect((service as any).proposeCreateUser({ id: 'bob', platformRole: 'EMPLOYEE' }, 'session-1', { email: 'x@acme.com', password: 'Password123!' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('survives provider 429/timeout with intent-preserving fallbacks and Retry-After backoff', async () => {
    const { service, ai } = harness();
    process.env['GROQ_API_KEY'] = 'test-key';
    const realFetch = global.fetch;
    // 429 with Retry-After header: retried once with header delay, then succeeds.
    const headers = new Headers({ 'retry-after': '0' });
    (global as any).fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers, text: async () => 'slow down' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ answer: 'Recovered.' }) } }] }) });
    try {
      const out = await (service as any).callModel([{ role: 'user', content: 'hi' }], false);
      expect(out.choices[0].message.content).toMatch(/Recovered/);
    } finally {
      (global as any).fetch = realFetch;
    }
    // Full outage → chat() preserves intent and reports no-change.
    (global as any).fetch = jest.fn(async () => { throw new Error('fetch failed'); });
    try {
      const res = await service.chat({ id: 'alice', platformRole: 'EMPLOYEE' }, { message: 'Make Alice a simple employee again' });
      expect(res.message).toMatch(/plain employee|simple employee/i);
      expect(res.message).toMatch(/not changed/i);
      expect(ai.reportChatError).toHaveBeenCalled();
    } finally {
      (global as any).fetch = realFetch;
    }
  });

  it('answers plain chat when Groq first invents a malformed tool call', async () => {
    const { service, prisma } = harness();
    process.env['GROQ_API_KEY'] = 'test-key';
    prisma.chatMessage.findMany.mockResolvedValue([{ role: 'user', content: 'hi', createdAt: new Date() }]);
    const realFetch = global.fetch;
    const calls: any[] = [];
    (global as any).fetch = jest.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      if (calls.length === 1) {
        return {
          ok: false,
          status: 400,
          text: async () => '{"error":{"code":"tool_use_failed","message":"attempted to call tool response which was not in request.tools"}}',
        };
      }
      return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: 'Hello! How can I help today?' } }] }) };
    });
    try {
      const result = await (service as any).runGroq({ id: 'alice', platformRole: 'EMPLOYEE' }, 'session-1', true);
      expect(result.message).toMatch(/Hello/);
      expect(calls).toHaveLength(2);
      expect(calls[0].tools).toBeDefined();
      expect(calls[0].messages[0].content).not.toMatch(/compact object|JSON only/i);
      expect(calls[1].tools).toBeUndefined();
      expect(calls[1].tool_choice).toBeUndefined();
    } finally {
      (global as any).fetch = realFetch;
    }
  });

  it('rehydrates confirmations from the database after a restart (interrupted conversations)', async () => {
    const { service, prisma, requests } = harness();
    await (service as any).storeProposal('session-1', { kind: 'claim', summary: 'Claim REQ-T1', payload: { requestId: 't1' } });
    const stored = JSON.parse(prisma.chatSession.update.mock.calls[0][0].data.pendingConfirmation)[0];
    (service as any).pendingActions.clear();
    prisma.chatSession.findFirst.mockResolvedValue({ id: 'session-1', userId: 'alice', pendingConfirmation: JSON.stringify(stored) });
    const res = await service.chat({ id: 'alice', platformRole: 'EMPLOYEE' }, { sessionId: 'session-1', confirmationId: stored.id, confirmationAction: 'confirm' });
    expect(requests.claim).toHaveBeenCalledWith('t1', 'alice');
    expect(res.message).toMatch(/confirmed/i);
  });

  it('exposes only the domain tool subset per turn (never the full registry in V2)', async () => {
    const { service, prisma } = harness();
    process.env['GROQ_API_KEY'] = 'test-key';
    prisma.department.findMany.mockResolvedValue(CATALOG);
    prisma.chatMessage.findMany.mockResolvedValue([{ role: 'user', content: 'Make Alice a simple employee again', createdAt: new Date() }]);
    let sentTools: string[] = [];
    const realFetch = global.fetch;
    (global as any).fetch = jest.fn(async (_url: string, init: any) => {
      sentTools = JSON.parse(init.body).tools.map((t: any) => t.function.name);
      return { ok: true, headers: new Headers(), json: async () => ({ choices: [{ message: { content: JSON.stringify({ answer: 'On it — confirm to proceed.' }) } }] }) };
    });
    try {
      await (service as any).runGroq({ id: 'admin', platformRole: 'SYSTEM_ADMIN' }, 'session-1', true);
      expect(sentTools).toContain('propose_make_plain_employee');
      expect(sentTools.length).toBeLessThanOrEqual(10);
      expect(sentTools.length).toBeGreaterThanOrEqual(3);
    } finally {
      (global as any).fetch = realFetch;
    }
  });
});
