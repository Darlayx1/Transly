// Optional browser integration tests; use a Pages preview configured with the
// test-only URL/key below. All auth, database and AI requests are intercepted.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSly_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TRANSLY_TEST_URL || 'http://127.0.0.1:5175/Transly/';
const mockOrigin = 'http://127.0.0.1:55432';
const accounts = { 'a@example.test': '10000000-0000-4000-8000-000000000001', 'b@example.test': '10000000-0000-4000-8000-000000000002' };
const sessions = new Map();
const loginEvents = new Map();
let failSaves = false;
let saveCalls = 0;
const errors = [];
const browser = await chromium.launch({ headless: true, ...(process.env.TRANSLY_CHROMIUM_PATH ? { executablePath: process.env.TRANSLY_CHROMIUM_PATH } : {}) });
const contexts = [];
function authSession(email) {
  const user = { id: accounts[email], email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp, aud: 'authenticated', session_id: crypto.randomUUID() })).toString('base64url')}.test-signature`;
  return { access_token: token, refresh_token: crypto.randomUUID(), token_type: 'bearer', expires_in: 3600, expires_at: exp, user };
}
async function createPage() {
  const context = await browser.newContext(); contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/credentials', route => route.fulfill({ json: { generator: false, evaluator: false, custom: false, server: false } }));
  await page.route(`${mockOrigin}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const payload = request.postDataJSON();
    const token = request.headers().authorization?.replace('Bearer ', '');
    let userId;
    try { userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub; } catch {}
    const respond = (json, status = 200) => route.fulfill({ status, json });
    if (url.pathname === '/auth/v1/token') {
      if (!accounts[payload.email] || payload.password !== 'test-password-123') return respond({ msg: 'Invalid login credentials', error_code: 'invalid_credentials' }, 400);
      return respond(authSession(payload.email));
    }
    if (url.pathname === '/auth/v1/signup') return respond({ id: accounts[payload.email], email: payload.email, identities: [] });
    if (url.pathname === '/auth/v1/verify') return respond(authSession(payload.email));
    if (url.pathname === '/auth/v1/recover' || url.pathname === '/auth/v1/resend') return respond({});
    if (url.pathname === '/auth/v1/user') return respond({ id: userId, email: Object.keys(accounts).find(email => accounts[email] === userId) });
    if (url.pathname === '/auth/v1/logout') return respond({});
    if (url.pathname === '/rest/v1/rpc/record_login') {
      if (payload.expected_owner !== userId) return respond({ message: 'Authentication required', code: '42501' }, 403);
      const sessionId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).session_id;
      loginEvents.set(sessionId, { id: sessionId, user_id: userId, created_at: new Date().toISOString() });
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === '/rest/v1/rpc/save_practice_session') {
      saveCalls++;
      if (failSaves) return respond({ message: 'offline test', code: '503' }, 503);
      assert.equal(payload.expected_owner, userId);
      const id = `${userId}:${payload.session_id}`;
      const previous = sessions.get(id);
      if ((previous?.version || 0) !== payload.expected_version) return respond({ message: 'Session changed on another device', code: 'P0001' }, 409);
      const version = (previous?.version || 0) + 1;
      sessions.set(id, { user_id: userId, id: payload.session_id, payload: payload.session_payload, version });
      return respond(version);
    }
    if (url.pathname === '/rest/v1/practice_sessions') return respond([...sessions.values()].filter(row => row.user_id === userId));
    if (url.pathname === '/rest/v1/login_events') return respond([...loginEvents.values()].filter(row => row.user_id === userId));
    throw new Error(`Unhandled mock endpoint: ${url.pathname}`);
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Pengaturan AI', exact: true }).waitFor();
  return page;
}
const panel = page => page.getByRole('dialog', { name: 'Pengaturan AI', exact: true });
async function accountTab(page) { await panel(page).getByRole('button', { name: 'Akun', exact: true }).click(); }
async function historyTab(page) { await panel(page).getByRole('button', { name: 'Riwayat', exact: true }).click(); }
async function openPanel(page) { await page.getByRole('button', { name: 'Pengaturan AI', exact: true }).first().click(); await accountTab(page); if (await panel(page).getByRole('button', { name: 'Keluar', exact: true }).isVisible()) await historyTab(page); }
async function closePanel(page) { await panel(page).getByRole('button', { name: 'Tutup', exact: true }).click(); }
async function login(page, email) {
  await accountTab(page);
  await panel(page).getByLabel('Email', { exact: true }).fill(email);
  await panel(page).getByLabel('Kata sandi', { exact: true }).fill('test-password-123');
  await panel(page).getByRole('button', { name: 'Masuk', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Keluar', exact: true }).waitFor();
  await historyTab(page);
  await panel(page).getByRole('button', { name: 'Sinkronkan', exact: true }).waitFor();
}
async function waitForCloud(page) {
  await page.waitForFunction(() => document.querySelector('.account-history p[role="status"]')?.textContent?.includes('Riwayat tersimpan di akun.'));
}
try {
  const controls = await createPage();
  await openPanel(controls);
  assert.equal(await panel(controls).locator('nav button').count(), 4);
  assert.equal(await controls.locator('.site-footer, .ai-window-footer').count(), 0);
  await panel(controls).getByRole('button', { name: 'API key', exact: true }).click();
  assert.equal(await panel(controls).locator('.account-summary:visible').count(), 0);
  await controls.route('https://generativelanguage.googleapis.com/**', route => route.fulfill({ json: { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] } }));
  for (const name of ['Key pertama', 'Key kedua']) {
    await panel(controls).getByRole('button', { name: 'Tambahkan API key', exact: true }).click();
    await panel(controls).getByLabel('Nama key', { exact: true }).fill(name);
    await panel(controls).getByLabel('API key', { exact: true }).fill(name === 'Key pertama' ? 'fake-first-key-1234567890' : 'fake-second-key-1234567890');
    await panel(controls).getByRole('button', { name: 'Simpan API key', exact: true }).click();
    await panel(controls).getByText('API key berhasil disimpan.', { exact: true }).waitFor();
  }
  assert.equal(await panel(controls).locator('.vault-key').count(), 2);
  assert(!await panel(controls).innerText().then(text => text.includes('fake-first-key')));
  const firstKey = panel(controls).locator('.vault-key').filter({ hasText: 'Key pertama' });
  await firstKey.getByRole('button', { name: 'Uji akses', exact: true }).click();
  await panel(controls).getByText('Akses model berhasil diuji. Kuota konten diperiksa saat latihan.', { exact: true }).waitFor();
  await firstKey.getByRole('button', { name: 'Nonaktifkan', exact: true }).click();
  await firstKey.getByRole('button', { name: 'Aktifkan', exact: true }).waitFor();
  await firstKey.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel(controls).getByLabel('Nama key', { exact: true }).fill('Key pertama diubah');
  await panel(controls).getByRole('button', { name: 'Simpan API key', exact: true }).click();
  await panel(controls).getByText('API key berhasil disimpan.', { exact: true }).waitFor();
  await panel(controls).getByRole('button', { name: 'Model & penggunaan', exact: true }).click();
  await panel(controls).getByLabel('API key penilai terjemahan', { exact: true }).selectOption({ label: 'Key kedua · Belum diuji' });
  await closePanel(controls);
  await controls.reload(); await openPanel(controls);
  await panel(controls).getByRole('button', { name: 'API key', exact: true }).click();
  assert.equal(await panel(controls).locator('.vault-key').count(), 2);
  const edited = panel(controls).locator('.vault-key').filter({ hasText: 'Key pertama diubah' });
  await edited.getByRole('button', { name: 'Aktifkan', exact: true }).waitFor();
  await panel(controls).getByRole('button', { name: 'Tambahkan API key', exact: true }).click();
  await panel(controls).getByLabel('Nama key', { exact: true }).fill('Belum disimpan');
  await panel(controls).getByRole('button', { name: 'Riwayat', exact: true }).click();
  await panel(controls).getByRole('alertdialog').waitFor();
  await panel(controls).getByRole('button', { name: 'Buang perubahan', exact: true }).click();
  await panel(controls).getByRole('button', { name: 'API key', exact: true }).click();
  await edited.getByRole('button', { name: 'Hapus', exact: true }).click();
  await edited.getByRole('button', { name: 'Hapus key', exact: true }).click();
  await panel(controls).getByText('API key dihapus.', { exact: true }).waitFor();
  assert.equal(await panel(controls).locator('.vault-key').count(), 1);
  await controls.setViewportSize({ width: 390, height: 844 });
  assert(await controls.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await mkdir('.sites-runtime/account-tests', { recursive: true });
  await controls.screenshot({ path: '.sites-runtime/account-tests/ai-keys-mobile.png', fullPage: true });
  await controls.setViewportSize({ width: 1280, height: 900 });
  await controls.screenshot({ path: '.sites-runtime/account-tests/ai-keys-desktop.png', fullPage: true });
  await panel(controls).getByRole('button', { name: 'Tambahkan API key', exact: true }).click();
  await panel(controls).getByLabel('Nama key', { exact: true }).fill('Key gagal');
  await panel(controls).getByLabel('API key', { exact: true }).fill('fake-bad-key-1234567890');
  await panel(controls).getByLabel('Urutan penggunaan', { exact: true }).fill('1');
  await panel(controls).getByRole('button', { name: 'Simpan API key', exact: true }).click();
  await panel(controls).getByText('API key berhasil disimpan.', { exact: true }).waitFor();
  const credentialUses = []; let activeKey;
  await controls.route('**/api/credentials', route => {
    if (route.request().method() === 'POST') { const payload = route.request().postDataJSON(); activeKey = payload.generator; credentialUses.push(activeKey); }
    return route.fulfill({ json: { generator: true, evaluator: true, custom: true, server: false } });
  });
  await controls.route('**/api/generate', route => {
    const payload = route.request().postDataJSON(); assert.equal(payload.generatorKeyId, undefined);
    if (activeKey === 'fake-bad-key-1234567890') return route.fulfill({ status: 401, json: { error: { code: 'INVALID_KEY', message: 'API key tidak valid.' } } });
    return route.fulfill({ json: { title: 'Latihan key kedua', sourceText: 'This is a practice passage with enough characters to verify the new key selection.', topic: 'General', style: 'Neutral' } });
  });
  await controls.route('**/api/evaluate', route => {
    const payload = route.request().postDataJSON(); assert.equal(payload.config.evaluatorKeyId, undefined);
    return route.fulfill({ json: { overallScore: 80, summaryFeedback: 'Makna sudah tepat.', strengths: ['Makna'], weaknesses: [], sourceText: payload.sourceText, userTranslation: payload.userTranslation, idealTranslation: 'Terjemahan contoh.', categoryScores: { accuracy: 80, grammar: 80, wordChoice: 80, naturalness: 80, completeness: 80, style: 80 }, annotations: [] } });
  });
  await closePanel(controls);
  await controls.getByRole('button', { name: 'Buat latihan', exact: true }).click();
  await controls.getByLabel('Terjemahanmu', { exact: true }).fill('Jawaban uji untuk key yang dipilih.');
  await controls.getByRole('button', { name: 'Kirim terjemahan', exact: true }).click();
  await controls.getByRole('button', { name: 'Evaluasi sekarang', exact: true }).click();
  await controls.getByText('Makna sudah tepat.', { exact: true }).waitFor();
  assert.deepEqual(credentialUses, ['fake-bad-key-1234567890', 'fake-second-key-1234567890', 'fake-second-key-1234567890']);
  await openPanel(controls); await historyTab(controls);
  assert.equal(await panel(controls).locator('.account-login-list li').count(), 3);
  console.log('PASS generation falls back to a different key and evaluation uses the selected key');
  await accountTab(controls); await login(controls, 'a@example.test');
  await panel(controls).getByRole('button', { name: 'API key', exact: true }).click();
  assert.equal(await panel(controls).locator('.vault-key').count(), 0);
  console.log('PASS four tabs, per-key management, masking, persistence, unsaved guard and account key isolation');

  const page = await createPage();
  await page.getByRole('button', { name: /Coba alur sampel/ }).click();
  await page.getByLabel('Terjemahanmu', { exact: true }).fill('Draft tamu yang harus tetap terpisah.');
  await page.reload();
  assert.equal(await page.getByLabel('Terjemahanmu', { exact: true }).inputValue(), 'Draft tamu yang harus tetap terpisah.');
  console.log('PASS guest draft survives reload');
  await openPanel(page);
  await login(page, 'a@example.test');
  await panel(page).getByText('Belum ada latihan tersimpan.', { exact: true }).waitFor();
  assert.equal(sessions.size, 0);
  page.once('dialog', dialog => dialog.accept());
  await panel(page).getByRole('button', { name: 'Salin riwayat tamu ke akun', exact: true }).click();
  await waitForCloud(page);
  assert.equal(sessions.size, 1);
  await closePanel(page);
  await page.getByRole('button', { name: 'Sesi aktif', exact: true }).click();
  await page.getByLabel('Terjemahanmu', { exact: true }).fill('Draft akun A tersinkron.');
  await openPanel(page); await waitForCloud(page);
  assert.equal([...sessions.values()][0].payload.answer, 'Draft akun A tersinkron.');
  console.log('PASS inline login, explicit import and debounced cloud draft sync');
  const eventsBefore = loginEvents.size;
  await page.reload(); await openPanel(page); await waitForCloud(page);
  assert.equal(loginEvents.size, eventsBefore);
  assert.equal(await panel(page).locator('.account-session-list li').count(), 1);
  console.log('PASS session persistence and deduplicated login history after refresh');
  await accountTab(page);
  await panel(page).getByRole('button', { name: 'Keluar', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Masuk', exact: true }).waitFor();
  await closePanel(page);
  await page.getByRole('button', { name: 'Sesi aktif', exact: true }).click();
  assert.equal(await page.getByLabel('Terjemahanmu', { exact: true }).inputValue(), 'Draft tamu yang harus tetap terpisah.');
  await openPanel(page); await login(page, 'b@example.test');
  await panel(page).getByText('Belum ada latihan tersimpan.', { exact: true }).waitFor();
  assert.equal(await panel(page).locator('.account-session-list li').count(), 0);
  console.log('PASS logout restores guest draft and account B cannot see account A');

  const second = await createPage(); await openPanel(second); await login(second, 'a@example.test'); await waitForCloud(second);
  assert.equal(await panel(second).locator('.account-session-list li').count(), 1);
  await panel(second).getByRole('button', { name: 'Buka', exact: true }).click();
  assert.equal(await second.getByLabel('Terjemahanmu', { exact: true }).inputValue(), 'Draft akun A tersinkron.');
  console.log('PASS history restores on a separate browser/device');
  failSaves = true;
  await second.getByLabel('Terjemahanmu', { exact: true }).fill('Draft saat koneksi gagal.');
  await openPanel(second);
  await panel(second).getByText(/Gunakan Sinkronkan untuk mencoba kembali/).waitFor();
  const failedCalls = saveCalls;
  await second.waitForTimeout(2200);
  assert.equal(saveCalls, failedCalls);
  failSaves = false;
  await panel(second).getByRole('button', { name: 'Sinkronkan', exact: true }).click();
  await waitForCloud(second);
  assert.equal([...sessions.values()][0].payload.answer, 'Draft saat koneksi gagal.');
  console.log('PASS failed sync stops retrying and manual sync preserves the offline draft');
  // A conflicting remote update is preserved alongside the local pending edit.
  await closePanel(second);
  const existing = [...sessions.values()][0];
  sessions.set(`${existing.user_id}:${existing.id}`, { ...existing, version: existing.version + 1, payload: { ...existing.payload, answer: 'Perubahan dari perangkat lain.' } });
  await second.getByLabel('Terjemahanmu', { exact: true }).fill('Perubahan lokal yang bertabrakan.');
  await openPanel(second);
  await panel(second).getByText(/Sesi ini berubah di perangkat lain/).waitFor();
  await panel(second).getByRole('button', { name: 'Sinkronkan', exact: true }).click();
  await waitForCloud(second);
  assert.equal(sessions.size, 2);
  assert([...sessions.values()].some(row => row.payload.answer === 'Perubahan dari perangkat lain.'));
  assert([...sessions.values()].some(row => row.payload.answer === 'Perubahan lokal yang bertabrakan.'));
  console.log('PASS browser conflict recovery preserves both device versions');
  await second.setViewportSize({ width: 390, height: 844 });
  assert(await second.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await mkdir('.sites-runtime/account-tests', { recursive: true });
  await second.screenshot({ path: '.sites-runtime/account-tests/account-mobile.png', fullPage: true });
  await second.setViewportSize({ width: 1280, height: 900 });
  await second.screenshot({ path: '.sites-runtime/account-tests/account-desktop.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS desktop/mobile account UI without browser errors');

  const signup = await createPage(); await openPanel(signup);
  const originalUrl = signup.url();
  await panel(signup).getByRole('button', { name: 'Buat akun', exact: true }).click();
  await panel(signup).getByLabel('Email', { exact: true }).fill('b@example.test');
  await panel(signup).getByLabel('Kata sandi', { exact: true }).fill('test-password-123');
  await panel(signup).getByRole('button', { name: 'Daftar', exact: true }).click();
  await panel(signup).getByLabel('Kode dari email (jika tersedia)', { exact: true }).fill('123456');
  await panel(signup).getByRole('button', { name: 'Konfirmasi kode', exact: true }).click();
  await panel(signup).getByRole('button', { name: 'Keluar', exact: true }).waitFor();
  assert.equal(signup.url(), originalUrl);
  console.log('PASS signup and email code confirmation without navigation');
  await panel(signup).getByRole('button', { name: 'Keluar', exact: true }).click();
  await panel(signup).getByRole('button', { name: 'Lupa kata sandi?', exact: true }).click();
  await panel(signup).getByLabel('Email', { exact: true }).fill('b@example.test');
  await panel(signup).getByRole('button', { name: 'Kirim email pemulihan', exact: true }).click();
  await panel(signup).getByLabel('Kode dari email (jika tersedia)', { exact: true }).fill('654321');
  await panel(signup).getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await panel(signup).getByLabel('Kata sandi', { exact: true }).fill('test-new-password-123');
  await panel(signup).getByRole('button', { name: 'Simpan kata sandi', exact: true }).click();
  await panel(signup).getByText('Kata sandi berhasil diperbarui.', { exact: true }).waitFor();
  assert.equal(signup.url(), originalUrl);
  console.log('PASS password recovery and update without navigation');
  const callback = await createPage();
  const callbackSession = authSession('a@example.test');
  const hash = new URLSearchParams({ access_token: callbackSession.access_token, refresh_token: callbackSession.refresh_token, expires_in: '3600', token_type: 'bearer', type: 'recovery' });
  // Email links load a document, rather than merely updating an existing SPA hash.
  await callback.goto(`${base}?email-callback=1#${hash}`);
  await panel(callback).getByRole('heading', { name: 'Buat kata sandi baru', exact: true }).waitFor();
  await panel(callback).getByLabel('Kata sandi', { exact: true }).fill('test-recovered-password-123');
  await panel(callback).getByRole('button', { name: 'Simpan kata sandi', exact: true }).click();
  await panel(callback).getByText('Kata sandi berhasil diperbarui.', { exact: true }).waitFor();
  assert(!callback.url().includes('access_token'));
  console.log('PASS default email recovery link returns to Transly and clears URL tokens');
  assert.deepEqual(errors, []);
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
