import {
  cardBrandLabel,
  cardBrands,
  normalizeCardBrand,
  type CardBrand,
} from '@/lib/card-brand';
import { resolveCardBrand } from '@/lib/card-brand-resolver';
import { getRuntimeSecret } from '@/lib/db';
import {
  classifyPurchaseCategory,
  normalizePurchaseCategory,
  purchaseCategoryLabel,
} from '@/lib/categories';
import { formatBrl, normalizeText, parseCents } from '@/lib/money';
import {
  cardOutstandingCents,
  clearSession,
  createPurchase,
  effectiveMonthlyBudget,
  getCachedReply,
  getCardByName,
  getProfile,
  getSession,
  saveAnalysis,
  saveInteraction,
  saveSession,
  spendingForPeriod,
  upsertCard,
  updateProfile,
  type AuthenticatedUser,
} from '@/lib/store';

type Intent =
  | 'greeting'
  | 'help'
  | 'configure_profile'
  | 'add_card'
  | 'record_purchase'
  | 'analyze_credit'
  | 'record_card_payment'
  | 'monthly_summary'
  | 'list_purchases'
  | 'confirm'
  | 'cancel'
  | 'unknown';

type PaymentMethod = 'credit' | 'debit' | 'pix' | 'cash';

type Command = {
  intent: Intent;
  description?: string;
  amount?: string;
  merchant?: string;
  location?: string;
  category?: string;
  paymentMethod?: PaymentMethod;
  installments?: number;
  cardName?: string;
  purchaseDate?: string;
  monthlyIncome?: string;
  fixedExpenses?: string;
  savingsGoal?: string;
  monthlyBudget?: string;
  cardLimit?: string;
  cardBrand?: CardBrand;
  closingDay?: number;
  dueDay?: number;
};

type PendingAction = {
  command: Command;
  originMessageId: string;
  preparedResponse: string;
};

type MessageInput = {
  user: AuthenticatedUser;
  text: string;
  source: 'panel' | 'whatsapp';
  messageId: string;
};

const HELP_TEXT = [
  'Posso registrar compras, configurar renda e cartões, mostrar seu resumo e analisar se uma compra cabe no crédito.',
  '',
  'Exemplos:',
  '• Comprei café por R$ 12,50 na Padaria Central no Pix hoje',
  '• Minha renda é R$ 5.000 e meu orçamento mensal é R$ 1.500',
  '• Cartão Nubank, limite R$ 3.000, fecha dia 5 e vence dia 12',
  '• Ao cadastrar um cartão, eu identifico a bandeira com segurança.',
  '• Posso comprar um notebook de R$ 2.500 no Nubank em 10x?',
  '• Eu identifico categorias como alimentação, saúde, roupas, transporte e outras.',
  '',
  'Antes de gravar algo, eu envio uma prévia para revisão. Responda SIM para salvar, CORRIGIR para ajustar ou CANCELAR para desistir.',
].join('\n');

const SENSITIVE_WARNING =
  '⚠️ Não envie número completo do cartão, CVV, senha, CPF ou código de segurança. A mensagem não foi processada.';

const intents: Intent[] = [
  'greeting',
  'help',
  'configure_profile',
  'add_card',
  'record_purchase',
  'analyze_credit',
  'record_card_payment',
  'monthly_summary',
  'list_purchases',
  'confirm',
  'cancel',
  'unknown',
];

function referenceDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function formatPeriod(date: string): string {
  return date.slice(0, 7);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDate(year: number, month: number, day: number): string {
  const safeDay = Math.min(Math.max(day, 1), daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

function addMonths(
  date: string,
  months: number,
  preferredDay?: number,
): string {
  const [year, month, day] = date.split('-').map(Number);
  const offset = year * 12 + month - 1 + months;
  const nextYear = Math.floor(offset / 12);
  const nextMonth = (offset % 12) + 1;
  return clampDate(nextYear, nextMonth, preferredDay ?? day);
}

function firstInstallmentDueDate(
  purchaseDate: string,
  closingDay: number,
  dueDay: number,
): string {
  const [year, month, day] = purchaseDate.split('-').map(Number);
  let closing = clampDate(year, month, closingDay);
  if (purchaseDate > closing) closing = addMonths(closing, 1, closingDay);
  let due = clampDate(
    Number(closing.slice(0, 4)),
    Number(closing.slice(5, 7)),
    dueDay,
  );
  if (due <= closing) due = addMonths(due, 1, dueDay);
  return due;
}

function splitCents(total: number, installments: number): number[] {
  if (
    !Number.isInteger(installments) ||
    installments < 1 ||
    installments > 48
  ) {
    throw new Error('As parcelas devem ficar entre 1 e 48.');
  }
  if (installments > total)
    throw new Error('Há parcelas demais para esse valor.');
  const base = Math.floor(total / installments);
  const remainder = total % installments;
  return Array.from(
    { length: installments },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

function hasSensitiveData(text: string): boolean {
  const normalized = normalizeText(text);
  if (
    /\b(cvv|cvc|senha|cpf|token|codigo de seguranca|codigo de autenticacao)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  const candidates = text.match(/(?:\d[ .-]?){13,19}/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19;
  });
}

function cleanText(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const compact = value.trim().replace(/\s+/g, ' ');
  return compact ? compact.slice(0, max) : undefined;
}

function correctFinanceText(value: string): string {
  return value
    .replace(/\b(?:piks|pixx|pics|piz|pich)\b/giu, 'Pix')
    .replace(/\b(?:credtio|credto|creditu|creddito|creditoo)\b/giu, 'crédito')
    .replace(/\b(?:debto|debtio|debitoo|debito)\b/giu, 'débito')
    .replace(/\b(?:dinhero|dinehiro|dinhiero|dinero)\b/giu, 'dinheiro')
    .replace(/\b(?:cartaoo|cartao)\b/giu, 'cartão')
    .replace(/\b(?:comprai|comprrei|compreei|compri)\b/giu, 'comprei')
    .replace(/\b(?:paghei|paguey|pguei)\b/giu, 'paguei')
    .replace(/\b(?:gastey|gasteei)\b/giu, 'gastei');
}

function cleanMoneyToken(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '');
}

function canonicalMoney(value: string): string | undefined {
  const number = cleanMoneyToken(value)
    .replace(/^r\s*(?:\$|s)\s*/iu, '')
    .replace(/\s*(?:reais?|rs)\s*$/iu, '')
    .trim();
  return /^\d[\d.,]*$/.test(number) ? `R$ ${number}` : undefined;
}

function moneyFromText(text: string, label?: RegExp): string | undefined {
  const source = label ? text.match(label)?.[1] : undefined;
  if (source) return canonicalMoney(source);

  const prefixed = text.match(
    /(?:^|[^\p{L}\d])r\s*(?:\$|s)\s*(\d[\d.,]*)/iu,
  )?.[1];
  if (prefixed) return canonicalMoney(prefixed);

  const suffixed = text.match(/\b(\d[\d.,]*)\s+(?:reais?|rs)\b/iu)?.[1];
  if (suffixed) return canonicalMoney(suffixed);

  const paidAmount = text.match(
    /\b(?:paguei|gastei)\s+(\d[\d.,]*)(?=\s+(?:pelo|pela|por|no|na|em)\b|$)/iu,
  )?.[1];
  return paidAmount ? canonicalMoney(paidAmount) : undefined;
}

function amountNearPayment(text: string): string | undefined {
  const amount = text.match(
    /\b(?:pix|dinheiro|d[eé]bito|(?:cart[aã]o\s+de\s+)?cr[eé]d(?:ito|tio))\b(?:\s+(?:por|de))?\s+(?:r\s*(?:\$|s)\s*)?(\d[\d.,]*)/iu,
  )?.[1];
  return amount ? canonicalMoney(amount) : undefined;
}

function amountFromPurchaseContext(
  text: string,
  normalized: string,
): string | undefined {
  if (
    !/\b(?:comprei|paguei|gastei)\b/.test(normalized) ||
    !paymentMethodFromText(normalized)
  ) {
    return undefined;
  }
  const numericValues = text.match(/\b\d[\d.,]*\b/gu) ?? [];
  return numericValues.length === 1 ? canonicalMoney(numericValues[0]) : undefined;
}

function parseDateFromText(text: string, fallback: string): string {
  const normalized = normalizeText(text);
  if (/\bhoje\b/.test(normalized)) return fallback;
  if (/\bontem\b/.test(normalized)) return addDays(fallback, -1);
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (br) return clampDate(Number(br[3]), Number(br[2]), Number(br[1]));
  return fallback;
}

function paymentMethodFromText(normalized: string): PaymentMethod | undefined {
  if (/\b(pix)\b/.test(normalized)) return 'pix';
  if (/\b(?:debito|cartao\s+(?:de\s+)?debito)\b/.test(normalized))
    return 'debit';
  if (/\b(dinheiro|especie)\b/.test(normalized)) return 'cash';
  if (/\b(?:credito|credtio|cartao)\b/.test(normalized)) return 'credit';
  return undefined;
}

function cleanCardName(value: unknown): string | undefined {
  const cardName = cleanText(value, 80)
    ?.replace(
      /^(?:cart[aã]o\s+)?(?:de\s+)?cr[eé]d(?:ito|tio)(?:\s+(?:no|na))?\s*/iu,
      '',
    )
    .replace(/^(?:no|na|e)\s+/iu, '')
    .trim();
  if (
    !cardName ||
    /^(?:de\s+)?(?:pix|cr[eé]d(?:ito|tio)|d[eé]bito|dinheiro|cart[aã]o)(?:\s|$)/iu.test(
      cardName,
    )
  ) {
    return undefined;
  }
  return cardName;
}

function cardNameFromText(text: string): string | undefined {
  const alias = String.raw`([\p{L}][\p{L}\d .-]{1,48}?)`;
  const ending = String.raw`(?=\s+(?:em\s+\d{1,2}x|em\s+parcelas?|por|de\s+R\$|R\$)|[,.!?]|$)`;
  const patterns = [
    new RegExp(
      String.raw`\b(?:cart[aã]o\s+(?:de\s+)?cr[eé]d(?:ito|tio)|cr[eé]d(?:ito|tio))\s+(?:(?:no|na)\s+)?${alias}${ending}`,
      'iu',
    ),
    new RegExp(
      String.raw`\b(?:no|na)\s+cart[aã]o\s+${alias}${ending}`,
      'iu',
    ),
    new RegExp(
      String.raw`\bcart[aã]o\s+(?!de\s+(?:d[eé]bito|cr[eé]d(?:ito|tio))\b)${alias}${ending}`,
      'iu',
    ),
  ];
  for (const pattern of patterns) {
    const cardName = cleanCardName(text.match(pattern)?.[1]);
    if (cardName) return cardName;
  }
  return undefined;
}

function cleanPurchaseDescription(value: unknown): string | undefined {
  const description = cleanText(value, 120);
  if (!description) return undefined;
  const withoutPayment = description
    .replace(
      /\s+(?:no|na|com|via)\s+(?:pix|dinheiro|d[eé]bito|(?:cart[aã]o\s+de\s+)?cr[eé]d(?:ito|tio)|cart[aã]o(?:\s+[\p{L}][\p{L}\d .-]{1,48})?)(?:\s+(?:no|na)\s+[\p{L}][\p{L}\d .-]{1,48})?$/iu,
      '',
    )
    .trim();
  return cleanText(withoutPayment, 120);
}

function descriptionFromText(text: string): string | undefined {
  const amount = String.raw`(?:r\s*(?:\$|s)\s*)?\d[\d.,]*(?:\s+reais?)?`;
  const paidFirst = text.match(
    new RegExp(
      String.raw`\b(?:paguei|gastei)\s+${amount}\s+(?:pelo|pela|por|no|na|em)\s+(.+?)(?=\s+(?:no|na|com)\s+(?:pix|cr[eé]dito|d[eé]bito|cart[aã]o|dinheiro)|\s+(?:hoje|ontem)\b|[,.!?]|$)`,
      'iu',
    ),
  );
  const purchaseFirst = text.match(
    new RegExp(
      String.raw`\b(?:comprei|paguei|gastei)\s+(.+?)(?=\s+(?:por|de)\s+${amount}|\s+${amount}|$)`,
      'iu',
    ),
  );
  const question = text.match(
    new RegExp(
      String.raw`\b(?:posso comprar|comprar)\s+(.+?)(?=\s+(?:por|de)\s+${amount})`,
      'iu',
    ),
  );
  const described = paidFirst?.[1] ?? question?.[1] ?? purchaseFirst?.[1];
  if (described) return cleanPurchaseDescription(described);
  const flexible = text
    .replace(/(?:r\s*(?:\$|s)\s*)?\d[\d.,]*(?:\s+reais?|\s+rs)?/giu, ' ')
    .replace(/\b(?:comprei|paguei|gastei|pix|dinheiro|d[eé]bito|cr[eé]d(?:ito|tio)|cart[aã]o)\b/giu, ' ')
    .replace(/\b(?:no|na|com|via|por|de|hoje|ontem)\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleanPurchaseDescription(flexible);
}

function merchantFromText(text: string): string | undefined {
  const match = text.match(
    /\b(?:na|no|em)\s+([\p{L}][\p{L}\d .&'-]{1,70}?)(?=\s+(?:no|na|com|por|de)\s+(?:pix|cr[eé]dito|d[eé]bito|dinheiro|R\$)|[,.!?]|$)/iu,
  );
  const merchant = cleanText(match?.[1], 100);
  if (
    !merchant ||
    /^(pix|cr[eé]dito|d[eé]bito|dinheiro|hoje|ontem)(\s|$)/i.test(merchant)
  ) {
    return undefined;
  }
  return merchant;
}

function dayFromText(
  text: string,
  kind: 'closing' | 'due',
): number | undefined {
  const pattern =
    kind === 'closing'
      ? /(?:fecha|fechamento)\s*(?:dia)?\s*(\d{1,2})/i
      : /(?:vence|vencimento)\s*(?:dia)?\s*(\d{1,2})/i;
  const value = Number(text.match(pattern)?.[1]);
  return value >= 1 && value <= 31 ? value : undefined;
}

function amountAfterKeyword(text: string, keyword: string): string | undefined {
  const match = text.match(
    new RegExp(
      String.raw`\b(?:${keyword})\b[^\d]{0,18}((?:r\s*(?:\$|s)\s*)?\d[\d.,]*(?:\s+reais?)?)`,
      'iu',
    ),
  );
  return match?.[1] ? canonicalMoney(match[1]) : undefined;
}

function fallbackExtract(text: string, today: string): Command {
  const corrected = correctFinanceText(text);
  const normalized = normalizeText(corrected);
  const date = parseDateFromText(corrected, today);
  if (/^(oi|ola|ol[aá]|bom dia|boa tarde|boa noite)\b/.test(normalized))
    return { intent: 'greeting' };
  if (/\b(ajuda|exemplos|o que voce faz)\b/.test(normalized))
    return { intent: 'help' };
  if (/^(resumo|meu resumo|como estou)\b/.test(normalized))
    return { intent: 'monthly_summary' };
  if (/\b(ultimas compras|minhas compras|listar compras)\b/.test(normalized))
    return { intent: 'list_purchases' };
  if (/^(confirmar|confirmo)\b/.test(normalized)) return { intent: 'confirm' };
  if (/^(cancelar|cancela|nao|não)\b/.test(normalized))
    return { intent: 'cancel' };

  const income = amountAfterKeyword(corrected, 'renda');
  const budget = amountAfterKeyword(corrected, 'orcamento|orçamento');
  const expenses = amountAfterKeyword(corrected, 'gastos? fixos?');
  const savings = amountAfterKeyword(corrected, 'reserva|poupanca|poupança');
  if (income || budget || expenses || savings) {
    return {
      intent: 'configure_profile',
      monthlyIncome: income,
      monthlyBudget: budget,
      fixedExpenses: expenses,
      savingsGoal: savings,
    };
  }

  if (
    /\b(cartao|cartão)\b/.test(normalized) &&
    /\b(limite|fecha|vence)\b/.test(normalized)
  ) {
    const name = cleanText(
      corrected.match(
        /cart[aã]o\s+([^,]+?)(?=,|\s+limite|\s+fecha|\s+vence|$)/i,
      )?.[1],
      80,
    );
    return {
      intent: 'add_card',
      cardName: name,
      cardBrand: normalizeCardBrand(corrected),
      cardLimit: amountAfterKeyword(corrected, 'limite'),
      closingDay: dayFromText(corrected, 'closing'),
      dueDay: dayFromText(corrected, 'due'),
    };
  }

  const amount =
    moneyFromText(corrected) ??
    amountAfterKeyword(corrected, 'por|valor|de') ??
    amountNearPayment(corrected) ??
    amountFromPurchaseContext(corrected, normalized);
  const installments = Number(corrected.match(/\b(\d{1,2})\s*x\b/i)?.[1]);
  const cardName = cardNameFromText(corrected);
  const paymentMethod = paymentMethodFromText(normalized);
  if (
    /\b(posso comprar|cabe no credito|cabe no cr[eé]dito|vale a pena comprar)\b/.test(
      normalized,
    )
  ) {
    return {
      intent: 'analyze_credit',
      amount,
      installments: installments || 1,
      cardName,
      description: descriptionFromText(corrected),
      purchaseDate: date,
    };
  }
  const description = descriptionFromText(corrected);
  const merchant = merchantFromText(corrected);
  const categorySource = `${description ?? ''} ${merchant ?? ''}`.trim() || corrected;
  const hasPurchaseVerb = /\b(comprei|paguei|gastei)\b/.test(normalized);
  const inferredPurchase = Boolean(
    amount &&
      paymentMethod &&
      !/\b(posso|cabe|limite|orcamento|renda)\b/.test(normalized),
  );
  if (hasPurchaseVerb || inferredPurchase) {
    return {
      intent: 'record_purchase',
      amount,
      description,
      merchant,
      category: classifyPurchaseCategory(categorySource),
      paymentMethod,
      installments: paymentMethod === 'credit' ? installments || 1 : 1,
      cardName: paymentMethod === 'credit' ? cardName : undefined,
      purchaseDate: date,
    };
  }
  if (paymentMethod) {
    return {
      intent: 'unknown',
      paymentMethod,
      cardName: paymentMethod === 'credit' ? cardName : undefined,
    };
  }
  return { intent: 'unknown', amount };
}

function readOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as { output_text?: unknown; output?: unknown[] };
  if (typeof data.output_text === 'string' && data.output_text.trim())
    return data.output_text;
  for (const item of data.output ?? []) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown[] }).content;
    for (const part of content ?? []) {
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

function commandFromUnknown(value: unknown): Command | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const intent =
    typeof item.intent === 'string' && intents.includes(item.intent as Intent)
      ? (item.intent as Intent)
      : null;
  if (!intent) return null;
  const paymentMethod = ['credit', 'debit', 'pix', 'cash'].includes(
    String(item.paymentMethod),
  )
    ? (item.paymentMethod as PaymentMethod)
    : undefined;
  const day = (value: unknown) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31
      ? parsed
      : undefined;
  };
  const installments = Number(item.installments);
  return {
    intent,
    description: cleanPurchaseDescription(item.description),
    amount: cleanText(item.amount, 64),
    merchant: cleanText(item.merchant),
    location: cleanText(item.location),
    category: normalizePurchaseCategory(item.category),
    paymentMethod,
    installments:
      Number.isInteger(installments) && installments >= 1 && installments <= 48
        ? installments
        : undefined,
    cardName: cleanText(item.cardName, 80),
    cardBrand: normalizeCardBrand(item.cardBrand),
    purchaseDate:
      typeof item.purchaseDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.purchaseDate)
        ? item.purchaseDate
        : undefined,
    monthlyIncome: cleanText(item.monthlyIncome, 64),
    fixedExpenses: cleanText(item.fixedExpenses, 64),
    savingsGoal: cleanText(item.savingsGoal, 64),
    monthlyBudget: cleanText(item.monthlyBudget, 64),
    cardLimit: cleanText(item.cardLimit, 64),
    closingDay: day(item.closingDay),
    dueDay: day(item.dueDay),
  };
}

function mergeCommand(base: Command, next: Command): Command {
  const merged: Command = { ...base };
  for (const [key, value] of Object.entries(next) as Array<
    [keyof Command, Command[keyof Command]]
  >) {
    if (key === 'intent') {
      if (value !== 'unknown') merged.intent = value as Intent;
    } else if (value !== undefined && value !== null && value !== '') {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

function isNewFinancialAction(intent: Intent): boolean {
  return [
    'configure_profile',
    'add_card',
    'record_purchase',
    'analyze_credit',
    'record_card_payment',
  ].includes(intent);
}

function mergeExtraction(fallback: Command, extracted: Command): Command {
  const merged = mergeCommand(fallback, extracted);
  if (isNewFinancialAction(fallback.intent)) merged.intent = fallback.intent;
  if (fallback.amount) merged.amount = fallback.amount;
  if (fallback.paymentMethod) merged.paymentMethod = fallback.paymentMethod;
  if (fallback.cardName) merged.cardName = fallback.cardName;
  if (fallback.cardBrand && fallback.cardBrand !== 'unknown') {
    merged.cardBrand = fallback.cardBrand;
  }
  if (fallback.category && fallback.category !== 'geral') {
    merged.category = fallback.category;
  }
  if (fallback.paymentMethod && fallback.paymentMethod !== 'credit') {
    merged.cardName = undefined;
    merged.installments = 1;
  }
  return merged;
}

function enrichPendingCardAlias(
  base: Command,
  text: string,
  extracted: Command,
): Command {
  if (extracted.cardName || !missingFields(base).includes('cartão'))
    return extracted;
  const normalized = normalizeText(text);
  if (
    isPositiveConfirmation(normalized) ||
    /^(?:cancelar|cancela|nao)\b/.test(normalized)
  )
    return extracted;
  const cardName = cleanCardName(text);
  return cardName ? { ...extracted, cardName } : extracted;
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

async function extractWithAi(
  text: string,
  userId: string,
  fallback: Command,
): Promise<Command> {
  const apiKey = getRuntimeSecret('OPENAI_API_KEY');
  if (!apiKey) return fallback;
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: [
      'intent',
      'description',
      'amount',
      'merchant',
      'location',
      'category',
      'paymentMethod',
      'installments',
      'cardName',
      'cardBrand',
      'purchaseDate',
      'monthlyIncome',
      'fixedExpenses',
      'savingsGoal',
      'monthlyBudget',
      'cardLimit',
      'closingDay',
      'dueDay',
    ],
    properties: {
      intent: { type: 'string', enum: intents },
      description: { type: ['string', 'null'] },
      amount: { type: ['string', 'null'] },
      merchant: { type: ['string', 'null'] },
      location: { type: ['string', 'null'] },
      category: { type: ['string', 'null'] },
      paymentMethod: {
        type: ['string', 'null'],
        enum: ['credit', 'debit', 'pix', 'cash', null],
      },
      installments: { type: ['integer', 'null'] },
      cardName: { type: ['string', 'null'] },
      cardBrand: { type: ['string', 'null'], enum: [...cardBrands, null] },
      purchaseDate: { type: ['string', 'null'] },
      monthlyIncome: { type: ['string', 'null'] },
      fixedExpenses: { type: ['string', 'null'] },
      savingsGoal: { type: ['string', 'null'] },
      monthlyBudget: { type: ['string', 'null'] },
      cardLimit: { type: ['string', 'null'] },
      closingDay: { type: ['integer', 'null'] },
      dueDay: { type: ['integer', 'null'] },
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
        max_output_tokens: 500,
        safety_identifier: await safetyIdentifier(userId),
        instructions:
          'Extraia fatos de uma mensagem em português do Brasil para um assistente financeiro. ' +
          'Nunca invente valores, datas, lojas ou cartões. Datas devem ser YYYY-MM-DD ou null. ' +
          'Valores em reais podem vir como R$, RS, real ou reais. Interprete "paguei <valor> pelo/pela <produto>" como uma compra. ' +
          'Entenda erros comuns de digitação e frases em ordem diferente, mas nunca invente um valor, cartão ou local ausente. ' +
          'Quando a pessoa responder apenas a forma de pagamento, preserve o contexto do rascunho. ' +
          '“Cartão de crédito Mercado Pago” significa paymentMethod credit e cardName Mercado Pago. ' +
          'Se a pessoa informar uma bandeira de cartão, use cardBrand; não invente uma bandeira ausente. ' +
          'Classifique compras em alimentação, saúde, roupas, transporte, moradia, educação, lazer, cuidados pessoais, pets ou geral. ' +
          'Valores devem manter a forma dita pela pessoa. Retorne somente o objeto solicitado.',
        input: text.slice(0, 2000),
        text: {
          format: {
            type: 'json_schema',
            name: 'finance_command',
            strict: true,
            schema,
          },
        },
      }),
    });
    if (!response.ok) return fallback;
    const parsed = commandFromUnknown(
      JSON.parse(readOutputText(await response.json()) ?? 'null'),
    );
    return parsed ? mergeExtraction(fallback, parsed) : fallback;
  } catch {
    return fallback;
  }
}

function missingFields(command: Command): string[] {
  if (command.intent === 'configure_profile') {
    return command.monthlyIncome ||
      command.fixedExpenses ||
      command.savingsGoal ||
      command.monthlyBudget
      ? []
      : ['renda ou orçamento mensal'];
  }
  if (command.intent === 'add_card') {
    return [
      !command.cardName && 'nome do cartão',
      !command.cardLimit && 'limite',
      !command.closingDay && 'dia de fechamento',
      !command.dueDay && 'dia de vencimento',
    ].filter(Boolean) as string[];
  }
  if (command.intent === 'record_purchase') {
    const fields = [
      !command.amount && 'valor',
      !command.paymentMethod && 'forma de pagamento',
      !command.purchaseDate && 'data',
    ];
    if (command.paymentMethod === 'credit') {
      fields.push(
        !command.cardName && 'cartão',
        !command.installments && 'parcelas',
      );
    }
    return fields.filter(Boolean) as string[];
  }
  if (command.intent === 'analyze_credit') {
    return [
      !command.amount && 'valor',
      !command.cardName && 'cartão',
      !command.installments && 'parcelas',
      !command.purchaseDate && 'data',
    ].filter(Boolean) as string[];
  }
  return [];
}

function questionFor(field: string): string {
  const questions: Record<string, string> = {
    valor: 'Qual foi o valor? Ex.: R$ 42,90.',
    'forma de pagamento': 'Como pagou: crédito, débito, Pix ou dinheiro?',
    data: 'Qual foi a data? Use DD/MM/AAAA, hoje ou ontem.',
    cartão: 'Qual é o apelido do cartão?',
    parcelas: 'Em quantas parcelas? Escreva, por exemplo, 3x.',
    'nome do cartão': 'Qual é o apelido do cartão?',
    limite: 'Qual é o limite total do cartão?',
    'dia de fechamento': 'Em que dia a fatura fecha?',
    'dia de vencimento': 'Em que dia a fatura vence?',
    'renda ou orçamento mensal': 'Qual é sua renda mensal ou seu orçamento?',
  };
  return questions[field] ?? `Informe ${field}.`;
}

function labelPayment(method?: PaymentMethod): string {
  const labels: Record<PaymentMethod, string> = {
    credit: 'crédito',
    debit: 'débito',
    pix: 'Pix',
    cash: 'dinheiro',
  };
  return method ? labels[method] : 'não informado';
}

const REVIEW_INSTRUCTIONS = [
  'Revise os dados acima.',
  'Para salvar, responda SIM. Para ajustar, responda CORRIGIR. Para desistir, responda CANCELAR.',
];

function preview(command: Command): string {
  if (command.intent === 'record_purchase') {
    const lines = [
      '🧾 Prévia da compra:',
      `• Compra: ${command.description ?? command.merchant ?? 'Compra'}`,
      `• Valor: ${formatBrl(parseCents(command.amount ?? ''))}`,
      `• Pagamento: ${labelPayment(command.paymentMethod)}`,
      `• Categoria: ${purchaseCategoryLabel(command.category, command.description ?? command.merchant ?? '')}`,
      `• Data: ${command.purchaseDate}`,
    ];
    if (command.merchant) lines.push(`• Local: ${command.merchant}`);
    if (command.paymentMethod === 'credit') {
      lines.push(
        `• Cartão: ${command.cardName}`,
        `• Parcelas: ${command.installments}x`,
      );
    }
    return [...lines, '', ...REVIEW_INSTRUCTIONS].join('\n');
  }
  if (command.intent === 'add_card') {
    return [
      '💳 Prévia do cartão:',
      `• Nome: ${command.cardName}`,
      `• Bandeira: ${cardBrandLabel(command.cardBrand)}`,
      `• Limite: ${formatBrl(parseCents(command.cardLimit ?? ''))}`,
      `• Fecha dia ${command.closingDay} e vence dia ${command.dueDay}`,
      '',
      ...REVIEW_INSTRUCTIONS,
    ].join('\n');
  }
  const values = [
    command.monthlyIncome &&
      `• Renda: ${formatBrl(parseCents(command.monthlyIncome, true))}`,
    command.fixedExpenses &&
      `• Gastos fixos: ${formatBrl(parseCents(command.fixedExpenses, true))}`,
    command.savingsGoal &&
      `• Reserva: ${formatBrl(parseCents(command.savingsGoal, true))}`,
    command.monthlyBudget &&
      `• Orçamento: ${formatBrl(parseCents(command.monthlyBudget, true))}`,
  ].filter(Boolean);
  return [
    '⚙️ Prévia da configuração:',
    ...values,
    '',
    ...REVIEW_INSTRUCTIONS,
  ].join('\n');
}

function isPositiveConfirmation(value: string): boolean {
  return /^(?:s|sim|confirmar|confirmo|pode(?:\s+(?:salvar|registrar|confirmar))?|salvar|registre|registrar|ok(?:ay)?|certo|isso|ta)(?:\b|$)/.test(
    value,
  );
}

async function commit(
  userId: string,
  pending: PendingAction,
  source: string,
): Promise<string> {
  const command = pending.command;
  if (command.intent === 'configure_profile') {
    const changes: Parameters<typeof updateProfile>[1] = {};
    if (command.monthlyIncome)
      changes.monthlyIncomeCents = parseCents(command.monthlyIncome, true);
    if (command.fixedExpenses)
      changes.fixedExpensesCents = parseCents(command.fixedExpenses, true);
    if (command.savingsGoal)
      changes.savingsGoalCents = parseCents(command.savingsGoal, true);
    if (command.monthlyBudget)
      changes.monthlyBudgetCents = parseCents(command.monthlyBudget, true);
    await updateProfile(userId, changes);
    return '✅ Perfil financeiro atualizado.';
  }
  if (command.intent === 'add_card') {
    const card = await upsertCard(userId, {
      name: command.cardName ?? '',
      brand: command.cardBrand,
      limitCents: parseCents(command.cardLimit ?? ''),
      closingDay: Number(command.closingDay),
      dueDay: Number(command.dueDay),
    });
    return card.brand === 'unknown'
      ? '✅ Cartão configurado. Não consegui identificar a bandeira automaticamente ainda.'
      : `✅ Cartão configurado com bandeira ${cardBrandLabel(card.brand)}.`;
  }
  if (command.intent === 'record_purchase') {
    const totalCents = parseCents(command.amount ?? '');
    let cardId: string | null = null;
    let installments:
      | Array<{ sequence: number; amountCents: number; dueDate: string }>
      | undefined;
    if (command.paymentMethod === 'credit') {
      const card = await getCardByName(userId, command.cardName ?? '');
      if (!card)
        return 'Não encontrei esse cartão. Configure-o antes de registrar uma compra no crédito.';
      cardId = card.id;
      const firstDue = firstInstallmentDueDate(
        command.purchaseDate ?? referenceDate(),
        card.closingDay,
        card.dueDay,
      );
      installments = splitCents(totalCents, command.installments ?? 1).map(
        (amountCents, index) => ({
          sequence: index + 1,
          amountCents,
          dueDate: addMonths(firstDue, index, card.dueDay),
        }),
      );
    }
    const description = command.description ?? command.merchant ?? 'Compra';
    const result = await createPurchase(userId, {
      description,
      merchant: command.merchant,
      location: command.location,
      category:
        normalizePurchaseCategory(command.category) ??
        classifyPurchaseCategory(`${description} ${command.merchant ?? ''}`),
      totalCents,
      paymentMethod: command.paymentMethod ?? 'pix',
      installmentsCount: command.installments ?? 1,
      cardId,
      purchasedAt: command.purchaseDate ?? referenceDate(),
      source,
      idempotencyKey: `${source}:${pending.originMessageId}`.slice(0, 240),
      installments,
    });
    return result.created
      ? '✅ Compra registrada.'
      : '✅ Essa compra já estava registrada.';
  }
  return 'Não consegui identificar uma alteração para salvar.';
}

async function analyzeCredit(
  userId: string,
  command: Command,
): Promise<string> {
  const priceCents = parseCents(command.amount ?? '');
  const card = await getCardByName(userId, command.cardName ?? '');
  if (!card)
    return 'Não encontrei esse cartão. Configure o cartão antes de fazer a análise.';
  const profile = await getProfile(userId);
  const outstanding = await cardOutstandingCents(userId, card.id);
  const availableBefore = card.limitCents - outstanding;
  const installmentsCount = command.installments ?? 1;
  const firstDue = firstInstallmentDueDate(
    command.purchaseDate ?? referenceDate(),
    card.closingDay,
    card.dueDay,
  );
  const monthlyImpact = splitCents(priceCents, installmentsCount).map(
    (amountCents, index) => ({
      amountCents,
      dueDate: addMonths(firstDue, index, card.dueDay),
    }),
  );
  const budget = effectiveMonthlyBudget(profile);
  const periods = await Promise.all(
    monthlyImpact.map(async (impact) => ({
      ...impact,
      period: formatPeriod(impact.dueDate),
      existingCents: await spendingForPeriod(
        userId,
        formatPeriod(impact.dueDate),
      ),
    })),
  );
  const overBudget =
    budget > 0 &&
    periods.some(
      (period) => period.existingCents + period.amountCents > budget,
    );
  const utilizationAfter =
    card.limitCents > 0
      ? ((outstanding + priceCents) * 100) / card.limitCents
      : 100;
  const decision =
    priceCents > availableBefore
      ? 'BLOCKED_LIMIT'
      : overBudget
        ? 'NOT_RECOMMENDED'
        : budget === 0 ||
            utilizationAfter >= profile.alertCreditUtilizationPercent
          ? 'CAUTION'
          : 'OK';
  const message = {
    OK: '✅ Pelos dados registrados, a compra cabe no limite e no orçamento.',
    CAUTION: '⚠️ A compra cabe no limite, mas merece cautela.',
    NOT_RECOMMENDED:
      '⚠️ Cabe no limite, mas não recomendo pelo orçamento mensal.',
    BLOCKED_LIMIT: '❌ Não cabe no limite disponível registrado.',
  }[decision];
  const result = {
    decision,
    availableBeforeCents: availableBefore,
    availableAfterCents: availableBefore - priceCents,
    utilizationAfterPercent: Math.round(utilizationAfter * 10) / 10,
    budgetCents: budget,
    periods,
  };
  await saveAnalysis(
    userId,
    card.id,
    command as Record<string, unknown>,
    result,
  );
  const first = monthlyImpact[0];
  return [
    message,
    `Valor: ${formatBrl(priceCents)} em ${installmentsCount}x.`,
    `Limite antes: ${formatBrl(availableBefore)}.`,
    `Limite depois: ${formatBrl(availableBefore - priceCents)}.`,
    `1ª parcela: ${formatBrl(first.amountCents)} em ${first.dueDate.split('-').reverse().join('/')}.`,
    budget === 0
      ? 'Configure seu orçamento mensal para eu avaliar a capacidade de pagamento.'
      : overBudget
        ? 'Alguma parcela ultrapassa o orçamento mensal registrado.'
        : `Uso projetado do limite: ${Math.round(utilizationAfter * 10) / 10}%.`,
    'A operadora ainda pode aprovar ou negar a transação.',
  ].join('\n');
}

async function summary(userId: string): Promise<string> {
  const profile = await getProfile(userId);
  const today = referenceDate();
  const budget = effectiveMonthlyBudget(profile);
  const spending = await spendingForPeriod(userId, formatPeriod(today));
  return [
    `📊 Resumo de ${today.slice(5, 7)}/${today.slice(0, 4)}`,
    `Orçamento: ${budget ? formatBrl(budget) : 'ainda não configurado'}`,
    `Gasto registrado: ${formatBrl(spending)}`,
    budget
      ? `Saldo do orçamento: ${formatBrl(budget - spending)}`
      : 'Configure renda e gastos para calcular o orçamento.',
  ].join('\n');
}

async function finish(input: MessageInput, reply: string): Promise<string> {
  await saveInteraction(input.user.id, {
    source: input.source,
    sourceMessageId: input.messageId,
    userText: input.text,
    reply,
  });
  return reply;
}

export async function processFinanceMessage(
  input: MessageInput,
): Promise<string> {
  const cached = await getCachedReply(
    input.user.id,
    input.source,
    input.messageId,
  );
  if (cached) return cached;
  const text = input.text.trim();
  if (!text) return 'Digite uma mensagem para eu ajudar.';
  if (hasSensitiveData(text)) return finish(input, SENSITIVE_WARNING);

  const normalized = normalizeText(text);
  const session = await getSession(input.user.id);
  if (
    normalized === 'cancelar' ||
    normalized === 'cancela' ||
    normalized === 'nao' ||
    normalized === 'não'
  ) {
    if (session.state !== 'idle') {
      await clearSession(input.user.id);
      return finish(
        input,
        'Tudo bem. O rascunho foi cancelado e nada foi registrado.',
      );
    }
    return finish(input, 'Não há um rascunho para cancelar.');
  }

  if (session.state === 'awaiting_confirmation' && session.pending) {
    const pending = session.pending as unknown as PendingAction;
    if (/^(corrigir|alterar|editar)\b/.test(normalized)) {
      await saveSession(
        input.user.id,
        'collecting_details',
        pending as unknown as Record<string, unknown>,
      );
      return finish(
        input,
        'Certo. Envie apenas o dado corrigido, por exemplo: valor R$ 25,90.',
      );
    }
    if (isPositiveConfirmation(normalized)) {
      try {
        const reply = await commit(input.user.id, pending, input.source);
        await clearSession(input.user.id);
        return finish(input, reply);
      } catch (error) {
        return finish(
          input,
          `Não consegui salvar: ${error instanceof Error ? error.message : 'tente novamente'}.`,
        );
      }
    }
    return finish(
      input,
      'Há uma revisão pendente. Responda SIM para salvar, CORRIGIR para ajustar algum dado ou CANCELAR para desistir.',
    );
  }

  const today = referenceDate();
  const fallback = fallbackExtract(text, today);
  const extracted = await extractWithAi(text, input.user.id, fallback);
  const pendingCommand =
    session.state === 'collecting_details' && session.pending
      ? (session.pending as unknown as PendingAction).command
      : null;
  const startsNewAction = Boolean(
    pendingCommand && isNewFinancialAction(fallback.intent),
  );
  if (startsNewAction) await clearSession(input.user.id);
  const command = pendingCommand && !startsNewAction
    ? mergeCommand(pendingCommand, {
        ...enrichPendingCardAlias(pendingCommand, text, extracted),
        intent: 'unknown',
      })
    : extracted;

  if (command.intent === 'greeting')
    return finish(
      input,
      'Olá! Eu sou a Eloá. Envie uma compra ou digite AJUDA para ver exemplos.',
    );
  if (command.intent === 'help') return finish(input, HELP_TEXT);
  if (command.intent === 'monthly_summary')
    return finish(input, await summary(input.user.id));
  if (command.intent === 'list_purchases')
    return finish(
      input,
      'Abra a seção “Compras recentes” para ver seus últimos registros.',
    );
  if (command.intent === 'confirm')
    return finish(input, 'Não há um rascunho pronto para confirmar.');
  if (command.intent === 'cancel')
    return finish(input, 'Não há um rascunho para cancelar.');
  if (command.intent === 'unknown')
    return finish(
      input,
      'Não entendi com segurança. Digite AJUDA para ver exemplos.',
    );

  if (
    !command.purchaseDate &&
    (command.intent === 'record_purchase' ||
      command.intent === 'analyze_credit')
  ) {
    command.purchaseDate = today;
  }
  const missing = missingFields(command);
  if (missing.length) {
    const pending: PendingAction = {
      command,
      originMessageId: input.messageId,
      preparedResponse: questionFor(missing[0]),
    };
    await saveSession(
      input.user.id,
      'collecting_details',
      pending as unknown as Record<string, unknown>,
    );
    return finish(input, pending.preparedResponse);
  }
  if (
    command.intent === 'add_card' &&
    command.cardName &&
    (!command.cardBrand || command.cardBrand === 'unknown')
  ) {
    command.cardBrand = (
      await resolveCardBrand(command.cardName, input.user.id)
    ).brand;
  }
  if (command.intent === 'analyze_credit') {
    try {
      return finish(input, await analyzeCredit(input.user.id, command));
    } catch (error) {
      return finish(
        input,
        `Não consegui analisar: ${error instanceof Error ? error.message : 'confira os dados e tente novamente'}.`,
      );
    }
  }
  try {
    const pending: PendingAction = {
      command,
      originMessageId: input.messageId,
      preparedResponse: preview(command),
    };
    await saveSession(
      input.user.id,
      'awaiting_confirmation',
      pending as unknown as Record<string, unknown>,
    );
    return finish(input, pending.preparedResponse);
  } catch (error) {
    return finish(
      input,
      `Confira o valor ou a data: ${error instanceof Error ? error.message : 'dados inválidos'}.`,
    );
  }
}
