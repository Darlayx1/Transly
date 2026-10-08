import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('This smoke test uses development-only mock sign-in on loopback.');
const login = await fetch(base + '/signin-with-chatgpt?return_to=%2F', { redirect: 'manual' });
assert.equal(login.status, 302);
const cookie = login.headers.get('set-cookie').split(';')[0];
const call = (body, endpoint = '/api/credentials') => fetch(base + endpoint, { method: body ? 'POST' : 'GET', headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const fake = `test-http-invalid-key-${crypto.randomUUID()}`, name = `HTTP smoke ${crypto.randomUUID().slice(0, 8)}`;
let id, groqId;
try {
  const spoof = await fetch(base + '/api/credentials', { headers: { 'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': 'forged@test.invalid' } });
  assert.equal((await spoof.json()).account, null); console.log('PASS local auth strips spoofed identity');
  const add = await call({ action: 'add', name, project: 'http-test-project', priority: 3, role: 'both', enabled: true, secret: fake });
  const data = await add.json(); assert.equal(add.status, 200); assert(data.account); assert(!JSON.stringify(data).includes(fake));
  id = data.keys.find(k => k.name === name).id; console.log('PASS authenticated vault saves masked metadata');
  const reload = await call(); const restored = await reload.json(); assert(restored.keys.some(k => k.id === id)); console.log('PASS key survives independent HTTP status request');
  const duplicate = await call({ action: 'add', name, project: 'other', priority: 1, role: 'both', secret: fake }); assert.equal(duplicate.status, 409); console.log('PASS duplicate rejected');
  const cross = await fetch(base + '/api/credentials', { method: 'POST', headers: { cookie, origin: 'https://untrusted.test', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'remove', id }) }); assert.equal(cross.status, 403); console.log('PASS authenticated cross-origin mutation rejected');
  const updated = await call({ action: 'update', id, name, project: 'http-test-project', priority: 3, role: 'evaluator', enabled: false }); assert.equal(updated.status, 200); const changed = (await updated.json()).keys.find(k => k.id === id); assert.equal(changed.enabled, false); assert.equal(changed.role, 'evaluator'); console.log('PASS metadata update retains secret and disables key');
  const unsigned = await fetch(base + '/api/credentials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'remove', id }) }); assert.equal(unsigned.status, 401); console.log('PASS anonymous vault write rejected');

  const groqFake = 'test-http-groq-disposable-' + crypto.randomUUID();
  const groq = await call({ action: 'add', provider: 'groq', name: 'Groq HTTP smoke', project: 'http-org', priority: 2, role: 'both', enabled: true, secret: groqFake });
  const groqData = await groq.json(); assert.equal(groq.status, 200); groqId = groqData.addedId; assert(groqId); assert.equal(groqData.keys.find(k => k.id === groqId).provider, 'groq'); assert(!JSON.stringify(groqData).includes(groqFake)); console.log('PASS Groq key returns masked provider metadata');
  const config = { level: 'B1', length: 'short', duration: 5, topic: '', style: '', generator: 'gemini-3.5-flash', evaluator: 'groq:openai/gpt-oss-20b' };
  const mismatch = await call({ ...config, generatorKeyId: groqId }, '/api/generate'); assert.equal(mismatch.status, 400); assert.equal((await mismatch.json()).error.code, 'INVALID_INPUT'); console.log('PASS generate rejects mismatched provider before calling upstream');
  const evaluateMismatch = await call({ config: { ...config, evaluatorKeyId: id }, sourceText: 'This is a sufficiently long source sentence.', userTranslation: 'Ini kalimat sumber.' }, '/api/evaluate'); assert.equal(evaluateMismatch.status, 400); assert.equal((await evaluateMismatch.json()).error.code, 'INVALID_INPUT'); console.log('PASS evaluate rejects mismatched provider before calling upstream');
  const switchWithoutSecret = await call({ action: 'update', id: groqId, provider: 'gemini', name: 'No new secret', project: 'http', priority: 2, role: 'both', enabled: true }); assert.equal(switchWithoutSecret.status, 400); console.log('PASS provider change requires a replacement secret through HTTP');
  const { backupMaterial } = await import('../.sites-runtime/vault-tests/backup-material.js');
  const material = await backupMaterial('http-test-only-passphrase');
  const exported = await call({ action: 'export', ...material }, '/api/credentials/backup'); assert.equal(exported.status, 200);
  const archive = (await exported.json()).backup; assert(archive.ciphertext); assert(!JSON.stringify(archive).includes(fake)); console.log('PASS backup export returns only encrypted content');
  const imported = await call({ action: 'import', ...material, backup: archive }, '/api/credentials/backup'); assert.equal(imported.status, 200); assert.equal((await imported.json()).imported, 0); console.log('PASS backup import safely skips existing records');
} finally {
  if (groqId) { const removed = await call({ action: 'remove', id: groqId }); assert.equal(removed.status, 200); console.log('PASS Groq smoke test record removed'); }
  if (id) { const removed = await call({ action: 'remove', id }); assert.equal(removed.status, 200); console.log('PASS smoke test record removed'); }
}
