/**
 * AI provider contract for Week 4 (v0.4): employee free text in,
 * structured draft candidate out. The model NEVER sees UUIDs and NEVER
 * creates anything — it only proposes codes inside the product's bounded
 * context. Backend validation + the human remain the authority.
 */

export interface CatalogType {
  code: string;
  name: string;
  description: string | null;
}

export interface CatalogDepartment {
  code: string;
  name: string;
  description: string | null;
  types: CatalogType[];
}

export interface RawDraft {
  departmentCode: string;
  requestTypeCode: string;
  title: string;
  description: string;
  priority: string;
}

export type DraftConfidence = 'high' | 'low';

export interface ProviderDraft {
  draft: RawDraft;
  confidence: DraftConfidence;
}

export interface AiProvider {
  readonly name: string;
  extractDraft(text: string, catalog: CatalogDepartment[]): Promise<ProviderDraft>;
}
