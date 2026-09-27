import {
  confirmationDirective,
  DOMAIN_TOOL_MAP,
  extractUserMention,
  parseRetryAfterMs,
  routeIntent,
  routerMode,
  toolsForGeneralAction,
  toolsForDomain,
} from './assistant-router';

describe('assistant router V2 — deterministic intent + tool subsets', () => {
  const oldFlag = process.env['ASSISTANT_ROUTER_V2'];
  afterEach(() => {
    if (oldFlag === undefined) delete process.env['ASSISTANT_ROUTER_V2'];
    else process.env['ASSISTANT_ROUTER_V2'] = oldFlag;
  });

  it('routes "make Alice a simple employee again" to user_admin/make_plain_employee', () => {
    const r = routeIntent('Make Alice a simple employee again');
    expect(r.domain).toBe('user_admin');
    expect(r.intent).toBe('make_plain_employee');
    expect(r.plainEmployee).toBe(true);
    expect(r.tools).toContain('propose_make_plain_employee');
  });

  it('routes "remove Alice from every department" to remove-all without asking for a department', () => {
    const r = routeIntent('remove Alice from every department');
    expect(r.domain).toBe('user_admin');
    expect(r.removeAllMemberships).toBe(true);
    expect(r.fallbackSummary).toMatch(/every department/i);
  });

  it('routes exact-details creation vs draft-for-me distinctly', () => {
    const exact = routeIntent('send a request using these exact details: title is Laptop, description is cracked');
    expect(exact.domain).toBe('request_creation');
    expect(exact.exactRequestDetails).toBe(true);
    const draft = routeIntent('draft a request for me about my laptop');
    expect(draft.domain).toBe('request_creation');
    expect(draft.intent).toMatch(/draft|create/);
  });

  it('routes claim, exact-note resolve, and AI-drafted resolve distinctly', () => {
    expect(routeIntent('claim this request').domain).toBe('request_claiming');
    const exact = routeIntent('resolve it with this exact note: replaced the screen and verified boot');
    expect(exact.domain).toBe('request_resolution');
    expect(exact.exactResolutionNote).toBe(true);
    const drafted = routeIntent('use the AI-generated resolution to complete it');
    expect(drafted.domain).toBe('request_resolution');
  });

  it('routes claim-and-resolve composites to Claiming with the composite tool', () => {
    const r = routeIntent('claim this ticket and resolve it for me');
    expect(r.domain).toBe('request_claiming');
    expect(r.tools).toContain('propose_claim_and_resolve');
  });

  it('routes admin lifecycle: activate/deactivate, departments, types, reporting, lookup', () => {
    expect(routeIntent('deactivate bob@acme.com').domain).toBe('user_admin');
    expect(routeIntent('activate carol@acme.com').domain).toBe('user_admin');
    expect(routeIntent('create a Legal department').domain).toBe('departments_catalog');
    expect(routeIntent('add a Badge type to FAC').domain).toBe('departments_catalog');
    expect(routeIntent('show overdue stats').domain).toBe('reporting');
    expect(routeIntent('show my queue').domain).toBe('readonly_lookup');
  });

  it('keeps every tool subset at 3–10 tools and every registry tool covered', () => {
    for (const [domain, tools] of Object.entries(DOMAIN_TOOL_MAP)) {
      expect(domain).toBeTruthy();
      expect(tools.length).toBeGreaterThanOrEqual(3);
      expect(tools.length).toBeLessThanOrEqual(10);
    }
    const covered = new Set(Object.values(DOMAIN_TOOL_MAP).flat());
    for (const must of ['propose_create_request', 'propose_claim', 'propose_complete', 'propose_membership', 'propose_user_status', 'propose_department', 'propose_request_type', 'my_stats', 'search_tickets', 'resolve_request_context', 'propose_make_plain_employee', 'propose_claim_and_resolve']) {
      expect(covered.has(must)).toBe(true);
    }
  });

  it('gives unknown action wording the complete authorized capability registry', () => {
    const admin = toolsForGeneralAction('SYSTEM_ADMIN');
    expect(admin.length).toBeGreaterThan(10);
    expect(admin).toContain('propose_request_type');
    expect(admin).toContain('resolve_request_context');
    const employee = toolsForGeneralAction('EMPLOYEE');
    expect(employee).not.toContain('propose_create_user');
    expect(employee).not.toContain('propose_request_type');
    expect(employee).toContain('propose_create_request');
  });

  it('hides admin-only tools from non-admins without emptying the subset', () => {
    const admin = toolsForDomain('user_admin', 'SYSTEM_ADMIN');
    expect(admin).toContain('propose_make_plain_employee');
    const emp = toolsForDomain('user_admin', 'EMPLOYEE');
    expect(emp).not.toContain('propose_make_plain_employee');
    expect(emp.length).toBeGreaterThan(0);
  });

  it('handles natural-language confirmations deterministically and never via the model', () => {
    for (const yes of ['yes', 'confirm', 'do it', 'go ahead', 'Yes please', 'ok']) {
      expect(confirmationDirective(yes)).toBe('confirm');
    }
    for (const no of ['no', 'cancel', 'never mind', 'stop']) {
      expect(confirmationDirective(no)).toBe('cancel');
    }
    expect(confirmationDirective('yes, change the title to Laptop first')).toBeNull();
    expect(confirmationDirective('please draft a request for me')).toBeNull();
  });

  it('extracts user mentions (email or name) for server-side resolution', () => {
    expect(extractUserMention('deactivate bob@acme.com')).toBe('bob@acme.com');
    expect(extractUserMention('Make Alice a simple employee again')).toBe('Alice');
    expect(extractUserMention('hello there')).toBeNull();
  });

  it('honors Retry-After seconds and epoch headers instead of blind delays', () => {
    expect(parseRetryAfterMs({ 'retry-after': '2' }, 2500)).toBe(2000);
    expect(parseRetryAfterMs({}, 2500)).toBe(2500);
    const future = Math.floor(Date.now() / 1000) + 5;
    const ms = parseRetryAfterMs({ 'x-ratelimit-reset': String(future) }, 2500);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(120_000);
  });

  it('reads the rollout flag: false=legacy, shadow, readonly, default full', () => {
    process.env['ASSISTANT_ROUTER_V2'] = 'false';
    expect(routerMode()).toBe('legacy');
    process.env['ASSISTANT_ROUTER_V2'] = 'shadow';
    expect(routerMode()).toBe('shadow');
    process.env['ASSISTANT_ROUTER_V2'] = 'readonly';
    expect(routerMode()).toBe('readonly');
    delete process.env['ASSISTANT_ROUTER_V2'];
    expect(routerMode()).toBe('full');
  });

  it('preserves intent wording for provider-failure fallbacks (never silently lost)', () => {
    const r = routeIntent('Make Alice a simple employee again');
    expect(r.fallbackSummary).toMatch(/plain employee/i);
    const c = routeIntent('claim this ticket and resolve it');
    expect(c.fallbackSummary).toMatch(/claim and resolve/i);
  });
});
