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
              '"priority": "URGENT if rushed/now/ASAP, else STANDARD" }.\n' +
              `Valid departments and categories:\n${listing}\n` +
              'Codes MUST come from the lists; the category MUST belong to the department. ' +
              'If the message is gibberish or not a service request, output {"departmentCode":"UNKNOWN","requestTypeCode":"UNKNOWN","title":"","description":"","priority":"STANDARD"}.',
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
      confidence: 'high',
    };
  }
}
