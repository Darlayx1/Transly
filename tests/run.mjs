import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Compile the exact source into an ignored folder. Only the platform env import
// is adapted; provider responses are mocked and never impersonate live AI.
const dir = path.resolve('.sites-runtime/tests'); await mkdir(dir, { recursive: true });
for (const name of ['config', 'schema', 'server']) {
  const source = (await readFile(`lib/transly/${name}.ts`, 'utf8')).replace("from './config'", "from './config.js'").replace("import { env } from 'cloudflare:workers';", 'const env = {};');
  await writeFile(path.join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const { normalizeEvaluation } = await import(pathToFileURL(path.join(dir, 'schema.js')));
const server = await import(pathToFileURL(path.join(dir, 'server.js')));
const raw = { overallScore: 80, summaryFeedback: 'Pertahankan makna sumber.', strengths: ['Konteks jelas.'], weaknesses: ['Periksa negasi.'], sourceText: 'ignored', userTranslation: 'ignored', idealTranslation: 'Saya tidak pergi.', categoryScores: { accuracy: 80, grammar: 80, wordChoice: 80, naturalness: 80, completeness: 80, style: 80 }, annotations: [] };
const ann = (quote, start = 99, severity = 'major') => ({ start, end: start + quote.length, originalText: quote, severity, explanation: 'Makna berbeda.', context: 'Sumber menggunakan negasi.', suggestion: 'Pertahankan negasi.', improvedText: 'tidak pergi' });
let passed = 0;
async function test(name, action) { await action(); passed++; console.log(`PASS ${name}`); }
await test('repair UTF-16 offsets and preserve authoritative text', () => { const r = normalizeEvaluation({ ...raw, annotations: [ann('pergi')] }, 'source', '😊 Saya pergi.'); assert.equal(r.annotations[0].start, 8); assert.equal(r.userTranslation, '😊 Saya pergi.'); assert.equal(r.sourceText, 'source'); });
await test('discard ambiguous quotes, invalid severity and overlaps', () => { const r = normalizeEvaluation({ ...raw, annotations: [ann('Saya'), ann('Saya pergi', 0), ann('pergi', 5), ann('tidak ditemukan'), ann('Saya', 99, 'unknown')] }, 'source', 'Saya pergi. Saya pulang.'); assert.equal(r.annotations.length, 1); assert.equal(r.annotationWarnings, 4); });
await test('all four severities retain exact boundaries', () => { const text = 'saran kecil besar kritis'; const r = normalizeEvaluation({ ...raw, annotations: ['suggestion','minor','major','fatal'].map((s,i)=>ann(text.split(' ')[i],99,s)) }, 'source', text); assert.equal(r.annotations.length,4); for(const a of r.annotations) assert.equal(text.slice(a.start,a.end),a.originalText); });
await test('reject incomplete evaluations and scores outside range', () => { assert.throws(() => normalizeEvaluation({ ...raw, overallScore: 101 }, 'source', 'answer')); assert.throws(() => normalizeEvaluation({ annotations: [] }, 'source', 'answer')); });
await test('empty answer has no fabricated spans', () => { assert.equal(normalizeEvaluation({ ...raw, annotations: [ann('missing')] }, 'source', '').annotations.length, 0); });
process.env.SESSION_SECRET = 'test-only-value-not-a-real-secret-12345678';
await test('cookie encrypts credentials, is HttpOnly, secure and round-trips', async () => { const req = new Request('https://transly.test/api/credentials'); const cookie = await server.credentialCookie(req,'test-key-generator-123456','test-key-evaluator-123456'); assert(!cookie.includes('test-key')); assert(cookie.includes('HttpOnly')); assert(cookie.includes('Secure')); assert(cookie.includes('SameSite=Strict')); const result = await server.readCredentials(new Request(req.url,{headers:{cookie:cookie.split(';')[0]}})); assert.equal(result.generator,'test-key-generator-123456'); const bad = await server.readCredentials(new Request(req.url,{headers:{cookie:cookie.split(';')[0]+'corrupt'}})); assert.equal(bad,null); });
await test('reject cross-origin and oversized requests', async () => { await assert.rejects(server.readBody(new Request('https://transly.test/api/generate',{method:'POST',headers:{origin:'https://other.test','content-type':'application/json'},body:'{}'})),e=>e.status===403); await assert.rejects(server.readBody(new Request('https://transly.test/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(60001)})),e=>e.status===413); });
const originalFetch = globalThis.fetch;
for (const [status,code] of [[401,'INVALID_KEY'],[403,'INVALID_KEY'],[404,'MODEL_UNAVAILABLE'],[429,'QUOTA_EXCEEDED'],[503,'PROVIDER_ERROR']]) await test(`provider ${status} maps to safe ${code}`,async()=>{ globalThis.fetch=async()=>Response.json({error:{message:'upstream secret detail'}},{status}); await assert.rejects(server.generateJson('test-key','gemini-3.8-flash','prompt',{}),e=>e.code===code&&!e.message.includes('secret')); });
await test('parse fenced JSON and omit thinking parts', async()=>{globalThis.fetch=async()=>Response.json({candidates:[{content:{parts:[{text:'reasoning',thought:true},{text:'```json\n{"title":"Test"}\n```'}]}}]});assert.deepEqual(await server.generateJson('test-key','gemma-4-31b-it','prompt',{}),{title:'Test'});});
await test('reject invalid JSON',async()=>{globalThis.fetch=async()=>Response.json({candidates:[{content:{parts:[{text:'invalid json'}]}}]});await assert.rejects(server.generateJson('test-key','gemini-3.8-flash','prompt',{}),e=>e.code==='INVALID_RESPONSE');});
await test('network failure does not reveal internals',async()=>{globalThis.fetch=async()=>{throw new Error('private network detail')};await assert.rejects(server.generateJson('test-key','gemini-3.8-flash','prompt',{}),e=>e.code==='NETWORK_ERROR'&&!e.message.includes('private'));});
globalThis.fetch=originalFetch;
console.log(`${passed} tests passed. Live Google AI calls require a real user key.`);
