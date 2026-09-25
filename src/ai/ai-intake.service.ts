import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT_TOKEN } from '../prisma.service';
import {
  AiProvider,
  CatalogDepartment,
  DraftConfidence,
  ProviderDraft,
  RawChildTask,
  RawDraft,
} from './ai.provider';
import { LocalAiProvider } from './local-ai.provider';
import { GroqAiProvider } from './groq-ai.provider';
import { fallbackSlaDurationMs, isAllowedSlaDuration } from '../sla-policy';

const VALID_PRIORITIES = ['LOW', 'STANDARD', 'URGENT'] as const;

/** Prompt/catalog contract version. Bumped whenever the extractor prompt,
 * synonyms, or validation rules change. Returned in every draft + health
 * response and asserted in evals so instructors see reproducibility. */
export const PROMPT_VERSION = 'v2.0-evidence-macro-sla';

const MAX_CHILD_TASKS = 6;
const MAX_TASK_LENGTH = 240;
const MAX_REASON_LENGTH = 400;

function titleOverlap(left: string, right: string): number {
  const tokens = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((word) => word.length > 2));
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common++;
  return common / Math.min(a.size, b.size);
}

export interface ValidatedDraft {
  departmentId: string | null;
  requestTypeId: string | null;
  title: string;
  description: string;
  priority: 'LOW' | 'STANDARD' | 'URGENT';
  confidence: DraftConfidence;
  provider: string;
  /** True for distress/safety signals. Advisory: forces URGENT + a discreet
   * UI note. A human still reviews every word before anything is created. */
  sensitive: boolean;
  promptVersion: string;
  /** Why this classification won — matched keywords + plain rationale. */
  trace?: { matchedKeywords: string[]; rationale: string };
  needsClarification: boolean;
  clarificationQuestions: string[];
  macro: { summary: string; childTasks: (RawChildTask & { departmentId: string; requestTypeId: string })[] } | null;
}

type CatalogRow = {
  id: string;
  code: string;
  requestTypes: { id: string; code: string; active: boolean }[];
};

/**
 * Product-owned validation (pure — no DB, no provider). Every code the AI
 * proposes must exist in the catalog the product owns; priority is coerced
 * into the enum; title/description get safe fallbacks. Anything else is a
 * 400, never a ticket. Shared by the service, the unit tests, and eval.
 */
export function validateCandidate(
  raw: RawDraft,
  catalog: CatalogRow[],
  needsClarification = false,
): Omit<ValidatedDraft, 'confidence' | 'provider' | 'sensitive' | 'promptVersion' | 'trace' | 'needsClarification' | 'clarificationQuestions' | 'macro'> {
  const departmentCode = (raw.departmentCode || '').trim().toUpperCase();
  const requestTypeCode = (raw.requestTypeCode || '').trim().toUpperCase();

  // UNKNOWN is reserved for off-topic input only (gibberish, sports,
  // cooking, small talk). Anything work-related must resolve — never here.
  if (departmentCode === 'UNKNOWN' || requestTypeCode === 'UNKNOWN') {
    throw new BadRequestException(
      'I can only help with workplace requests — try describing an issue like "my laptop screen is broken" or "I need VPN access".',
    );
  }
  if (needsClarification) {
    return {
      departmentId: null,
      requestTypeId: null,
      title: (raw.title || '').trim().slice(0, 200) || 'Workplace request',
      description: (raw.description || '').trim().slice(0, 2000) || 'Please clarify the workplace request.',
      priority: VALID_PRIORITIES.includes(raw.priority as any) ? raw.priority as ValidatedDraft['priority'] : 'STANDARD',
    };
  }
  if (!departmentCode || !requestTypeCode) {
    throw new BadRequestException(
      'I can only help with workplace requests — try describing an issue like "my laptop screen is broken" or "I need VPN access".',
    );
  }

  const dept = catalog.find((d) => d.code === departmentCode);
  if (!dept) {
    throw new BadRequestException(
      `AI suggested unknown department ("${departmentCode}").`,
    );
  }
  const type = dept.requestTypes.find(
    (t) => t.code === requestTypeCode && t.active,
  );
  if (!type) {
    throw new BadRequestException(
      `AI suggested unknown category ("${requestTypeCode}") for ${departmentCode}.`,
    );
  }

  const priority = VALID_PRIORITIES.includes(raw.priority as any)
    ? (raw.priority as ValidatedDraft['priority'])
    : 'STANDARD';

  const title = (raw.title || '').trim().slice(0, 200) || `${type.code} request`;
  let description = (raw.description || '').trim().slice(0, 2000);
  if (description.length < 10) description = `Request regarding: ${description || type.code}`;

  return {
    departmentId: dept.id,
    requestTypeId: type.id,
    title,
    description,
    priority,
  };
}

/**
 * v0.4 AI-assisted intake. Free text in → validated draft candidate out.
 * Nothing is created here: the human reviews the draft and submits through
 * the existing POST /requests flow. AI is advisory; software + human stay
 * authoritative. Provider order: Groq when configured, local otherwise —
 * any provider failure falls back to local, never to an error page.
 */
@Injectable()
export class AiIntakeService {
  private readonly logger = new Logger(AiIntakeService.name);

  constructor(
    @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaClient,
    private readonly local: LocalAiProvider = new LocalAiProvider(),
    private readonly groq: GroqAiProvider = new GroqAiProvider(),
  ) {}

  async draft(text: string, providerOverride?: AiProvider): Promise<ValidatedDraft> {
    const clean = (text || '').trim().slice(0, 2000);
    if (!clean) {
      throw new BadRequestException('Describe your issue in a few words first.');
    }

    const departments = await this.prisma.department.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
      include: {
        requestTypes: {
          where: { active: true },
          select: { id: true, code: true, name: true, description: true, active: true },
        },
      },
    });
    if (departments.length === 0 || departments.every((d) => d.requestTypes.length === 0)) {
      throw new BadRequestException('No request categories are configured yet.');
    }

    const catalog: CatalogDepartment[] = departments.map((d) => ({
      code: d.code,
      name: d.name,
      description: d.description,
      types: d.requestTypes.map((t) => ({ code: t.code, name: t.name, description: t.description })),
    }));

    const primary: AiProvider =
      providerOverride || (process.env['GROQ_API_KEY'] ? this.groq : this.local);

    let result: Awaited<ReturnType<AiProvider['extractDraft']>>;
    let used: AiProvider = primary;
    try {
      result = await primary.extractDraft(clean, catalog);
    } catch (e) {
      if (primary === this.local) throw e;
      this.recordProviderError((e as Error).message);
      this.logger.warn(
        `AI provider "${primary.name}" failed, falling back to local: ${(e as Error).message}`,
      );
      used = this.local;
      result = await this.local.extractDraft(clean, catalog);
    }

    let candidate: ReturnType<typeof validateCandidate>;
    let macro: ValidatedDraft['macro'];
    let needsClarification = result.needsClarification === true || result.confidence === 'low';
    try {
      candidate = validateCandidate(result.draft, departments, needsClarification);
      macro = this.validateMacro(result.macro, departments, needsClarification, result.draft);
    } catch (error) {
      if (used === this.local) throw error;
      this.recordProviderError('Invalid model draft or catalog reference.');
      this.logger.warn('AI provider returned an invalid draft; using local classification.');
      used = this.local;
      result = await this.local.extractDraft(clean, catalog);
      needsClarification = result.needsClarification === true || result.confidence === 'low';
      candidate = validateCandidate(result.draft, departments, needsClarification);
      macro = null;
    }

    if (result.sensitive === true) candidate = { ...candidate, priority: 'URGENT' };
    return {
      ...candidate,
      confidence: result.confidence,
      provider: used.name,
      sensitive: result.sensitive === true,
      promptVersion: PROMPT_VERSION,
      ...(result.trace ? { trace: result.trace } : {}),
      needsClarification,
      clarificationQuestions: (result.clarificationQuestions || (needsClarification
        ? ['What specific workplace issue do you need help with, and what outcome do you need?']
        : [])).slice(0, 3),
      macro: needsClarification ? null : macro,
    };
  }

  private validateMacro(
    value: ProviderDraft['macro'],
    catalog: CatalogRow[],
    needsClarification: boolean,
    parent?: RawDraft,
  ): ValidatedDraft['macro'] {
    if (!value || needsClarification) return null;
    if (typeof value.summary !== 'string' || value.summary.trim().length < 8 || value.summary.length > 240 ||
        !Array.isArray(value.childTasks) || value.childTasks.length < 1 || value.childTasks.length > MAX_CHILD_TASKS) {
      throw new BadRequestException('Invalid AI workflow proposal.');
    }
    const seen: { departmentId: string; requestTypeId: string; title: string }[] = [];
    const childTasks = value.childTasks.map((task) => {
      if (typeof task.task !== 'string' || task.task.trim().length < 8 || task.task.length > MAX_TASK_LENGTH ||
          typeof task.reason !== 'string' || task.reason.trim().length < 8 || task.reason.length > MAX_REASON_LENGTH) {
        throw new BadRequestException('AI workflow tasks must be specific and concise.');
      }
      const department = catalog.find((item) => item.code === task.departmentCode.trim().toUpperCase());
      const requestType = department?.requestTypes.find((item) => item.code === task.requestTypeCode.trim().toUpperCase() && item.active);
      if (!department || !requestType) throw new BadRequestException('AI proposed a task outside the active request catalog.');
      const normalizedTitle = task.task.trim();
      if (parent && department.code === parent.departmentCode && requestType.code === parent.requestTypeCode &&
          titleOverlap(normalizedTitle, parent.title) >= 0.8) {
        throw new BadRequestException('AI proposed a child task that duplicates the parent request.');
      }
      if (seen.some((existing) => titleOverlap(normalizedTitle, existing.title) >= 0.8)) {
        throw new BadRequestException('AI proposed duplicate workflow tasks.');
      }
      seen.push({ departmentId: department.id, requestTypeId: requestType.id, title: normalizedTitle });
      return {
        ...task,
        departmentCode: department.code,
        requestTypeCode: requestType.code,
        task: normalizedTitle,
        reason: task.reason.trim(),
        departmentId: department.id,
        requestTypeId: requestType.id,
      };
    });
    return { summary: value.summary.trim(), childTasks };
  }

  /**
   * Decides how many hours a ticket gets before its SLA deadline.
   * Groq reads the actual urgency when a key is configured; anything
   * (missing key, network, bad response) falls back to static priority
   * targets — creation never blocks on the LLM.
   */
  async decideSlaMs(text: string, priority: string): Promise<{ durationMs: number; source: 'AI' | 'RULE' }> {
    if (process.env['GROQ_API_KEY']) {
      try {
        const durationMs = await this.groq.estimateSlaMs(text, priority);
        if (!isAllowedSlaDuration(durationMs)) {
          throw new Error('SLA estimate is outside policy bounds.');
        }
        return { durationMs, source: 'AI' };
      } catch (e) {
        this.recordProviderError((e as Error).message);
        this.logger.warn(`SLA estimator failed, using priority fallback: ${(e as Error).message}`);
      }
    }
    return { durationMs: fallbackSlaDurationMs(priority), source: 'RULE' };
  }

  async generateResolutionPlaybook(input: {
    title: string;
    description: string;
    department: string;
    requestType: string;
  }) {
    if (!process.env['GROQ_API_KEY']) {
      throw new ServiceUnavailableException('AI resolution drafting is unavailable. Add a resolution note manually.');
    }
    try {
      return {
        ...(await this.groq.generateResolutionPlaybook(input)),
        provider: this.groq.name,
        promptVersion: PROMPT_VERSION,
      };
    } catch (error) {
      this.recordProviderError((error as Error).message);
      this.logger.warn('AI resolution drafting failed; no ticket state was changed.');
      throw new ServiceUnavailableException('AI could not draft a safe resolution note. Write the verified resolution manually.');
    }
  }

  private lastErrorAt: string | null = null;
  private lastErrorMessage: string | null = null;

  private recordProviderError(message: string) {
    this.lastErrorAt = new Date().toISOString();
    this.lastErrorMessage = message.slice(0, 200);
  }

  /** Surfaced on /health + GET /ai/health: which provider is live and when it last failed. */
  providerStatus() {
    const configured = !!process.env['GROQ_API_KEY'];
    return {
      provider: configured ? 'groq' : 'local',
      model: configured ? process.env['GROQ_MODEL'] || 'openai/gpt-oss-20b' : 'offline-rules',
      promptVersion: PROMPT_VERSION,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
    };
  }
}
