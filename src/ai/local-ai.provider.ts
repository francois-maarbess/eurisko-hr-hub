import { AiProvider, CatalogDepartment, ProviderDraft } from './ai.provider';

const URGENT_HINTS = [
  'urgent', 'asap', 'immediately', 'emergency', 'critical', 'blocked',
  'broken', 'cracked', 'down', 'rush', 'rushing', 'rushed',
  'as soon as possible', "can't work", 'cannot work', 'not working',
];

/**
 * Everyday workplace words. If the text shares NOTHING with the catalog AND
 * none of these, it is not a workplace request at all (gibberish, sports,
 * cooking, homework...) — the extractor returns UNKNOWN so the service can
 * answer with a clean, human-readable error instead of a forced guess.
 */
const WORK_WORDS = new Set([
  'need', 'needs', 'help', 'please', 'issue', 'issues', 'problem', 'problems',
  'fix', 'fixing', 'broken', 'work', 'working', 'request', 'requesting',
  'employee', 'employees', 'employer', 'company', 'office', 'team',
  'support', 'claim', 'report', 'approve', 'approval', 'access',
]);

const SENSITIVE_HINTS = [
  'harass', 'harrass', 'bully', 'bullying', 'unsafe', 'discrimination',
  'grievance', 'assault', 'threat', 'abuse', 'abusive', 'cry', 'crying',
];

const TYPE_SYNONYMS: Record<string, string[]> = {
  LAPTOP: ['laptop', 'computer', 'notebook', 'macbook', 'screen', 'keyboard', 'device', 'pc', 'monitor', 'mouse'],
  VPN: ['vpn', 'remote', 'tunnel', 'network', 'wifi', 'login', 'password', 'account', 'access', 'signin', 'sign-in'],
  SOFTWARE: ['software', 'install', 'installation', 'license', 'licence', 'application', 'program', 'tool', 'figma', 'adobe'],
  ACCESS: ['access', 'account', 'permission', 'permissions', 'reset', 'credentials'],
  EMP_LETTER: ['letter', 'employment', 'proof', 'visa', 'verification', 'certificate', 'embassy', 'salary', 'income', 'document'],
  ONBOARDING: ['onboard', 'onboarding', 'orientation', 'welcome', 'induction', 'starter', 'joiner', 'newcomer', 'hire'],
  EXPENSE: ['expense', 'expenses', 'reimbursement', 'reimburse', 'travel', 'receipt', 'receipts', 'budget', 'claim'],
  INVOICE: ['invoice', 'vendor', 'billing', 'bill', 'payment', 'dispute', 'charged', 'invoice'],
  PRINTER: ['printer', 'printers', 'peripheral', 'peripherals', 'scanner', 'toner', 'ink', 'printing'],
  LEAVE: ['leave', 'vacation', 'holiday', 'holidays', 'timeoff', 'time-off', 'absence', 'pto', 'sick'],
  BUDGET: ['budget', 'budgets', 'funding', 'allocation', 'approve', 'approval'],
  MAINTENANCE: ['maintenance', 'repair', 'repairs', 'broken', 'facility', 'facilities', 'plumbing', 'electrical', 'cleaning', 'hvac', 'cooling', 'heating'],
  SUPPLIES: ['supplies', 'supply', 'stationery', 'paper', 'furniture', 'chair', 'equipment', 'stock'],
  PAYROLL: ['payroll', 'payslip', 'salary', 'overtime', 'wage'],
  BENEFITS: ['benefits', 'benefit', 'insurance', 'health', 'coverage'],
  EMAIL: ['email', 'emails', 'mailbox', 'mail', 'calendar', 'outlook', 'inbox'],
  EQUIPMENT: ['equipment', 'hardware', 'desktop', 'monitor', 'docking', 'dock'],
  PAYMENT: ['payment', 'payments', 'banking', 'bank', 'transfer', 'paid'],
  BADGE: ['badge', 'badges', 'building', 'entry', 'entrance', 'gate'],
  DESK: ['desk', 'meeting', 'room', 'workspace', 'office', 'setup', 'move'],
  TRAINING: ['training', 'course', 'courses', 'workshop', 'certification', 'learn', 'excel'],
  WELLBEING: ['wellbeing', 'wellness', 'health', 'support', 'stress', 'mental', 'harass', 'harassment', 'harrass', 'bullying', 'bully', 'crying', 'cry', 'sick', 'illness', 'safety', 'unsafe', 'discrimination', 'grievance', 'complaint'],
  FEEDBACK: ['feedback', 'suggestion', 'suggestions', 'experience', 'improve', 'idea'],
};

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// Glue words must never become matchable keywords: with 23 catalog types,
// a shared "the"/"and"/"for" would match everything and drown real signals.
const KEY_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'with', 'from', 'that', 'this', 'into',
  'your', 'you', 'our', 'was', 'were', 'has', 'have', 'had', 'will',
  'would', 'can', 'its', 'are', 'an', 'of', 'to', 'in', 'on', 'is',
  'it', 'as', 'at', 'by', 'or', 'be', 'new', 'request',
]);

function keywordSet(parts: (string | null | undefined)[], extra: string[] = []): Set<string> {
  const set = new Set<string>(extra);
  for (const part of parts) {
    for (const w of words(part || '')) {
      if (w.length >= 2 && !KEY_STOPWORDS.has(w)) set.add(w);
    }
  }
  return set;
}

/**
 * Deterministic, dependency-free extractor. Scores the employee's words
 * against the catalog's own vocabulary (codes, names, descriptions) plus a
 * small synonym map — so it can only ever propose values the product owns.
 * No network, no randomness, no API key: the offline-safe default provider.
 */
export class LocalAiProvider implements AiProvider {
  readonly name = 'local';

  async extractDraft(text: string, catalog: CatalogDepartment[]): Promise<ProviderDraft> {
    const tokens = new Set(words(text));

    let best: { deptCode: string; typeCode: string; score: number; matched: string[] } | null = null;
    let runnerUpScore = 0;
    const deptHits = new Set<string>();

    for (const dept of catalog) {
      for (const type of dept.types) {
        const departmentKeys = keywordSet([
          dept.code.replace(/_/g, ' '), dept.name, dept.description,
        ]);
        const typeKeys = keywordSet([
          type.code.replace(/_/g, ' '), type.name, type.description,
        ], TYPE_SYNONYMS[type.code] || []);
        const matched: string[] = [];
        let score = 0;
        for (const token of tokens) {
          if (typeKeys.has(token)) {
            matched.push(token);
            score += 1;
          } else if (departmentKeys.has(token)) {
            // Shared department words provide weak context only. Counting
            // them as full category evidence makes sibling types tie.
            score += 0.2;
          }
        }
        if (!best || score > best.score) {
          runnerUpScore = best ? best.score : 0;
          best = { deptCode: dept.code, typeCode: type.code, score, matched };
        } else if (score > runnerUpScore) {
          runnerUpScore = score;
        }
        if (score > 0) deptHits.add(dept.code);
      }
    }

    const lowered = text.toLowerCase();
    const calmed = ['no rush', 'no hurry', 'not urgent', 'at your convenience', 'whenever', 'take your time']
      .some((h) => lowered.includes(h));
    const urgent = !calmed && URGENT_HINTS.some((h) => lowered.includes(h));
    const sensitive = SENSITIVE_HINTS.some((h) => lowered.includes(h));

    // Off-topic guard: zero catalog overlap AND zero workplace vocabulary
    // means gibberish or small talk (sports, cooking, homework...). Return
    // the UNKNOWN sentinel so the service answers with a clean,
    // human-readable error instead of a forced wrong guess. Anything
    // work-related always resolves — never UNKNOWN.
    const hasWorkSignal = [...tokens].some((t) => WORK_WORDS.has(t));
    if (best && best.score === 0 && !hasWorkSignal) {
      return {
        draft: {
          departmentCode: 'UNKNOWN',
          requestTypeCode: 'UNKNOWN',
          title: '',
          description: text.trim(),
          priority: 'STANDARD',
        },
        confidence: 'low',
        sensitive: false,
        trace: {
          matchedKeywords: [],
          rationale: 'No catalog overlap and no workplace vocabulary — off-topic, nothing to classify.',
        },
      };
    }

    // Deterministic fallback: alphabetical first department + first type,
    // always flagged low-confidence so the UI asks the human to confirm.
    const fallbackDept = [...catalog].sort((a, b) => a.code.localeCompare(b.code))[0];
    const fallbackType = fallbackDept ? [...fallbackDept.types].sort((a, b) => a.code.localeCompare(b.code))[0] : null;

    if (!best || !fallbackDept || !fallbackType) {
      throw new Error('Empty catalog: no departments with active request types.');
    }

    const pickedBase = best.score > 0
      ? best
      : { deptCode: fallbackDept.code, typeCode: fallbackType.code, score: 0, matched: [] as string[] };

    // Two independent catalog signals with a clear lead are enough to
    // confidently route; a single thin match still asks the employee to clarify.
    // Explicit onboarding words ("onboarding", "joiner", "new hire") name the
    // category outright: force HR/ONBOARDING when the catalog owns it, so a
    // multi-department ask ("laptop access and a desk badge") routes high
    // with a workflow instead of a clarification question. Signals spread
    // across departments likewise mean a real multi-part ask, not ambiguity.
    const onboardingIntent = /\bonboard(?:ing|ed)?\b|\bjoiner\b|\bnew hire\b|\bnewcomer\b|\binduction\b/.test(lowered);
    const onboardingType = onboardingIntent
      ? catalog.flatMap((d) => d.types.map((t) => ({ dept: d, type: t })))
          .find(({ type }) => type.code.toUpperCase() === 'ONBOARDING')
      : undefined;
    const picked = onboardingType && pickedBase.typeCode.toUpperCase() !== 'ONBOARDING'
      ? {
          deptCode: onboardingType.dept.code,
          typeCode: onboardingType.type.code,
          score: Math.max(pickedBase.score, 2),
          matched: [...new Set([...pickedBase.matched, 'onboarding'])],
        }
      : pickedBase;
    const multiDeptAsk = picked.score >= 1 && deptHits.size >= 2;
    const high = (picked.score >= 2 && picked.score - runnerUpScore >= 1) || multiDeptAsk || !!onboardingType;
    const pickedTypeName =
      catalog.flatMap((d) => d.types).find((t) => t.code === picked.typeCode)?.name || picked.typeCode;
    const firstClause = text.split(/[.?!;\n]/)[0].trim().slice(0, 90) || text.trim().slice(0, 90);
    const matchedKeywords = [...new Set(picked.matched)].slice(0, 12);
    const rationale =
      picked.score === 0
        ? `No catalog keywords matched — defaulted to ${picked.deptCode}/${picked.typeCode}; human must confirm.`
        : `Matched ${picked.score} keyword${picked.score === 1 ? '' : 's'} (${matchedKeywords.join(', ')}) for ${picked.deptCode}/${picked.typeCode}, runner-up had ${runnerUpScore}; ${urgent || sensitive ? 'urgency words forced URGENT' : 'no urgency words, STANDARD'}.`;

    return {
      draft: {
        departmentCode: picked.deptCode,
        requestTypeCode: picked.typeCode,
        title: `${pickedTypeName}: ${firstClause}`.slice(0, 120),
        description: text.trim(),
        priority: urgent || sensitive ? 'URGENT' : 'STANDARD',
      },
      confidence: high || (onboardingIntent && picked.typeCode === 'ONBOARDING') ? 'high' : 'low',
      sensitive,
      trace: { matchedKeywords, rationale },
      ...(onboardingIntent && picked.typeCode === 'ONBOARDING'
        ? { macro: this.onboardingMacro(catalog, text) }
        : {}),
    };
  }

  private onboardingMacro(catalog: CatalogDepartment[], text: string) {
    const tasks: NonNullable<ProviderDraft['macro']>['childTasks'] = [];
    const it = catalog.find((department) => ['IT', 'TECH'].includes(department.code.toUpperCase()));
    const equipment = it?.types.find((type) => ['EQUIPMENT', 'LAPTOP', 'ACCESS'].includes(type.code.toUpperCase()));
    if (it && equipment) {
      tasks.push({
        departmentCode: it.code,
        requestTypeCode: equipment.code,
        task: 'Prepare employee equipment and access',
        reason: `The request explicitly asks to onboard a new employee: ${text.trim().slice(0, 120)}`,
      });
    }
    const facilities = catalog.find((department) => ['FAC', 'FACILITIES'].includes(department.code.toUpperCase()));
    const workspace = facilities?.types.find((type) => ['DESK', 'SUPPLIES', 'MAINTENANCE'].includes(type.code.toUpperCase()));
    if (facilities && workspace) {
      tasks.push({
        departmentCode: facilities.code,
        requestTypeCode: workspace.code,
        task: 'Prepare the new employee workspace',
        reason: `The request explicitly asks to onboard a new employee: ${text.trim().slice(0, 120)}`,
      });
    }
    return tasks.length > 0 ? { summary: 'Coordinate setup for the new employee', childTasks: tasks } : null;
  }
}
