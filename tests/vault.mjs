import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = path.resolve('.sites-runtime/vault-tests');
await mkdir(dir, { recursive: true });
const runtime = globalThis.__vaultTestEnv = { VAULT_ENCRYPTION_KEYS: JSON.stringify({ v1: 'test-only-encryption-secret-12345678901234567890' }), VAULT_ACTIVE_VERSION: 'v1' };
for (const name of ['config', 'provider-adapters', 'server', 'vault-crypto', 'vault', 'vault-backup', 'backup-material']) {
  const source = (await readFile(`lib/transly/${name}.ts`, 'utf8'))
    .replace("import { env } from 'cloudflare:workers';", 'const env = globalThis.__vaultTestEnv;')
    .replace(/from '(\.\/[^']+)'/g, "from '$1.js'");
  await writeFile(path.join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const vault = await import(pathToFileURL(path.join(dir, 'vault.js')));
const encryption = await import(pathToFileURL(path.join(dir, 'vault-crypto.js')));
const model = 'gemini-3.5-flash';
const schema = { type: 'object', properties: { title: { type: 'string' } } };
const originalFetch = globalThis.fetch;
let passed = 0;
function database() {
  const sqlite = new DatabaseSync(':memory:');
  const prepare = (sql, values = []) => {
    const execute = () => {
      const q = sqlite.prepare(sql), returnsRows = q.columns().length > 0;
      const rows = returnsRows ? q.all(...values) : [];
      const changes = returnsRows ? Number(sqlite.prepare('SELECT changes() n').get().n) : Number(q.run(...values).changes);
      return { success: true, results: rows, meta: { changes } };
    };
    return { bind: (...v) => prepare(sql, v), first: async () => sqlite.prepare(sql).get(...values) || null, run: async () => execute(), all: async () => execute(), execute };
  };
  return { sqlite, prepare, batch: async statements => {
    sqlite.exec('BEGIN');
    try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}
async function reset() {
  runtime.DB?.sqlite.close(); runtime.DB = database();
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
  for (const entry of journal.entries) runtime.DB.sqlite.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
  runtime.VAULT_ENCRYPTION_KEYS = JSON.stringify({ v1: 'test-only-encryption-secret-12345678901234567890' }); runtime.VAULT_ACTIVE_VERSION = 'v1';
}
async function test(name, action) { await reset(); await action(); passed++; console.log(`PASS ${name}`); }
const request = (owner = 'alice', id = crypto.randomUUID()) => new Request('https://transly.test/api/generate', { method: 'POST', headers: { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@test.invalid`, 'idempotency-key': id } });
const add = async (name, project, priority = 1, owner = 'alice', role = 'both', enabled = true) => vault.addKey(owner, { name, project, priority, role, enabled, secret: `test-credential-${name}-123456789012345` });
const success = () => Response.json({ candidates: [{ content: { parts: [{ text: '{"title":"Validated result"}' }] } }] });
const run = (req = request(), role = 'generator', prompt = 'Original request') => vault.runWithVault(req, role, model, prompt, schema, raw => { assert.equal(typeof raw.title, 'string'); return raw; });
const rejectCode = (promise, code) => assert.rejects(promise, e => e.code === code);
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error('Timed out waiting for concurrent test'); await new Promise(r => setTimeout(r, 1)); }
}

try {
  await test('durable key encryption, masking, ownership and duplicate protection', async () => {
    const id = await add('Primary', 'project-a');
    const keys = await vault.getKeys('alice');
    assert(!keys[0].ciphertext.includes('test-credential'));
    const status = await vault.vaultStatus(request());
    assert.equal(status.keys.length, 1); assert(status.generator && status.evaluator);
    assert(!JSON.stringify(status).includes('test-credential')); assert(!JSON.stringify(status).includes('ciphertext')); assert(!JSON.stringify(status).includes('fingerprint'));
    assert.equal((await vault.vaultStatus(request('bob'))).keys.length, 0);
    await rejectCode(vault.removeKey('bob', id), 'KEY_NOT_FOUND');
    await rejectCode(add('Primary', 'project-other'), 'DUPLICATE_KEY');
    await vault.updateKey('alice', { id, name: 'Updated', project: 'project-a', role: 'evaluator', priority: 2, enabled: true });
    assert.equal((await vault.getKeys('alice'))[0].ciphertext, keys[0].ciphertext);
    await vault.removeKey('alice', id); assert.equal((await vault.getKeys('alice')).length, 0);
  });
  await test('authentication required and cross-site identities rejected', async () => {
    assert.equal(vault.account(new Request('https://transly.test/api/credentials')), null);
    await rejectCode(run(new Request('https://transly.test/api/generate')), 'SIGN_IN_REQUIRED');
    const req = request(); req.headers.set('origin', 'https://evil.test');
    await rejectCode(run(req), 'FORBIDDEN');
    req.headers.set('origin', 'https://darlayx1.github.io'); assert.equal(vault.account(req), null);
    await rejectCode(run(req), 'SIGN_IN_REQUIRED');
  });
  await test('AES-GCM binds each secret to its owner and record, and supports large responses', async () => {
    const c = await encryption.seal('protected value', 'owner:alice:record:1');
    await rejectCode(encryption.unseal(c, 'owner:bob:record:1'), 'VAULT_LOCKED');
    await rejectCode(encryption.unseal(c.slice(0, -5) + 'abcde', 'owner:alice:record:1'), 'VAULT_LOCKED');
    const big = 'a'.repeat(400000); assert.equal(await encryption.unseal(await encryption.seal(big, 'large'), 'large'), big);
  });
  await test('versioned rotation retains old key access and re-encrypts safely', async () => {
    const id = await add('Primary', 'a');
    runtime.VAULT_ENCRYPTION_KEYS = JSON.stringify({ v1: 'test-only-encryption-secret-12345678901234567890', v2: 'test-only-second-encryption-secret-98765432109876543210' }); runtime.VAULT_ACTIVE_VERSION = 'v2';
    await vault.rotateVault('alice');
    assert((await vault.getKeys('alice'))[0].ciphertext.startsWith('v2.'));
    runtime.VAULT_ENCRYPTION_KEYS = JSON.stringify({ v2: 'test-only-second-encryption-secret-98765432109876543210' });
    globalThis.fetch = async () => success(); assert.equal((await run()).title, 'Validated result');
    assert.equal((await vault.getKeys('alice'))[0].id, id);
  });
  await test('invalid primary falls back without changing model, input or role', async () => {
    const first = await add('Primary', 'a'), second = await add('Backup', 'b', 2);
    await add('EvaluatorOnly', 'c', 0 + 1, 'alice', 'evaluator');
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return options.headers['x-goog-api-key'].includes('Primary') ? Response.json({ error: { message: 'bad key secret detail' } }, { status: 401 }) : success();
    };
    const result = await run();
    assert.equal(calls.length, 2); assert.equal(calls[0].url, calls[1].url); assert.equal(calls[0].options.body, calls[1].options.body);
    assert(result.routing.fallback); assert.equal(result.routing.attempts[1].keyName, 'Backup');
    assert.equal((await vault.getKeys('alice')).find(k => k.id === first).invalid, 1);
    assert.equal((await vault.getKeys('alice')).find(k => k.id === second).successes, 1);
    assert(!JSON.stringify(await vault.vaultStatus(request())).includes('secret detail'));
  });
  await test('429 respects Retry-After and skips every key sharing the same project', async () => {
    await add('Primary', 'shared'); await add('SameProject', 'shared', 2); await add('Independent', 'independent', 3);
    const used = [];
    globalThis.fetch = async (_url, options) => { const secret = options.headers['x-goog-api-key']; used.push(secret); return secret.includes('Primary') ? Response.json({ error: { message: 'rate limit', details: [{ retryDelay: '120s' }] } }, { status: 429, headers: { 'Retry-After': '90' } }) : success(); };
    const result = await run(); assert.equal(used.length, 2); assert(used[1].includes('Independent'));
    const health = (await vault.vaultStatus(request())).health.find(h => h.scope === 'project:shared');
    assert(health.until - Date.now() > 119000); assert(result.routing.fallback);
  });
  await test('model permission failure excludes only that key and model', async () => {
    const first = await add('Primary', 'shared'); await add('Backup', 'shared', 2);
    globalThis.fetch = async (_url, options) => options.headers['x-goog-api-key'].includes('Primary') ? Response.json({ error: { message: 'permission denied' } }, { status: 403 }) : success();
    await run();
    const status = await vault.vaultStatus(request()); assert.equal(status.keys.find(k => k.id === first).invalid, false);
    assert(status.health.some(h => h.scope === `key:${first}` && h.model === model));
  });
  await test('blocked content and bad parameters do not spend fallback attempts', async () => {
    await add('Primary', 'a'); await add('Backup', 'b', 2); let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ promptFeedback: { blockReason: 'SAFETY' } }); };
    await rejectCode(run(), 'SAFETY_BLOCKED'); assert.equal(calls, 1);
    globalThis.fetch = async () => { calls++; return Response.json({ error: { message: 'unsupported parameter' } }, { status: 400 }); };
    await rejectCode(run(), 'UNSUPPORTED_PARAMETER'); assert.equal(calls, 2);
  });
  await test('provider-wide circuit opens after two failures instead of exhausting the pool', async () => {
    await add('Primary', 'a'); await add('Backup', 'b', 2); await add('Third', 'c', 3); let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ error: { message: 'unavailable' } }, { status: 503 }); };
    await rejectCode(run(), 'PROVIDER_ERROR'); assert.equal(calls, 2);
    await rejectCode(run(), 'NO_READY_KEY'); assert.equal(calls, 2);
    assert((await vault.vaultStatus(request())).health.some(h => h.scope === 'provider:gemini' && h.until > Date.now()));
  });
  await test('settings enforce a single total attempt budget', async () => {
    for (let i = 1; i <= 4; i++) await add(`Key${i}`, `project${i}`, i);
    await vault.saveSettings('alice', { mode: 'priority', maxAttempts: 2 }); let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({}, { status: 401 }); };
    await rejectCode(run(), 'INVALID_KEY'); assert.equal(calls, 2);
    await assert.rejects(vault.saveSettings('alice', { mode: 'priority', maxAttempts: 4 }));
  });
  await test('balanced mode alternates keys and disabled or wrong-role keys stay unused', async () => {
    await add('First', 'a'); await add('Second', 'b', 2); await add('Disabled', 'c', 1, 'alice', 'both', false); await add('Evaluator', 'd', 1, 'alice', 'evaluator');
    await vault.saveSettings('alice', { mode: 'balanced', maxAttempts: 3 }); const used = [];
    globalThis.fetch = async (_url, options) => { used.push(options.headers['x-goog-api-key']); return success(); };
    await run(); await run(); assert(used[0].includes('First')); assert(used[1].includes('Second'));
  });
  await test('concurrent requests use separate keys and duplicate jobs replay exactly once', async () => {
    await add('First', 'a'); await add('Second', 'b', 2);
    const resolvers = [], secrets = [];
    globalThis.fetch = async (_url, options) => { secrets.push(options.headers['x-goog-api-key']); return new Promise(resolve => resolvers.push(() => resolve(success()))); };
    const id = crypto.randomUUID(); const one = run(request('alice', id));
    await until(() => resolvers.length >= 1);
    await rejectCode(run(request('alice', id)), 'REQUEST_RUNNING');
    const two = run(); await until(() => resolvers.length >= 2);
    assert.notEqual(secrets[0], secrets[1]); resolvers.forEach(resolve => resolve());
    const [first] = await Promise.all([one, two]);
    assert.deepEqual(await run(request('alice', id)), first); assert.equal(secrets.length, 2);
    await rejectCode(run(request('alice', id), 'generator', 'Different input'), 'INVALID_INPUT');
    const jobs = runtime.DB.sqlite.prepare('SELECT result FROM vault_jobs').all(); assert(!JSON.stringify(jobs).includes('Validated result'));
    assert.equal(runtime.DB.sqlite.prepare('SELECT count(*) n FROM vault_leases').get().n, 0);
  });
  await test('bounded queue rechecks every busy key and resumes when a lease releases', async () => {
    await add('First', 'a'); await add('Second', 'b', 2);
    const resolvers = [], secrets = [];
    globalThis.fetch = async (_url, options) => { secrets.push(options.headers['x-goog-api-key']); return new Promise(resolve => resolvers.push(() => resolve(success()))); };
    const one = run(); await until(() => resolvers.length === 1);
    const two = run(); await until(() => resolvers.length === 2);
    const three = run(); await new Promise(r => setTimeout(r, 50)); assert.equal(resolvers.length, 2);
    resolvers[0](); await one;
    await until(() => resolvers.length === 3); assert.equal(secrets[0], secrets[2]);
    resolvers[1](); resolvers[2](); await Promise.all([two, three]);
    assert.equal(runtime.DB.sqlite.prepare('SELECT count(*) n FROM vault_leases').get().n, 0);
  });
  await test('project and user rate limits are atomic across concurrent reservations', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => vault.rateLimit('alice', 'project:a:model', 12)));
    assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 12);
    assert.equal(attempts.filter(a => a.status === 'rejected' && a.reason.code === 'RATE_LIMIT').length, 8);
  });
  await test('metadata checks are honest, clear model permission state, and never generate content', async () => {
    const id = await add('Primary', 'a'), key = (await vault.getKeys('alice'))[0];
    const { AppError } = await import(pathToFileURL(path.join(dir, 'server.js')));
    await vault.recordFailure('alice', key, model, new AppError('KEY_PERMISSION_DENIED', 'denied'));
    globalThis.fetch = async (url, options) => { assert(!url.includes('generateContent')); assert.equal(options.method, undefined); return Response.json({ name: `models/${model}`, supportedGenerationMethods: ['generateContent'] }); };
    await vault.testKey('alice', id, model);
    const status = await vault.vaultStatus(request()); assert(status.keys[0].testedAt); assert.equal(status.health.length, 0); assert.equal(status.events[0].outcome, 'TEST_OK');
  });
  await test('deleting a key erases its records without exposing credentials', async () => {
    const id = await add('Primary', 'a'); globalThis.fetch = async () => success(); await run();
    await vault.removeKey('alice', id); const status = await vault.vaultStatus(request()); assert.equal(status.keys.length, 0); assert.equal(status.events.length, 0);
  });
  await test('password-encrypted backup restores keys, rejects tampering and skips duplicates', async () => {
    const backup = await import(pathToFileURL(path.join(dir, 'vault-backup.js')));
    await add('Primary', 'a'); await add('Secondary', 'b', 2);
    await vault.saveSettings('alice', { mode: 'balanced', maxAttempts: 2 });
    const password = 'test-only-backup-passphrase';
    const { backupMaterial } = await import(pathToFileURL(path.join(dir, 'backup-material.js')));
    const material = await backupMaterial(password);
    const archive = await backup.exportBackup('alice', material.wrappingKey, material.salt);
    assert(!JSON.stringify(archive).includes('test-credential'));
    assert.deepEqual(await backup.importBackup('bob', material.wrappingKey, archive), { imported: 2, skipped: 0 });
    assert.equal((await vault.getSettings('bob')).mode, 'balanced');
    assert.deepEqual(await backup.importBackup('bob', material.wrappingKey, archive), { imported: 0, skipped: 2 });
    const wrong = await backupMaterial('incorrect-passphrase', archive.salt);
    await rejectCode(backup.importBackup('bob', wrong.wrappingKey, archive), 'BACKUP_INVALID');
    await rejectCode(backup.importBackup('bob', material.wrappingKey, { ...archive, ciphertext: archive.ciphertext.slice(0, -10) + 'tampered==' }), 'BACKUP_INVALID');
  });

  await test('legacy SQL migration preserves Gemini ciphertext and owner binding', async () => {
    const legacy = database(); legacy.sqlite.exec(await readFile('drizzle/0000_elite_betty_ross.sql', 'utf8'));
    const id = crypto.randomUUID(), secret = 'legacy-test-secret-123456789012345', ciphertext = await encryption.seal(secret, 'transly:key:alice:' + id);
    legacy.sqlite.prepare('INSERT INTO vault_keys (id,owner,name,project,role,priority,enabled,ciphertext,fingerprint,suffix,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, 'alice', 'Legacy', 'old-project', 'both', 1, 1, ciphertext, await encryption.digest(secret), secret.slice(-4), Date.now());
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
    for (const entry of journal.entries.slice(1)) legacy.sqlite.exec(await readFile('drizzle/' + entry.tag + '.sql', 'utf8'));
    runtime.DB.sqlite.close(); runtime.DB = legacy;
    const [key] = await vault.getKeys('alice'); assert.equal(key.provider, 'gemini'); assert.equal(key.ciphertext, ciphertext); assert.equal(key.tested_model, null);
    globalThis.fetch = async () => success(); assert.equal((await run()).title, 'Validated result');
  });

  await test('v2 backup retains provider and authenticates the version', async () => {
    const backup = await import(pathToFileURL(path.join(dir, 'vault-backup.js'))), { backupMaterial } = await import(pathToFileURL(path.join(dir, 'backup-material.js')));
    await add('Gemini', 'a'); const material = await backupMaterial('test-only-backup-password'); const archive = await backup.exportBackup('alice', material.wrappingKey, material.salt);
    assert.equal(archive.version, 2); await backup.importBackup('bob', material.wrappingKey, archive); assert.deepEqual((await vault.getKeys('bob')).map(key => key.provider), ['gemini']);
    await rejectCode(backup.importBackup('bob', material.wrappingKey, { ...archive, version: 1 }), 'BACKUP_INVALID');
  });

  await test('v1 encrypted backups remain readable and default restored keys to Gemini', async () => {
    const backup = await import(pathToFileURL(path.join(dir, 'vault-backup.js'))), { backupMaterial } = await import(pathToFileURL(path.join(dir, 'backup-material.js')));
    const material = await backupMaterial('old-backup-test-password'); const key = await crypto.subtle.importKey('raw', Buffer.from(material.wrappingKey, 'base64'), 'AES-GCM', false, ['encrypt']); const iv = crypto.getRandomValues(new Uint8Array(12));
    const content = { keys: [{ name: 'Legacy key', project: 'legacy', role: 'both', priority: 1, enabled: true, secret: 'legacy-backup-test-secret-123456789012345' }], settings: { mode: 'priority', maxAttempts: 3 } };
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('transly-vault-backup:v1') }, key, new TextEncoder().encode(JSON.stringify(content)));
    const archive = { format: 'transly-vault-backup', version: 1, iterations: 600000, salt: material.salt, iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(ciphertext).toString('base64') };
    assert.equal((await backup.importBackup('alice', material.wrappingKey, archive)).imported, 1); assert.equal((await vault.getKeys('alice'))[0].provider, 'gemini');
  });

  await test('cached results remain replayable after the selected credential is removed', async () => {
    const id = await add('Cached', 'a'); const req = request(); let calls = 0;
    globalThis.fetch = async () => { calls++; return success(); };
    const selection = { keyId: id }, validate = raw => raw;
    const result = await vault.runWithVault(req, 'generator', model, 'Original request', schema, validate, selection);
    await vault.removeKey('alice', id);
    assert.deepEqual(await vault.runWithVault(req, 'generator', model, 'Original request', schema, validate, selection), result); assert.equal(calls, 1);
  });
  console.log(`${passed} vault integration tests passed. Provider responses are simulated.`);
} finally { globalThis.fetch = originalFetch; runtime.DB?.sqlite.close(); }
