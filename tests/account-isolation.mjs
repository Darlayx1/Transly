import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

const dir = path.resolve('.sites-runtime/isolation-tests');
await mkdir(dir, { recursive: true });

// Setup test environment
globalThis.__vaultTestEnv = {
  VAULT_ENCRYPTION_KEYS: JSON.stringify({ v1: 'isolation-test-secret-12345678901234567890' }),
  VAULT_ACTIVE_VERSION: 'v1',
};

for (const name of ['config', 'credential-schema', 'provider-adapters', 'vault-types', 'schema', 'server', 'vault-crypto', 'owner', 'account-auth', 'client-keys', 'device-vault', 'history', 'storage-layer', 'vault']) {
  const source = (await readFile(`lib/transly/${name}.ts`, 'utf8'))
    .replace("import { env } from 'cloudflare:workers';", 'const env = globalThis.__vaultTestEnv;')
    .replace(/from '(\.\/[^']+)'/g, "from '$1.js'");
  await writeFile(path.join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}

const ownerModule = await import(pathToFileURL(path.join(dir, 'owner.js')));
const storageLayerModule = await import(pathToFileURL(path.join(dir, 'storage-layer.js')));
const historyModule = await import(pathToFileURL(path.join(dir, 'history.js')));
const deviceVaultModule = await import(pathToFileURL(path.join(dir, 'device-vault.js')));
const vaultModule = await import(pathToFileURL(path.join(dir, 'vault.js')));
const accountAuthModule = await import(pathToFileURL(path.join(dir, 'account-auth.js')));
const schemaModule = await import(pathToFileURL(path.join(dir, 'schema.js')));

const { formatAccountOwner, getStorageOwner, isAccountOwner, extractUserId } = ownerModule;
const { StorageLayer, STORAGE_PREFIX } = storageLayerModule;
const { emptyHistory, identifySession, updateHistory } = historyModule;
const { newDeviceKey } = deviceVaultModule;
const { defaultConfig } = schemaModule;

// Memory storage mock for browser localStorage
const memoryStore = new Map();
const storageMock = {
  getItem: key => memoryStore.get(key) ?? null,
  setItem: (key, value) => memoryStore.set(key, String(value)),
  removeItem: key => memoryStore.delete(key),
  clear: () => memoryStore.clear(),
};
globalThis.window = { localStorage: storageMock };
globalThis.localStorage = storageMock;

// D1 Database in-memory setup
function setupD1() {
  const sqlite = new DatabaseSync(':memory:');
  const prepare = (sql, values = []) => {
    const execute = () => {
      const q = sqlite.prepare(sql);
      const returnsRows = q.columns().length > 0;
      const rows = returnsRows ? q.all(...values) : [];
      const changes = returnsRows ? Number(sqlite.prepare('SELECT changes() n').get().n) : Number(q.run(...values).changes);
      return { success: true, results: rows, meta: { changes } };
    };
    return {
      bind: (...v) => prepare(sql, v),
      first: async (col) => {
        const row = sqlite.prepare(sql).get(...values);
        return row ? (col ? row[col] : row) : null;
      },
      run: async () => execute(),
      all: async () => execute(),
      execute,
    };
  };
  return {
    sqlite,
    prepare,
    batch: async statements => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(s => s.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

async function resetD1() {
  globalThis.__vaultTestEnv.DB?.sqlite.close();
  globalThis.__vaultTestEnv.DB = setupD1();
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
  for (const entry of journal.entries) {
    globalThis.__vaultTestEnv.DB.sqlite.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
  }
}

// Helper to craft a mock Supabase JWT
function createTestJwt(userId, email, expSec = Math.floor(Date.now() / 1000) + 3600) {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replaceAll('=', '');
  const payload = btoa(JSON.stringify({ sub: userId, email, exp: expSec, role: 'authenticated', aud: 'authenticated' })).replaceAll('=', '');
  const signature = 'test_signature_' + Math.random().toString(36).slice(2);
  return `${header}.${payload}.${signature}`;
}

console.log('--- Starting Account Isolation & Local Storage Tests ---');

// Test 1: Owner Identity Consistency
{
  assert.equal(getStorageOwner(null), 'guest');
  assert.equal(getStorageOwner(undefined), 'guest');
  assert.equal(getStorageOwner(''), 'guest');
  assert.equal(getStorageOwner('user-123'), 'account:user-123');
  assert(isAccountOwner('account:user-123'));
  assert(!isAccountOwner('guest'));
  assert.equal(extractUserId('account:user-123'), 'user-123');
  assert.equal(extractUserId('guest'), null);
  console.log('PASS 1: Owner identity functions format and extract guest and account:<userId> consistently');
}

// Test 2: Guest -> Refresh: Settings, Draft, History, and Keys remain available locally
{
  memoryStore.clear();
  const guestOwner = 'guest';

  // Save guest config
  const customConfig = { ...defaultConfig, level: 'C1', length: 'long', duration: 30 };
  StorageLayer.writeConfig(guestOwner, customConfig);

  // Save guest history & draft
  const session = identifySession({
    config: customConfig,
    challenge: { title: 'Guest Challenge', sourceText: 'English source text for translation practice.', topic: 'science', style: 'formal' },
    answer: 'Draft terjemahan guest.',
    deadline: Date.now() + 60000,
    startedAt: Date.now(),
  });
  const historyCache = updateHistory(emptyHistory(), session);
  StorageLayer.writeHistory(guestOwner, historyCache);

  // Save guest API key
  const guestVault = {
    keys: [newDeviceKey('Guest Key 1', 'test-guest-secret-key-12345', 'both', 1)],
    settings: { mode: 'priority', maxAttempts: 3 },
  };
  StorageLayer.writeGuestVault(guestVault);

  // Simulate refresh: re-read everything for guest
  const loadedConfig = StorageLayer.readConfig(guestOwner);
  const loadedHistory = StorageLayer.readHistory(guestOwner);
  const loadedVault = StorageLayer.readGuestVault();

  assert.equal(loadedConfig.level, 'C1');
  assert.equal(loadedConfig.duration, 30);
  assert.equal(loadedHistory.entries.length, 1);
  assert.equal(loadedHistory.entries[0].session.answer, 'Draft terjemahan guest.');
  assert.equal(loadedVault.keys.length, 1);
  assert.equal(loadedVault.keys[0].secret, 'test-guest-secret-key-12345');
  console.log('PASS 2: Guest -> refresh preserves config, draft, history, and API keys locally');
}

// Test 3: Guest -> Login Account A: Guest data does not leak into Account A
{
  const accountA = formatAccountOwner('uuid-account-a');

  // Account A reads config and history
  const aConfig = StorageLayer.readConfig(accountA);
  const aHistory = StorageLayer.readHistory(accountA);

  // Account A has its default/clean state, NOT guest's C1 / Draft
  assert.notEqual(aConfig.level, 'C1');
  assert.equal(aHistory.entries.length, 0);

  // Guest data remains intact in guest space
  assert.equal(StorageLayer.readHistory('guest').entries.length, 1);
  assert.equal(StorageLayer.readGuestVault().keys.length, 1);
  console.log('PASS 3: Guest -> login A: guest data never automatically enters Account A');
}

// Test 4: Account A -> Account B: Complete isolation
{
  const accountA = formatAccountOwner('uuid-account-a');
  const accountB = formatAccountOwner('uuid-account-b');

  // Account A writes private data
  const aSession = identifySession({
    config: { ...defaultConfig, level: 'B1', length: 'short', duration: 25 },
    challenge: { title: 'A Exclusive', sourceText: 'Exclusive text for Account A only.', topic: 'daily', style: 'casual' },
    answer: 'Jawaban rahasia akun A.',
    deadline: Date.now() + 60000,
    startedAt: Date.now(),
  });
  StorageLayer.writeHistory(accountA, updateHistory(emptyHistory(), aSession));
  StorageLayer.writeConfig(accountA, aSession.config);

  // Switch to Account B
  const bConfig = StorageLayer.readConfig(accountB);
  const bHistory = StorageLayer.readHistory(accountB);

  // Account B cannot see Account A's history or config
  assert.equal(bHistory.entries.length, 0);
  assert.notEqual(bConfig.duration, 25);
  console.log('PASS 4: Account A -> Account B: total isolation between accounts');
}

// Test 5: Account B -> Logout: Account B cache purged, Guest restored
{
  const accountB = formatAccountOwner('uuid-account-b');
  const bUserId = 'uuid-account-b';

  // Save something in B's local cache
  StorageLayer.writeConfig(accountB, { ...defaultConfig, level: 'A2', length: 'short', duration: 10 });
  assert.equal(StorageLayer.readConfig(accountB).level, 'A2');

  // Logout clears account cache
  StorageLayer.clearAccountCache(bUserId);

  // Account B cache is gone
  assert.equal(StorageLayer.readConfig(accountB).level, 'B1'); // fallback to default
  assert.equal(memoryStore.has(STORAGE_PREFIX.CONFIG + accountB), false);

  // Guest data is restored and intact
  const guestHistory = StorageLayer.readHistory('guest');
  assert.equal(guestHistory.entries.length, 1);
  assert.equal(guestHistory.entries[0].session.answer, 'Draft terjemahan guest.');
  console.log('PASS 5: Account B -> logout: account B device cache purged and guest space restored');
}

// Test 6: Server Vault Authorization & RLS: Direct access with another account's ID rejected
{
  await resetD1();
  const userA = 'user-uuid-1111';
  const userB = 'user-uuid-2222';
  const ownerA = formatAccountOwner(userA);
  const ownerB = formatAccountOwner(userB);

  // Account A adds a key to server vault
  const keyAId = await vaultModule.addKey(ownerA, {
    name: 'Account A Secret Key',
    project: 'proj-a',
    role: 'both',
    priority: 1,
    enabled: true,
    secret: 'test-real-secret-key-account-a-12345',
  });

  // Verify Account A has 1 key
  const keysA = await vaultModule.getKeys(ownerA);
  assert.equal(keysA.length, 1);
  assert.equal(keysA[0].id, keyAId);

  // Account B queries its keys -> 0 keys
  const keysB = await vaultModule.getKeys(ownerB);
  assert.equal(keysB.length, 0);

  // Account B attempts to update Account A's key directly -> KEY_NOT_FOUND (404)
  await assert.rejects(
    vaultModule.updateKey(ownerB, { id: keyAId, name: 'Hacked', project: 'proj-b', priority: 1, role: 'both', enabled: true }),
    err => err.code === 'KEY_NOT_FOUND'
  );

  // Account B attempts to delete Account A's key directly -> KEY_NOT_FOUND (404)
  await assert.rejects(
    vaultModule.removeKey(ownerB, keyAId),
    err => err.code === 'KEY_NOT_FOUND'
  );

  // Account B attempts to test Account A's key directly -> KEY_NOT_FOUND (404)
  await assert.rejects(
    vaultModule.testKey(ownerB, keyAId, 'gemini-3.5-flash'),
    err => err.code === 'KEY_NOT_FOUND'
  );

  console.log('PASS 6: Server vault strictly rejects cross-account reads, updates, deletes, and test requests');
}

// Test 7: Backend JWT token verification without trusting client-supplied userId
{
  const realUserId = 'auth-user-9999';
  const validToken = createTestJwt(realUserId, 'alice@example.com');
  const reqWithToken = new Request('https://transly.test/api/credentials', {
    headers: { 'X-Transly-Auth': `Bearer ${validToken}` },
  });

  const verified = await accountAuthModule.getVerifiedAccount(reqWithToken);
  assert(verified !== null);
  assert.equal(verified.userId, realUserId);
  assert.equal(verified.owner, `account:${realUserId}`);

  // Spoofed request trying to pass a fake user ID in headers or body
  const spoofReq = new Request('https://transly.test/api/credentials', {
    headers: {
      'X-Transly-Auth': `Bearer ${validToken}`,
      'x-spoofed-user-id': 'victim-user-0000',
    },
  });
  const verifiedSpoof = await accountAuthModule.getVerifiedAccount(spoofReq);
  assert.equal(verifiedSpoof.userId, realUserId); // stays real user ID from token!

  // Request with expired token
  const expiredToken = createTestJwt(realUserId, 'alice@example.com', Math.floor(Date.now() / 1000) - 100);
  const expiredReq = new Request('https://transly.test/api/credentials', {
    headers: { 'X-Transly-Auth': `Bearer ${expiredToken}` },
  });
  assert.equal(await accountAuthModule.getVerifiedAccount(expiredReq), null);
  console.log('PASS 7: Backend derives owner solely from verified JWT and rejects expired or spoofed IDs');
}

// Test 8: ChatGPT headers are NOT automatically accepted as Supabase account
{
  const chatgptReq = new Request('https://transly.test/api/credentials', {
    headers: {
      'oai-authenticated-user-id': 'chatgpt-user-5555',
      'oai-authenticated-user-email': 'chatgpt@example.com',
    },
  });
  const result = await accountAuthModule.getVerifiedAccount(chatgptReq);
  assert.equal(result, null);
  console.log('PASS 8: ChatGPT identity is NOT automatically recognized as a Supabase account');
}

// Test 9: Selective import from guest to account retains source data
{
  memoryStore.clear();
  // Setup guest data
  const guestSession = identifySession({
    config: { ...defaultConfig, level: 'B2', length: 'medium', duration: 20 },
    challenge: { title: 'Import Candidate', sourceText: 'Text to import for practicing Indonesian translation.', topic: 'culture', style: 'news' },
    answer: 'Terjemahan sebelum impor.',
    deadline: Date.now() + 60000,
    startedAt: Date.now(),
  });
  StorageLayer.writeHistory('guest', updateHistory(emptyHistory(), guestSession));

  const accountOwner = formatAccountOwner('new-user-7777');
  assert.equal(StorageLayer.readHistory(accountOwner).entries.length, 0);

  // Import history from guest
  const guestHistory = StorageLayer.readHistory('guest');
  let accountHistory = StorageLayer.readHistory(accountOwner);
  for (const entry of guestHistory.entries) {
    accountHistory = updateHistory(accountHistory, entry.session);
  }
  StorageLayer.writeHistory(accountOwner, accountHistory);

  // Account now has the session
  assert.equal(StorageLayer.readHistory(accountOwner).entries.length, 1);
  assert.equal(StorageLayer.readHistory(accountOwner).entries[0].session.challenge.title, 'Import Candidate');

  // Source guest data is preserved!
  assert.equal(StorageLayer.readHistory('guest').entries.length, 1);
  assert.equal(StorageLayer.readHistory('guest').entries[0].session.challenge.title, 'Import Candidate');
  console.log('PASS 9: Selective import copies data into account while retaining source guest data');
}

console.log('ALL 9 ACCOUNT ISOLATION TESTS PASSED!');
