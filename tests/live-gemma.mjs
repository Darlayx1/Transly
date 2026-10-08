import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Check if key is available in process.env or read from stdin if interactive
let key = process.env.GEMINI_API_KEY || '';
if (!key && process.stdin.isTTY) {
  console.log('Masukkan API key Google AI (stdin):');
  process.stdin.setRawMode(true);
  for await (const chunk of process.stdin) {
    key += chunk;
    if (/[\r\n]/.test(key)) break;
  }
  process.stdin.setRawMode(false);
  key = key.trim();
}

if (!key) {
  console.log('[LIVE_TEST:BLOCKED] GEMINI_API_KEY tidak tersedia di environment maupun stdin.');
  console.log('Untuk menjalankan live integration test, jalankan:');
  console.log('$env:GEMINI_API_KEY="AIzaSy..."; node tests/live-gemma.mjs');
  process.exit(0);
}

process.env.GEMINI_API_KEY = key;

const dir = path.resolve('.sites-runtime/live-gemma');
await mkdir(dir, { recursive: true });
for (const name of ['config', 'schema', 'server', 'output-schema', 'generate', 'evaluate']) {
  const file = ['generate', 'evaluate'].includes(name) ? `app/api/${name}/route.ts` : `lib/transly/${name}.ts`;
  const source = (await readFile(file, 'utf8'))
    .replaceAll(/from ['"]@\/lib\/transly\/([^'"]+)['"]/g, "from './$1.js'")
    .replaceAll(/from ['"]\.\/([^'"]+)['"]/g, (_, module) => `from './${module.endsWith('.js') ? module : module + '.js'}'`)
    .replace("import { env } from 'cloudflare:workers';", 'const env = {};');
  await writeFile(path.join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}

const { defaultConfig } = await import(pathToFileURL(path.join(dir, 'schema.js')));
const { POST: generatePOST } = await import(pathToFileURL(path.join(dir, 'generate.js')));
const { POST: evaluatePOST } = await import(pathToFileURL(path.join(dir, 'evaluate.js')));

const makeRequest = body => new Request('https://transly.test/api/test', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

console.log('--- MEMULAI LIVE INTEGRATION TEST GEMMA 4 31B ---');

const scenarios = [
  // 1. Gemma generator, Gemini evaluator
  { id: 1, name: 'Gemma generator, Gemini evaluator', config: { ...defaultConfig, level: 'B1', length: 'short', generator: 'gemma-4-31b-it', evaluator: 'gemini-3.5-flash' }, type: 'both', source: 'The sun rises every morning in the east.', userTranslation: 'Matahari terbit setiap pagi di timur.' },
  // 2. Gemini generator, Gemma evaluator
  { id: 2, name: 'Gemini generator, Gemma evaluator', config: { ...defaultConfig, level: 'B1', length: 'short', generator: 'gemini-3.5-flash', evaluator: 'gemma-4-31b-it' }, type: 'both', source: 'Technology has transformed our daily lives.', userTranslation: 'Teknologi telah mengubah kehidupan sehari-hari kita.' },
  // 3. Gemma generator sekaligus evaluator
  { id: 3, name: 'Gemma generator dan evaluator', config: { ...defaultConfig, level: 'B1', length: 'short', generator: 'gemma-4-31b-it', evaluator: 'gemma-4-31b-it' }, type: 'both', source: 'Reading books expands knowledge.', userTranslation: 'Membaca buku memperluas pengetahuan.' },
  // 4. Input A1 teks pendek
  { id: 4, name: 'Input A1 teks pendek', config: { ...defaultConfig, level: 'A1', length: 'short', generator: 'gemma-4-31b-it', evaluator: 'gemma-4-31b-it' }, type: 'generate' },
  // 5. Input B2 teks sedang
  { id: 5, name: 'Input B2 teks sedang', config: { ...defaultConfig, level: 'B2', length: 'medium', generator: 'gemma-4-31b-it', evaluator: 'gemma-4-31b-it' }, type: 'generate' },
  // 6. Input C1 teks panjang
  { id: 6, name: 'Input C1 teks panjang', config: { ...defaultConfig, level: 'C1', length: 'long', generator: 'gemma-4-31b-it', evaluator: 'gemma-4-31b-it' }, type: 'generate' },
  // 7. Terjemahan benar
  { id: 7, name: 'Evaluasi: terjemahan benar', config: { ...defaultConfig, generator: 'gemma-4-31b-it', evaluator: 'gemma-4-31b-it' }, type: 'evaluate', source: 'The library is open from eight in the morning until five in the afternoon.', userTranslation: 'Perpustakaan buka dari jam delapan pagi hingga jam lima sore.' },
  // 8. Terjemahan sebagian benar
  { id: 8, name: 'Evaluasi: terjemahan sebagian benar', config: { ...defaultConfig, generator: 'gemma-4-31b-it', evaluator: 'gemma-4-31b-it' }, type: 'evaluate', source: 'The library is open from eight in the morning until five in the afternoon.', userTranslation: 'Perpustakaan itu buka dari pagi sampai jam lima malam.' },
  // 9. Terjemahan kesalahan fatal
  { id: 9, name: 'Evaluasi: terjemahan kesalahan fatal', config: { ...defaultConfig, generator: 'gemma-4-31b-it', evaluator: 'gemma-4-31b-it' }, type: 'evaluate', source: 'Do not enter this room without safety goggles.', userTranslation: 'Silakan masuk ke ruangan ini tanpa kacamata pengaman.' },
  // 10. Jawaban kosong
  { id: 10, name: 'Evaluasi: jawaban kosong', config: { ...defaultConfig, generator: 'gemma-4-31b-it', evaluator: 'gemma-4-31b-it' }, type: 'evaluate', source: 'Education is essential for future development.', userTranslation: '' },
];

let livePassed = 0;
for (const sc of scenarios) {
  try {
    if (sc.type === 'generate' || sc.type === 'both') {
      const res = await generatePOST(makeRequest(sc.config));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Generate failed');
      console.log(`[PASS] Skenario ${sc.id} (${sc.name}) Generate OK: ${data.title} (${data.sourceText.split(/\s+/).length} kata)`);
    }
    if (sc.type === 'evaluate' || sc.type === 'both') {
      const res = await evaluatePOST(makeRequest({ config: sc.config, sourceText: sc.source, userTranslation: sc.userTranslation }));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Evaluate failed');
      console.log(`[PASS] Skenario ${sc.id} (${sc.name}) Evaluate OK: skor ${data.overallScore}, annotations: ${data.annotations?.length ?? 0}`);
    }
    livePassed++;
  } catch (err) {
    console.error(`[FAIL] Skenario ${sc.id} (${sc.name}):`, err.message);
  }
}

console.log(`Live integration testing selesai: ${livePassed}/${scenarios.length} berhasil.`);
delete process.env.GEMINI_API_KEY;
