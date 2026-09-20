import { AiProvider, CatalogDepartment, ProviderDraft } from './ai.provider';

const URGENT_HINTS = [
  'urgent', 'asap', 'immediately', 'emergency', 'critical', 'blocked',
  'broken', 'cracked', 'down', 'rush', 'rushing', 'rushed',
  'as soon as possible', "can't work", 'cannot work', 'not working',
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
  SUPPLIES: ['supplies', 'supply', 'stationery', 'paper', 'furniture', 'chair', 'desk', 'equipment', 'stock'],
};

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function keywordSet(parts: (string | null | undefined)[], extra: string[] = []): Set<string> {
  const set = new Set<string>(extra);
  for (const part of parts) {
    for (const w of words(part || '')) {
      if (w.length >= 2) set.add(w);
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

    let best: { deptCode: string; typeCode: string; score: number } | null = null;
    let runnerUpScore = 0;

    for (const dept of catalog) {
      for (const type of dept.types) {
        const keys = keywordSet(
          [type.code.replace(/_/g, ' '), type.name, type.description],
          TYPE_SYNONYMS[type.code] || [],
        );
        let score = 0;
        for (const t of tokens) if (keys.has(t)) score++;
        if (!best || score > best.score) {
          runnerUpScore = best ? best.score : 0;
          best = { deptCode: dept.code, typeCode: type.code, score };
        } else if (score > runnerUpScore) {
          runnerUpScore = score;
        }
      }
    }

    const lowered = text.toLowerCase();
    const calmed = ['no rush', 'no hurry', 'not urgent', 'at your convenience', 'whenever', 'take your time']
      .some((h) => lowered.includes(h));
    const urgent = !calmed && URGENT_HINTS.some((h) => lowered.includes(h));

    // Deterministic fallback: alphabetical first department + first type,
    // always flagged low-confidence so the UI asks the human to confirm.
    const fallbackDept = [...catalog].sort((a, b) => a.code.localeCompare(b.code))[0];
    const fallbackType = fallbackDept ? [...fallbackDept.types].sort((a, b) => a.code.localeCompare(b.code))[0] : null;

    if (!best || !fallbackDept || !fallbackType) {
      throw new Error('Empty catalog: no departments with active request types.');
    }

    const picked = best.score > 0
      ? best
      : { deptCode: fallbackDept.code, typeCode: fallbackType.code, score: 0 };

    const high = picked.score >= 3 && picked.score - runnerUpScore >= 2;
    const pickedTypeName =
      catalog.flatMap((d) => d.types).find((t) => t.code === picked.typeCode)?.name || picked.typeCode;
    const firstClause = text.split(/[.?!;\n]/)[0].trim().slice(0, 90) || text.trim().slice(0, 90);

    return {
      draft: {
        departmentCode: picked.deptCode,
        requestTypeCode: picked.typeCode,
        title: `${pickedTypeName}: ${firstClause}`.slice(0, 120),
        description: text.trim(),
        priority: urgent ? 'URGENT' : 'STANDARD',
      },
      confidence: high ? 'high' : 'low',
    };
  }
}
