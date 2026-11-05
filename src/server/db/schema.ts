import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRole = pgEnum("user_role", ["owner", "member"]);
export const accountKind = pgEnum("account_kind", ["checking", "savings", "external"]);
export const transactionStatus = pgEnum("transaction_status", ["pending", "posted", "failed"]);
export const transactionMethod = pgEnum("transaction_method", [
  "ach",
  "wire",
  "card",
  "transfer",
  "interest",
  "fee",
]);
export const cardStatus = pgEnum("card_status", ["active", "frozen"]);
export const scheduledStatus = pgEnum("scheduled_status", ["scheduled", "completed", "failed", "canceled"]);
export const paymentMethod = pgEnum("payment_method", ["ach", "wire"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

/** A customer's workspace, and the boundary every query is scoped to. */
export const organizations = pgTable("organizations", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  /** Demo workspaces are disposable and removed after this time. */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  ...timestamps,
});

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text().notNull().unique(),
    name: text().notNull(),
    /** Null for demo users, who can only enter through one-click sign-in. */
    passwordHash: text("password_hash"),
    role: userRole().notNull().default("owner"),
    ...timestamps,
  },
  (table) => [index("users_org_idx").on(table.orgId)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the cookie token, so a database leak can't be replayed as logins. */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    kind: accountKind().notNull(),
    /** Only the last digits are stored. The full number never enters this system. */
    numberLast4: text("number_last4"),
    currency: text().notNull().default("USD"),
    ...timestamps,
  },
  (table) => [
    unique("accounts_org_id_unique").on(table.orgId, table.id),
    index("accounts_org_idx").on(table.orgId),
  ],
);

export const cards = pgTable(
  "cards",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    holderName: text("holder_name").notNull(),
    label: text().notNull(),
    numberLast4: text("number_last4").notNull(),
    status: cardStatus().notNull().default("active"),
    monthlyLimitCents: bigint("monthly_limit_cents", { mode: "number" }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("cards_org_id_unique").on(table.orgId, table.id),
    foreignKey({
      name: "cards_account_fk",
      columns: [table.orgId, table.accountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }).onDelete("cascade"),
    check("cards_limit_positive", sql`${table.monthlyLimitCents} > 0`),
  ],
);

export const recipients = pgTable(
  "recipients",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    bankName: text("bank_name").notNull(),
    numberLast4: text("number_last4").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("recipients_org_id_unique").on(table.orgId, table.id),
    index("recipients_org_idx").on(table.orgId),
  ],
);

/** What happened, as people see it. The money itself moves in `ledger_entries`. */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: transactionStatus().notNull(),
    method: transactionMethod().notNull(),
    description: text().notNull(),
    counterparty: text().notNull(),
    category: text().notNull(),
    memo: text(),
    cardId: uuid("card_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** Set on user-initiated money movement, so a retry can't send money twice. */
    idempotencyKey: text("idempotency_key"),
    idempotencyFingerprint: text("idempotency_fingerprint"),
    ...timestamps,
  },
  (table) => [
    unique("transactions_org_id_unique").on(table.orgId, table.id),
    unique("transactions_idempotency_unique").on(table.orgId, table.idempotencyKey),
    foreignKey({
      name: "transactions_card_fk",
      columns: [table.orgId, table.cardId],
      foreignColumns: [cards.orgId, cards.id],
    }).onDelete("cascade"),
    index("transactions_org_occurred_idx").on(table.orgId, table.occurredAt.desc()),
    index("transactions_org_card_idx").on(table.orgId, table.cardId),
  ],
);

/**
 * Append-only, double-entry lines. Database triggers (see the migrations) reject
 * unbalanced transactions and any edit. Composite foreign keys make it impossible
 * for a line to touch another organization's account or transaction.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    transactionId: uuid("transaction_id").notNull(),
    accountId: uuid("account_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "ledger_entries_transaction_fk",
      columns: [table.orgId, table.transactionId],
      foreignColumns: [transactions.orgId, transactions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ledger_entries_account_fk",
      columns: [table.orgId, table.accountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }).onDelete("cascade"),
    check("ledger_entries_amount_nonzero", sql`${table.amountCents} <> 0`),
    // Every query starts from one organization. Without this, each one scans all customers' lines.
    index("ledger_entries_org_account_idx").on(table.orgId, table.accountId),
    index("ledger_entries_account_idx").on(table.accountId),
    index("ledger_entries_transaction_idx").on(table.transactionId),
  ],
);

/** A payment set up to run on a future date. Exactly one destination is set. */
export const scheduledPayments = pgTable(
  "scheduled_payments",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    fromAccountId: uuid("from_account_id").notNull(),
    toAccountId: uuid("to_account_id"),
    recipientId: uuid("recipient_id"),
    method: paymentMethod(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    memo: text(),
    scheduledFor: date("scheduled_for", { mode: "string" }).notNull(),
    status: scheduledStatus().notNull().default("scheduled"),
    transactionId: uuid("transaction_id"),
    failureReason: text("failure_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("scheduled_payments_idempotency_unique").on(table.orgId, table.idempotencyKey),
    foreignKey({
      name: "scheduled_payments_from_fk",
      columns: [table.orgId, table.fromAccountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "scheduled_payments_to_fk",
      columns: [table.orgId, table.toAccountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "scheduled_payments_recipient_fk",
      columns: [table.orgId, table.recipientId],
      foreignColumns: [recipients.orgId, recipients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "scheduled_payments_transaction_fk",
      columns: [table.orgId, table.transactionId],
      foreignColumns: [transactions.orgId, transactions.id],
    }).onDelete("cascade"),
    check("scheduled_payments_amount_positive", sql`${table.amountCents} > 0`),
    check("scheduled_payments_one_destination", sql`(${table.toAccountId} is null) <> (${table.recipientId} is null)`),
    index("scheduled_payments_due_idx").on(table.orgId, table.status, table.scheduledFor),
    index("scheduled_payments_transaction_idx").on(table.orgId, table.transactionId),
  ],
);

/** A one-time code for a large payment, bound to that user and those exact details. */
export const paymentChallenges = pgTable(
  "payment_challenges",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fingerprint: text().notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer().notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("payment_challenges_user_idx").on(table.userId)],
);

/** Append-only record of security-relevant and money-moving actions. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text().notNull(),
    targetId: text("target_id"),
    metadata: jsonb().$type<Record<string, string | number | boolean>>(),
    ...timestamps,
  },
  (table) => [
    index("audit_log_org_idx").on(table.orgId, table.createdAt.desc()),
    index("audit_log_actor_idx").on(table.actorUserId),
  ],
);

/** Lives in Postgres because serverless instances share no memory. Keys are hashed. */
export const rateLimits = pgTable("rate_limits", {
  keyHash: text("key_hash").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer().notNull(),
});
