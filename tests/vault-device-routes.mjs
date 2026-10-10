import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = path.resolve('.sites-runtime/device-route-tests');
await mkdir(directory, { recursive: true });
globalThis.__vaultTestEnv = {
  SESSION_SECRET: 'device-route-test-session-secret-1234567890',
  VAULT_ENCRYPTION_KEYS: JSON.stringify({ v1: 'device-route-vault-secret-1234567890' }),
  VAULT_ACTIVE_VERSION: 'v1',
};
const routes = {};
for (const name of ['credentials', 'generate', 'evaluate']) {
  const outfile = path.join(directory, `${name}.mjs`);
  await build({
    entryPoints: [`app/api/${name}/route.ts`], outfile, bundle: true,
    platform: 'node', format: 'esm', packages: 'external',
    alias: { '@': process.cwd() },
    plugins: [{ name: 'isolated-env', setup(plugin) {
      plugin.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'test' }));
      plugin.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const env = globalThis.__vaultTestEnv;', loader: 'js' }));
    } }],
  });
  routes[name] = await import(pathToFileURL(outfile));
}
const jwt = `e30.${Buffer.from(JSON.stringify({ sub: 'account-a', email: 'a@test.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test-signature`;
const key = 'test-device-key-1234567890';
const request = (endpoint, body, credentials) => new Request(`https://transly.test/api/${endpoint}`, {
  method: 'POST', headers: {
    'content-type': 'application/json', 'X-Transly-Auth': `Bearer ${jwt}`,
    ...(credentials ? { 'X-Transly-Credentials': credentials } : {}),
  }, body: JSON.stringify(body),
});
const saved = await routes.credentials.POST(request('credentials', { generator: key, evaluator: key }));
assert.equal(saved.status, 200, 'device credentials must not require a database or account vault');
const status = await saved.json();
assert.equal(status.device, true);
assert.equal(status.account, null);
assert.equal(status.generator, true);
assert(!JSON.stringify(status).includes(key));
assert.equal(typeof status.sessionToken, 'string');
console.log('PASS authenticated device credential exchange without a server vault');

const expiredJwt = `e30.${Buffer.from(JSON.stringify({ sub: 'account-a', exp: 1 })).toString('base64url')}.expired-signature`;
const expiredRequest = new Request('https://transly.test/api/credentials', {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-Transly-Auth': `Bearer ${expiredJwt}`,
    'oai-authenticated-user-id': 'platform-user', 'oai-authenticated-user-email': 'platform@test.invalid' },
  body: JSON.stringify({ action: 'add', name: 'Must not save', secret: key }),
});
assert.equal((await routes.credentials.POST(expiredRequest)).status, 401, 'expired account sessions must not fall back to another platform identity');
console.log('PASS expired account tokens cannot open a different identity vault');

const config = { level: 'B1', length: 'short', topic: 'General', style: 'Neutral', duration: 5, generator: 'gemma-4-31b-it', evaluator: 'gemma-4-31b-it' };
const challenge = { title: 'Device practice', sourceText: 'This is an original practice passage with enough characters to verify local credential routing.', topic: 'General', style: 'Neutral' };
let upstreamCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  upstreamCalls++;
  assert.equal(new Headers(options.headers).get('x-goog-api-key'), key);
  const value = upstreamCalls === 1 ? challenge : {
    overallScore: 80, summaryFeedback: 'Makna sudah tepat.', strengths: ['Makna'], weaknesses: [],
    idealTranslation: 'Terjemahan contoh.', annotations: [],
    categoryScores: { accuracy: 80, grammar: 80, wordChoice: 80, naturalness: 80, completeness: 80, style: 80 },
  };
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] });
};
try {
  const generated = await routes.generate.POST(request('generate', config, status.sessionToken));
  assert.equal(generated.status, 200, JSON.stringify(await generated.clone().json()));
  assert.equal((await generated.json()).title, challenge.title);
  const evaluated = await routes.evaluate.POST(request('evaluate', { config, sourceText: challenge.sourceText, userTranslation: 'Jawaban uji.' }, status.sessionToken));
  assert.equal(evaluated.status, 200, JSON.stringify(await evaluated.clone().json()));
  assert.equal((await evaluated.json()).summaryFeedback, 'Makna sudah tepat.');
  assert.equal(upstreamCalls, 2);
  console.log('PASS generation and evaluation use device credentials even with a login token');

  const blocked = await routes.generate.POST(request('generate', { ...config, generatorKeyId: crypto.randomUUID() }, status.sessionToken));
  assert.equal(blocked.status, 401);
  assert.equal(upstreamCalls, 2, 'device mode must never read server key IDs');
  const invalid = await routes.generate.POST(request('generate', config, 'invalid-token'));
  assert.equal(invalid.status, 503, 'invalid device token must not bypass account vault routing');
  assert.equal(upstreamCalls, 2);
  console.log('PASS invalid device tokens and server key selections cannot bypass vault isolation');
} finally {
  globalThis.fetch = originalFetch;
}
