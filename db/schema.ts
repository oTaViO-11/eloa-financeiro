import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  email: text('email'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const profiles = sqliteTable(
  'profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    whatsappNumber: text('whatsapp_number'),
    monthlyIncomeCents: integer('monthly_income_cents').notNull().default(0),
    fixedExpensesCents: integer('fixed_expenses_cents').notNull().default(0),
    savingsGoalCents: integer('savings_goal_cents').notNull().default(0),
    monthlyBudgetCents: integer('monthly_budget_cents').notNull().default(0),
    alertCreditUtilizationPercent: integer('alert_credit_utilization_percent')
      .notNull()
      .default(80),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('profiles_whatsapp_number_unique').on(table.whatsappNumber),
  ],
);

export const cards = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    brand: text('brand').notNull().default('unknown'),
    limitCents: integer('limit_cents').notNull(),
    closingDay: integer('closing_day').notNull(),
    dueDay: integer('due_day').notNull(),
    active: integer('active').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('cards_user_name_unique').on(table.userId, table.normalizedName),
    index('cards_user_idx').on(table.userId),
  ],
);

export const purchases = sqliteTable(
  'purchases',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    quantity: integer('quantity'),
    quantityUnit: text('quantity_unit'),
    merchant: text('merchant'),
    location: text('location'),
    category: text('category').notNull().default('outros'),
    totalCents: integer('total_cents').notNull(),
    paymentMethod: text('payment_method').notNull(),
    installmentsCount: integer('installments_count').notNull().default(1),
    cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    purchasedAt: text('purchased_at').notNull(),
    source: text('source').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('purchases_user_idempotency_unique').on(
      table.userId,
      table.idempotencyKey,
    ),
    index('purchases_user_date_idx').on(table.userId, table.purchasedAt, table.id),
  ],
);

export const installments = sqliteTable(
  'installments',
  {
    id: text('id').primaryKey(),
    purchaseId: text('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    amountCents: integer('amount_cents').notNull(),
    paidCents: integer('paid_cents').notNull().default(0),
    dueDate: text('due_date').notNull(),
  },
  (table) => [
    uniqueIndex('installments_purchase_sequence_unique').on(
      table.purchaseId,
      table.sequence,
    ),
    index('installments_card_due_idx').on(table.cardId, table.dueDate, table.id),
  ],
);

export const cardPayments = sqliteTable(
  'card_payments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    paidAt: text('paid_at').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('card_payments_user_idempotency_unique').on(
      table.userId,
      table.idempotencyKey,
    ),
  ],
);

export const conversationSessions = sqliteTable(
  'conversation_sessions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    state: text('state').notNull().default('idle'),
    pendingActionJson: text('pending_action_json'),
    expiresAt: text('expires_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.source] })],
);

export const conversationMessages = sqliteTable(
  'conversation_messages',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    source: text('source').notNull(),
    sourceMessageId: text('source_message_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('conversation_message_source_unique').on(
      table.userId,
      table.source,
      table.sourceMessageId,
      table.role,
    ),
    index('conversation_messages_user_idx').on(table.userId, table.createdAt),
  ],
);

export const webhookEvents = sqliteTable('webhook_events', {
  providerMessageId: text('provider_message_id').primaryKey(),
  waId: text('wa_id').notNull(),
  eventJson: text('event_json').notNull(),
  processedAt: text('processed_at').notNull(),
  responseText: text('response_text'),
});

export const financialAnalyses = sqliteTable(
  'financial_analyses',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    inputJson: text('input_json').notNull(),
    resultJson: text('result_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('financial_analyses_user_idx').on(table.userId, table.createdAt)],
);
