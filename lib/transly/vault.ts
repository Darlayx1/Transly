import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { models, modelProvider, providers, type Provider } from './config';
import { providerAdapters } from './provider-adapters';
import { AppError, generateJson, hasServerKey, isPagesRequest, readCredentials } from './server';
import { activeVersion, digest, seal, unseal } from './vault-crypto';

import { getVerifiedAccount, decodeJwtPayload, extractLoginToken } from './account-auth';

export type Role = 'generator' | 'evaluator';
type KeyRow = { provider: Provider; tested_model: string | null; id: string; owner: string; name: string; project: string; role: string; priority: number; enabled: number; ciphertext: string; fingerprint: string; suffix: string; invalid: number; tested_at: number | null; last_used: number | null; successes: number; failures: number; created_at: number };
type Health = { scope: string; model: string; until: number; code: string; failures: number };
type Job = { hash: string; status: string; result: string | null; expires: number };
const FOREVER = 8640000000000000;
const quotaGroup = (key: KeyRow) => key.project;
const providerScope = (provider: Provider) => `provider:${provider}`;
const keyContext = (owner: string, id: string) => `transly:key:${owner}:${id}`;
export function account(request: Request) {
  const token = extractLoginToken(request);
  if (token) {
    const payload = decodeJwtPayload(token);
    if (payload?.sub && (!payload.exp || payload.exp * 1000 > Date.now())) {
      return { id: `account:${payload.sub}`, email: payload.email || '', isAccount: true };
    }
  }
  // Sites dispatch authenticates and supplies these headers; Pages never supplies identity.
  if (isPagesRequest(request)) return null;
  const id = request.headers.get('oai-authenticated-user-id'), email = request.headers.get('oai-authenticated-user-email');
  return id && email ? { id, email, isAccount: false } : null;
}
export async function requireOwner(request: Request) {
  const verified = await getVerifiedAccount(request);
  let user: { id: string; email: string } | null = null;
  if (verified) {
    user = { id: verified.owner, email: verified.email };
  } else if (!isPagesRequest(request)) {
    const id = request.headers.get('oai-authenticated-user-id');
    const email = request.headers.get('oai-authenticated-user-email');
    if (id && email) user = { id, email };
  }
  if (!user) throw new AppError('SIGN_IN_REQUIRED', 'Masuk untuk membuka brankas API key.', 401);
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin && !isPagesRequest(request)) || (request.headers.get('sec-fetch-site') === 'cross-site' && !isPagesRequest(request))) throw new AppError('FORBIDDEN', 'Permintaan tidak diizinkan.', 403);
  return user.id;
}
export function vaultDb() {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new AppError('STORAGE_UNAVAILABLE', 'Brankas belum dapat diakses. Coba kembali nanti.', 503);
  // Read-your-writes consistency even if the deployment enables D1 replicas.
  return typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
}
const statement = (sql: string, ...values: (string | number | null)[]) => vaultDb().prepare(sql).bind(...values);
export async function getKeys(owner: string) { return (await statement("SELECT * FROM vault_keys WHERE owner = ? AND provider = 'gemini' ORDER BY priority, created_at, id", owner).all<KeyRow>()).results; }
async function getHealth(owner: string) { return (await statement('SELECT * FROM vault_health WHERE owner = ?', owner).all<Health>()).results; }
export async function getSettings(owner: string) {
  return await statement('SELECT mode, max_attempts AS maxAttempts FROM vault_settings WHERE owner = ?', owner).first<{ mode: 'priority' | 'balanced'; maxAttempts: number }>() || { mode: 'priority' as const, maxAttempts: 3 };
}
export async function vaultStatus(request: Request) {
  const verified = await getVerifiedAccount(request);
  let user: { id: string; email: string } | null = null;
  if (verified) {
    user = { id: verified.owner, email: verified.email };
  } else if (!isPagesRequest(request)) {
    const id = request.headers.get('oai-authenticated-user-id');
    const email = request.headers.get('oai-authenticated-user-email');
    if (id && email) user = { id, email };
  }
  if (!user) {
    const legacy = await readCredentials(request);
    const legacyProviders: Provider[] = [];
    if (legacy && (legacy.gemini || legacy.generator || legacy.evaluator)) {
      legacyProviders.push('gemini');
    }
    return { generator: Boolean(legacy?.generator || legacy?.gemini) || hasServerKey(), evaluator: Boolean(legacy?.evaluator || legacy?.gemini) || hasServerKey(), custom: Boolean(legacy), server: hasServerKey(), serverProviders: hasServerKey() ? (['gemini'] as const) : ([] as const), legacyProviders, account: null, keys: [], health: [], events: [], settings: { mode: 'priority' as const, maxAttempts: 3 } };
  }
  await requireOwner(request);
  const owner = user.id;
  if (new URL(request.url).searchParams.get('progress') === '1') {
    const events = await statement("SELECT e.key_name AS keyName, e.model, e.role, e.outcome, e.attempt, e.created_at AS createdAt FROM vault_events e INNER JOIN vault_jobs j ON j.owner = e.owner AND j.id = e.request_id WHERE e.owner = ? AND j.status = 'running' AND j.expires > ? ORDER BY e.created_at DESC, e.rowid DESC LIMIT 3", owner, Date.now()).all();
    return { events: events.results };
  }
  const [keys, health, settings, events, progress] = await Promise.all([
    getKeys(owner), getHealth(owner), getSettings(owner),
    statement('SELECT key_name AS keyName, model, role, outcome, duration, attempt, request_id AS requestId, created_at AS createdAt FROM vault_events WHERE owner = ? ORDER BY created_at DESC, rowid DESC LIMIT 30', owner).all(),
    statement("SELECT id FROM vault_jobs WHERE owner = ? AND status = 'running' AND expires > ?", owner, Date.now()).all<{ id: string }>(),
  ]);
  const usable = (role: Role) => keys.some(k => k.enabled && !k.invalid && (k.role === 'both' || k.role === role));
  return { generator: usable('generator'), evaluator: usable('evaluator'), custom: keys.length > 0, server: false,
    account: { email: user.email }, legacyMigrationAvailable: Boolean(await readCredentials(request)), keys: keys.map(k => ({ provider: k.provider, testedModel: k.tested_model, id: k.id, name: k.name, project: k.project, role: k.role, priority: k.priority, enabled: Boolean(k.enabled), suffix: k.suffix, invalid: Boolean(k.invalid), testedAt: k.tested_at, lastUsed: k.last_used, successes: k.successes, failures: k.failures })),
    health: health.filter(h => h.until > Date.now()), settings, events: events.results.map(e => ({ ...e, provider: modelProvider(String(e.model)) })), running: progress.results.map(j => j.id),
  };
}
const keyFields = z.object({ provider: z.literal('gemini').default('gemini'), name: z.string().trim().min(1).max(60), project: z.string().trim().max(100).transform(s => s || 'unknown'), role: z.enum(['generator', 'evaluator', 'both']), priority: z.number().int().min(1).max(100), enabled: z.boolean().default(true) });
const keySecret = z.string().trim().min(20).max(256).regex(/^[\x21-\x7E]+$/, 'API key harus berisi karakter ASCII tanpa spasi.');
const keyInput = keyFields.extend({ secret: keySecret });
async function ownedKey(owner: string, id: string) {
  const key = await statement('SELECT * FROM vault_keys WHERE owner = ? AND id = ?', owner, id).first<KeyRow>();
  if (!key) throw new AppError('KEY_NOT_FOUND', 'Key tidak ditemukan.', 404);
  return key;
}
export async function rateLimit(owner: string, scope: string, max: number) {
  const window = Math.floor(Date.now() / 60000);
  const row = await statement('INSERT INTO vault_limits (owner, scope, window, count) VALUES (?, ?, ?, 1) ON CONFLICT(owner, scope, window) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count', owner, scope, window, max).first();
  if (!row) throw new AppError('RATE_LIMIT', 'Batas permintaan tercapai. Coba kembali setelah waktu tunggu.', 429, 60000 - Date.now() % 60000);
}
export async function addKey(owner: string, value: unknown) {
  const data = keyInput.parse(value), id = crypto.randomUUID();
  const fingerprint = await digest(data.secret);
  if (await statement('SELECT id FROM vault_keys WHERE owner = ? AND fingerprint = ?', owner, fingerprint).first()) throw new AppError('DUPLICATE_KEY', 'Key ini sudah ada dalam brankas. Edit pengaturannya pada daftar key.', 409);
  try {
    const row = await statement('INSERT INTO vault_keys (id, owner, name, provider, project, role, priority, enabled, ciphertext, fingerprint, suffix, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM vault_keys WHERE owner = ?) < 50 RETURNING id', id, owner, data.name, data.provider, data.project, data.role, data.priority, Number(data.enabled), await seal(data.secret, keyContext(owner, id)), fingerprint, data.secret.slice(-4), Date.now(), owner).first();
    if (!row) throw new AppError('KEY_LIMIT', 'Brankas dapat menyimpan hingga 50 key.', 409);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (String(error).includes('UNIQUE')) throw new AppError('DUPLICATE_KEY', 'Key ini sudah ada dalam brankas.', 409);
    throw error;
  }
  return id;
}
export async function updateKey(owner: string, value: unknown) {
  const data = keyFields.extend({ id: z.string().uuid(), secret: keySecret.optional() }).parse(value);
  const old = await ownedKey(owner, data.id);
  if (data.provider !== old.provider && !data.secret) throw new AppError('INVALID_INPUT', 'Masukkan key baru untuk mengganti provider.');
  const fingerprint = data.secret ? await digest(data.secret) : old.fingerprint;
  if (await statement('SELECT id FROM vault_keys WHERE owner = ? AND fingerprint = ? AND id <> ?', owner, fingerprint, data.id).first()) throw new AppError('DUPLICATE_KEY', 'Key ini sudah ada dalam brankas.', 409);
  const ciphertext = data.secret ? await seal(data.secret, keyContext(owner, data.id)) : old.ciphertext;
  try {
    await statement('UPDATE vault_keys SET name = ?, provider = ?, project = ?, role = ?, priority = ?, enabled = ?, ciphertext = ?, fingerprint = ?, suffix = ?, invalid = ?, tested_at = ?, tested_model = ? WHERE owner = ? AND id = ?', data.name, data.provider, data.project, data.role, data.priority, Number(data.enabled), ciphertext, fingerprint, data.secret ? data.secret.slice(-4) : old.suffix, data.secret ? 0 : old.invalid, data.secret ? null : old.tested_at, data.secret ? null : old.tested_model, owner, data.id).run();
    if (data.secret) await statement('DELETE FROM vault_health WHERE owner = ? AND scope = ?', owner, `key:${data.id}`).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new AppError('DUPLICATE_KEY', 'Key ini sudah ada dalam brankas.', 409);
    throw error;
  }
}
export async function removeKey(owner: string, id: string) {
  await ownedKey(owner, id);
  const db = vaultDb();
  await db.batch([
    db.prepare('DELETE FROM vault_keys WHERE owner = ? AND id = ?').bind(owner, id),
    db.prepare('DELETE FROM vault_health WHERE owner = ? AND scope = ?').bind(owner, `key:${id}`),
    db.prepare('DELETE FROM vault_events WHERE owner = ? AND key_id = ?').bind(owner, id),
  ]);
}
export async function saveSettings(owner: string, value: unknown) {
  const data = z.object({ mode: z.enum(['priority', 'balanced']), maxAttempts: z.number().int().min(1).max(3) }).parse(value);
  await statement('INSERT INTO vault_settings (owner, mode, max_attempts) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET mode = excluded.mode, max_attempts = excluded.max_attempts', owner, data.mode, data.maxAttempts).run();
}
async function decryptKey(key: KeyRow) {
  const secret = await unseal(key.ciphertext, keyContext(key.owner, key.id));
  if (!key.ciphertext.startsWith(`${activeVersion()}.`)) {
    const replacement = await seal(secret, keyContext(key.owner, key.id));
    await statement('UPDATE vault_keys SET ciphertext = ? WHERE owner = ? AND id = ? AND ciphertext = ?', replacement, key.owner, key.id, key.ciphertext).run();
    key.ciphertext = replacement;
  }
  return secret;
}
export async function rotateVault(owner: string) {
  for (const key of await getKeys(owner)) {
    await statement('UPDATE vault_keys SET ciphertext = ? WHERE owner = ? AND id = ? AND ciphertext = ?', await seal(await unseal(key.ciphertext, keyContext(owner, key.id)), keyContext(owner, key.id)), owner, key.id, key.ciphertext).run();
  }
}
async function event(owner: string, key: KeyRow, model: string, role: string, outcome: string, duration: number, attempt: number, requestId: string) {
  await statement('INSERT INTO vault_events (id, owner, key_id, key_name, model, role, outcome, duration, attempt, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', crypto.randomUUID(), owner, key.id, key.name, model, role, outcome, Math.max(0, duration), attempt, requestId, Date.now()).run();
  await statement('DELETE FROM vault_events WHERE owner = ? AND id NOT IN (SELECT id FROM vault_events WHERE owner = ? ORDER BY created_at DESC, rowid DESC LIMIT 100)', owner, owner).run();
}
async function setHealth(owner: string, scope: string, model: string, until: number, code: string) {
  await statement('INSERT INTO vault_health (owner, scope, model, until, code, failures) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(owner, scope, model) DO UPDATE SET until = excluded.until, code = excluded.code, failures = failures + 1', owner, scope, model, until, code).run();
}
export async function recordFailure(owner: string, key: KeyRow, model: string, error: AppError) {
  if (!await statement('SELECT id FROM vault_keys WHERE owner = ? AND id = ? AND fingerprint = ?', owner, key.id, key.fingerprint).first()) return;
  const now = Date.now();
  if (error.code === 'INVALID_KEY') await statement('UPDATE vault_keys SET invalid = 1 WHERE owner = ? AND id = ?', owner, key.id).run();
  else if (['MODEL_UNAVAILABLE', 'KEY_PERMISSION_DENIED'].includes(error.code)) await setHealth(owner, `key:${key.id}`, model, FOREVER, error.code);
  else if (['RATE_LIMIT', 'QUOTA_EXCEEDED'].includes(error.code)) await setHealth(owner, `project:${quotaGroup(key)}`, model, now + (error.retryAfterMs || 60000), error.code);
  else if (['TIMEOUT', 'NETWORK_ERROR'].includes(error.code)) await setHealth(owner, `key:${key.id}`, model, now + 10000, error.code);
  if (['PROVIDER_ERROR', 'NETWORK_ERROR', 'TIMEOUT'].includes(error.code)) {
    await statement('INSERT INTO vault_health (owner, scope, model, until, code, failures) VALUES (?, ?, ?, 0, ?, 1) ON CONFLICT(owner, scope, model) DO UPDATE SET failures = CASE WHEN until > 0 AND until <= ? THEN 1 ELSE failures + 1 END, until = CASE WHEN until > 0 AND until <= ? THEN 0 WHEN failures >= 1 THEN ? ELSE 0 END, code = excluded.code', owner, providerScope(key.provider), model, error.code, now, now, now + Math.max(30000, error.retryAfterMs)).run();
  }
}
export async function testKey(owner: string, id: string, model: string) {
  const selected = models.find(m => m.id === model);
  if (!selected) throw new AppError('MODEL_UNAVAILABLE', 'Pilih model yang tersedia.');
  const key = await ownedKey(owner, id), started = Date.now();
  if (selected.provider !== key.provider) throw new AppError('INVALID_INPUT', 'Provider key tidak cocok dengan model yang dipilih.');
  const secret = await decryptKey(key);
  let outcome = 'TEST_OK';
  try {
    const adapter = providerAdapters[key.provider], access = adapter.access(secret, selected);
    const response = await fetch(access.url, { headers: access.headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      const code = response.status === 401 || response.status === 400 ? 'INVALID_KEY' : response.status === 403 ? 'KEY_PERMISSION_DENIED' : response.status === 404 ? 'MODEL_UNAVAILABLE' : response.status === 429 ? 'RATE_LIMIT' : 'PROVIDER_ERROR';
      throw new AppError(code, `Pemeriksaan ${providers[key.provider].name} gagal. Periksa status key dan izin model di konsol provider.`, 422, code === 'RATE_LIMIT' ? 60000 : 0);
    }
    const data: unknown = await response.json();
    if (!adapter.available(data, selected)) throw new AppError('MODEL_UNAVAILABLE', 'Model belum mendukung pembuatan konten untuk key ini.', 422);
    await statement('UPDATE vault_keys SET invalid = 0, tested_at = ?, tested_model = ? WHERE owner = ? AND id = ? AND ciphertext = ?', Date.now(), model, owner, id, key.ciphertext).run();
    await statement('DELETE FROM vault_health WHERE owner = ? AND scope = ? AND model = ?', owner, `key:${id}`, model).run();
  } catch (error) {
    const safe = error instanceof AppError ? error : new AppError('NETWORK_ERROR', 'Pemeriksaan belum dapat terhubung ke provider. Coba kembali.', 502);
    outcome = safe.code;
    await recordFailure(owner, key, model, safe);
    throw safe;
  } finally { await event(owner, key, model, 'test', outcome, Date.now() - started, 1, crypto.randomUUID()); }
}
export function eligibleKeys(keys: KeyRow[], health: Health[], role: Role, model: string, mode: string, now = Date.now()) {
  const healthy = keys.filter(k => k.provider === modelProvider(model) && k.enabled && !k.invalid && (k.role === role || k.role === 'both') && !health.some(h => h.until > now && h.model === model && [providerScope(k.provider), ...(k.provider === 'gemini' ? ['provider'] : []), `key:${k.id}`, `project:${quotaGroup(k)}`].includes(h.scope)));
  return healthy.sort((a, b) => mode === 'balanced' ? (a.last_used || 0) - (b.last_used || 0) || a.priority - b.priority : a.priority - b.priority || a.created_at - b.created_at);
}
async function acquire(owner: string, key: KeyRow, model: string) {
  const id = crypto.randomUUID(), now = Date.now();
  const row = await statement('INSERT INTO vault_leases (id, owner, key_id, project, model, expires) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM vault_leases WHERE owner = ? AND project = ? AND model = ? AND expires > ?) < 2 AND NOT EXISTS (SELECT 1 FROM vault_leases WHERE owner = ? AND key_id = ? AND expires > ?) AND EXISTS (SELECT 1 FROM vault_keys WHERE owner = ? AND id = ? AND enabled = 1 AND invalid = 0 AND ciphertext = ?) RETURNING id', id, owner, key.id, quotaGroup(key), model, now + 95000, owner, quotaGroup(key), model, now, owner, key.id, now, owner, key.id, key.ciphertext).first();
  if (!row) return null;
  await statement('UPDATE vault_keys SET last_used = ? WHERE owner = ? AND id = ?', now, owner, key.id).run();
  return id;
}
async function clean(owner: string) {
  const db = vaultDb(), now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM vault_jobs WHERE owner = ? AND expires <= ?').bind(owner, now),
    db.prepare('DELETE FROM vault_leases WHERE owner = ? AND expires <= ?').bind(owner, now),
    db.prepare('DELETE FROM vault_limits WHERE owner = ? AND window < ?').bind(owner, Math.floor(now / 60000) - 1),
  ]);
}
export async function runWithVault<T>(request: Request, role: Role, model: string, prompt: string, schema: unknown, validate: (raw: unknown) => T, selection: { keyId?: string; fallbackModel?: string } = {}): Promise<T & { routing?: unknown }> {
  const owner = await requireOwner(request), deadline = Date.now() + 85000;
  if (!models.some(item => item.id === model) || (selection.fallbackModel && (!models.some(item => item.id === selection.fallbackModel) || selection.fallbackModel === model))) throw new AppError('INVALID_INPUT', 'Pilih model yang tersedia.');
  let activeModel = model;
  const suppliedId = request.headers.get('idempotency-key');
  if (suppliedId && !/^[a-zA-Z0-9_-]{16,80}$/.test(suppliedId)) throw new AppError('INVALID_INPUT', 'Identitas permintaan tidak valid.');
  const id = suppliedId || crypto.randomUUID(), hash = await digest(JSON.stringify({ role, model, prompt, schema, selection }));
  await clean(owner);
  const prior = await statement('SELECT hash, status, result, expires FROM vault_jobs WHERE owner = ? AND id = ?', owner, id).first<Job>();
  if (prior) {
    if (prior.hash !== hash) throw new AppError('INVALID_INPUT', 'Identitas permintaan sudah digunakan untuk data berbeda.', 409);
    if (prior.status === 'success' && prior.result) return JSON.parse(await unseal(prior.result, `transly:job:${owner}:${id}`));
    throw new AppError('REQUEST_RUNNING', 'Permintaan ini masih diproses. Tunggu sebentar lalu coba lagi.', 409, Math.max(1000, prior.expires - Date.now()));
  }
  if (selection.keyId) {
    const chosen = await ownedKey(owner, selection.keyId);
    if (chosen.provider !== modelProvider(model) || !['both', role].includes(chosen.role)) throw new AppError('INVALID_INPUT', 'Key pilihan tidak cocok dengan provider atau penggunaan.');
  }
  const job = await statement("INSERT INTO vault_jobs (owner, id, hash, status, expires) SELECT ?, ?, ?, 'running', ? WHERE (SELECT COUNT(*) FROM vault_jobs WHERE owner = ? AND status = 'running' AND expires > ?) < 3 ON CONFLICT(owner, id) DO NOTHING RETURNING id", owner, id, hash, deadline + 10000, owner, Date.now()).first();
  if (!job) throw new AppError('REQUEST_RUNNING', 'Ada permintaan yang sedang diproses. Tunggu sebentar lalu coba lagi.', 409, 5000);
  let succeeded = false;
  const routing: { keyName: string; provider: Provider; model: string; outcome: string; attempt: number }[] = [];
  try {
    await rateLimit(owner, 'requests', 30);
    const settings = await getSettings(owner);
    let lastError: AppError | undefined;
    const tried = new Set<string>();
    const queued = new Set<string>();
    let attempts = 0, queuedUntil = Date.now() + 5000, transientRetry: string | undefined;
    while (attempts < settings.maxAttempts && Date.now() < deadline && !request.signal.aborted) {
      const [keys, health] = await Promise.all([getKeys(owner), getHealth(owner)]);
      const eligible = eligibleKeys(keys, health, role, activeModel, settings.mode).filter(k => (activeModel !== model || !selection.keyId || k.id === selection.keyId) && (!tried.has(k.id) || transientRetry === k.id));
      const candidate = transientRetry ? eligible.find(k => k.id === transientRetry) || eligible[0] : eligible[0];
      transientRetry = undefined;
      if (!candidate) {
        if (queued.size && Date.now() < queuedUntil && eligibleKeys(keys, health, role, activeModel, settings.mode).some(k => queued.has(k.id))) {
          for (const id of queued) tried.delete(id);
          queued.clear(); await new Promise(r => setTimeout(r, 250)); continue;
        }
        if (activeModel === model && selection.fallbackModel) { activeModel = selection.fallbackModel; queued.clear(); continue; }
        const wait = health.filter(h => h.model === activeModel && h.until > Date.now() && h.until < FOREVER).map(h => h.until - Date.now());
        throw lastError || new AppError('NO_READY_KEY', keys.length ? 'Belum ada key yang siap untuk model ini. Periksa peran, status, dan waktu tunggu di Pengaturan AI.' : 'Tambahkan API key di Pengaturan AI untuk memulai.', 429, wait.length ? Math.min(...wait) : 0);
      }
      const lease = await acquire(owner, candidate, activeModel);
      if (!lease) {
        // Bounded queue; other eligible keys can serve separate concurrent work.
        tried.add(candidate.id);
        queued.add(candidate.id);
        if (Date.now() < queuedUntil && eligible.length === 1) {
          for (const id of queued) tried.delete(id);
          queued.clear(); await new Promise(r => setTimeout(r, 250)); continue;
        }
        if (eligible.length > 1) continue;
        throw lastError || new AppError('KEY_BUSY', 'Key sedang digunakan. Coba kembali sebentar lagi.', 429, 5000);
      }
      const started = Date.now();
      try {
        try { await rateLimit(owner, `project:${quotaGroup(candidate)}:${activeModel}`, 12); }
        catch (error) { await recordFailure(owner, candidate, activeModel, error as AppError); tried.add(candidate.id); lastError = error as AppError; continue; }
        attempts++;
        const secret = await decryptKey(candidate);
        const raw = await generateJson(secret, activeModel, prompt, schema, { maxAttempts: 1, timeoutMs: Math.max(1, Math.min(60000, deadline - Date.now())), signal: request.signal });
        let data: T;
        try { data = validate(raw); } catch { throw new AppError('INVALID_RESPONSE', 'Jawaban AI belum lengkap. Sistem akan mencoba kembali jika tersedia.', 502); }
        await statement('UPDATE vault_keys SET successes = successes + 1 WHERE owner = ? AND id = ? AND fingerprint = ?', owner, candidate.id, candidate.fingerprint).run();
        await statement('DELETE FROM vault_health WHERE owner = ? AND scope = ? AND model = ?', owner, providerScope(candidate.provider), activeModel).run();
        await event(owner, candidate, activeModel, role, 'SUCCESS', Date.now() - started, attempts, id);
        routing.push({ keyName: candidate.name, provider: candidate.provider, model: activeModel, outcome: 'SUCCESS', attempt: attempts });
        const result = { ...data, routing: { requestId: id, provider: candidate.provider, model: activeModel, attempts: routing, fallback: routing.length > 1 || activeModel !== model } };
        await statement("UPDATE vault_jobs SET status = 'success', result = ?, expires = ? WHERE owner = ? AND id = ?", await seal(JSON.stringify(result), `transly:job:${owner}:${id}`), Date.now() + 600000, owner, id).run();
        succeeded = true;
        return result;
      } catch (error) {
        const safe = error instanceof AppError ? error : new AppError('SERVER_ERROR', 'Pemrosesan belum dapat diselesaikan. Jawaban tetap tersimpan.', 503);
        lastError = safe;
        await statement('UPDATE vault_keys SET failures = failures + 1 WHERE owner = ? AND id = ? AND fingerprint = ?', owner, candidate.id, candidate.fingerprint).run();
        await recordFailure(owner, candidate, activeModel, safe);
        await event(owner, candidate, activeModel, role, safe.code, Date.now() - started, attempts, id);
        routing.push({ keyName: candidate.name, provider: candidate.provider, model: activeModel, outcome: safe.code, attempt: attempts });
        if (!['INVALID_KEY', 'KEY_PERMISSION_DENIED', 'MODEL_UNAVAILABLE', 'RATE_LIMIT', 'QUOTA_EXCEEDED', 'PROVIDER_ERROR', 'TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE', 'EMPTY_RESPONSE', 'RESPONSE_TRUNCATED'].includes(safe.code)) throw safe;
        tried.add(candidate.id);
        if (['PROVIDER_ERROR', 'INVALID_RESPONSE', 'EMPTY_RESPONSE', 'RESPONSE_TRUNCATED'].includes(safe.code) && attempts < 2) transientRetry = candidate.id;
        if (['PROVIDER_ERROR', 'NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE', 'EMPTY_RESPONSE', 'RESPONSE_TRUNCATED'].includes(safe.code)) await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** (attempts - 1) + Math.random() * 200, Math.max(0, deadline - Date.now()))));
      } finally { await statement('DELETE FROM vault_leases WHERE owner = ? AND id = ?', owner, lease).run(); }
      queuedUntil = Date.now() + 1000;
    }
    throw lastError || new AppError('TIMEOUT', 'Batas waktu tercapai. Jawaban tetap tersimpan; coba kembali.', 504);
  } finally {
    if (!succeeded) await statement("DELETE FROM vault_jobs WHERE owner = ? AND id = ? AND status = 'running'", owner, id).run();
  }
}
