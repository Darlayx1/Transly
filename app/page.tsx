'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Languages, SlidersHorizontal, ShieldCheck } from 'lucide-react';
import { Setup } from '@/components/transly/setup';
import { Settings, type KeyStatus } from '@/components/transly/settings';
import { Practice } from '@/components/transly/practice';
import { Review } from '@/components/transly/review';
import { api, ErrorBanner, Processing, Modal } from '@/components/transly/ui';
import { challengeSchema, configSchema, defaultConfig, evaluationSchema, type PracticeConfig } from '@/lib/transly/schema';
import { sampleAnswer, sampleChallenge, sampleConfig, sampleEvaluation } from '@/lib/transly/sample';
import { modelLabel, type Provider } from '@/lib/transly/config';
import { roleReady } from '@/lib/transly/vault-types';
import type { RoutingInfo } from '@/lib/transly/vault-types';

import { loadDeviceKeys, deviceCredentialPayload } from '@/lib/transly/client-keys';
import { useAccountHistory } from '@/hooks/use-account-history';
import { AccountPanel } from '@/components/transly/account-panel';

type View = 'setup' | 'practice' | 'review';
type Confirmation = 'replace' | 'sample-replace' | 'submit';
const CONFIG = 'transly.config.v1';

export default function Home() {
  const [config, setConfig] = useState<PracticeConfig>(defaultConfig);
  const history = useAccountHistory();
  const { session, setSession, ready, storageFailed } = history;
  const [accountOpen, setAccountOpen] = useState(false);
  const [view, setView] = useState<View>('setup');
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState<'generate' | 'evaluate' | null>(null);
  const initialLocalKeys = typeof window !== 'undefined' ? loadDeviceKeys() : {};
  const hasInitialKeys = Boolean(initialLocalKeys.gemini || initialLocalKeys.generator || initialLocalKeys.evaluator);
  const initialProviders: Provider[] = hasInitialKeys ? ['gemini'] : [];
  const [status, setStatus] = useState<KeyStatus>({
    generator: hasInitialKeys,
    evaluator: hasInitialKeys,
    custom: hasInitialKeys,
    server: false,
    legacyProviders: initialProviders,
  });
  const [error, setError] = useState('');
  const [routingMessage, setRoutingMessage] = useState('');
  const [configStorageFailed, setConfigStorageFailed] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const lastAction = useRef<'generate' | 'evaluate' | null>(null);
  const locked = useRef(false);
  const current = useRef(session); current.current = session;
  const accountOwner = useRef(history.user?.id || 'guest');
  accountOwner.current = history.user?.id || 'guest';

  const navigate = useCallback((next: View) => {
    setView(next);
    const hash = next === 'setup' ? '' : `#${next}`;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash || window.location.pathname + window.location.search);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    try {
      const c = configSchema.safeParse(JSON.parse(localStorage.getItem(CONFIG) || 'null'));
      if (c.success) setConfig(c.data);
    } catch { setConfigStorageFailed(true); }
    const route = () => {
      const s = current.current;
      const h = window.location.hash;
      if (h === '#settings') setSettings(true);
      setView(h === '#review' && s?.result ? 'review' : h === '#practice' && s && !s.result ? 'practice' : 'setup');
    };
    route();
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);
    const localKeys = loadDeviceKeys();
    api<KeyStatus>('/api/credentials', undefined, 'GET')
      .then(async (s) => {
        if (!s.account && !s.custom && (localKeys.gemini || localKeys.generator || localKeys.evaluator)) {
          try {
            const synced = await api<KeyStatus>('/api/credentials', deviceCredentialPayload(localKeys), 'POST');
            setStatus(synced);
            return;
          } catch {
            // Keep status from GET if sync fails
          }
        }
        setStatus(s);
      })
      .catch(() => setError('Pengaturan AI belum dapat dimuat. Coba buka Pengaturan AI atau muat ulang halaman.'));
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
    try {
      localStorage.setItem(CONFIG, JSON.stringify(config));
    } catch { setConfigStorageFailed(true); }
  }, [config, ready]);
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => { if (busy) e.preventDefault(); };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [busy]);

  const changeConfig = (next: PracticeConfig) => {
    setConfig(next);
    if (session && !session.result && view === 'practice' && !session.sample) {
      setSession({ ...session, config: { ...session.config, evaluator: next.evaluator, evaluatorKeyId: next.evaluatorKeyId, evaluatorFallback: next.evaluatorFallback } });
    }
  };
  const resume = () => { if (session) navigate(session.result ? 'review' : 'practice'); };
  function start() {
    setError('');
    if (!roleReady(status, config, 'generator') || !roleReady(status, config, 'evaluator')) { setSettings(true); return; }
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
  async function generate() {
    if (locked.current) return;
    const actionOwner = accountOwner.current;
    locked.current = true; setConfirm(null); setError(''); setRoutingMessage(''); setBusy('generate'); lastAction.current = 'generate';
    try {
      const data = await api<{ routing?: RoutingInfo }>('/api/generate', config);
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
      const data = await api<{ routing?: RoutingInfo }>('/api/evaluate', { config: session.config, sourceText: session.challenge.sourceText, userTranslation: session.answer });
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
    <header className="site-header"><div className="header-inner"><button className="brand" onClick={() => { if (!busy) navigate('setup'); }} aria-label="Transly, beranda"><span className="brand-mark"><Languages size={23}/></span>transly<span className="brand-dot">.</span></button><nav aria-label="Navigasi utama"><button className={view === 'setup' ? 'active' : ''} onClick={() => { if (!busy) navigate('setup'); }}>Latihan</button>{session && <button className={view !== 'setup' ? 'active' : ''} onClick={() => { if (!busy) resume(); }}>{session.result ? 'Evaluasi' : 'Sesi aktif'}</button>}</nav><div className="header-actions"><button className="settings-button" onClick={() => setAccountOpen(true)} disabled={Boolean(busy) || !ready}>Akun & riwayat</button><button className="settings-button" aria-label="Pengaturan AI" onClick={() => setSettings(true)} disabled={Boolean(busy)}><SlidersHorizontal size={18}/><span>Pengaturan AI</span></button></div></div></header>
    {error && <div className="global-error"><ErrorBanner message={error} onDismiss={() => setError('')}/><div className="error-actions"><button className="text-button" onClick={() => setSettings(true)}>Pengaturan AI</button>{lastAction.current && <button className="text-button" disabled={Boolean(busy)} onClick={() => lastAction.current === 'generate' ? void generate() : void evaluate()}>Coba lagi</button>}</div></div>}
    {routingMessage && <div className="routing-notice" role="status"><ShieldCheck size={17}/><span>{routingMessage}</span><button className="text-button" onClick={() => setRoutingMessage('')}>Tutup</button></div>}
    {!ready ? <div className="initial-load" role="status">Menyiapkan ruang latihan…</div> : busy ? <Processing evaluation={busy === 'evaluate'}/> : view === 'practice' && session ? <Practice session={session} onAnswer={answer => setSession({ ...session, answer })} onSubmit={submit} onSampleAnswer={() => setSession({ ...session, answer: sampleAnswer })} onSettings={() => setSettings(true)} storageFailed={storageFailed || configStorageFailed}/> : view === 'review' && session?.result ? <Review session={session} onNew={() => navigate('setup')}/> : <Setup config={config} onConfig={changeConfig} onStart={start} onSample={startSample} onSettings={() => setSettings(true)} status={status} session={session} onResume={resume}/>}
    <footer className="site-footer"><span><Languages size={15}/>transly</span><span>Belajar memahami. Berlatih menerjemahkan.</span><span><ShieldCheck size={14}/>Key terenkripsi</span></footer>
    <Settings open={settings} onClose={() => setSettings(false)} config={view === 'practice' && session ? { ...config, evaluator: session.config.evaluator, evaluatorKeyId: session.config.evaluatorKeyId, evaluatorFallback: session.config.evaluatorFallback } : config} onConfig={changeConfig} status={status} onStatus={setStatus}/>
    <AccountPanel open={accountOpen} onClose={() => setAccountOpen(false)} history={history} onResume={id => { const saved = history.entries.find(entry => entry.session.id === id); if (saved) { history.selectSession(id); navigate(saved.session.result ? 'review' : 'practice'); } }}/>
    <Modal open={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirmationTitle}><div className="modal-body"><p className="muted">{confirmationBody}</p><div className="modal-actions"><button className="secondary-button" onClick={() => setConfirm(null)}>Kembali</button><button className="primary-button" onClick={() => confirm === 'replace' ? void generate() : confirm === 'sample-replace' ? createSample() : void evaluate()}>{confirm === 'replace' ? 'Buat latihan baru' : confirm === 'sample-replace' ? 'Buka sampel' : session?.sample ? 'Lihat contoh' : 'Evaluasi sekarang'}</button></div></div></Modal>
  </div>;
}
