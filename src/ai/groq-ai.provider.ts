import { AiProvider, CatalogDepartment, ProviderDraft } from './ai.provider';

/**
 * Optional LLM provider (Groq, free tier) over raw HTTPS — no SDK dependency.
 * Used ONLY when GROQ_API_KEY is set; every failure (missing key, network,
 * bad response) throws so the service falls back to the local provider.
 * "Paid AI provider is not required" holds by construction.
 */
export class GroqAiProvider implements AiProvider {
  readonly name = 'groq';

  async extractDraft(text: string, catalog: CatalogDepartment[]): Promise<ProviderDraft> {
    const apiKey = process.env['GROQ_API_KEY'];
    if (!apiKey) throw new Error('GROQ_API_KEY is not set.');

    const listing = catalog
      .map((d) => `- ${d.code} (${d.name}): ${d.types.map((t) => `${t.code} (${t.name})`).join(', ') || 'no categories'}`)
      .join('\n');

    // Model is env-overridable because Groq retires model IDs aggressively;
    // a future sunset is then a one-line .env change, not a code change.
    const model = process.env['GROQ_MODEL'] || 'openai/gpt-oss-20b';
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // Groq sits behind Cloudflare, which rejects non-browser clients.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are an IT service desk data extractor. Output ONLY a raw JSON object: ' +
              '{ "departmentCode": "one valid code below", "requestTypeCode": "one valid category of that department below", ' +
              '"title": "Professional 4-word subject", "description": "Professional rewrite of the issue", ' +
              '"priority": "URGENT if rushed/now/ASAP or distressed/unsafe, else STANDARD", ' +
              '"sensitive": true only if the message signals distress, harassment, or safety concerns, else false, ' +
              '"confidence": "high only for specific, actionable requests with a clear need; low for vague, thin, or ambiguous messages" }.\n' +
              `Valid departments and categories:\n${listing}\n` +
              'Codes MUST come from the lists; the category MUST belong to the department. ' +
              'RULE: UNKNOWN is forbidden for anything work-related — typos, emotions, vague wording, and personal ' +
              'hardship all still map to the closest category (e.g. harassment, crying, or feeling unsafe at work ' +
              'is Employee Wellbeing, URGENT, sensitive true). Output ' +
              '{"departmentCode":"UNKNOWN","requestTypeCode":"UNKNOWN","title":"","description":"","priority":"STANDARD","sensitive":false} ' +
              'ONLY when the message is unintelligible gibberish or clearly not about work at all ' +
              '(sports scores, cooking, homework, small talk).\n' +
              'Examples:\n' +
              '- "my laptop screen is cracked, need replacement asap" -> {"departmentCode":"IT","requestTypeCode":"LAPTOP","title":"Laptop Screen Replacement Request","description":"...","priority":"URGENT","sensitive":false,"confidence":"high"}\n' +
              '- "please i need help, crying, a coworker is harassing me" -> {"departmentCode":"PEO","requestTypeCode":"WELLBEING","title":"Workplace Harassment Support Request","description":"...","priority":"URGENT","sensitive":true,"confidence":"high"}\n' +
              '- "i need help asap" -> {"departmentCode":"IT","requestTypeCode":"ACCESS","title":"General Assistance Request","description":"...","priority":"URGENT","sensitive":false,"confidence":"low"}',
          },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Groq rejected the request (HTTP ${res.status}).`);

    const body = (await res.json()) as any;
    const content: string = body?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);
    return {
      draft: {
        departmentCode: String(parsed.departmentCode || ''),
        requestTypeCode: String(parsed.requestTypeCode || ''),
        title: String(parsed.title || ''),
        description: String(parsed.description || ''),
        priority: String(parsed.priority || ''),
      },
      // High only when the model explicitly claims it; anything else
      // (missing, vague, malformed) degrades to low so the UI asks the
      // human to double-check instead of presenting a guess confidently.
      confidence: parsed.confidence === 'high' ? 'high' : 'low',
      sensitive: parsed.sensitive === true,
    };
  }
}
