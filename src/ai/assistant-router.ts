/**
 * Assistant Router V2 — deterministic intent routing + dynamic tool subsets.
 *
 * Goal (no capability loss): the full backend capability registry stays
 * intact, but the model sees only 3–10 relevant tools per turn. Smaller
 * tool sets improve selection reliability and cut token usage (Groq
 * tool-use guidance). The model interprets language; the server resolves
 * identities, permissions, IDs, and exact operations.
 *
 * No database migration: all state lives in existing ChatSession rows
 * (pendingConfirmation JSON) + in-memory resilience maps.
 */

export type RouterDomain =
  | 'user_admin'
  | 'request_creation'
  | 'request_claiming'
  | 'request_resolution'
  | 'departments_catalog'
  | 'reporting'
  | 'readonly_lookup'
  | 'general_help';

export type RouterMode = 'legacy' | 'shadow' | 'readonly' | 'full';

export interface RouteResult {
  domain: RouterDomain;
  /** Fine-grained intent inside the domain (for tests + fallback wording). */
  intent: string;
  /** Tool names the model should see for this turn (subset of registry). */
  tools: string[];
  /** Whether the request wants a plain-employee composite (role + remove-all). */
  plainEmployee: boolean;
  /** Whether the request wants removal from all departments. */
  removeAllMemberships: boolean;
  /** True when the user supplied an exact resolution note (vs AI draft). */
  exactResolutionNote: boolean;
  /** True when the user supplied exact request details (vs draft-for-me). */
  exactRequestDetails: boolean;
  /** Human summary used for provider-failure fallbacks (no mutation). */
  fallbackSummary: string;
}

const CONFIRM_PHRASES = [
  'yes',
  'yes please',
  'yeah',
  'yep',
  'yup',
  'confirm',
  'confirmed',
  'do it',
  'do it please',
  'go ahead',
  'proceed',
  'ok',
  'okay',
  'ok do it',
  'sure',
  'sure do it',
  'looks good',
  'approved',
];

const CANCEL_PHRASES = [
  'no',
  'nope',
  'cancel',
  'cancel that',
  'stop',
  'never mind',
  'nevermind',
  "don't do it",
  'do not do it',
  'abort',
  'discard',
];

function normalize(text: string): string {
  return (text || '')
    .trim()
    .toLowerCase()
    .replace(/[.!…]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deterministic confirmation layer: never let the model reinterpret yes/no. */
export function confirmationDirective(text: string): 'confirm' | 'cancel' | null {
  const clean = normalize(text);
  if (!clean || clean.length > 40) return null;
  if ((CONFIRM_PHRASES as string[]).includes(clean)) return 'confirm';
  if ((CANCEL_PHRASES as string[]).includes(clean)) return 'cancel';
  // "yes, do it" / "no, cancel it" — short prefix forms only.
  if (/^(yes|yeah|yep|yup|ok|okay|sure)[, ]+(do it|confirm|go ahead|proceed|please).*$/i.test(clean)) return 'confirm';
  if (/^(no|nope)[, ]+(don't|do not|cancel|stop).*$/i.test(clean)) return 'cancel';
  return null;
}

export function isConfirmPhrase(text: string): boolean {
  return confirmationDirective(text) === 'confirm';
}

export function isCancelPhrase(text: string): boolean {
  return confirmationDirective(text) === 'cancel';
}

/** Feature flag: ASSISTANT_ROUTER_V2=false | shadow | readonly | full/true/1. Default full. */
export function routerMode(): RouterMode {
  const raw = (process.env['ASSISTANT_ROUTER_V2'] || '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off' || raw === 'legacy') return 'legacy';
  if (raw === 'shadow') return 'shadow';
  if (raw === 'readonly' || raw === 'read-only' || raw === 'read_only') return 'readonly';
  return 'full';
}

export function isRouterV2Enabled(): boolean {
  return routerMode() !== 'legacy';
}

/** Full capability registry names (must match TOOL_DEFINITIONS in ai-chat.service). */
export const ALL_TOOL_NAMES = [
  'my_stats',
  'my_tickets',
  'search_tickets',
  'ticket_detail',
  'ai_health',
  'start_mfa_setup',
  'propose_create_request',
  'classify_text',
  'department_stats',
  'propose_claim',
  'propose_complete',
  'propose_reroute',
  'propose_create_user',
  'propose_cancel',
  'propose_takeover',
  'propose_reassign',
  'propose_reject',
  'propose_note',
  'propose_rating',
  'propose_membership',
  'propose_export',
  'audit_search',
  'propose_department',
  'propose_request_type',
  'propose_user_status',
  'propose_workflow',
  'my_work',
  'queue_view',
  'claimed_history',
  'ticket_children',
  'staff_notes',
  'analytics_report',
  'notifications_summary',
  // V2 composite workflows (additive — nothing removed).
  'propose_make_plain_employee',
  'propose_claim_and_resolve',
] as const;

/**
 * Domain → tool subset. Every registry tool appears in at least one subset.
 * Subsets stay at 3–10 tools so the model never faces the full 35 at once.
 */
export const DOMAIN_TOOL_MAP: Record<RouterDomain, string[]> = {
  user_admin: [
    'propose_make_plain_employee',
    'propose_create_user',
    'propose_user_status',
    'propose_membership',
  ],
  request_creation: [
    'propose_create_request',
    'classify_text',
    'propose_workflow',
    'search_tickets',
  ],
  request_claiming: [
    'propose_claim',
    'propose_takeover',
    'propose_reassign',
    'propose_reroute',
    'propose_claim_and_resolve',
    'queue_view',
    'my_work',
    'ticket_detail',
  ],
  request_resolution: [
    'propose_complete',
    'propose_claim_and_resolve',
    'propose_reject',
    'propose_cancel',
    'propose_note',
    'propose_rating',
    'ticket_detail',
    'my_work',
  ],
  departments_catalog: [
    'propose_department',
    'propose_request_type',
    'propose_membership',
  ],
  reporting: [
    'department_stats',
    'analytics_report',
    'propose_export',
    'audit_search',
    'my_stats',
  ],
  readonly_lookup: [
    'my_stats',
    'my_tickets',
    'search_tickets',
    'ticket_detail',
    'queue_view',
    'my_work',
    'claimed_history',
    'ticket_children',
    'staff_notes',
    'notifications_summary',
  ],
  general_help: [
    'classify_text',
    'ai_health',
    'start_mfa_setup',
    'my_stats',
    'notifications_summary',
  ],
};

export function toolsForDomain(domain: RouterDomain, platformRole?: string): string[] {
  let tools = [...(DOMAIN_TOOL_MAP[domain] || DOMAIN_TOOL_MAP.general_help)];
  // Non-admins never need to see admin-only mutation tools even in mixed
  // domains: the server would refuse them anyway, and hiding them cuts
  // mis-selection. Admin-only tools stay in the registry for admins.
  if (platformRole && platformRole !== 'SYSTEM_ADMIN') {
    const adminOnly = new Set([
      'propose_create_user',
      'propose_user_status',
      'propose_make_plain_employee',
      'propose_department',
      'propose_request_type',
      'propose_export',
      'audit_search',
      'analytics_report',
    ]);
    const filtered = tools.filter((t) => !adminOnly.has(t));
    // Never leave a domain empty for non-admins — fall back to read-only.
    if (filtered.length > 0) tools = filtered;
  }
  return tools.slice(0, 10);
}

function hasWord(text: string, re: RegExp): boolean {
  return re.test(text);
}

/**
 * Deterministic domain classifier. Order matters: most specific first.
 * The model still interprets nuance from full history; this is the routing
 * hint + tool-subset selector + offline-testable contract.
 */
export function routeIntent(rawText: string): RouteResult {
  const text = (rawText || '').toLowerCase();
  const clean = normalize(rawText);

  const plainEmployee =
    /(simple employee|plain employee|regular employee|just an employee|make .* employee|demote|no departments|leave all departments)/.test(text) &&
    /(employee|demote|plain|simple|regular|no department|leave all)/.test(text);
  const removeAllMemberships =
    /(remove .* from (every|all)( department)?s?|leave all departments|no departments|strip .* memberships|remove all memberships)/.test(
      text,
    ) || (plainEmployee && /(no department|leave all|remove|every department)/.test(text));
  const exactResolutionNote =
    /(with this exact note|use this note|resolution note:|note is:|note reads)/.test(text) ||
    (/resolve.*(with|using):?\s*["']?.{10,}/.test(text) && /resolve|complete/.test(text));
  const exactRequestDetails =
    /(using these exact details|with these exact details|send .* exactly|file .* exactly|exact details|title is|description is)/.test(
      text,
    );

  let domain: RouterDomain;
  let intent: string;

  const emailPresent = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(text);
  // Composite signals win outright: "no departments" / "every department"
  // are user_admin even without the words user/member/role.
  const wantsUserAdminComposite = plainEmployee || removeAllMemberships;

  if (!clean) {
    domain = 'general_help';
    intent = 'empty';
  } else if (
    wantsUserAdminComposite ||
    /(make|set|change|demote|promote|deactivate|activate|remove|add|create).*(admin|employee|plain|simple|regular|user|member|membership)/.test(text) ||
    (/(deactivat|activat)/.test(text) && emailPresent) ||
    (/(admin|employee|membership|deactivat|activat)/.test(text) && /(user|member|role|department|@[a-z])/i.test(rawText) && /(make|set|remove|add|create|deactivat|activat|change)/.test(text)) ||
    (/remove\s+\S+\s+from\s+(every|all)/.test(text) && /(department|membership)/.test(text))
  ) {
    // User/admin — must come before request Claiming/Resolution so
    // "make Alice a simple employee" never routes to ticket tools.
    domain = 'user_admin';
    if (plainEmployee) intent = 'make_plain_employee';
    else if (removeAllMemberships) intent = 'remove_all_memberships';
    else if (/deactivat/.test(text)) intent = 'deactivate_user';
    else if (/activat/.test(text)) intent = 'activate_user';
    else if (/make.*admin|promote.*admin|admin/.test(text) && /make|set|promote/.test(text)) intent = 'make_admin';
    else if (/make.*employee|demote|regular employee/.test(text)) intent = 'make_employee';
    else if (/create.*user|new user|add.*user/.test(text)) intent = 'create_user';
    else if (/membership|member of|add to|remove from/.test(text)) intent = 'membership_change';
    else intent = 'user_admin';
  } else if (/(create|draft|file|send|submit|report|open).*(request|ticket|workflow|onboarding)/.test(text) ||
    /(draft|file|create|send).*(for me|it|this)/.test(text) && /(request|ticket|laptop|vpn|hr|letter)/.test(text) ||
    /my laptop|need.*(laptop|vpn|access|letter|desk|badge)/.test(text) && /(draft|create|file|send|request)/.test(text)) {
    domain = 'request_creation';
    intent = exactRequestDetails ? 'create_request_exact' : /draft/.test(text) ? 'create_request_draft' : /workflow|onboard/.test(text) ? 'create_workflow' : 'create_request';
  } else if (/(claim|take over|takeover|reassign|reroute|assign)/.test(text)) {
    // Claim-and-resolve composite: Claiming verb + resolution verb together.
    if (/(claim|take).*(resolv|complet)/.test(text) || /(resolv|complet).*(claim|take)/.test(text)) {
      domain = 'request_claiming';
      intent = 'claim_and_resolve';
    } else {
      domain = 'request_claiming';
      if (/take ?over/.test(text)) intent = 'takeover';
      else if (/reassign/.test(text)) intent = 'reassign';
      else if (/reroute/.test(text)) intent = 'reroute';
      else intent = 'claim';
    }
  } else if (/(resolv|complet|resolution|done|fix|close).*(ticket|request|it\b)/.test(text) ||
    /(cancel|reject|rate|feedback|note)/.test(text) && /(ticket|request|it\b)/.test(text) ||
    /use the ai.*resolution|ai-generated resolution|draft.*resolution/.test(text)) {
    domain = 'request_resolution';
    if (/cancel/.test(text)) intent = 'cancel_request';
    else if (/reject/.test(text)) intent = 'reject_request';
    else if (/rate|feedback|\bstars?\b/.test(text)) intent = 'rate_request';
    else if (/note/.test(text) && !/resolution/.test(text)) intent = 'staff_note';
    else if (exactResolutionNote) intent = 'resolve_exact_note';
    else if (/ai.*resolv|resolv.*draft|generated resolution/.test(text)) intent = 'resolve_drafted_note';
    else intent = 'resolve_request';
  } else if (/(department|request type|category|catalog|legal|facilities|add.*type|new department)/.test(text) &&
    /(create|add|new|update|edit|rename|deactivat|department|request type|category)/.test(text)) {
    domain = 'departments_catalog';
    if (/request type|category/.test(text)) intent = 'manage_request_type';
    else intent = 'manage_department';
  } else if (/(report|stats|statistics|analytics|export|csat|audit|overdue|workload)/.test(text)) {
    domain = 'reporting';
    if (/export|csv/.test(text)) intent = 'export';
    else if (/audit/.test(text)) intent = 'audit_search';
    else if (/analytic|csat|workload/.test(text)) intent = 'analytics';
    else intent = 'stats';
  } else if (/(show|list|find|search|what|which|my |queue|inbox|notif|ticket|request|pending|today|claimed|history|detail|children|notes?)/.test(text)) {
    domain = 'readonly_lookup';
    if (/queue|unassigned|mywork|my work/.test(text)) intent = 'queue_view';
    else if (/notif|inbox/.test(text)) intent = 'notifications';
    else if (/child|workflow|progress/.test(text)) intent = 'ticket_children';
    else if (/staff note|internal note/.test(text)) intent = 'staff_notes';
    else if (/search|find/.test(text)) intent = 'search';
    else if (/stat|today|pending/.test(text)) intent = 'stats_lookup';
    else intent = 'lookup';
  } else if (hasWord(text, /(hi|hello|hey|thanks|thank|bye|hungry|joke|help|password|2fa|mfa|authenticator|health)/)) {
    domain = 'general_help';
    intent = /password|2fa|mfa|authenticator/.test(text) ? 'security_help' : /health/.test(text) ? 'health' : 'chit_chat_help';
  } else {
    domain = 'general_help';
    intent = 'help';
  }

  const tools = DOMAIN_TOOL_MAP[domain] || DOMAIN_TOOL_MAP.general_help;
  return {
    domain,
    intent,
    tools: [...tools],
    plainEmployee,
    removeAllMemberships,
    exactResolutionNote,
    exactRequestDetails,
    fallbackSummary: fallbackSummaryFor(domain, intent, rawText),
  };
}

function fallbackSummaryFor(domain: RouterDomain, intent: string, rawText: string): string {
  const snippet = (rawText || '').trim().slice(0, 160) || 'your request';
  switch (domain) {
    case 'user_admin':
      if (intent === 'make_plain_employee') return 'make the named person a plain employee with no department memberships';
      if (intent === 'remove_all_memberships') return 'remove the named person from every department';
      return `handle the user/admin change ("${snippet}")`;
    case 'request_creation':
      return `create the service request ("${snippet}")`;
    case 'request_claiming':
      return intent === 'claim_and_resolve' ? `claim and resolve the ticket ("${snippet}")` : `claim the ticket ("${snippet}")`;
    case 'request_resolution':
      return `resolve the ticket ("${snippet}")`;
    case 'departments_catalog':
      return `update the department catalog ("${snippet}")`;
    case 'reporting':
      return `produce the report ("${snippet}")`;
    case 'readonly_lookup':
      return `look up ("${snippet}")`;
    default:
      return `help with ("${snippet}")`;
  }
}

/**
 * Extract a user mention (email or name fragment) for deterministic
 * server-side resolution. Returns null when no mention is found.
 * The server then resolves against real users (exact email first,
 * then display-name match, ambiguous → ask, never guess).
 */
export function extractUserMention(text: string): string | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const email = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (email) return email[0].toLowerCase();
  // "make Alice a simple employee" / "deactivate bob" / "add Carol to IT"
  // Case-insensitive: chat text may be lowered before it reaches us.
  const m = raw.match(
    /(?:make|set|deactivate|activate|remove|add|create|promote|demote)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)/i,
  );
  if (m) {
    const name = m[1].trim().replace(/\s+(a|an|the|to|from|as|in|into|for)$/i, '');
    // Guard against verb-phrase captures ("make sure", "add a").
    if (!/^(sure|certain|a|an|the|it|this|that|them|user)$/i.test(name)) return name;
  }
  const quoted = raw.match(/["']([A-Za-z][A-Za-z .'-]{1,60})["']/);
  if (quoted) return quoted[1].trim();
  return null;
}

/** Parse Retry-After / rate-limit reset headers into a backoff in ms. */
export function parseRetryAfterMs(headers: Record<string, string | null | undefined>, fallbackMs = 2500): number {
  const retryAfter = headers['retry-after'];
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(Math.max(0, Math.round(secs * 1000)), 60_000);
    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) return Math.min(Math.max(0, dateMs - Date.now()), 60_000);
  }
  for (const key of ['x-ratelimit-reset', 'x-rate-limit-reset', 'ratelimit-reset']) {
    const v = headers[key];
    if (v) {
      const secs = Number(v);
      if (Number.isFinite(secs) && secs > 0) {
        // Groq-style epoch seconds vs relative seconds heuristic.
        const ms = secs > 1_000_000_000 ? secs * 1000 - Date.now() : secs * 1000;
        if (ms > 0 && ms <= 120_000) return Math.round(ms);
      }
    }
  }
  return fallbackMs;
}

/** Compact per-domain system-prompt fragment (V2 keeps prompts small). */
export function domainGuidance(domain: RouterDomain): string {
  switch (domain) {
    case 'user_admin':
      return 'User/admin: resolve the person server-side by email or name (ambiguous names ask, never guess). "Make X a simple/plain employee (again)" means set role EMPLOYEE and remove ALL memberships in one confirmation — never ask for a department when the user said no departments. "Remove X from every department" removes all memberships only. Destructive changes confirm once.';
    case 'request_creation':
      return 'Request creation: exact user details go straight to propose; vague text goes through classify_text first, then propose. Show the completed draft, confirm once, create exactly once.';
    case 'request_claiming':
      return 'Claiming: claim pending tickets; takeover needs a reason and manager/admin rights; reassign needs target email + reason. Claim-then-resolve is one composite confirmation.';
    case 'request_resolution':
      return 'Resolution: exact user notes are used verbatim; otherwise draft one note the user reviews. Confirm once, resolve exactly once. Never resolve someone else’s claimed work without takeover first.';
    case 'departments_catalog':
      return 'Catalog: departments and request types by human name (codes resolved server-side). Admin only, confirm once.';
    case 'reporting':
      return 'Reporting: admin cross-department numbers; staff see own departments; employees see personal wording. Exports summarize + confirm.';
    case 'readonly_lookup':
      return 'Lookup: read-only, caller-scoped. Pronouns ("it", "that ticket", "her") mean the department/request already discussed — resolve from history, never ask for IDs.';
    default:
      return 'Help: warm, direct, plain words. Small talk stays small talk (no tools). Sensitive topics get empathy + one confidential URGENT filing proposal, never auto-file.';
  }
}
