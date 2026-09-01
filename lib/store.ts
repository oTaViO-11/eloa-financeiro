import { normalizeCardBrand, type CardBrand } from '@/lib/card-brand';
import { getDatabase } from '@/lib/db';
import { formatBrl, normalizeText } from '@/lib/money';

export type AuthenticatedUser = {
  id: string;
  displayName: string;
  email: string;
};

export type Profile = {
  userId: string;
  whatsappNumber: string | null;
  monthlyIncomeCents: number;
  fixedExpensesCents: number;
  savingsGoalCents: number;
  monthlyBudgetCents: number;
  alertCreditUtilizationPercent: number;
  updatedAt: string;
};

export type Card = {
  id: string;
  userId: string;
  name: string;
  normalizedName: string;
  brand: CardBrand;
  limitCents: number;
  closingDay: number;
  dueDay: number;
  outstandingCents?: number;
  availableCents?: number;
};

export type Purchase = {
  id: string;
  description: string;
  merchant: string | null;
  location: string | null;
  category: string;
  totalCents: number;
  paymentMethod: string;
  installmentsCount: number;
  cardName: string | null;
  purchasedAt: string;
};

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source: string;
  sourceMessageId: string | null;
  createdAt: string;
};

export type PendingSession = {
  state: 'idle' | 'awaiting_confirmation' | 'collecting_details';
  pending: Record<string, unknown> | null;
  expiresAt: string | null;
};

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function profileFromRow(row: Row): Profile {
  return {
    userId: String(row.user_id),
    whatsappNumber: row.whatsapp_number ? String(row.whatsapp_number) : null,
    monthlyIncomeCents: asNumber(row.monthly_income_cents),
    fixedExpensesCents: asNumber(row.fixed_expenses_cents),
    savingsGoalCents: asNumber(row.savings_goal_cents),
    monthlyBudgetCents: asNumber(row.monthly_budget_cents),
    alertCreditUtilizationPercent: asNumber(row.alert_credit_utilization_percent),
    updatedAt: String(row.updated_at),
  };
}

function cardFromRow(row: Row): Card {
  const limitCents = asNumber(row.limit_cents);
  const outstandingCents = asNumber(row.outstanding_cents);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    normalizedName: String(row.normalized_name),
    brand: normalizeCardBrand(row.brand),
    limitCents,
    closingDay: asNumber(row.closing_day),
    dueDay: asNumber(row.due_day),
    outstandingCents,
    availableCents: limitCents - outstandingCents,
  };
}

function purchaseFromRow(row: Row): Purchase {
  return {
    id: String(row.id),
    description: String(row.description),
    merchant: row.merchant ? String(row.merchant) : null,
    location: row.location ? String(row.location) : null,
    category: String(row.category),
    totalCents: asNumber(row.total_cents),
    paymentMethod: String(row.payment_method),
    installmentsCount: asNumber(row.installments_count),
    cardName: row.card_name ? String(row.card_name) : null,
    purchasedAt: String(row.purchased_at),
  };
}

export function effectiveMonthlyBudget(profile: Profile): number {
  if (profile.monthlyBudgetCents > 0) return profile.monthlyBudgetCents;
  return Math.max(
    0,
    profile.monthlyIncomeCents -
      profile.fixedExpensesCents -
      profile.savingsGoalCents,
  );
}

export async function ensureUser(user: AuthenticatedUser): Promise<void> {
  const db = getDatabase();
  const timestamp = now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, display_name, email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           email = excluded.email,
           updated_at = excluded.updated_at`,
      )
      .bind(user.id, user.displayName.slice(0, 120), user.email.slice(0, 254), timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO profiles (user_id, updated_at)
         VALUES (?, ?)
         ON CONFLICT(user_id) DO NOTHING`,
      )
      .bind(user.id, timestamp),
  ]);
}

export async function getProfile(userId: string): Promise<Profile> {
  const db = getDatabase();
  const row = (await db
    .prepare('SELECT * FROM profiles WHERE user_id = ?')
    .bind(userId)
    .first()) as Row | null;
  if (!row) throw new Error('Perfil financeiro nao encontrado.');
  return profileFromRow(row);
}

export async function updateProfile(
  userId: string,
  changes: Partial<
    Pick<
      Profile,
      | 'whatsappNumber'
      | 'monthlyIncomeCents'
      | 'fixedExpensesCents'
      | 'savingsGoalCents'
      | 'monthlyBudgetCents'
      | 'alertCreditUtilizationPercent'
    >
  >,
): Promise<Profile> {
  const db = getDatabase();
  const allowed: Array<[keyof typeof changes, string]> = [
    ['whatsappNumber', 'whatsapp_number'],
    ['monthlyIncomeCents', 'monthly_income_cents'],
    ['fixedExpensesCents', 'fixed_expenses_cents'],
    ['savingsGoalCents', 'savings_goal_cents'],
    ['monthlyBudgetCents', 'monthly_budget_cents'],
    ['alertCreditUtilizationPercent', 'alert_credit_utilization_percent'],
  ];
  const assignments: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [key, column] of allowed) {
    if (changes[key] !== undefined) {
      assignments.push(`${column} = ?`);
      values.push(changes[key] as string | number | null);
    }
  }
  if (assignments.length) {
    assignments.push('updated_at = ?');
    values.push(now());
    values.push(userId);
    await db
      .prepare(`UPDATE profiles SET ${assignments.join(', ')} WHERE user_id = ?`)
      .bind(...values)
      .run();
  }
  return getProfile(userId);
}

export async function findUserByWhatsapp(waId: string): Promise<AuthenticatedUser | null> {
  const db = getDatabase();
  const row = (await db
    .prepare(
      `SELECT u.id, u.display_name, COALESCE(u.email, '') AS email
       FROM profiles p JOIN users u ON u.id = p.user_id
       WHERE p.whatsapp_number = ?`,
    )
    .bind(waId)
    .first()) as Row | null;
  if (!row) return null;
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    email: String(row.email),
  };
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      const substitution = diagonal + Number(left[leftIndex - 1] !== right[rightIndex - 1]);
      const insertion = previous[rightIndex - 1] + 1;
      const deletion = above + 1;
      previous[rightIndex] = Math.min(substitution, insertion, deletion);
      diagonal = above;
    }
  }
  return previous[right.length];
}

export async function getCardByName(userId: string, cardName: string): Promise<Card | null> {
  const db = getDatabase();
  const row = (await db
    .prepare(
      `SELECT c.*, COALESCE(SUM(i.amount_cents - i.paid_cents), 0) AS outstanding_cents
       FROM cards c
       LEFT JOIN installments i ON i.card_id = c.id
       WHERE c.user_id = ? AND c.normalized_name = ? AND c.active = 1
       GROUP BY c.id`,
    )
    .bind(userId, normalizeText(cardName))
    .first()) as Row | null;
  if (row) return cardFromRow(row);
  const sought = normalizeText(cardName);
  const candidates = (await listCards(userId)).filter((card) => {
    const saved = card.normalizedName;
    return saved.startsWith(`${sought} `) || sought.startsWith(`${saved} `);
  });
  if (candidates.length === 1) return candidates[0];

  const compactSought = sought.replace(/\s+/g, '');
  if (compactSought.length < 4) return null;
  const fuzzyMatches = (await listCards(userId))
    .map((card) => ({
      card,
      distance: editDistance(compactSought, card.normalizedName.replace(/\s+/g, '')),
    }))
    .filter(({ card, distance }) => {
      const compactSaved = card.normalizedName.replace(/\s+/g, '');
      const acceptedDistance = Math.max(1, Math.ceil(Math.max(compactSought.length, compactSaved.length) * 0.2));
      return distance <= acceptedDistance;
    })
    .sort((left, right) => left.distance - right.distance);

  if (!fuzzyMatches.length) return null;
  if (fuzzyMatches.length > 1 && fuzzyMatches[0].distance === fuzzyMatches[1].distance) return null;
  return fuzzyMatches[0].card;
}

export async function getCardById(userId: string, cardId: string): Promise<Card | null> {
  const db = getDatabase();
  const row = (await db
    .prepare(
      `SELECT c.*, COALESCE(SUM(i.amount_cents - i.paid_cents), 0) AS outstanding_cents
       FROM cards c
       LEFT JOIN installments i ON i.card_id = c.id
       WHERE c.user_id = ? AND c.id = ? AND c.active = 1
       GROUP BY c.id`,
    )
    .bind(userId, cardId)
    .first()) as Row | null;
  return row ? cardFromRow(row) : null;
}

export async function listCards(userId: string): Promise<Card[]> {
  const db = getDatabase();
  const result = await db
    .prepare(
      `SELECT c.*, COALESCE(SUM(i.amount_cents - i.paid_cents), 0) AS outstanding_cents
       FROM cards c
       LEFT JOIN installments i ON i.card_id = c.id
       WHERE c.user_id = ? AND c.active = 1
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
    )
    .bind(userId)
    .all<Row>();
  return result.results.map(cardFromRow);
}

export async function upsertCard(
  userId: string,
  input: {
    name: string;
    brand?: CardBrand;
    limitCents: number;
    closingDay: number;
    dueDay: number;
  },
): Promise<Card> {
  const db = getDatabase();
  const timestamp = now();
  const normalizedName = normalizeText(input.name);
  const brand = input.brand ?? 'unknown';
  await db
    .prepare(
      `INSERT INTO cards (
          id, user_id, name, normalized_name, brand, limit_cents, closing_day, due_day,
          active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(user_id, normalized_name) DO UPDATE SET
          name = excluded.name,
          brand = CASE WHEN excluded.brand = 'unknown' THEN brand ELSE excluded.brand END,
          limit_cents = excluded.limit_cents,
          closing_day = excluded.closing_day,
          due_day = excluded.due_day,
          active = 1,
          updated_at = excluded.updated_at`,
    )
    .bind(
      newId('card'),
      userId,
      input.name.slice(0, 80),
      normalizedName,
      brand,
      input.limitCents,
      input.closingDay,
      input.dueDay,
      timestamp,
      timestamp,
    )
    .run();
  const card = await getCardByName(userId, input.name);
  if (!card) throw new Error('Nao foi possivel localizar o cartao salvo.');
  return card;
}

export async function updateCardBrand(
  userId: string,
  cardId: string,
  brand: CardBrand,
): Promise<Card | null> {
  if (brand === 'unknown') return getCardById(userId, cardId);
  const db = getDatabase();
  await db
    .prepare('UPDATE cards SET brand = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(brand, now(), cardId, userId)
    .run();
  return getCardById(userId, cardId);
}

export async function updateCard(
  userId: string,
  cardId: string,
  changes: Partial<
    Pick<Card, 'brand' | 'limitCents' | 'closingDay' | 'dueDay'>
  >,
): Promise<Card | null> {
  const card = await getCardById(userId, cardId);
  if (!card) return null;
  const brand = changes.brand && changes.brand !== 'unknown' ? changes.brand : card.brand;
  const limitCents =
    typeof changes.limitCents === 'number' && changes.limitCents > 0
      ? changes.limitCents
      : card.limitCents;
  const closingDay =
    typeof changes.closingDay === 'number' && changes.closingDay >= 1 && changes.closingDay <= 31
      ? changes.closingDay
      : card.closingDay;
  const dueDay =
    typeof changes.dueDay === 'number' && changes.dueDay >= 1 && changes.dueDay <= 31
      ? changes.dueDay
      : card.dueDay;
  const db = getDatabase();
  await db
    .prepare(
      `UPDATE cards
       SET brand = ?, limit_cents = ?, closing_day = ?, due_day = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(brand, limitCents, closingDay, dueDay, now(), cardId, userId)
    .run();
  return getCardById(userId, cardId);
}

export async function createPurchase(
  userId: string,
  input: {
    description: string;
    merchant?: string | null;
    location?: string | null;
    category?: string | null;
    totalCents: number;
    paymentMethod: string;
    installmentsCount: number;
    cardId?: string | null;
    purchasedAt: string;
    source: string;
    idempotencyKey: string;
    installments?: Array<{ sequence: number; amountCents: number; dueDate: string }>;
  },
): Promise<{ created: boolean; purchaseId: string }> {
  const db = getDatabase();
  const existing = (await db
    .prepare('SELECT id FROM purchases WHERE user_id = ? AND idempotency_key = ?')
    .bind(userId, input.idempotencyKey)
    .first()) as Row | null;
  if (existing) return { created: false, purchaseId: String(existing.id) };

  const purchaseId = newId('purchase');
  const timestamp = now();
  const statements = [
    db
      .prepare(
        `INSERT INTO purchases (
          id, user_id, description, merchant, location, category, total_cents,
          payment_method, installments_count, card_id, purchased_at, source,
          idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        purchaseId,
        userId,
        input.description.slice(0, 160),
        input.merchant?.slice(0, 120) ?? null,
        input.location?.slice(0, 120) ?? null,
        input.category?.slice(0, 80) ?? 'outros',
        input.totalCents,
        input.paymentMethod,
        input.installmentsCount,
        input.cardId ?? null,
        input.purchasedAt,
        input.source,
        input.idempotencyKey,
        timestamp,
      ),
  ];
  for (const installment of input.installments ?? []) {
    statements.push(
      db
        .prepare(
          `INSERT INTO installments (id, purchase_id, card_id, sequence, amount_cents, due_date)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId('installment'),
          purchaseId,
          input.cardId,
          installment.sequence,
          installment.amountCents,
          installment.dueDate,
        ),
    );
  }
  await db.batch(statements);
  return { created: true, purchaseId };
}

export async function listPurchases(userId: string, limit = 12): Promise<Purchase[]> {
  const db = getDatabase();
  const result = await db
    .prepare(
      `SELECT p.*, c.name AS card_name
       FROM purchases p LEFT JOIN cards c ON c.id = p.card_id
       WHERE p.user_id = ?
       ORDER BY p.purchased_at DESC, p.created_at DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<Row>();
  return result.results.map(purchaseFromRow);
}

export async function cardOutstandingCents(userId: string, cardId: string): Promise<number> {
  const db = getDatabase();
  const row = (await db
    .prepare(
      `SELECT COALESCE(SUM(i.amount_cents - i.paid_cents), 0) AS total
       FROM installments i JOIN cards c ON c.id = i.card_id
       WHERE c.user_id = ? AND i.card_id = ?`,
    )
    .bind(userId, cardId)
    .first()) as Row | null;
  return asNumber(row?.total);
}

export async function recordCardPayment(
  userId: string,
  input: {
    cardId: string;
    amountCents: number;
    paidAt: string;
    idempotencyKey: string;
  },
): Promise<{ created: boolean; appliedCents: number }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('Informe um valor de pagamento válido.');
  }
  const db = getDatabase();
  const existing = (await db
    .prepare(
      'SELECT amount_cents FROM card_payments WHERE user_id = ? AND idempotency_key = ?',
    )
    .bind(userId, input.idempotencyKey)
    .first()) as Row | null;
  if (existing) return { created: false, appliedCents: asNumber(existing.amount_cents) };

  const open = await db
    .prepare(
      `SELECT i.id, i.amount_cents, i.paid_cents
       FROM installments i
       JOIN cards c ON c.id = i.card_id
       WHERE c.user_id = ? AND i.card_id = ? AND i.paid_cents < i.amount_cents
       ORDER BY i.due_date ASC, i.id ASC`,
    )
    .bind(userId, input.cardId)
    .all<Row>();
  const outstanding = open.results.reduce(
    (total, row) => total + asNumber(row.amount_cents) - asNumber(row.paid_cents),
    0,
  );
  if (outstanding <= 0) throw new Error('Esse cartão não tem fatura em aberto.');
  if (input.amountCents > outstanding) {
    throw new Error(`O valor é maior que a fatura em aberto de ${formatBrl(outstanding)}.`);
  }

  let remaining = input.amountCents;
  const statements = [
    db
      .prepare(
        `INSERT INTO card_payments (
          id, user_id, card_id, amount_cents, paid_at, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId('card_payment'),
        userId,
        input.cardId,
        input.amountCents,
        input.paidAt,
        input.idempotencyKey,
        now(),
      ),
  ];
  for (const row of open.results) {
    if (remaining <= 0) break;
    const installmentRemaining = asNumber(row.amount_cents) - asNumber(row.paid_cents);
    const applied = Math.min(remaining, installmentRemaining);
    statements.push(
      db
        .prepare('UPDATE installments SET paid_cents = paid_cents + ? WHERE id = ?')
        .bind(applied, String(row.id)),
    );
    remaining -= applied;
  }
  await db.batch(statements);
  return { created: true, appliedCents: input.amountCents };
}

export async function spendingForPeriod(userId: string, period: string): Promise<number> {
  const db = getDatabase();
  const [cash, credit] = await db.batch([
    db
      .prepare(
        `SELECT COALESCE(SUM(total_cents), 0) AS total
         FROM purchases
         WHERE user_id = ? AND payment_method != 'credit' AND substr(purchased_at, 1, 7) = ?`,
      )
      .bind(userId, period),
    db
      .prepare(
        `SELECT COALESCE(SUM(i.amount_cents), 0) AS total
         FROM installments i JOIN purchases p ON p.id = i.purchase_id
         WHERE p.user_id = ? AND substr(i.due_date, 1, 7) = ?`,
      )
      .bind(userId, period),
  ]);
  const cashTotal = asNumber((cash.results[0] as Row | undefined)?.total);
  const creditTotal = asNumber((credit.results[0] as Row | undefined)?.total);
  return cashTotal + creditTotal;
}

export async function getSession(userId: string, source: string): Promise<PendingSession> {
  const db = getDatabase();
  const row = (await db
    .prepare('SELECT state, pending_action_json, expires_at FROM conversation_sessions WHERE user_id = ? AND source = ?')
    .bind(userId, source)
    .first()) as Row | null;
  if (!row) return { state: 'idle', pending: null, expiresAt: null };
  const expiresAt = row.expires_at ? String(row.expires_at) : null;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    await clearSession(userId, source);
    return { state: 'idle', pending: null, expiresAt: null };
  }
  let pending: Record<string, unknown> | null = null;
  if (row.pending_action_json) {
    try {
      pending = JSON.parse(String(row.pending_action_json)) as Record<string, unknown>;
    } catch {
      pending = null;
    }
  }
  const state = String(row.state);
  return {
    state: state === 'awaiting_confirmation' || state === 'collecting_details' ? state : 'idle',
    pending,
    expiresAt,
  };
}

export async function saveSession(
  userId: string,
  source: string,
  state: PendingSession['state'],
  pending: Record<string, unknown> | null,
): Promise<void> {
  const db = getDatabase();
  const timestamp = now();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO conversation_sessions (user_id, source, state, pending_action_json, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, source) DO UPDATE SET
         state = excluded.state,
         pending_action_json = excluded.pending_action_json,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, source, state, pending ? JSON.stringify(pending) : null, expiresAt, timestamp)
    .run();
}

export async function clearSession(userId: string, source: string): Promise<void> {
  const db = getDatabase();
  await db
    .prepare(
      `INSERT INTO conversation_sessions (user_id, source, state, pending_action_json, expires_at, updated_at)
       VALUES (?, ?, 'idle', NULL, NULL, ?)
       ON CONFLICT(user_id, source) DO UPDATE SET
         state = 'idle', pending_action_json = NULL, expires_at = NULL, updated_at = excluded.updated_at`,
    )
    .bind(userId, source, now())
    .run();
}

export async function getCachedReply(
  userId: string,
  source: string,
  sourceMessageId: string,
): Promise<string | null> {
  const db = getDatabase();
  const row = (await db
    .prepare(
      `SELECT content FROM conversation_messages
       WHERE user_id = ? AND source = ? AND source_message_id = ? AND role = 'assistant'
       LIMIT 1`,
    )
    .bind(userId, source, sourceMessageId)
    .first()) as Row | null;
  return row?.content ? String(row.content) : null;
}

export async function saveInteraction(
  userId: string,
  input: { source: string; sourceMessageId: string; userText: string; reply: string },
): Promise<void> {
  const db = getDatabase();
  const timestamp = now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO conversation_messages (id, user_id, role, content, source, source_message_id, created_at)
         VALUES (?, ?, 'user', ?, ?, ?, ?)
         ON CONFLICT(user_id, source, source_message_id, role) DO NOTHING`,
      )
      .bind(newId('message'), userId, input.userText.slice(0, 2000), input.source, input.sourceMessageId, timestamp),
    db
      .prepare(
        `INSERT INTO conversation_messages (id, user_id, role, content, source, source_message_id, created_at)
         VALUES (?, ?, 'assistant', ?, ?, ?, ?)
         ON CONFLICT(user_id, source, source_message_id, role) DO NOTHING`,
      )
      .bind(newId('message'), userId, input.reply.slice(0, 4000), input.source, input.sourceMessageId, timestamp),
  ]);
}

export async function listMessages(userId: string, limit = 24): Promise<ConversationMessage[]> {
  const db = getDatabase();
  const result = await db
    .prepare(
      `SELECT id, role, content, source, source_message_id, created_at
       FROM conversation_messages WHERE user_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(userId, limit)
    .all<Row>();
  return result.results
    .reverse()
    .map((row) => ({
      id: String(row.id),
      role: row.role === 'user' ? 'user' : 'assistant',
      content: String(row.content),
      source: String(row.source),
      sourceMessageId: row.source_message_id ? String(row.source_message_id) : null,
      createdAt: String(row.created_at),
    }));
}

export async function registerWebhookEvent(
  providerMessageId: string,
  waId: string,
  eventJson: string,
): Promise<boolean> {
  const db = getDatabase();
  const result = await db
    .prepare(
      `INSERT INTO webhook_events (provider_message_id, wa_id, event_json, processed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider_message_id) DO NOTHING`,
    )
    .bind(providerMessageId, waId, eventJson.slice(0, 20_000), now())
    .run();
  return asNumber(result.meta.changes) > 0;
}

export async function saveWebhookReply(providerMessageId: string, reply: string): Promise<void> {
  const db = getDatabase();
  await db
    .prepare('UPDATE webhook_events SET response_text = ? WHERE provider_message_id = ?')
    .bind(reply.slice(0, 4000), providerMessageId)
    .run();
}

export async function saveAnalysis(
  userId: string,
  cardId: string | null,
  input: Record<string, unknown>,
  result: Record<string, unknown>,
): Promise<void> {
  const db = getDatabase();
  await db
    .prepare(
      `INSERT INTO financial_analyses (id, user_id, card_id, input_json, result_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId('analysis'), userId, cardId, JSON.stringify(input), JSON.stringify(result), now())
    .run();
}

export async function dashboard(userId: string): Promise<{
  profile: Profile;
  effectiveBudgetCents: number;
  spendingCents: number;
  cards: Card[];
  purchases: Purchase[];
  messages: ConversationMessage[];
}> {
  const profile = await getProfile(userId);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const period = `${date.year}-${date.month}`;
  const [spendingCents, cards, purchases, messages] = await Promise.all([
    spendingForPeriod(userId, period),
    listCards(userId),
    listPurchases(userId),
    listMessages(userId),
  ]);
  return {
    profile,
    effectiveBudgetCents: effectiveMonthlyBudget(profile),
    spendingCents,
    cards,
    purchases,
    messages,
  };
}
