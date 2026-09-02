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
  deactivateCard,
  effectiveMonthlyBudget,
  getCachedReply,
  getCardByName,
  getProfile,
  getSession,
  listCards,
  listPurchases,
  recordCardPayment,
  saveAnalysis,
  saveInteraction,
  saveSession,
  spendingForPeriod,
  updateCard,
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
  | 'my_data'
  | 'update_data'
  | 'update_card'
  | 'delete_card'
  | 'confirm'
  | 'cancel'
  | 'unknown';

type PaymentMethod = 'credit' | 'debit' | 'pix' | 'cash';

type Command = {
  intent: Intent;
  description?: string;
  quantity?: number;
  quantityUnit?: string;
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
  location?: string;
  source: 'panel' | 'whatsapp';
  messageId: string;
};

const HELP_TEXT = [
  '✨ COMO POSSO AJUDAR',
  '',
  '🧾 COMPRAS',
  '• “Comprei 12 bananas por R$ 23 no Pix”',
  '• “Paguei R$ 40 por uma consulta na UPA no Pix”',
  '• Para informar o local, escreva na mesma mensagem: “local: Feira do Centro”.',
  '• Eu separo produto, quantidade, pagamento, estabelecimento, local e categoria.',
  '',
  '💳 CARTÕES E FATURAS',
  '• “Cartão Nubank, limite R$ 3.000, fecha dia 5 e vence dia 12”',
  '• “Paguei R$ 300 da fatura do Nubank”',
  '• “Posso comprar um notebook de R$ 2.500 no Nubank em 10x?”',
  '• “Excluir cartão Nubank”',
  '',
  '📁 DADOS E CORREÇÕES',
  '• MEUS DADOS — mostra cartões, bandeiras, limites e gastos.',
  '• ATUALIZAR DADOS — mostra o que pode ser corrigido.',
  '• “Corrigir bandeira do cartão Mercado Pago para Visa”.',
  '• RESUMO ou ÚLTIMAS COMPRAS — acompanha o mês.',
  '',
  '🏷️ CATEGORIAS',
  'Reconheço alimentação, saúde, casa, roupas, transporte, moradia, contas e serviços, tecnologia, educação, lazer, cuidados pessoais, pets, trabalho, assinaturas, presentes, impostos e geral.',
  '',
  '✅ REVISÃO',
  'Nada é salvo sem revisão. Responda SIM para confirmar, CORRIGIR para ajustar ou CANCELAR para desistir.',
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
  'my_data',
  'update_data',
  'update_card',
  'delete_card',
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
  const [year, month] = purchaseDate.split('-').map(Number);
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
    .replace(/(?<=\d)\s+(?=\d)/gu, '')
    .trim();
  return /^\d[\d.,]*$/.test(number) ? `R$ ${number}` : undefined;
}

function moneyFromText(text: string, label?: RegExp): string | undefined {
  const source = label ? text.match(label)?.[1] : undefined;
  if (source) return canonicalMoney(source);

  const reaisAndCents = text.match(
    /\b(\d+)\s+reais?\s+e\s+(\d{1,2})\s+centavos?\b/iu,
  );
  if (reaisAndCents) {
    return canonicalMoney(`${reaisAndCents[1]},${reaisAndCents[2].padStart(2, '0')}`);
  }

  const thousands = text.match(/\b(\d{1,3})\s+mil\s+reais?\b/iu)?.[1];
  if (thousands) return canonicalMoney(`${thousands}000`);

  const prefixed = text.match(
    /(?:^|[^\p{L}\d])r\s*(?:\$|s)\s*(\d(?:[\d.,]|\s(?=\d))*)/iu,
  )?.[1];
  if (prefixed) return canonicalMoney(prefixed);

  const suffixed = text.match(/\b(\d(?:[\d.,]|\s(?=\d))*)\s+(?:reais?|rs)\b/iu)?.[1];
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

const writtenQuantities: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
};

const quantityToken = String.raw`(?:\d{1,4}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte)`;

function parseQuantityToken(value: string): number | undefined {
  const normalized = normalizeText(value);
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 9_999) return numeric;
  const written = writtenQuantities[normalized];
  return written && written > 0 ? written : undefined;
}

function totalFromQuantityAndUnitPrice(text: string): string | undefined {
  const match = text.match(
    new RegExp(
      String.raw`\b(?:comprei|paguei|gastei)\s+(${quantityToken})\s+(?:[\p{L}][\p{L}\d-]*\s*){1,6}?(?:por|a)\s+((?:r\s*(?:\$|s)\s*)?\d(?:[\d.,]|\s(?=\d))*(?:\s+reais?)?)\s+(?:cada|cada\s+um(?:a)?|a\s+unidade)\b`,
      'iu',
    ),
  );
  if (!match) return undefined;
  const quantity = parseQuantityToken(match[1]);
  const unit = canonicalMoney(match[2]);
  if (!quantity || !unit) return undefined;
  try {
    return formatBrl(parseCents(unit) * quantity);
  } catch {
    return undefined;
  }
}

function parseDateFromText(text: string, fallback: string): string {
  return explicitDateFromText(text) ?? fallback;
}

function paymentMethodFromText(normalized: string): PaymentMethod | undefined {
  if (/\b(pix)\b/.test(normalized)) return 'pix';
  if (/\b(?:debito|cartao\s+(?:de\s+)?debito)\b/.test(normalized))
    return 'debit';
  if (/\b(dinheiro|especie)\b/.test(normalized)) return 'cash';
  if (/\b(?:credito|credtio|cartao\s+(?:de\s+)?credito|(?:no|na|com)\s+cartao)\b/.test(normalized))
    return 'credit';
  return undefined;
}

function cleanCardName(value: unknown): string | undefined {
  const cardName = cleanText(value, 80)
    ?.replace(
      /^(?:cart[aã]o\s+)?(?:de\s+)?cr[eé]d(?:ito|tio)(?:\s+(?:no|na))?\s*/iu,
      '',
    )
    .replace(/^(?:no|na|do|da|e)\s+/iu, '')
    .replace(
      /\s+(?:visa|mastercard|master\s*card|elo|hipercard|american\s+express|amex|diners(?:\s+club)?|discover|jcb|aura|cabal|sorocred)$/iu,
      '',
    )
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

function cardNameFromCorrectionText(text: string): string | undefined {
  const patterns = [
    /(?:bandeira|limite|fecha|fechamento|vence|vencimento)\s+(?:do|da)\s+(?:cart[aã]o\s+)?(.+?)(?=\s+(?:para|é|eh|=|limite|fecha|vence|vencimento|fechamento)\b|[,.!?]|$)/iu,
    /(?:do|da|no|na)\s+cart[aã]o\s+(.+?)(?=\s+(?:para|é|eh|=|limite|fecha|vence|vencimento|fechamento)\b|[,.!?]|$)/iu,
  ];
  for (const pattern of patterns) {
    const cardName = cleanCardName(text.match(pattern)?.[1]);
    if (cardName) return cardName;
  }
  return cardNameFromText(text);
}

function cardNameFromInvoiceText(text: string): string | undefined {
  const patterns = [
    /\bfatura\s+(?:do|da)\s+(?:cart[aã]o\s+)?(.+?)(?=\s+(?:por|de|em)\s+(?:r\s*(?:\$|s)\s*)?\d|\s+(?:hoje|ontem|anteontem)\b|[,.!?]|$)/iu,
    /\b(?:do|da)\s+fatura\s+(?:do|da)\s+(?:cart[aã]o\s+)?(.+?)(?=\s+(?:por|de|em)\s+(?:r\s*(?:\$|s)\s*)?\d|\s+(?:hoje|ontem|anteontem)\b|[,.!?]|$)/iu,
  ];
  for (const pattern of patterns) {
    const cardName = cleanCardName(text.match(pattern)?.[1]);
    if (cardName) return cardName;
  }
  return undefined;
}

function cardNameFromDeletionText(text: string): string | undefined {
  const match = text.match(
    /\b(?:excluir|remover|apagar|deletar|tirar)\s+(?:o\s+)?(?:cart[aã]o\s+)?(.+?)(?=\s+(?:da|do|de)\s+(?:lista|painel|cadastro)\b|[,.!?]|$)/iu,
  );
  return cleanCardName(match?.[1]);
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

type PurchaseDetails = {
  description?: string;
  quantity?: number;
  quantityUnit?: string;
};

function normalizedQuantityUnit(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeText(value).replace(/\.$/, '');
  const labels: Record<string, string> = {
    un: 'un.',
    und: 'un.',
    unidade: 'un.',
    unidades: 'un.',
    saco: 'sacos',
    sacos: 'sacos',
    pacote: 'pacotes',
    pacotes: 'pacotes',
    caixa: 'caixas',
    caixas: 'caixas',
    garrafa: 'garrafas',
    garrafas: 'garrafas',
    lata: 'latas',
    latas: 'latas',
    litro: 'litros',
    litros: 'litros',
    l: 'litros',
    quilo: 'kg',
    quilos: 'kg',
    kg: 'kg',
    grama: 'g',
    gramas: 'g',
    g: 'g',
    par: 'pares',
    pares: 'pares',
    pote: 'potes',
    potes: 'potes',
    frasco: 'frascos',
    frascos: 'frascos',
    metro: 'metros',
    metros: 'metros',
    m: 'metros',
  };
  return labels[normalized];
}

function purchaseDetailsFromDescription(value: unknown): PurchaseDetails {
  const cleaned = cleanPurchaseDescription(value);
  if (!cleaned) return {};
  const match = cleaned.match(
    new RegExp(String.raw`^(${quantityToken})\s+(.+)$`, 'iu'),
  );
  if (!match) return { description: cleaned };
  const quantity = parseQuantityToken(match[1]);
  if (!quantity) return { description: cleaned };

  let remaining = match[2].trim();
  const unitMatch = remaining.match(
    /^(un(?:idade|idades)?|und|sacos?|pacotes?|caixas?|garrafas?|latas?|litros?|l|quilos?|kg|gramas?|g|pares?|potes?|frascos?|metros?|m)\b\s*/iu,
  );
  const quantityUnit = normalizedQuantityUnit(unitMatch?.[1]);
  if (unitMatch) remaining = remaining.slice(unitMatch[0].length);
  remaining = remaining.replace(/^de\s+/iu, '').trim();
  const description = cleanPurchaseDescription(remaining);
  return description
    ? { description, quantity, quantityUnit }
    : { description: cleaned };
}

function rawPurchaseDescriptionFromText(text: string): string | undefined {
  const amount = String.raw`(?:\d+\s+reais?\s+e\s+\d{1,2}\s+centavos?|(?:r\s*(?:\$|s)\s*)?\d[\d.,]*(?:\s+reais?)?)`;
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

function purchaseDetailsFromText(text: string): PurchaseDetails {
  const rawDescription = rawPurchaseDescriptionFromText(text);
  const merchant = merchantFromText(text);
  if (!rawDescription || !merchant) {
    return purchaseDetailsFromDescription(rawDescription);
  }
  const escapedMerchant = merchant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const productOnly = rawDescription.replace(
    new RegExp(String.raw`\s+(?:na|no|em)\s+${escapedMerchant}$`, 'iu'),
    '',
  );
  return purchaseDetailsFromDescription(productOnly);
}

function categoryFromPurchaseDetails(
  description: string | undefined,
  merchant: string | undefined,
) {
  const categoryFromDescription = classifyPurchaseCategory(description ?? '');
  return categoryFromDescription !== 'geral'
    ? categoryFromDescription
    : classifyPurchaseCategory(merchant ?? '');
}

function descriptionFromText(text: string): string | undefined {
  return purchaseDetailsFromText(text).description;
}

function cleanPurchaseLocation(value: unknown): string | undefined {
  const location = cleanText(value, 120)
    ?.replace(/^(?:local|localizacao|localização)\s*[:=-]\s*/iu, '')
    .trim();
  if (
    !location ||
    /^(?:nao informado|não informado|desconhecido|local desconhecido|sem local|n\/a|na)$/iu.test(
      location,
    )
  ) {
    return undefined;
  }
  return location;
}

function locationFromText(text: string): string | undefined {
  const match = text.match(
    /\b(?:local|localizacao|localização|lugar)\s*[:=-]\s*(.+?)(?=[.!?]|$)/iu,
  );
  return cleanPurchaseLocation(match?.[1]);
}

function merchantFromText(text: string): string | undefined {
  const match = text.match(
    /\b(?:na|no|em)\s+([\p{L}][\p{L}\d .&'-]{1,70}?)(?=\s+(?:no|na|com|por|de)\s+(?:pix|cr[eé]dito|d[eé]bito|dinheiro|R\$)|[,.!?]|$)/iu,
  );
  const merchant = cleanText(match?.[1], 100);
  if (
    !merchant ||
    /^(pix|cr[eé]dito|d[eé]bito|dinheiro|cart[aã]o|hoje|ontem)(\s|$)/i.test(merchant)
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
      ? /(?:fecha|fechamento)\b[^\d]{0,60}?(?:dia\s*)?(\d{1,2})/i
      : /(?:vence|vencimento)\b[^\d]{0,60}?(?:dia\s*)?(\d{1,2})/i;
  const value = Number(text.match(pattern)?.[1]);
  return value >= 1 && value <= 31 ? value : undefined;
}

function amountAfterKeyword(text: string, keyword: string): string | undefined {
  const match = text.match(
    new RegExp(
      String.raw`\b(?:${keyword})\b[^\d]{0,80}((?:r\s*(?:\$|s)\s*)?\d(?:[\d.,]|\s(?=\d))*(?:\s+reais?)?)`,
      'iu',
    ),
  );
  return match?.[1] ? canonicalMoney(match[1]) : undefined;
}

function fallbackExtract(text: string, today: string): Command {
  const corrected = correctFinanceText(text);
  const normalized = normalizeText(corrected);
  const date = parseDateFromText(corrected, today);
  const hasFinancialAction = /\b(?:comprei|paguei|gastei|cartao|cartão|renda|orcamento|orçamento)\b/.test(normalized);
  if (/^(?:o+[iy]+|ol+a+|bom dia|boa tarde|boa noite)\b/.test(normalized) && !hasFinancialAction)
    return { intent: 'greeting' };
  if (/\b(?:ajud+a+|ajd|exemplos|o que voce faz|como funciona)\b/.test(normalized) && !hasFinancialAction)
    return { intent: 'help' };
  if (/^(resumo|meu resumo|como estou)\b/.test(normalized))
    return { intent: 'monthly_summary' };
  if (/^(?:meus?\s+dad+os?|ver\s+(?:meus?\s+)?dad+os?|dados\s+(?:salvos|cadastrados)|minhas?\s+informacoes|(?:quais|ver)\s+(?:meus?\s+)?cartoes)\b/.test(normalized))
    return { intent: 'my_data' };
  if (
    /^(?:atualizar|atualiza|editar|corrigir|corrige|alterar|mudar|quero\s+(?:mudar|alterar|atualizar))\s+(?:os?\s+)?(?:meus?\s+)?dados\b/.test(
      normalized,
    ) &&
    !/\b(?:cartao|bandeira|limite|fechamento|vencimento)\b/.test(normalized)
  )
    return { intent: 'update_data' };
  if (/\b(ultimas compras|minhas compras|listar compras)\b/.test(normalized))
    return { intent: 'list_purchases' };
  if (/^(confirmar|confirmo)\b/.test(normalized)) return { intent: 'confirm' };
  if (/^(cancelar|cancela|nao|não)\b/.test(normalized))
    return { intent: 'cancel' };

  const isCardDeletion =
    /\b(?:excluir|remover|apagar|deletar|tirar)\b/.test(normalized) &&
    /\b(?:cartao|card)\b/.test(normalized);
  if (isCardDeletion) {
    return {
      intent: 'delete_card',
      cardName: cardNameFromDeletionText(corrected),
    };
  }

  const isInvoicePayment =
    /\b(?:pagar|paguei|quitar|quitei)\b/.test(normalized) &&
    /\bfatura\b/.test(normalized);
  if (isInvoicePayment) {
    return {
      intent: 'record_card_payment',
      amount:
        totalFromQuantityAndUnitPrice(corrected) ??
        moneyFromText(corrected) ??
        amountAfterKeyword(corrected, 'fatura|paguei|quitei'),
      cardName: cardNameFromInvoiceText(corrected),
      purchaseDate: date,
    };
  }

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

  const isCardCorrection =
    /\b(?:corrigir|corrige|atualizar|atualize|alterar|mudar|editar)\b/.test(normalized) &&
    /\b(?:cartao|cartão|bandeira|limite|fecha|fechamento|vence|vencimento)\b/.test(normalized);
  if (isCardCorrection) {
    return {
      intent: 'update_card',
      cardName: cardNameFromCorrectionText(corrected),
      cardBrand: normalizeCardBrand(corrected),
      cardLimit: amountAfterKeyword(corrected, 'limite'),
      closingDay: dayFromText(corrected, 'closing'),
      dueDay: dayFromText(corrected, 'due'),
    };
  }

  if (
    /\b(cartao|cartão)\b/.test(normalized) &&
    /\b(limite|fecha|vence)\b/.test(normalized)
  ) {
    const name = cleanCardName(
      corrected.match(
        /cart[aã]o\s+([^,]+?)(?=,|\s+limite|\s+fecha|\s+vence|$)/i,
      )?.[1],
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
    totalFromQuantityAndUnitPrice(corrected) ??
    moneyFromText(corrected) ??
    amountAfterKeyword(corrected, 'por|valor|de') ??
    amountNearPayment(corrected);
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
  const purchaseDetails = purchaseDetailsFromText(corrected);
  const description = purchaseDetails.description;
  const merchant = merchantFromText(corrected);
  const location = locationFromText(corrected);
  const category = categoryFromPurchaseDetails(description, merchant);
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
      quantity: purchaseDetails.quantity,
      quantityUnit: purchaseDetails.quantityUnit,
      merchant,
      location,
      category,
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
  const details = purchaseDetailsFromDescription(item.description);
  const quantity = Number(item.quantity);
  const quantityUnit = normalizedQuantityUnit(cleanText(item.quantityUnit, 40));
  return {
    intent,
    description: details.description,
    quantity:
      Number.isInteger(quantity) && quantity >= 1 && quantity <= 9_999
        ? quantity
        : details.quantity,
    quantityUnit: quantityUnit ?? details.quantityUnit,
    amount: cleanText(item.amount, 64),
    merchant: cleanText(item.merchant),
    location: cleanPurchaseLocation(item.location),
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
    } else if (key === 'cardBrand' && value === 'unknown') {
      continue;
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
    'update_card',
    'delete_card',
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
  if (fallback.description) merged.description = fallback.description;
  if (fallback.quantity) merged.quantity = fallback.quantity;
  if (fallback.quantityUnit) merged.quantityUnit = fallback.quantityUnit;
  if (fallback.location) merged.location = fallback.location;
  if (fallback.paymentMethod && fallback.paymentMethod !== 'credit') {
    merged.cardName = undefined;
    merged.installments = 1;
  }
  return merged;
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
      'quantity',
      'quantityUnit',
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
      quantity: { type: ['integer', 'null'] },
      quantityUnit: { type: ['string', 'null'] },
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
          'Os comandos “meus dados” e “atualizar dados” usam os intents my_data e update_data. ' +
          'Para “corrigir bandeira do cartão Mercado Pago para Visa”, use update_card, cardName Mercado Pago e cardBrand visa. ' +
          'Para “excluir cartão Nubank”, use delete_card e cardName Nubank. ' +
          'Para “paguei R$ 300 da fatura do Nubank”, use record_card_payment, cardName Nubank e amount R$ 300; isso nunca é uma compra nova. ' +
          'Se a pessoa informar uma bandeira de cartão, use cardBrand; não invente uma bandeira ausente. ' +
          'Qualquer alimento, bebida ou refeição deve usar a categoria alimentacao, mesmo com variações de escrita. ' +
          'Para compras, description deve conter apenas o produto, sem quantidade, preço, forma de pagamento, estabelecimento ou local. quantity e quantityUnit são campos separados e só devem ser preenchidos quando a pessoa informou uma quantidade. ' +
          'Só use location quando a pessoa informou explicitamente o local; nunca use “desconhecido” ou “não informado”. merchant é o estabelecimento, não o local. ' +
          'Classifique compras em alimentação, saúde, casa, roupas, transporte, moradia, contas e serviços, tecnologia, educação, lazer, cuidados pessoais, pets, assinaturas, trabalho, presentes e doações, impostos e taxas ou geral. ' +
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
  if (command.intent === 'update_card') {
    const hasChange =
      (command.cardBrand && command.cardBrand !== 'unknown') ||
      command.cardLimit ||
      command.closingDay ||
      command.dueDay;
    return [
      !command.cardName && 'nome do cartão',
      !hasChange && 'dado a corrigir',
    ].filter(Boolean) as string[];
  }
  if (command.intent === 'delete_card') {
    return !command.cardName ? ['nome do cartão'] : [];
  }
  if (command.intent === 'record_card_payment') {
    return [
      !command.amount && 'valor do pagamento',
      !command.cardName && 'cartão',
    ].filter(Boolean) as string[];
  }
  if (command.intent === 'record_purchase') {
    const fields = [
      !command.description && 'produto',
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
    produto: 'Qual foi o produto ou serviço comprado? Ex.: bananas ou consulta médica.',
    valor: 'Qual foi o valor? Ex.: R$ 42,90.',
    'valor do pagamento': 'Qual foi o valor pago na fatura? Ex.: R$ 250,00.',
    'forma de pagamento': 'Como pagou: crédito, débito, Pix ou dinheiro?',
    data: 'Qual foi a data? Use DD/MM/AAAA, hoje ou ontem.',
    cartão: 'Qual é o apelido do cartão?',
    parcelas: 'Em quantas parcelas? Escreva, por exemplo, 3x.',
    'nome do cartão': 'Qual é o apelido do cartão?',
    limite: 'Qual é o limite total do cartão?',
    'dia de fechamento': 'Em que dia a fatura fecha?',
    'dia de vencimento': 'Em que dia a fatura vence?',
    'renda ou orçamento mensal': 'Qual é sua renda mensal ou seu orçamento?',
    'dado a corrigir': 'O que deseja corrigir: bandeira, limite, dia de fechamento ou vencimento?',
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
      `• Produto: ${command.description ?? 'Compra'}`,
      `• Valor: ${formatBrl(parseCents(command.amount ?? ''))}`,
      `• Pagamento: ${labelPayment(command.paymentMethod)}`,
      `• Categoria: ${purchaseCategoryLabel(command.category, command.description ?? command.merchant ?? '')}`,
      `• Data: ${command.purchaseDate}`,
    ];
    if (command.quantity) {
      lines.splice(2, 0, `• Quantidade: ${command.quantity}${command.quantityUnit ? ` ${command.quantityUnit}` : ' un.'}`);
    }
    if (command.merchant) lines.push(`• Estabelecimento: ${command.merchant}`);
    if (command.location) lines.push(`• Local: ${command.location}`);
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
  if (command.intent === 'record_card_payment') {
    return [
      '💸 Revisão do pagamento da fatura:',
      `• Cartão: ${command.cardName}`,
      `• Valor pago: ${formatBrl(parseCents(command.amount ?? ''))}`,
      `• Data: ${command.purchaseDate}`,
      '',
      ...REVIEW_INSTRUCTIONS,
    ].join('\n');
  }
  if (command.intent === 'update_card') {
    const changes = [
      command.cardBrand && command.cardBrand !== 'unknown'
        ? `• Bandeira: ${cardBrandLabel(command.cardBrand)}`
        : null,
      command.cardLimit
        ? `• Limite: ${formatBrl(parseCents(command.cardLimit))}`
        : null,
      command.closingDay ? `• Fecha dia: ${command.closingDay}` : null,
      command.dueDay ? `• Vence dia: ${command.dueDay}` : null,
    ].filter(Boolean);
    return [
      `✏️ Revisão do cartão ${command.cardName}:`,
      ...changes,
      '',
      ...REVIEW_INSTRUCTIONS,
    ].join('\n');
  }
  if (command.intent === 'delete_card') {
    return [
      '🗑️ Revisão da exclusão do cartão:',
      `• Cartão: ${command.cardName}`,
      '• As compras anteriores serão preservadas no seu histórico.',
      '• Não excluo cartões com fatura em aberto.',
      '',
      'Para remover o cartão da sua lista, responda SIM. Para desistir, responda CANCELAR.',
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
  return /^(?:s+|s+i+m+|confirmar|confirmo|confirmado|pode(?:\s+(?:salvar|registrar|confirmar))?|salvar|registre|registrar|ok(?:ay)?|certo|isso|ta|beleza|blz|fechado)(?:\b|$)/.test(
    value,
  );
}

function isCancellation(value: string): boolean {
  return /^(?:cancel(?:ar|a|e)?|cancela(?:\s+isso)?|nao(?:\s+quero)?|desist(?:ir|o)|pare|parar)(?:\b|[.!?]|$)/.test(
    value,
  );
}

function isCorrectionRequest(value: string): boolean {
  return /^(?:corrig(?:ir|e|a)|alter(?:ar|e)|edit(?:ar|e)|atualiz(?:ar|e)|mud(?:ar|e)|(?:quero\s+)?ajustar)(?:\b|$)/.test(
    value,
  );
}

function explicitDateFromText(text: string): string | undefined {
  const normalized = normalizeText(text);
  const today = referenceDate();
  if (/\bhoje\b/.test(normalized)) return today;
  if (/\bontem\b/.test(normalized)) return addDays(today, -1);
  if (/\banteontem\b/.test(normalized)) return addDays(today, -2);
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return clampDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) === candidate
      ? candidate
      : undefined;
  }
  const br = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (br) {
    const candidate = clampDate(Number(br[3]), Number(br[2]), Number(br[1]));
    return candidate.slice(8, 10) === String(Number(br[1])).padStart(2, '0') &&
      candidate.slice(5, 7) === String(Number(br[2])).padStart(2, '0')
      ? candidate
      : undefined;
  }
  return undefined;
}

function followUpDetails(
  text: string,
  pending: Command,
): Command {
  const corrected = correctFinanceText(text);
  const normalized = normalizeText(corrected);
  const explicitDate = explicitDateFromText(corrected);
  const installments = Number(
    corrected.match(/\b(\d{1,2})\s*(?:x|vez(?:es)?|parcelas?)\b/iu)?.[1],
  );
  const bareDay = /^\s*(\d{1,2})\s*$/.test(corrected)
    ? Number(corrected.trim())
    : undefined;
  const pendingFields = missingFields(pending);
  const purchaseDetails = pendingFields.includes('produto')
    ? purchaseDetailsFromText(corrected)
    : {};
  const inferredCardName = pendingFields.includes('nome do cartão') || pendingFields.includes('cartão')
    ? cardNameFromCorrectionText(corrected) ??
      cardNameFromText(corrected) ??
      cleanCardName(corrected)
    : undefined;
  return {
    intent: 'unknown',
    amount:
      moneyFromText(corrected) ??
      amountAfterKeyword(corrected, 'valor|paguei|quitei') ??
      undefined,
    description: purchaseDetails.description,
    quantity: purchaseDetails.quantity,
    quantityUnit: purchaseDetails.quantityUnit,
    paymentMethod: paymentMethodFromText(normalized),
    installments:
      Number.isInteger(installments) && installments >= 1 && installments <= 48
        ? installments
        : undefined,
    cardName: inferredCardName,
    cardBrand: normalizeCardBrand(corrected),
    cardLimit: amountAfterKeyword(corrected, 'limite'),
    closingDay:
      dayFromText(corrected, 'closing') ??
      (pendingFields.includes('dia de fechamento') ? bareDay : undefined),
    dueDay:
      dayFromText(corrected, 'due') ??
      (pendingFields.includes('dia de vencimento') ? bareDay : undefined),
    purchaseDate: explicitDate,
    monthlyIncome: amountAfterKeyword(corrected, 'renda|salario|salário'),
    fixedExpenses: amountAfterKeyword(corrected, 'gastos? fixos?'),
    savingsGoal: amountAfterKeyword(corrected, 'reserva|poupanca|poupança'),
    monthlyBudget: amountAfterKeyword(corrected, 'orcamento|orçamento'),
  };
}

function hasCompleteNewAction(command: Command): boolean {
  if (command.intent === 'configure_profile') {
    return Boolean(
      command.monthlyIncome ||
        command.fixedExpenses ||
        command.savingsGoal ||
        command.monthlyBudget,
    );
  }
  if (command.intent === 'add_card') {
    return Boolean(
      command.cardName &&
        command.cardLimit &&
        command.closingDay &&
        command.dueDay,
    );
  }
  if (command.intent === 'record_purchase') {
    return Boolean(
      command.description &&
      command.amount &&
        command.paymentMethod &&
        (command.paymentMethod !== 'credit' || command.cardName),
    );
  }
  if (command.intent === 'analyze_credit') {
    return Boolean(command.amount && command.cardName && command.installments);
  }
  if (command.intent === 'record_card_payment') {
    return Boolean(command.amount && command.cardName);
  }
  if (command.intent === 'delete_card') {
    return Boolean(command.cardName);
  }
  if (command.intent === 'update_card') {
    return Boolean(
      command.cardName &&
        ((command.cardBrand && command.cardBrand !== 'unknown') ||
          command.cardLimit ||
          command.closingDay ||
          command.dueDay),
    );
  }
  return false;
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
  if (command.intent === 'update_card') {
    const card = await getCardByName(userId, command.cardName ?? '');
    if (!card) return 'Não encontrei esse cartão. Digite MEUS DADOS para conferir o nome salvo.';
    const updated = await updateCard(userId, card.id, {
      brand: command.cardBrand,
      limitCents: command.cardLimit ? parseCents(command.cardLimit) : undefined,
      closingDay: command.closingDay,
      dueDay: command.dueDay,
    });
    if (!updated) return 'Não consegui atualizar esse cartão agora.';
    return `✅ Dados do cartão ${updated.name} atualizados. Bandeira: ${cardBrandLabel(updated.brand)}.`;
  }
  if (command.intent === 'delete_card') {
    const card = await getCardByName(userId, command.cardName ?? '');
    if (!card) return 'Não encontrei esse cartão. Digite MEUS DADOS para conferir o nome salvo.';
    const result = await deactivateCard(userId, card.id);
    if (result.outstandingCents > 0) {
      return `Não posso excluir ${card.name} porque há ${formatBrl(result.outstandingCents)} em fatura aberta. Registre o pagamento da fatura e tente novamente.`;
    }
    return result.deactivated
      ? `✅ Cartão ${card.name} removido da sua lista. Suas compras anteriores foram preservadas.`
      : 'Não consegui excluir esse cartão agora.';
  }
  if (command.intent === 'record_card_payment') {
    const card = await getCardByName(userId, command.cardName ?? '');
    if (!card)
      return 'Não encontrei esse cartão. Digite MEUS DADOS para conferir o nome salvo.';
    const payment = await recordCardPayment(userId, {
      cardId: card.id,
      amountCents: parseCents(command.amount ?? ''),
      paidAt: command.purchaseDate ?? referenceDate(),
      idempotencyKey: `${source}:${pending.originMessageId}`.slice(0, 240),
    });
    return payment.created
      ? `✅ Pagamento de ${formatBrl(payment.appliedCents)} registrado na fatura do ${card.name}.`
      : '✅ Esse pagamento da fatura já estava registrado.';
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
    const description = command.description ?? 'Compra';
    const automaticCategory = categoryFromPurchaseDetails(
      description,
      command.merchant,
    );
    const requestedCategory = normalizePurchaseCategory(command.category);
    const result = await createPurchase(userId, {
      description,
      quantity: command.quantity,
      quantityUnit: command.quantityUnit,
      merchant: command.merchant,
      location: command.location,
      category:
        automaticCategory !== 'geral'
          ? automaticCategory
          : requestedCategory && requestedCategory !== 'geral'
            ? requestedCategory
            : 'geral',
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

async function myData(userId: string, includeEditingHelp = false): Promise<string> {
  const [profile, cards] = await Promise.all([getProfile(userId), listCards(userId)]);
  const today = referenceDate();
  const budget = effectiveMonthlyBudget(profile);
  const spending = await spendingForPeriod(userId, formatPeriod(today));
  const lines = [
    includeEditingHelp ? '✏️ Dados para atualizar' : '📁 Meus dados',
    `Orçamento mensal: ${budget ? formatBrl(budget) : 'não configurado'}`,
    `Gasto registrado no mês: ${formatBrl(spending)}`,
    `Saldo do orçamento: ${budget ? formatBrl(budget - spending) : 'configure seu orçamento para calcular'}`,
    '',
    'Cartões:',
  ];
  if (!cards.length) {
    lines.push('• Nenhum cartão cadastrado.');
  } else {
    for (const card of cards) {
      const used = card.outstandingCents ?? 0;
      const available = card.availableCents ?? card.limitCents - used;
      lines.push(
        `• ${card.name} — ${cardBrandLabel(card.brand)} — limite ${formatBrl(card.limitCents)} — usado ${formatBrl(used)} — disponível ${formatBrl(available)} — fecha dia ${card.closingDay}, vence dia ${card.dueDay}.`,
      );
    }
  }
  if (includeEditingHelp) {
    lines.push(
      '',
      'Para corrigir, envie uma frase como:',
      '“Corrigir bandeira do cartão Mercado Pago para Visa”.',
      'Você também pode corrigir limite, fechamento ou vencimento.',
      'Para remover um cartão da lista: “Excluir cartão Mercado Pago”. Eu sempre mostro uma revisão antes de qualquer alteração.',
    );
  }
  return lines.join('\n');
}

async function recentPurchases(userId: string): Promise<string> {
  const purchases = await listPurchases(userId, 8);
  if (!purchases.length) return '🧾 Ainda não há compras registradas.';
  return [
    '🧾 Últimas compras:',
    ...purchases.map((purchase) => {
      const details = [
        `${purchase.description} — ${formatBrl(purchase.totalCents)}`,
        purchase.quantity
          ? `quantidade ${purchase.quantity}${purchase.quantityUnit ? ` ${purchase.quantityUnit}` : ' un.'}`
          : null,
        labelPayment(purchase.paymentMethod as PaymentMethod | undefined),
        purchase.cardName,
        purchase.merchant ? `estabelecimento ${purchase.merchant}` : null,
        purchase.location ? `local ${purchase.location}` : null,
        purchase.purchasedAt.split('-').reverse().join('/'),
      ].filter(Boolean);
      return `• ${details.join(' · ')}`;
    }),
  ].join('\n');
}

async function informationalReply(userId: string, intent: Intent): Promise<string> {
  if (intent === 'greeting')
    return 'Olá! Eu sou a Eloá. Envie uma compra ou digite AJUDA para ver exemplos.';
  if (intent === 'help') return HELP_TEXT;
  if (intent === 'monthly_summary') return summary(userId);
  if (intent === 'my_data') return myData(userId);
  if (intent === 'update_data') return myData(userId, true);
  if (intent === 'list_purchases') return recentPurchases(userId);
  return '';
}

function isInformationalIntent(intent: Intent): boolean {
  return [
    'greeting',
    'help',
    'monthly_summary',
    'my_data',
    'update_data',
    'list_purchases',
  ].includes(intent);
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
  const session = await getSession(input.user.id, input.source);
  if (isCancellation(normalized)) {
    if (session.state !== 'idle') {
      await clearSession(input.user.id, input.source);
      return finish(
        input,
        'Tudo bem. O rascunho foi cancelado e nada foi registrado.',
      );
    }
    return finish(input, 'Não há um rascunho para cancelar.');
  }

  if (session.state === 'awaiting_confirmation' && session.pending) {
    const pending = session.pending as unknown as PendingAction;
    if (isCorrectionRequest(normalized)) {
      await saveSession(
        input.user.id,
        input.source,
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
        await clearSession(input.user.id, input.source);
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
  const pendingCommand =
    session.state === 'collecting_details' && session.pending
      ? (session.pending as unknown as PendingAction).command
      : null;
  if (pendingCommand && isInformationalIntent(fallback.intent)) {
    const reply = await informationalReply(input.user.id, fallback.intent);
    return finish(
      input,
      `${reply}\n\nSeu rascunho continua aberto. Responda ao dado que eu pedi, ou diga CANCELAR para desistir.`,
    );
  }
  const extracted = await extractWithAi(text, input.user.id, fallback);
  const startsNewAction = Boolean(
    pendingCommand && hasCompleteNewAction(fallback),
  );
  if (startsNewAction) await clearSession(input.user.id, input.source);
  const command = pendingCommand && !startsNewAction
    ? mergeCommand(pendingCommand, followUpDetails(text, pendingCommand))
    : extracted;
  const providedLocation = cleanPurchaseLocation(input.location);
  if (providedLocation && command.intent === 'record_purchase') {
    command.location = providedLocation;
  }

  if (isInformationalIntent(command.intent))
    return finish(input, await informationalReply(input.user.id, command.intent));
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
      command.intent === 'analyze_credit' ||
      command.intent === 'record_card_payment')
  ) {
    command.purchaseDate = today;
  }
  if (
    command.cardName &&
    ['record_purchase', 'record_card_payment', 'update_card', 'delete_card', 'analyze_credit'].includes(
      command.intent,
    )
  ) {
    const knownCard = await getCardByName(input.user.id, command.cardName);
    if (knownCard) command.cardName = knownCard.name;
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
      input.source,
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
      input.source,
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
