'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Languages, SlidersHorizontal, ShieldCheck } from 'lucide-react';
import { Setup } from '@/components/transly/setup';
import { Settings, type KeyStatus } from '@/components/transly/settings';
import { Practice } from '@/components/transly/practice';
import { Review } from '@/components/transly/review';
import { api, ErrorBanner, Processing, Modal } from '@/components/transly/ui';
import { challengeSchema, defaultConfig, evaluationSchema, type PracticeConfig } from '@/lib/transly/schema';
import { sampleAnswer, sampleChallenge, sampleConfig, sampleEvaluation } from '@/lib/transly/sample';
import { modelLabel } from '@/lib/transly/config';
import { roleReady } from '@/lib/transly/vault-types';
import type { RoutingInfo } from '@/lib/transly/vault-types';

import { readDeviceVault, writeDeviceVault, deviceVaultStatus, deviceCandidates, deviceRequestConfig } from '@/lib/transly/device-vault';
import { useAccountHistory } from '@/hooks/use-account-history';

import { StorageLayer } from '@/lib/transly/storage-layer';
import { getStorageOwner, type StorageOwner } from '@/lib/transly/owner';
import { setCredentialToken } from '@/lib/transly/transport';

type View = 'setup' | 'practice' | 'review';
type Confirmation = 'replace' | 'sample-replace' | 'submit';

export default function Home() {
  const [config, setConfig] = useState<PracticeConfig>(defaultConfig);
  const history = useAccountHistory();
  const userId = history.user?.id;
  const { session, setSession, ready, storageFailed } = history;
  const [view, setView] = useState<View>('setup');
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState<'generate' | 'evaluate' | null>(null);
  const [status, setStatus] = useState<KeyStatus>({ generator: false, evaluator: false, custom: false, server: false });
  const [error, setError] = useState('');
  const [routingMessage, setRoutingMessage] = useState('');
  const [configStorageFailed, setConfigStorageFailed] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const lastAction = useRef<'generate' | 'evaluate' | null>(null);
  const locked = useRef(false);
  const current = useRef(session); current.current = session;
  const accountOwner = useRef<StorageOwner>(getStorageOwner(history.user?.id));
  accountOwner.current = getStorageOwner(history.user?.id);
  useEffect(() => { if (history.recoveryRequired) setSettings(true); }, [history.recoveryRequired]);

  const navigate = useCallback((next: View) => {
    setView(next);
    const hash = next === 'setup' ? '' : `#${next}`;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash || window.location.pathname + window.location.search);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    const route = () => {
      const s = current.current;
      const h = window.location.hash;
      if (h === '#settings') setSettings(true);
      setView(h === '#review' && s?.result ? 'review' : h === '#practice' && s && !s.result ? 'practice' : 'setup');
    };
    route();
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);
    return () => { window.removeEventListener('hashchange', route); window.removeEventListener('popstate', route); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const hash = window.location.hash;
    setView(hash === '#review' && session?.result ? 'review' : hash === '#practice' && session && !session.result ? 'practice' : 'setup');
    // Restore the route once storage/authentication finishes loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, history.user?.id]);

  useEffect(() => {
    if (!ready) return;
    const owner = getStorageOwner(userId);
    accountOwner.current = owner;
    let active = true;
    setCredentialToken('');
    try {
      const loaded = StorageLayer.readConfig(owner);
      setConfig(loaded);
      if (userId) {
        const localStatus = () => deviceVaultStatus(readDeviceVault(owner));
        setStatus({ ...localStatus(), loading: true });
        void api<KeyStatus>('/api/credentials', undefined, 'GET').then(next => {
          if (!active) return;
          if (!next.account) {
            setStatus({ ...localStatus(), notice: 'Akun sudah masuk, tetapi brankas server belum dapat memverifikasi sesi. API key dapat disimpan pada perangkat ini.' });
            return;
          }
          const local = localStatus();
          if (local.keys?.length && !next.keys?.length) {
            setStatus({ ...local, notice: 'API key akun ini tetap digunakan dari penyimpanan perangkat. Brankas server belum memiliki key.' });
            return;
          }
          setCredentialToken('');
          setStatus(next);
          StorageLayer.writeAccountKeysMeta(owner as `account:${string}`, next);
        }).catch(() => {
          if (active) {
            try {
              setStatus({ ...localStatus(), notice: 'Brankas server belum dapat diakses. API key dapat disimpan pada perangkat ini.' });
            } catch (e) {
              setStatus({ device: true, generator: false, evaluator: false, custom: false, server: false });
              setError((e as Error).message);
            }
          }
        });
      } else {
        const guestVault = StorageLayer.readGuestVault();
        setStatus(deviceVaultStatus(guestVault));
      }
    } catch (e) {
      setStatus({ device: true, generator: false, evaluator: false, custom: false, server: false });
      setError((e as Error).message);
    }
    return () => { active = false; };
  }, [ready, userId]);

  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => { if (busy) e.preventDefault(); };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [busy]);

  const changeConfig = (next: PracticeConfig) => {
    setConfig(next);
    try {
      StorageLayer.writeConfig(accountOwner.current, next);
    } catch {
      setConfigStorageFailed(true);
    }
    if (session && !session.result && view === 'practice' && !session.sample) {
      setSession({ ...session, config: { ...session.config, evaluator: next.evaluator, evaluatorKeyId: next.evaluatorKeyId, evaluatorFallback: next.evaluatorFallback } });
    }
  };
  const resume = () => { if (session) navigate(session.result ? 'review' : 'practice'); };
  function start() {
    setError('');
    if (!ready || !roleReady(status, config, 'generator') || !roleReady(status, config, 'evaluator')) { setSettings(true); return; }
    if (session && !session.result) setConfirm('replace');
    else void generate();
  }
  function startSample() {
    setError('');
    if (session && !session.result) setConfirm('sample-replace');
    else createSample();
  }
  function createSample() {
    const now = Date.now();
    setConfirm(null); setError(''); lastAction.current = null;
    setSession({ config: sampleConfig, challenge: sampleChallenge, answer: sampleAnswer, deadline: now + 5 * 60000, startedAt: now, sample: true });
    navigate('practice');
  }
  async function requestAI<T>(url: string, practiceConfig: PracticeConfig, body: Record<string, unknown> = {}): Promise<T> {
    const owner = accountOwner.current;
    const role = url === '/api/evaluate' ? 'evaluator' : 'generator';

    // Account user: backend uses server vault directly with authenticated token
    if (status.loading) throw new Error('Status brankas sedang diperiksa. Tunggu sebentar.');
    if (status.account && !status.device) {
      if (accountOwner.current !== owner) throw new Error('Akun berubah. Silakan mulai kembali.');
      const result = await api<T>(url, { ...practiceConfig, ...body });
      if (accountOwner.current !== owner) throw new Error('Akun berubah. Silakan mulai kembali.');
      return result;
    }

    // Device keys stay scoped to the active guest or account owner.
    const readLocal = () => owner === 'guest' ? StorageLayer.readGuestVault() : readDeviceVault(owner);
    const writeLocal = (vault: ReturnType<typeof readLocal>) => owner === 'guest' ? StorageLayer.writeGuestVault(vault) : writeDeviceVault(owner, vault);
    const vault = readLocal();
    const candidates = deviceCandidates(vault, practiceConfig, role).slice(0, vault.settings.maxAttempts);
    if (!candidates.length) throw new Error('Pilih API key aktif untuk peran ini di Pengaturan AI.');
    let failure: unknown;
    const requestId = crypto.randomUUID();
    for (const [index, key] of candidates.entries()) {
      const startedAt = Date.now();
      if (accountOwner.current !== owner) { setCredentialToken(''); throw new Error('Akun berubah. Silakan mulai kembali.'); }
      try {
        await api('/api/credentials', { generator: key.secret, evaluator: key.secret }, 'POST', 'device');
        if (accountOwner.current !== owner) { setCredentialToken(''); throw new Error('Akun berubah. Silakan mulai kembali.'); }
        const result = await api<T>(url, { ...deviceRequestConfig(practiceConfig), ...body }, 'POST', 'device');
        if (accountOwner.current !== owner) { setCredentialToken(''); throw new Error('Akun berubah. Silakan mulai kembali.'); }
        const latest = readLocal();
        latest.events = [...(latest.events || []), { keyName: key.name, model: practiceConfig[role], role, outcome: 'SUCCESS', duration: Date.now() - startedAt, attempt: index + 1, requestId, createdAt: Date.now() }].slice(-100);
        const used = latest.keys.find(item => item.id === key.id);
        if (used) { used.lastUsed = Date.now(); used.successes++; }
        try { writeLocal(latest); setStatus(deviceVaultStatus(latest)); } catch { setError('Hasil AI berhasil diterima, tetapi statistik penggunaan belum tersimpan.'); }
        return result;
      } catch (e) {
        failure = e;
        if (accountOwner.current !== owner) throw e;
        const latest = readLocal();
        latest.events = [...(latest.events || []), { keyName: key.name, model: practiceConfig[role], role, outcome: (e as Error & { code?: string }).code || 'NETWORK_ERROR', duration: Date.now() - startedAt, attempt: index + 1, requestId, createdAt: Date.now() }].slice(-100);
        const used = latest.keys.find(item => item.id === key.id);
        if (used) { used.lastUsed = Date.now(); used.failures++; }
        try { writeLocal(latest); setStatus(deviceVaultStatus(latest)); } catch { /* Original request error remains actionable. */ }
        // Retry only another key for verified access/quota failures; never repeat a key.
        if (!['INVALID_KEY', 'KEY_PERMISSION_DENIED', 'QUOTA_EXCEEDED', 'RATE_LIMIT'].includes((e as Error & { code?: string }).code || '')) throw e;
      }
    }
    throw failure;
  }
  async function generate() {
    if (locked.current) return;
    const actionOwner = accountOwner.current;
    locked.current = true; setConfirm(null); setError(''); setRoutingMessage(''); setBusy('generate'); lastAction.current = 'generate';
    try {
      const data = await requestAI<{ routing?: RoutingInfo }>('/api/generate', config);
      if (accountOwner.current !== actionOwner) throw new Error('Akun berubah saat latihan dibuat. Silakan mulai latihan pada akun yang sedang masuk.');
      const challenge = challengeSchema.parse(data);
      if (data.routing?.fallback) setRoutingMessage(`Latihan berhasil setelah ${data.routing.attempts.length} percobaan. Menggunakan ${data.routing.attempts.at(-1)?.keyName} · ${modelLabel(data.routing.model)}.`);
      const now = Date.now();
      setSession({ config: { ...config }, challenge, answer: '', deadline: now + config.duration * 60000, startedAt: now });
      navigate('practice');
    } catch (e) { setError((e as Error).message); }
    finally { locked.current = false; setBusy(null); }
  }
  function submit() {
    if (session?.sample && session.answer !== sampleAnswer) {
      lastAction.current = null;
      setError('Evaluasi contoh hanya berlaku untuk jawaban contoh. Pulihkan jawaban contoh untuk melihatnya, atau gunakan API key untuk menilai tulisanmu sendiri.');
      return;
    }
    setError(''); setConfirm('submit');
  }
  async function evaluate() {
    if (locked.current || !session) return;
    const actionOwner = accountOwner.current;
    setConfirm(null); setError('');
    if (session.sample) {
      setSession({ ...session, result: sampleEvaluation });
      navigate('review');
      return;
    }
    if (!roleReady(status, session.config, 'evaluator')) {
      setError('Periksa key dan model penilai terjemahan di Pengaturan AI. Jawabanmu tetap tersimpan.');
      setSettings(true);
      return;
    }
    locked.current = true; setRoutingMessage(''); setBusy('evaluate'); lastAction.current = 'evaluate';
    try {
      const data = await requestAI<{ routing?: RoutingInfo }>('/api/evaluate', session.config, { config: status.device ? deviceRequestConfig(session.config) : session.config, sourceText: session.challenge.sourceText, userTranslation: session.answer });
      if (accountOwner.current !== actionOwner) throw new Error('Akun berubah saat evaluasi berjalan. Draft tetap tersimpan pada akun asal.');
      const result = evaluationSchema.parse(data);
      if (data.routing?.fallback) setRoutingMessage(`Evaluasi berhasil setelah ${data.routing.attempts.length} percobaan. Menggunakan ${data.routing.attempts.at(-1)?.keyName} · ${modelLabel(data.routing.model)}.`);
      setSession({ ...session, result });
      navigate('review');
    } catch (e) { setError((e as Error).message); }
    finally { locked.current = false; setBusy(null); }
  }
  const confirmationTitle = confirm === 'replace' || confirm === 'sample-replace' ? 'Mulai latihan baru?' : session?.sample ? 'Lihat evaluasi contoh?' : 'Kirim untuk evaluasi?';
  const confirmationBody = confirm === 'sample-replace' ? 'Draft latihan saat ini akan diganti dengan teks, jawaban, dan evaluasi contoh.' : confirm === 'replace' ? 'Draft latihan saat ini akan diganti setelah teks baru berhasil dibuat.' : session?.sample ? 'Evaluasi ilustratif ini hanya menjelaskan jawaban contoh, tanpa panggilan AI.' : session?.answer.trim() ? 'Terjemahan akan dikunci dan AI mulai meninjau jawabanmu. Pastikan semua kalimat sudah selesai.' : 'Jawabanmu masih kosong. Kamu tetap dapat melihat versi ideal, tetapi nilai pengerjaan adalah 0.';

  return <div className="app-shell">
    <header className="site-header"><div className="header-inner"><button className="brand" onClick={() => { if (!busy) navigate('setup'); }} aria-label="Transly, beranda"><span className="brand-mark"><Languages size={23}/></span>transly<span className="brand-dot">.</span></button><nav aria-label="Navigasi utama"><button className={view === 'setup' ? 'active' : ''} onClick={() => { if (!busy) navigate('setup'); }}>Latihan</button>{session && <button className={view !== 'setup' ? 'active' : ''} onClick={() => { if (!busy) resume(); }}>{session.result ? 'Evaluasi' : 'Sesi aktif'}</button>}</nav><div className="header-actions"><button className="settings-button" aria-label="Pengaturan AI" onClick={() => setSettings(true)} disabled={Boolean(busy) || !ready}><SlidersHorizontal size={18}/><span>Pengaturan AI</span></button></div></div></header>
    {error && <div className="global-error"><ErrorBanner message={error} onDismiss={() => setError('')}/><div className="error-actions"><button className="text-button" onClick={() => setSettings(true)}>Pengaturan AI</button>{lastAction.current && <button className="text-button" disabled={Boolean(busy)} onClick={() => lastAction.current === 'generate' ? void generate() : void evaluate()}>Coba lagi</button>}</div></div>}
    {routingMessage && <div className="routing-notice" role="status"><ShieldCheck size={17}/><span>{routingMessage}</span><button className="text-button" onClick={() => setRoutingMessage('')}>Tutup</button></div>}
    {!ready ? <div className="initial-load" role="status">Menyiapkan ruang latihan…</div> : busy ? <Processing evaluation={busy === 'evaluate'}/> : view === 'practice' && session ? <Practice session={session} onAnswer={answer => setSession({ ...session, answer })} onSubmit={submit} onSampleAnswer={() => setSession({ ...session, answer: sampleAnswer })} onSettings={() => setSettings(true)} storageFailed={storageFailed || configStorageFailed}/> : view === 'review' && session?.result ? <Review session={session} onNew={() => navigate('setup')}/> : <Setup config={config} onConfig={changeConfig} onStart={start} onSample={startSample} onSettings={() => setSettings(true)} status={status} session={session} onResume={resume}/>}
    <Settings history={history} onResume={id => { const saved = history.entries.find(entry => entry.session.id === id); if (saved) { history.selectSession(id); navigate(saved.session.result ? 'review' : 'practice'); } }} open={settings} onClose={() => setSettings(false)} config={view === 'practice' && session ? { ...config, evaluator: session.config.evaluator, evaluatorKeyId: session.config.evaluatorKeyId, evaluatorFallback: session.config.evaluatorFallback } : config} onConfig={changeConfig} status={status} onStatus={setStatus}/>
    <Modal open={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirmationTitle}><div className="modal-body"><p className="muted">{confirmationBody}</p><div className="modal-actions"><button className="secondary-button" onClick={() => setConfirm(null)}>Kembali</button><button className="primary-button" onClick={() => confirm === 'replace' ? void generate() : confirm === 'sample-replace' ? createSample() : void evaluate()}>{confirm === 'replace' ? 'Buat latihan baru' : confirm === 'sample-replace' ? 'Buka sampel' : session?.sample ? 'Lihat contoh' : 'Evaluasi sekarang'}</button></div></div></Modal>
  </div>;
}
