import { cardBrands, normalizeCardBrand, type CardBrand } from '@/lib/card-brand';
import { getRuntimeSecret } from '@/lib/db';

export type CardBrandResolution = {
  brand: CardBrand;
  source: 'mentioned' | 'web' | 'unknown';
};

function outputText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as { output_text?: unknown; output?: unknown[] };
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  for (const item of data.output ?? []) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return null;
}

async function safetyIdentifier(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(userId);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (item) =>
    item.toString(16).padStart(2, '0'),
  )
    .join('')
    .slice(0, 64);
}

export async function resolveCardBrand(
  cardName: string,
  userId: string,
): Promise<CardBrandResolution> {
  const mentioned = normalizeCardBrand(cardName);
  if (mentioned !== 'unknown') return { brand: mentioned, source: 'mentioned' };

  const apiKey = getRuntimeSecret('OPENAI_API_KEY');
  if (!apiKey) return { brand: 'unknown', source: 'unknown' };

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['brand', 'confidence'],
    properties: {
      brand: { type: 'string', enum: [...cardBrands] },
      confidence: { type: 'string', enum: ['confirmed', 'uncertain'] },
    },
  };

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: getRuntimeSecret('OPENAI_MODEL') ?? 'gpt-5.6-luna',
        store: false,
        max_output_tokens: 160,
        max_tool_calls: 1,
        safety_identifier: await safetyIdentifier(userId),
        tools: [{ type: 'web_search_preview' }],
        tool_choice: 'required',
        instructions:
          'Pesquise na web apenas a bandeira de um cartão brasileiro identificado pelo seu nome comercial. ' +
          'Nunca peça, use ou procure número do cartão, CVV, senha, CPF ou qualquer dado pessoal. ' +
          'Só retorne uma bandeira quando fontes confiáveis apontarem uma única opção para esse produto. ' +
          'Se o emissor puder ter mais de uma bandeira ou a informação não estiver clara, retorne brand unknown e confidence uncertain.',
        input: `Qual é a bandeira do cartão chamado "${cardName.slice(0, 80)}" no Brasil?`,
        text: {
          format: {
            type: 'json_schema',
            name: 'card_brand',
            strict: true,
            schema,
          },
        },
      }),
    });
    if (!response.ok) return { brand: 'unknown', source: 'unknown' };
    const parsed = JSON.parse(outputText(await response.json()) ?? 'null') as {
      brand?: unknown;
      confidence?: unknown;
    } | null;
    const brand = normalizeCardBrand(parsed?.brand);
    return parsed?.confidence === 'confirmed' && brand !== 'unknown'
      ? { brand, source: 'web' }
      : { brand: 'unknown', source: 'unknown' };
  } catch {
    return { brand: 'unknown', source: 'unknown' };
  }
}
