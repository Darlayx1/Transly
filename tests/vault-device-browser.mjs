// Offline regression tests against the real Home, settings and storage code.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { chromium } = await import(process.env.TRANSly_PLAYWRIGHT_MODULE || 'playwright');
const bundled = await build({
  stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import Home from './app/page';
    createRoot(document.getElementById('root')).render(React.createElement(Home));
  `, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@': process.cwd() },
  plugins: [{ name: 'offline-account', setup(plugin) {
    plugin.onResolve({ filter: /use-account-history$/ }, () => ({ path: 'history', namespace: 'mock' }));
    plugin.onResolve({ filter: /account-panel$/ }, () => ({ path: 'panel', namespace: 'mock' }));
    plugin.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'panel'
      ? 'export const AccountPanel = () => null;'
      : `import { useState } from 'react';
         export function useAccountHistory() {
           const [user, setUser] = useState(window.testUser || null);
           const [session, setSession] = useState(null);
           window.switchTestUser = next => { setSession(null); setUser(next); };
           return { user, session, setSession, ready: true, storageFailed: false, entries: [] };
         }`, loader: 'js', resolveDir: process.cwd() }));
  } }],
});
const browser = await chromium.launch({ headless: true, ...(process.env.TRANSLY_CHROMIUM_PATH ? { executablePath: process.env.TRANSLY_CHROMIUM_PATH } : {}) });
try {
  async function start({ account = false, response = 'anonymous' } = {}) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.addInitScript(({ account }) => {
      window.testUser = account ? { id: 'account-a', email: 'a@test.invalid' } : null;
      if (account) localStorage.setItem('transly.auth_token.v1', 'test-login-token');
    }, { account });
    const actions = [];
    await page.route('https://transly.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/credentials') {
        if (route.request().method() === 'GET') {
          if (response === 'unavailable') return route.fulfill({ status: 503, json: { error: { code: 'STORAGE_UNAVAILABLE', message: 'offline' } } });
          return route.fulfill({ json: { generator: false, evaluator: false, custom: false, server: false, account: ['verified', 'expired-mutation'].includes(response) ? { email: 'a@test.invalid' } : null, keys: [] } });
        }
        const body = route.request().postDataJSON(); actions.push(body);
        if (!body.action) assert.equal(route.request().headers()['x-transly-auth'], undefined, 'device credentials must be independent of the login session');
        else assert.equal(route.request().headers()['x-transly-auth'], 'Bearer test-login-token');
        if (response === 'expired-mutation' && body.action) return route.fulfill({ status: 401, json: { error: { code: 'SIGN_IN_REQUIRED', message: 'Masuk untuk membuka brankas API key.' } } });
        return route.fulfill({ json: { saved: true, sessionToken: 'device-session-token', generator: true, evaluator: true, custom: true, server: false } });
      }
      if (url.pathname === '/api/generate') {
        assert.equal(route.request().headers()['x-transly-credentials'], 'device-session-token');
        assert.equal(route.request().headers()['x-transly-auth'], undefined);
        assert.equal(route.request().postDataJSON().generatorKeyId, undefined);
        return route.fulfill({ json: { title: 'Device practice', sourceText: 'This is a practice passage with enough characters to verify local credential routing.', topic: 'General', style: 'Neutral' } });
      }
      if (url.pathname === '/api/evaluate') {
        assert.equal(route.request().headers()['x-transly-credentials'], 'device-session-token');
        assert.equal(route.request().headers()['x-transly-auth'], undefined);
        assert.equal(route.request().postDataJSON().config.evaluatorKeyId, undefined);
        return route.fulfill({ json: { overallScore: 80, summaryFeedback: 'Makna sudah tepat.', strengths: ['Makna'], weaknesses: [],
          sourceText: route.request().postDataJSON().sourceText, userTranslation: route.request().postDataJSON().userTranslation,
          idealTranslation: 'Terjemahan contoh.', annotations: [],
          categoryScores: { accuracy: 80, grammar: 80, wordChoice: 80, naturalness: 80, completeness: 80, style: 80 } } });
      }
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    });
    await page.goto('https://transly.test/');
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    return { context, page, actions, setResponse: value => { response = value; } };
  }
  async function keysTab(page) {
    await page.getByRole('button', { name: 'Pengaturan AI', exact: true }).click();
    await page.getByRole('button', { name: 'API key', exact: true }).click();
  }
  async function addKey(page, name) {
    await page.getByRole('button', { name: 'Tambahkan API key', exact: true }).click();
    await page.getByLabel('Nama key', { exact: true }).fill(name);
    await page.getByLabel('API key', { exact: true }).fill('fake-device-secret-1234567890');
    await page.getByRole('button', { name: 'Simpan API key', exact: true }).click();
    await page.getByText('API key berhasil disimpan.', { exact: true }).waitFor();
  }
  for (const scenario of [{ account: false }, { account: true }, { account: true, response: 'unavailable' }]) {
    const { context, page, actions, setResponse } = await start(scenario);
    await keysTab(page);
    await addKey(page, 'Device key');
    assert.equal(actions.length, 0, 'saving local keys must not call the server');
    const owner = scenario.account ? 'account:account-a' : 'guest';
    assert.equal(await page.evaluate(owner => JSON.parse(localStorage.getItem('transly.ai-keys.v2:' + owner)).keys.length, owner), 1);
    if (scenario.account && !scenario.response) setResponse('verified');
    await page.reload();
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    await keysTab(page);
    assert.equal(await page.locator('.vault-key').count(), 1);
    await page.getByRole('button', { name: 'Tutup', exact: true }).click();
    await page.getByRole('button', { name: 'Buat latihan', exact: true }).click();
    await page.getByText('Device practice', { exact: true }).waitFor();
    await page.getByLabel('Terjemahanmu', { exact: true }).fill('Jawaban uji.');
    await page.getByRole('button', { name: 'Kirim terjemahan', exact: true }).click();
    await page.getByRole('button', { name: 'Evaluasi sekarang', exact: true }).click();
    await page.getByText('Makna sudah tepat.', { exact: true }).waitFor();
    assert.equal(actions.length, 2);
    await keysTab(page);
    if (scenario.account) {
      await page.evaluate(() => window.switchTestUser({ id: 'account-b', email: 'b@test.invalid' }));
      await page.waitForFunction(() => !document.querySelector('.vault-key'));
      assert.equal(await page.evaluate(() => localStorage.getItem('transly.ai-keys.v2:account:account-b')), null);
      await page.evaluate(() => window.switchTestUser(null));
      await page.waitForFunction(() => !document.querySelector('.vault-key'));
      assert.equal(await page.evaluate(() => localStorage.getItem('transly.ai-keys.v2:guest')), null);
    }
    console.log(`PASS ${scenario.account ? 'account' : 'guest'} device save, reload and isolation (${scenario.response || 'anonymous'})`);
    await context.close();
  }
  const { context, page, actions } = await start({ account: true, response: 'verified' });
  await keysTab(page);
  await page.getByRole('button', { name: 'Tambahkan API key', exact: true }).click();
  await page.getByLabel('Nama key', { exact: true }).fill('Cloud key');
  await page.getByLabel('API key', { exact: true }).fill('fake-device-secret-1234567890');
  await page.getByRole('button', { name: 'Simpan API key', exact: true }).click();
  await page.getByText('API key berhasil disimpan.', { exact: true }).waitFor();
  assert.equal(actions[0].action, 'add');
  assert.equal(await page.evaluate(() => localStorage.getItem('transly.ai-keys.v2:account:account-a')), null);
  console.log('PASS verified account keeps encrypted server vault routing');
  await context.close();
  const expired = await start({ account: true, response: 'expired-mutation' });
  await keysTab(expired.page);
  await expired.page.getByRole('button', { name: 'Tambahkan API key', exact: true }).click();
  await expired.page.getByLabel('Nama key', { exact: true }).fill('Recover unsaved key');
  await expired.page.getByLabel('API key', { exact: true }).fill('fake-device-secret-1234567890');
  await expired.page.getByRole('button', { name: 'Simpan API key', exact: true }).click();
  await expired.page.getByText('Brankas server belum dapat memverifikasi sesi. Klik Simpan kembali untuk menyimpan key pada perangkat ini.', { exact: true }).waitFor();
  assert.equal(await expired.page.getByLabel('Nama key', { exact: true }).inputValue(), 'Recover unsaved key');
  await expired.page.getByRole('button', { name: 'Simpan API key', exact: true }).click();
  await expired.page.getByText('API key berhasil disimpan.', { exact: true }).waitFor();
  assert.equal(expired.actions.length, 1, 'recovery must save locally without repeating the rejected server call');
  assert.equal(await expired.page.evaluate(() => JSON.parse(localStorage.getItem('transly.ai-keys.v2:account:account-a')).keys.length), 1);
  console.log('PASS expired server session preserves the form and supports an explicit local save');
  await expired.context.close();
  const unavailable = await start();
  await keysTab(unavailable.page);
  await unavailable.page.evaluate(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }));
  await unavailable.page.getByRole('button', { name: 'Tambahkan API key', exact: true }).click();
  await unavailable.page.getByLabel('Nama key', { exact: true }).fill('Blocked storage');
  await unavailable.page.getByLabel('API key', { exact: true }).fill('fake-device-secret-1234567890');
  await unavailable.page.getByRole('button', { name: 'Simpan API key', exact: true }).click();
  await unavailable.page.getByText('Penyimpanan API key pada perangkat tidak tersedia.', { exact: true }).waitFor();
  assert.equal(await unavailable.page.getByText('API key berhasil disimpan.', { exact: true }).count(), 0);
  console.log('PASS unavailable device storage never reports a successful save');
  await unavailable.context.close();
} finally { await browser.close(); }
