import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT_TOKEN } from '../prisma.service';
import {
  AiProvider,
  CatalogDepartment,
  DraftConfidence,
  RawDraft,
} from './ai.provider';
import { LocalAiProvider } from './local-ai.provider';
import { GroqAiProvider } from './groq-ai.provider';

const VALID_PRIORITIES = ['LOW', 'STANDARD', 'URGENT'] as const;

export interface ValidatedDraft {
  departmentId: string;
  requestTypeId: string;
  title: string;
  description: string;
  priority: 'LOW' | 'STANDARD' | 'URGENT';
  confidence: DraftConfidence;
  provider: string;
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
): Omit<ValidatedDraft, 'confidence' | 'provider'> {
  const departmentCode = (raw.departmentCode || '').trim().toUpperCase();
  const requestTypeCode = (raw.requestTypeCode || '').trim().toUpperCase();

  const dept = catalog.find((d) => d.code === departmentCode);
  if (!dept) {
    throw new BadRequestException(
      `AI suggested unknown department ("${departmentCode || 'empty'}").`,
    );
  }
  const type = dept.requestTypes.find(
    (t) => t.code === requestTypeCode && t.active,
  );
  if (!type) {
    throw new BadRequestException(
      `AI suggested unknown category ("${requestTypeCode || 'empty'}") for ${departmentCode}.`,
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

    let result;
    let used: AiProvider = primary;
    try {
      result = await primary.extractDraft(clean, catalog);
    } catch (e) {
      if (primary === this.local) throw e;
      this.logger.warn(
        `AI provider "${primary.name}" failed, falling back to local: ${(e as Error).message}`,
      );
      used = this.local;
      result = await this.local.extractDraft(clean, catalog);
    }

    return {
      ...validateCandidate(result.draft, departments),
      confidence: result.confidence,
      provider: used.name,
    };
  }
}
