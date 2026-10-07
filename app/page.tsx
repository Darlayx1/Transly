'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Languages, SlidersHorizontal, BookOpen, ShieldCheck } from 'lucide-react';
import { Setup } from '@/components/transly/setup';
import { Settings, type KeyStatus } from '@/components/transly/settings';
import { Practice } from '@/components/transly/practice';
import { Review } from '@/components/transly/review';
import { api, ErrorBanner, Processing, Modal } from '@/components/transly/ui';
import { challengeSchema, configSchema, defaultConfig, evaluationSchema, sessionSchema, type PracticeConfig, type PracticeSession } from '@/lib/transly/schema';

type View = 'setup' | 'practice' | 'review';
const SESSION = 'transly.session.v1'; const CONFIG = 'transly.config.v1';
export default function Home() {
  const [config, setConfig] = useState<PracticeConfig>(defaultConfig); const [session, setSession] = useState<PracticeSession | null>(null);
  const [view, setView] = useState<View>('setup'); const [settings, setSettings] = useState(false); const [busy, setBusy] = useState<'generate' | 'evaluate' | null>(null);
  const [status, setStatus] = useState<KeyStatus>({ generator: false, evaluator: false, custom: false, server: false });
  const [error, setError] = useState(''); const [storageFailed, setStorageFailed] = useState(false); const [confirm, setConfirm] = useState<'replace' | 'submit' | null>(null); const [ready, setReady] = useState(false);
  const lastAction = useRef<'generate' | 'evaluate' | null>(null); const locked = useRef(false); const current = useRef(session); current.current = session;
  const navigate = useCallback((next: View) => { setView(next); window.location.hash = next === 'setup' ? '' : next; window.scrollTo({ top: 0, behavior: 'instant' }); }, []);
  useEffect(() => {
    let saved: PracticeSession | null = null;
    try { const c = configSchema.safeParse(JSON.parse(localStorage.getItem(CONFIG) || 'null')); if (c.success) setConfig(c.data); const s = sessionSchema.safeParse(JSON.parse(localStorage.getItem(SESSION) || 'null')); if (s.success) { saved = s.data; setSession(s.data); } } catch { setStorageFailed(true); }
    const route = () => { const s = current.current ?? saved; const h = window.location.hash; setView(h === '#review' && s?.result ? 'review' : h === '#practice' && s && !s.result ? 'practice' : 'setup'); };
    route(); window.addEventListener('hashchange', route); setReady(true);
    api<KeyStatus>('/api/credentials', undefined, 'GET').then(setStatus).catch(() => setError('Pengaturan AI belum dapat dimuat. Coba buka Pengaturan AI atau muat ulang halaman.'));
    return () => window.removeEventListener('hashchange', route);
  }, []);
  useEffect(() => { if (!ready) return; try { localStorage.setItem(CONFIG, JSON.stringify(config)); if (session) localStorage.setItem(SESSION, JSON.stringify(session)); } catch { setStorageFailed(true); } }, [config, session, ready]);
  useEffect(() => { const protect = (e: BeforeUnloadEvent) => { if (busy) { e.preventDefault(); } }; window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect); }, [busy]);
  const changeConfig = (c: PracticeConfig) => { setConfig(c); if (session && !session.result && view === 'practice') setSession({ ...session, config: { ...session.config, evaluator: c.evaluator } }); };
  function start() { setError(''); if (!status.generator || !status.evaluator) { setSettings(true); return; } if (session && !session.result) setConfirm('replace'); else void generate(); }
  async function generate() {
    if (locked.current) return; locked.current = true; setConfirm(null); setError(''); setBusy('generate'); lastAction.current = 'generate';
    try { const challenge = challengeSchema.parse(await api('/api/generate', config)); const now = Date.now(); setSession({ config: { ...config }, challenge, answer: '', deadline: now + config.duration * 60000, startedAt: now }); navigate('practice'); }
    catch (e) { setError((e as Error).message); } finally { locked.current = false; setBusy(null); }
  }
  async function evaluate() {
    if (locked.current || !session) return; locked.current = true; setConfirm(null); setError(''); setBusy('evaluate'); lastAction.current = 'evaluate';
    try { const result = evaluationSchema.parse(await api('/api/evaluate', { config: session.config, sourceText: session.challenge.sourceText, userTranslation: session.answer })); setSession({ ...session, result }); navigate('review'); }
    catch (e) { setError((e as Error).message); } finally { locked.current = false; setBusy(null); }
  }
  const resume = () => { if (session) navigate(session.result ? 'review' : 'practice'); };
  return <div className="app-shell"><header className="site-header"><div className="header-inner"><button className="brand" onClick={() => { if (!busy) navigate('setup'); }} aria-label="Transly, beranda"><span className="brand-mark"><Languages size={23}/></span>transly<span className="brand-dot">.</span></button><nav aria-label="Navigasi utama"><button className={view === 'setup' ? 'active' : ''} onClick={() => { if (!busy) navigate('setup'); }}>Latihan</button>{session && <button className={view !== 'setup' ? 'active' : ''} onClick={() => { if (!busy) resume(); }}>{session.result ? 'Evaluasi' : 'Sesi aktif'}</button>}</nav><button className="settings-button" aria-label="Pengaturan AI" onClick={() => setSettings(true)} disabled={Boolean(busy)}><SlidersHorizontal size={18}/><span>Pengaturan AI</span></button></div></header>
    {error && <div className="global-error"><ErrorBanner message={error} onDismiss={() => setError('')}/><div className="error-actions"><button className="text-button" onClick={() => setSettings(true)}>Pengaturan AI</button>{lastAction.current && <button className="text-button" disabled={Boolean(busy)} onClick={() => lastAction.current === 'generate' ? void generate() : void evaluate()}>Coba lagi</button>}</div></div>}
    {!ready ? <div className="initial-load" role="status">Menyiapkan ruang latihan…</div> : busy ? <Processing evaluation={busy === 'evaluate'}/> : view === 'practice' && session ? <Practice session={session} onAnswer={answer => setSession({ ...session, answer })} onSubmit={() => setConfirm('submit')} onSettings={() => setSettings(true)} storageFailed={storageFailed}/> : view === 'review' && session?.result ? <Review session={session} onNew={() => navigate('setup')}/> : <Setup config={config} onConfig={changeConfig} onStart={start} onSettings={() => setSettings(true)} status={status} session={session} onResume={resume}/>}
    <footer className="site-footer"><span><Languages size={15}/>transly</span><span>Belajar memahami. Berlatih menerjemahkan.</span><span><ShieldCheck size={14}/>Key terenkripsi</span></footer>
    <Settings open={settings} onClose={() => setSettings(false)} config={view === 'practice' && session ? { ...config, evaluator: session.config.evaluator } : config} onConfig={changeConfig} status={status} onStatus={setStatus}/>
    <Modal open={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirm === 'replace' ? 'Mulai latihan baru?' : 'Kirim untuk evaluasi?'}><div className="modal-body"><p className="muted">{confirm === 'replace' ? 'Draft latihan saat ini akan diganti setelah teks baru berhasil dibuat.' : session?.answer.trim() ? 'Terjemahan akan dikunci dan AI mulai meninjau jawabanmu. Pastikan semua kalimat sudah selesai.' : 'Jawabanmu masih kosong. Kamu tetap dapat melihat versi ideal, tetapi nilai pengerjaan adalah 0.'}</p><div className="modal-actions"><button className="secondary-button" onClick={() => setConfirm(null)}>Kembali</button><button className="primary-button" onClick={() => confirm === 'replace' ? void generate() : void evaluate()}>{confirm === 'replace' ? 'Buat latihan baru' : 'Evaluasi sekarang'}</button></div></div></Modal>
  </div>;
}


