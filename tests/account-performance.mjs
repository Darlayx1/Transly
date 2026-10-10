// Real React lifecycle regression tests with isolated, offline account services.
// Uses the same optional Playwright dependency as account-browser.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const { chromium } = await import(process.env.TRANSly_PLAYWRIGHT_MODULE || 'playwright');
const source = process.argv.includes('--baseline')
  ? execFileSync('git', ['show', 'HEAD:hooks/use-account-history.ts'], { encoding: 'utf8' })
  : await readFile('hooks/use-account-history.ts', 'utf8');
const bundled = await build({
  stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { useAccountHistory } from 'tested-hook';
    import { sampleConfig, sampleChallenge } from './lib/transly/sample';
    window.sample = { id: '20000000-0000-4000-8000-000000000001', config: sampleConfig, challenge: sampleChallenge, answer: 'draft', startedAt: 1, deadline: 60000, sample: true };
    function Probe() { window.historyState = useAccountHistory(); window.metrics.renders++; return null; }
    const root = createRoot(document.getElementById('root'));
    root.render(React.createElement(Probe));
    window.unmountProbe = () => root.unmount();
  `, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'isolated-account', setup(plugin) {
    plugin.onResolve({ filter: /^tested-hook$/ }, () => ({ path: 'hook', namespace: 'test' }));
    plugin.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: source, loader: 'ts', resolveDir: process.cwd() }));
    plugin.onResolve({ filter: /^@\// }, args => {
      if (args.path === '@/lib/transly/account') return { path: 'account', namespace: 'mock' };
      if (args.path === '@/components/transly/ui') return { path: 'ui', namespace: 'mock' };
      return { path: `${process.cwd()}/${args.path.slice(2)}.ts` };
    });
    plugin.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'account'
      ? 'export const accountClient = () => window.mockClient; export const accountError = () => "test error";'
      : 'export const api = async () => ({});', loader: 'js' }));
  } }],
});
const browser = await chromium.launch({ headless: true, ...(process.env.TRANSLY_CHROMIUM_PATH ? { executablePath: process.env.TRANSLY_CHROMIUM_PATH } : {}) });
try {
  async function start({ signedIn = true, delayedBootstrap = false, rejectBootstrap = false } = {}) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.route('https://transly.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto('https://transly.test/');
    await page.evaluate(({ signedIn, delayedBootstrap, rejectBootstrap }) => {
      window.metrics = { subscriptions: 0, unsubscriptions: 0, reads: 0, saves: 0, logins: 0, renders: 0 };
      const session = { access_token: 'token-a', user: { id: 'account-a', email: 'a@test.invalid' } };
      window.emitAuth = (event, value) => window.authCallback?.(event, structuredClone(value));
      window.testSession = session;
      window.mockClient = {
        auth: {
          onAuthStateChange(callback) {
            window.metrics.subscriptions++;
            window.authCallback = callback;
            // Bound the broken baseline so a runaway render cannot hang this test.
            if (!delayedBootstrap && window.metrics.subscriptions <= 12) queueMicrotask(() => callback('INITIAL_SESSION', signedIn ? structuredClone(session) : null));
            return { data: { subscription: { unsubscribe() { window.metrics.unsubscriptions++; window.authCallback = null; } } } };
          },
          getSession() {
            if (rejectBootstrap) return Promise.reject(new Error('offline'));
            if (delayedBootstrap) return new Promise(resolve => { window.resolveBootstrap = resolve; });
            return Promise.resolve({ data: { session: signedIn ? structuredClone(session) : null }, error: null });
          },
        },
        from() {
          window.metrics.reads++;
          const query = { select() { return query; }, eq() { return query; }, order() { return query; }, range() { return Promise.resolve({ data: [], error: null }); } };
          return query;
        },
        rpc(name, payload) {
          if (name === 'record_login') { window.metrics.logins++; return Promise.resolve({ error: null }); }
          window.metrics.saves++;
          window.lastSave = payload;
          return Promise.resolve({ data: window.metrics.saves, error: null });
        },
      };
    }, { signedIn, delayedBootstrap, rejectBootstrap });
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    return { context, page };
  }
  const { context, page } = await start();
  await page.waitForFunction(() => window.historyState?.ready && !window.historyState.syncing);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.metrics.subscriptions), 1, 'auth listener must stay subscribed after INITIAL_SESSION');
  const settledRenders = await page.evaluate(() => window.metrics.renders);
  for (let i = 0; i < 10; i++) {
    await page.evaluate(i => {
      window.historyState.setSession({ ...window.sample, answer: `draft ${i}` });
      window.emitAuth('TOKEN_REFRESHED', { ...window.testSession, access_token: `fresh-${i}` });
    }, i);
    await page.waitForFunction(i => window.historyState.session?.answer === `draft ${i}`, i);
  }
  await page.waitForFunction(() => window.metrics.saves === 1 && !window.historyState.syncing);
  assert.deepEqual(await page.evaluate(() => ({ subscriptions: window.metrics.subscriptions, reads: window.metrics.reads, logins: window.metrics.logins, saved: window.lastSave.session_payload.answer, token: localStorage.getItem('transly.auth_token.v1') })),
    { subscriptions: 1, reads: 1, logins: 1, saved: 'draft 9', token: 'fresh-9' });
  const renders = await page.evaluate(() => window.metrics.renders);
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.metrics.renders), renders, 'idle account must not keep rendering');
  assert(renders - settledRenders < 50, 'interaction render count must remain bounded');
  await page.evaluate(() => {
    const session = { ...window.sample, answer: 'guest draft' };
    localStorage.setItem('transly.history.v2:guest', JSON.stringify({ activeId: session.id, entries: [{ session, version: 0, dirty: true }] }));
    window.emitAuth('SIGNED_OUT', null);
  });
  await page.waitForFunction(() => !window.historyState.user && window.historyState.session?.answer === 'guest draft');
  assert.equal(await page.evaluate(() => localStorage.getItem('transly.auth_token.v1')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('transly.history.v2:account:account-a')), null);
  await page.evaluate(() => window.unmountProbe());
  assert.equal(await page.evaluate(() => window.metrics.unsubscriptions), 1);
  await context.close();
  console.log('PASS stable auth subscription, 10 edits/token refreshes, one debounced upload, idle stability, guest restoration and cleanup');

  const stale = await start({ delayedBootstrap: true });
  await stale.page.waitForFunction(() => Boolean(window.resolveBootstrap));
  await stale.page.evaluate(() => {
    window.emitAuth('SIGNED_IN', window.testSession);
    window.emitAuth('SIGNED_OUT', null);
    window.resolveBootstrap({ data: { session: window.testSession }, error: null });
  });
  await stale.page.waitForFunction(() => window.historyState?.ready);
  assert.equal(await stale.page.evaluate(() => window.historyState.user), null);
  assert.equal(await stale.page.evaluate(() => window.metrics.logins), 0);
  await stale.context.close();
  console.log('PASS stale bootstrap and superseded login cannot undo logout');

  const offline = await start({ signedIn: false, delayedBootstrap: true, rejectBootstrap: true });
  await offline.page.waitForFunction(() => window.historyState?.ready);
  assert.equal(await offline.page.evaluate(() => window.historyState.user), null);
  await offline.context.close();
  console.log('PASS failed auth bootstrap leaves guest interactions available');
} finally { await browser.close(); }
