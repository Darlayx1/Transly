import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Compile the exact source into an ignored folder. Only the platform env import
// is adapted; provider responses are mocked and never impersonate live AI.
const dir = path.resolve('.sites-runtime/tests'); await mkdir(dir, { recursive: true });
for (const name of ['config', 'schema', 'server', 'sample']) {
  const source = (await readFile(`lib/transly/${name}.ts`, 'utf8')).replace("from './config'", "from './config.js'").replace("from './schema'", "from './schema.js'").replace("import { env } from 'cloudflare:workers';", 'const env = {};');
  await writeFile(path.join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const { normalizeEvaluation, defaultConfig, challengeSchema, evaluationSchema } = await import(pathToFileURL(path.join(dir, 'schema.js')));
const server = await import(pathToFileURL(path.join(dir, 'server.js')));
const { models } = await import(pathToFileURL(path.join(dir, 'config.js')));
const sample = await import(pathToFileURL(path.join(dir, 'sample.js')));
const raw = { overallScore: 80, summaryFeedback: 'Pertahankan makna sumber.', strengths: ['Konteks jelas.'], weaknesses: ['Periksa negasi.'], sourceText: 'ignored', userTranslation: 'ignored', idealTranslation: 'Saya tidak pergi.', categoryScores: { accuracy: 80, grammar: 80, wordChoice: 80, naturalness: 80, completeness: 80, style: 80 }, annotations: [] };
const ann = (quote, start = 99, severity = 'major') => ({ start, end: start + quote.length, originalText: quote, severity, explanation: 'Makna berbeda.', context: 'Sumber menggunakan negasi.', suggestion: 'Pertahankan negasi.', improvedText: 'tidak pergi' });
let passed = 0;
async function test(name, action) { await action(); passed++; console.log(`PASS ${name}`); }
await test('repair UTF-16 offsets and preserve authoritative text', () => { const r = normalizeEvaluation({ ...raw, annotations: [ann('pergi')] }, 'source', '😊 Saya pergi.'); assert.equal(r.annotations[0].start, 8); assert.equal(r.userTranslation, '😊 Saya pergi.'); assert.equal(r.sourceText, 'source'); });
await test('discard ambiguous quotes, invalid severity and overlaps', () => { const r = normalizeEvaluation({ ...raw, annotations: [ann('Saya'), ann('Saya pergi', 0), ann('pergi', 5), ann('tidak ditemukan'), ann('Saya', 99, 'unknown')] }, 'source', 'Saya pergi. Saya pulang.'); assert.equal(r.annotations.length, 1); assert.equal(r.annotationWarnings, 4); });
await test('all four severities retain exact boundaries', () => { const text = 'saran kecil besar kritis'; const r = normalizeEvaluation({ ...raw, annotations: ['suggestion','minor','major','fatal'].map((s,i)=>ann(text.split(' ')[i],99,s)) }, 'source', text); assert.equal(r.annotations.length,4); for(const a of r.annotations) assert.equal(text.slice(a.start,a.end),a.originalText); });
await test('reject incomplete evaluations and scores outside range', () => { assert.throws(() => normalizeEvaluation({ ...raw, overallScore: 101 }, 'source', 'answer')); assert.throws(() => normalizeEvaluation({ annotations: [] }, 'source', 'answer')); });
await test('empty answer has no fabricated spans', () => { assert.equal(normalizeEvaluation({ ...raw, annotations: [ann('missing')] }, 'source', '').annotations.length, 0); });
await test('default generator and evaluator use a verified available model', () => { assert.equal(defaultConfig.generator, 'gemini-3.5-flash'); assert.equal(defaultConfig.evaluator, 'gemini-3.5-flash'); });
await test('sample annotations cover exact non-overlapping spans in all four severities', () => {
  assert.equal(sample.sampleEvaluation.userTranslation, sample.sampleAnswer);
  assert.equal(sample.sampleEvaluation.sourceText, sample.sampleChallenge.sourceText);
  assert.deepEqual(sample.sampleEvaluation.annotations.map(a => a.severity), ['minor', 'major', 'fatal', 'suggestion']);
  let end = 0;
  for (const a of sample.sampleEvaluation.annotations) {
    assert(a.start >= end);
    assert.equal(sample.sampleAnswer.slice(a.start, a.end), a.originalText);
    end = a.end;
  }
});
process.env.SESSION_SECRET = 'test-only-value-not-a-real-secret-12345678';
await test('cookie encrypts credentials, is HttpOnly, secure and round-trips', async () => { const req = new Request('https://transly.test/api/credentials'); const cookie = await server.credentialCookie(req,'test-key-generator-123456','test-key-evaluator-123456'); assert(!cookie.includes('test-key')); assert(cookie.includes('HttpOnly')); assert(cookie.includes('Secure')); assert(cookie.includes('SameSite=Strict')); const result = await server.readCredentials(new Request(req.url,{headers:{cookie:cookie.split(';')[0]}})); assert.equal(result.generator,'test-key-generator-123456'); const bad = await server.readCredentials(new Request(req.url,{headers:{cookie:cookie.split(';')[0]+'corrupt'}})); assert.equal(bad,null); });
await test('reject cross-origin and oversized requests', async () => { await assert.rejects(server.readBody(new Request('https://transly.test/api/generate',{method:'POST',headers:{origin:'https://other.test','content-type':'application/json'},body:'{}'})),e=>e.status===403); await assert.rejects(server.readBody(new Request('https://transly.test/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(60001)})),e=>e.status===413); });
const originalFetch = globalThis.fetch;
await test('Gemma 4 name, provider ID and JSON request configuration', async () => {
  assert.equal(models.find(m => m.id === 'gemma-4-31b-it').name, 'Gemma 4 31B');
  const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent');
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType, undefined);
    assert.equal(body.generationConfig.responseJsonSchema, undefined);
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
    assert(body.contents[0].parts[0].text.includes(JSON.stringify(schema)));
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"title":"Gemma result"}' }] } }] });
  };
  assert.deepEqual(await server.generateJson('test-key', 'gemma-4-31b-it', 'Generate a passage.', schema), { title: 'Gemma result' });
});
await test('Pages bearer session decrypts only for the allowed origin without plaintext key', async () => {
  const cookie = await server.credentialCookie(new Request('https://transly.test/api/credentials'), 'test-pages-generator-12345', 'test-pages-evaluator-12345');
  const token = cookie.split(';')[0].slice('transly_credentials='.length);
  assert(!token.includes('test-pages'));
  const headers = { origin: 'https://darlayx1.github.io', authorization: `Bearer ${token}`, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' };
  const request = new Request('https://transly.test/api/generate', { method: 'POST', headers, body: '{}' });
  assert.deepEqual(await server.readBody(request), {});
  assert.equal((await server.readCredentials(request)).generator, 'test-pages-generator-12345');
  assert.equal(await server.readCredentials(new Request(request.url, { headers: { ...headers, origin: 'https://other.test' } })), null);
});

await test('all models have valid IDs and official display names', () => {
  assert(models.length >= 6);
  for (const m of models) {
    assert(m.id.startsWith('gemini-') || m.id.startsWith('gemma-'));
    assert(m.name.length > 0);
    assert(typeof m.structured === 'boolean');
  }
  const gemma = models.find(m => m.id === 'gemma-4-31b-it');
  assert(gemma);
  assert.equal(gemma.name, 'Gemma 4 31B');
  assert.equal(gemma.structured, false);
});

await test('Gemini structured output request configuration', async () => {
  const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(body.generationConfig.responseJsonSchema, schema);
    assert.equal(body.generationConfig.thinkingConfig, undefined);
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"title":"Gemini result"}' }] } }] });
  };
  assert.deepEqual(await server.generateJson('test-key', 'gemini-3.5-flash', 'prompt', schema), { title: 'Gemini result' });
});

await test('separate generator and evaluator credentials', async () => {
  const req = new Request('https://transly.test/api/credentials');
  const cookie = await server.credentialCookie(req, 'gen-key-unique', 'eval-key-unique');
  const authedReq = new Request(req.url, { headers: { cookie: cookie.split(';')[0] } });
  assert.equal(await server.resolveKey(authedReq, 'generator'), 'gen-key-unique');
  assert.equal(await server.resolveKey(authedReq, 'evaluator'), 'eval-key-unique');
});

await test('parse direct JSON, fenced JSON, embedded JSON, and repaired trailing commas', () => {
  assert.deepEqual(server.parseJsonResponse('{"title":"direct"}'), { title: 'direct' });
  assert.deepEqual(server.parseJsonResponse('```json\n{"title":"fenced"}\n```'), { title: 'fenced' });
  assert.deepEqual(server.parseJsonResponse('Preamble text\n{"title":"embedded"}\nPostscript text'), { title: 'embedded' });
  assert.deepEqual(server.parseJsonResponse('{"title":"repaired",}'), { title: 'repaired' });
  assert.deepEqual(server.parseJsonResponse('<thought>thinking</thought>{"title":"no-thought"}'), { title: 'no-thought' });
  assert.throws(() => server.parseJsonResponse(''), e => e.code === 'EMPTY_RESPONSE');
  assert.throws(() => server.parseJsonResponse('{broken json'), e => e.code === 'INVALID_RESPONSE');
  assert.throws(() => server.parseJsonResponse('x'.repeat(500001)), e => e.code === 'TOO_LARGE');
});

await test('combine multiple candidate parts and filter out thought parts', async () => {
  globalThis.fetch = async () => Response.json({
    candidates: [{
      content: {
        parts: [
          { text: 'internal thought', thought: true },
          { text: '{"title":' },
          { text: '"Combined"}' },
        ],
      },
    }],
  });
  assert.deepEqual(await server.generateJson('test-key', 'gemma-4-31b-it', 'prompt', {}), { title: 'Combined' });
});

await test('handle finishReason MAX_TOKENS as RESPONSE_TRUNCATED', async () => {
  globalThis.fetch = async () => Response.json({
    candidates: [{
      content: { parts: [{ text: '{"title":"Incom' }] },
      finishReason: 'MAX_TOKENS',
    }],
  });
  await assert.rejects(server.generateJson('test-key', 'gemma-4-31b-it', 'prompt', {}), e => e.code === 'RESPONSE_TRUNCATED');
});

await test('handle finishReason SAFETY as SAFETY_BLOCKED', async () => {
  globalThis.fetch = async () => Response.json({
    candidates: [{
      content: { parts: [{ text: '' }] },
      finishReason: 'SAFETY',
    }],
  });
  await assert.rejects(server.generateJson('test-key', 'gemma-4-31b-it', 'prompt', {}), e => e.code === 'SAFETY_BLOCKED');
});

await test('retry transient 502 error and succeed on second attempt', async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) return Response.json({ error: { message: 'temporary 502' } }, { status: 502 });
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"title":"Recovered"}' }] } }] });
  };
  const result = await server.generateJson('test-key', 'gemma-4-31b-it', 'prompt', {});
  assert.equal(attempts, 2);
  assert.deepEqual(result, { title: 'Recovered' });
});

await test('challenge validation with challengeSchema', () => {
  const valid = { title: 'Test Challenge', sourceText: 'This is a sample source text for testing CEFR level B1 translation.', topic: 'General', style: 'Neutral' };
  assert.equal(challengeSchema.safeParse(valid).success, true);
  assert.equal(challengeSchema.safeParse({ ...valid, sourceText: 'too short' }).success, false);
});

await test('evaluation validation with evaluationSchema', () => {
  assert.equal(evaluationSchema.safeParse(raw).success, true);
  assert.equal(evaluationSchema.safeParse({ ...raw, overallScore: -1 }).success, false);
});

await test('granular error mapping for 400 parameter, 403 permission, and 429 rate limit', async () => {
  globalThis.fetch = async () => Response.json({ error: { message: 'unsupported parameter value' } }, { status: 400 });
  await assert.rejects(server.generateJson('test-key', 'gemma-4-31b-it', 'prompt', {}), e => e.code === 'UNSUPPORTED_PARAMETER');

  globalThis.fetch = async () => Response.json({ error: { message: 'User does not have permission' } }, { status: 403 });
  await assert.rejects(server.generateJson('test-key', 'gemma-4-31b-it', 'prompt', {}), e => e.code === 'KEY_PERMISSION_DENIED');

  globalThis.fetch = async () => Response.json({ error: { message: 'Rate limit exceeded: requests per minute' } }, { status: 429 });
  await assert.rejects(server.generateJson('test-key', 'gemma-4-31b-it', 'prompt', {}), e => e.code === 'RATE_LIMIT');
});

for (const [status,code] of [[401,'INVALID_KEY'],[403,'INVALID_KEY'],[404,'MODEL_UNAVAILABLE'],[429,'QUOTA_EXCEEDED'],[503,'PROVIDER_ERROR']]) await test(`provider ${status} maps to safe ${code}`,async()=>{ globalThis.fetch=async()=>Response.json({error:{message:'upstream secret detail'}},{status}); await assert.rejects(server.generateJson('test-key','gemini-3.8-flash','prompt',{}),e=>e.code===code&&!e.message.includes('secret')); });
await test('parse fenced JSON and omit thinking parts', async()=>{globalThis.fetch=async()=>Response.json({candidates:[{content:{parts:[{text:'reasoning',thought:true},{text:'```json\n{"title":"Test"}\n```'}]}}]});assert.deepEqual(await server.generateJson('test-key','gemma-4-31b-it','prompt',{}),{title:'Test'});});
await test('reject invalid JSON',async()=>{globalThis.fetch=async()=>Response.json({candidates:[{content:{parts:[{text:'invalid json'}]}}]});await assert.rejects(server.generateJson('test-key','gemini-3.8-flash','prompt',{}),e=>e.code==='INVALID_RESPONSE');});
await test('network failure does not reveal internals',async()=>{globalThis.fetch=async()=>{throw new Error('private network detail')};await assert.rejects(server.generateJson('test-key','gemini-3.8-flash','prompt',{}),e=>e.code==='NETWORK_ERROR'&&!e.message.includes('private'));});
globalThis.fetch=originalFetch;
console.log(`${passed} tests passed. Live Google AI calls require a real user key.`);
