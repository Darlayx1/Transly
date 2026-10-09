import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const dir = path.resolve('.sites-runtime/account-tests');
await mkdir(dir, { recursive: true });
for (const name of ['config', 'schema', 'sample', 'history', 'account']) {
  const source = (await readFile(`lib/transly/${name}.ts`, 'utf8')).replace(/from '(\.\/[^']+)'/g, "from '$1.js'");
  await writeFile(path.join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const history = await import(pathToFileURL(path.join(dir, 'history.js')));
const sample = await import(pathToFileURL(path.join(dir, 'sample.js')));
const { isPublicAccountKey, accountError } = await import(pathToFileURL(path.join(dir, 'account.js')));
assert(isPublicAccountKey('sb_publishable_test'));
assert(isPublicAccountKey(`header.${btoa(JSON.stringify({ role: 'anon' }))}.signature`));
assert(!isPublicAccountKey('sb_secret_test'));
assert(!isPublicAccountKey(`header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`));
console.log('PASS secret and service_role keys are rejected by the browser client');
assert.equal(accountError({ message: 'Email address not authorized', code: 'email_address_not_authorized' }), 'Email ini belum diizinkan untuk pendaftaran. Hubungi pengelola Transly.');
const session = history.identifySession({ config: sample.sampleConfig, challenge: sample.sampleChallenge, answer: 'Draft A', deadline: Date.now() + 60000, startedAt: Date.now(), sample: true });
const storage = new Map([['transly.session.v1', JSON.stringify(session)]]);
const reader = { getItem: key => storage.get(key) ?? null };
assert.equal(history.readHistory(reader, 'guest').entries.length, 1);
assert.equal(history.readHistory(reader, 'account-a').entries.length, 0);
console.log('PASS legacy guest data never enters an account automatically');
let cache = history.updateHistory(history.emptyHistory(), session);
const sent = cache.entries[0];
cache = history.updateHistory(cache, { ...session, answer: 'Edited during upload' });
cache = history.acknowledgeSave(cache, sent, 1);
assert.equal(cache.entries[0].dirty, true);
assert.equal(cache.entries[0].version, 1);
assert.equal(cache.entries[0].session.answer, 'Edited during upload');
console.log('PASS edits during an upload stay pending with the new server version');
const remote = { session: { ...session, answer: 'Other device' }, version: 2, dirty: false };
cache = history.mergeHistory(cache, [remote]);
assert.equal(cache.entries.length, 2);
assert(cache.entries.some(entry => entry.session.answer === 'Other device' && !entry.dirty));
assert(cache.entries.some(entry => entry.session.answer === 'Edited during upload' && entry.version === 0));
assert.notEqual(cache.activeId, session.id);
console.log('PASS concurrent edits preserve both cloud and local drafts');
cache = history.updateHistory(cache, history.identifySession({ ...session, id: undefined, answer: 'Next practice' }));
assert.equal(cache.entries.length, 3);
console.log('PASS starting a new practice retains previous history');

const db = new PGlite();
const a = '10000000-0000-4000-8000-000000000001';
const b = '10000000-0000-4000-8000-000000000002';
const authSession = '20000000-0000-4000-8000-000000000001';
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
  `);
  await db.query('insert into auth.users values ($1), ($2)', [a, b]);
  await db.exec(await readFile('supabase/migrations/202610100001_account_history.sql', 'utf8'));
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [a, JSON.stringify({ sub: a, session_id: authSession })]);
  const save = (payload, version, owner = a) => db.query('select public.save_practice_session($1, $2, $3, $4) as version', [session.id, JSON.stringify(payload), version, owner]);
  assert.equal((await save(session, 0)).rows[0].version, 1);
  assert.equal((await save({ ...session, answer: 'Saved edit' }, 1)).rows[0].version, 2);
  await assert.rejects(save({ ...session, answer: 'Stale edit' }, 1), /Session changed/);
  assert.equal((await db.query('select payload from public.practice_sessions')).rows[0].payload.answer, 'Saved edit');
  await assert.rejects(save(session, 0), /duplicate key/);
  await assert.rejects(save({ ...session, id: crypto.randomUUID() }, 2), /Invalid session/);
  await assert.rejects(save({ ...session, answer: 'x'.repeat(16001) }, 2), /Invalid session/);
  await assert.rejects(save({ ...session, extra: 'x'.repeat(250001) }, 2), /check constraint/);
  console.log('PASS real PostgreSQL migration, version conflicts and payload limits');

  await db.query('select public.record_login($1)', [a]);
  await db.query('select public.record_login($1)', [a]);
  assert.equal((await db.query('select * from public.login_events')).rows.length, 1);
  await assert.rejects(db.query('insert into public.login_events(user_id, auth_session_id) values ($1, $2)', [a, crypto.randomUUID()]), /permission denied/);
  await assert.rejects(db.query('update public.practice_sessions set version = 99'), /permission denied/);
  console.log('PASS server-controlled login events, deduplication and denied direct writes');

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [b]);
  assert.equal((await db.query('select * from public.practice_sessions')).rows.length, 0);
  assert.equal((await db.query('select * from public.login_events')).rows.length, 0);
  await assert.rejects(save(session, 0, a), /Authentication required/);
  await assert.rejects(db.query('select public.record_login($1)', [a]), /Authentication required/);
  console.log('PASS account B cannot read or write account A history');

  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select * from public.practice_sessions'), /permission denied/);
  await assert.rejects(db.query('select public.save_practice_session($1, $2, $3, $4)', [session.id, JSON.stringify(session), 0, a]), /permission denied/);
  await assert.rejects(db.query('select * from public.login_events'), /permission denied/);
  console.log('PASS anonymous clients cannot read or write account data');
} finally { await db.close(); }
