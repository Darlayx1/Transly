import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
export const vaultKeys = sqliteTable('vault_keys', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(),
  provider: text('provider').notNull().default('gemini'), testedModel: text('tested_model'),
  project: text('project').notNull(), role: text('role').notNull(), priority: integer('priority').notNull(),
  enabled: integer('enabled').notNull().default(1), ciphertext: text('ciphertext').notNull(),
  fingerprint: text('fingerprint').notNull(), suffix: text('suffix').notNull(),
  invalid: integer('invalid').notNull().default(0), testedAt: integer('tested_at'), lastUsed: integer('last_used'),
  successes: integer('successes').notNull().default(0), failures: integer('failures').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, t => [index('vault_owner_priority').on(t.owner, t.priority), uniqueIndex('vault_owner_fingerprint').on(t.owner, t.fingerprint)]);
export const vaultSettings = sqliteTable('vault_settings', {
  owner: text('owner').primaryKey(), mode: text('mode').notNull().default('priority'), maxAttempts: integer('max_attempts').notNull().default(3),
});
export const vaultHealth = sqliteTable('vault_health', {
  owner: text('owner').notNull(), scope: text('scope').notNull(), model: text('model').notNull(),
  until: integer('until').notNull(), code: text('code').notNull(), failures: integer('failures').notNull().default(1),
}, t => [primaryKey({ columns: [t.owner, t.scope, t.model] })]);
export const vaultEvents = sqliteTable('vault_events', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), keyId: text('key_id').notNull(),
  keyName: text('key_name').notNull(), model: text('model').notNull(), role: text('role').notNull(),
  outcome: text('outcome').notNull(), duration: integer('duration').notNull(), attempt: integer('attempt').notNull(),
  requestId: text('request_id').notNull(), createdAt: integer('created_at').notNull(),
}, t => [index('vault_events_owner_created').on(t.owner, t.createdAt)]);
export const vaultJobs = sqliteTable('vault_jobs', {
  owner: text('owner').notNull(), id: text('id').notNull(), hash: text('hash').notNull(),
  status: text('status').notNull(), result: text('result'), expires: integer('expires').notNull(),
}, t => [primaryKey({ columns: [t.owner, t.id] }), index('vault_jobs_owner_expires').on(t.owner, t.expires)]);
export const vaultLeases = sqliteTable('vault_leases', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), keyId: text('key_id').notNull(),
  project: text('project').notNull(), model: text('model').notNull(), expires: integer('expires').notNull(),
}, t => [index('vault_leases_project').on(t.owner, t.project, t.model, t.expires)]);
export const vaultLimits = sqliteTable('vault_limits', {
  owner: text('owner').notNull(), scope: text('scope').notNull(), window: integer('window').notNull(), count: integer('count').notNull(),
}, t => [primaryKey({ columns: [t.owner, t.scope, t.window] })]);
