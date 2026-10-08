'use client';
import { useEffect, useRef, useState } from 'react';
import { KeyRound, ShieldCheck, Plus, Check, LoaderCircle, Pencil, Trash2, RefreshCw, LogOut, History, SlidersHorizontal } from 'lucide-react';
import { models } from '@/lib/transly/config';
import type { PracticeConfig } from '@/lib/transly/schema';
import { apiOrigin, pagesMode } from '@/lib/transly/transport';
import { outcomeLabel, type KeyStatus, type VaultKey } from '@/lib/transly/vault-types';
import { api, ErrorBanner, Modal } from './ui';
import { ModelSelect } from './settings';
import { backupMaterial } from '@/lib/transly/backup-material';

const empty = { name: '', project: '', role: 'both' as VaultKey['role'], priority: 1, enabled: true, secret: '' };
const time = (value: number) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'short', timeStyle: 'short' }).format(value);
function keyState(key: VaultKey, status: KeyStatus, model: string) {
  if (!key.enabled) return 'Nonaktif';
  if (key.invalid) return 'Perlu diganti';
  const block = status.health?.find(h => h.model === model && h.until > Date.now() && ['provider', `key:${key.id}`, `project:${key.project}`].includes(h.scope));
  if (block) return block.until > 8e15 ? 'Periksa akses model' : `Tunggu ${Math.max(1, Math.ceil((block.until - Date.now()) / 1000))} dtk`;
  return key.testedAt ? 'Aktif · pernah diuji' : 'Tersimpan · belum diuji';
}
export function VaultSettings({ open, onClose, config, onConfig, status, onStatus }: { open: boolean; onClose: () => void; config: PracticeConfig; onConfig: (c: PracticeConfig) => void; status: KeyStatus; onStatus: (s: KeyStatus) => void }) {
  const [tab, setTab] = useState<'keys' | 'routing' | 'history'>('keys');
  const [form, setForm] = useState(empty), [editing, setEditing] = useState<string | null>(null), [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [remove, setRemove] = useState<VaultKey | null>(null);
  const [testModel, setTestModel] = useState(config.generator);
  const [mode, setMode] = useState<'priority' | 'balanced'>('priority'), [maxAttempts, setMaxAttempts] = useState(3);
  const [passphrase, setPassphrase] = useState(''), [backupFile, setBackupFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false), generation = useRef(0);
  useEffect(() => {
    if (!open || pagesMode) return;
    const run = ++generation.current;
    api<KeyStatus>('/api/credentials', undefined, 'GET').then(s => { if (run === generation.current) onStatus(s); }).catch(e => { if (run === generation.current) setError(e.message); });
    return () => { generation.current++; };
  }, [open, onStatus]);
  useEffect(() => { setMode(status.settings?.mode || 'priority'); setMaxAttempts(status.settings?.maxAttempts || 3); }, [status.settings?.mode, status.settings?.maxAttempts]);
  useEffect(() => { setTestModel(config.generator); }, [config.generator]);
  useEffect(() => {
    if (!open || !status.account || pagesMode) return;
    const timer = setInterval(() => {
      if (!lock.current && document.visibilityState === 'visible') api<KeyStatus>('/api/credentials', undefined, 'GET').then(onStatus).catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [open, status.account, onStatus]);
  const reset = () => { setForm(empty); setEditing(null); setShowForm(false); setRemove(null); setPassphrase(''); setBackupFile(null); if (fileInput.current) fileInput.current.value = ''; };
  const close = () => { if (lock.current) return; generation.current++; reset(); setError(''); setMessage(''); onClose(); };
  async function perform(id: string, body: unknown, success: string, after?: () => void) {
    if (lock.current) return;
    lock.current = true; setBusy(id); setError(''); setMessage('');
    try { onStatus(await api<KeyStatus>('/api/credentials', body)); setMessage(success); after?.(); }
    catch (e) { setError((e as Error).message); try { onStatus(await api<KeyStatus>('/api/credentials', undefined, 'GET')); } catch {} }
    finally { lock.current = false; setBusy(''); }
  }
  function edit(key: VaultKey) { setForm({ name: key.name, project: key.project === 'unknown' ? '' : key.project, role: key.role, priority: key.priority, enabled: key.enabled, secret: '' }); setEditing(key.id); setShowForm(true); setMessage(''); setError(''); }
  async function backup(action: 'export' | 'import') {
    if (lock.current) return;
    if (passphrase.length < 12) { setError('Gunakan kata sandi cadangan minimal 12 karakter.'); return; }
    if (action === 'import' && (!backupFile || backupFile.size > 130000)) { setError('Pilih file cadangan Transly berukuran maksimal 130 KB.'); return; }
    lock.current = true; setBusy(`backup:${action}`); setError(''); setMessage('');
    try {
      const archive = action === 'import' ? JSON.parse(await backupFile!.text()) : undefined;
      if (archive && (archive.format !== 'transly-vault-backup' || archive.version !== 1 || archive.iterations !== 600000 || typeof archive.salt !== 'string' || archive.salt.length > 64)) throw new Error('File cadangan tidak valid.');
      const material = await backupMaterial(passphrase, archive?.salt);
      const data = await api<{ backup?: unknown; imported?: number; skipped?: number }>('/api/credentials/backup', { action, ...material, ...(archive ? { backup: archive } : {}) });
      if (action === 'export') {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data.backup)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `transly-key-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage('Cadangan terenkripsi diunduh. Simpan kata sandinya terpisah.');
      } else { onStatus(await api<KeyStatus>('/api/credentials', undefined, 'GET')); setMessage(`${data.imported} key dipulihkan; ${data.skipped} dilewatkan karena sudah ada atau brankas penuh.`); }
      setPassphrase(''); setBackupFile(null); if (fileInput.current) fileInput.current.value = '';
    } catch (e) { setError(e instanceof SyntaxError ? 'File cadangan tidak dapat dibaca.' : (e as Error).message); }
    finally { lock.current = false; setBusy(''); }
  }
  const keys = status.keys || [], events = status.events || [];
  return <Modal open={open} onClose={close} title="Pengaturan AI" className="vault-modal"><div className="modal-body">
    <div className="two-col"><ModelSelect role="generator" value={config.generator} onChange={v => onConfig({ ...config, generator: v })}/><ModelSelect role="evaluator" value={config.evaluator} onChange={v => onConfig({ ...config, evaluator: v })}/></div>
    <div className="section-divider"/>
    {pagesMode ? <div className="vault-signin"><ShieldCheck size={30}/><h3>Buka brankas API key</h3><p>Kelola banyak key, simpan permanen, dan gunakan cadangan otomatis di situs utama Transly. Draft di perangkat ini tetap tersedia di halaman ini.</p><a className="primary-button" href={`${apiOrigin}/#settings`} target="_top">Buka Transly utama</a></div> : !status.account ? <div className="vault-signin"><ShieldCheck size={30}/><h3>Key tersimpan di akunmu</h3><p>Masuk untuk menyimpan key dengan aman, mengelola cadangan, dan membukanya kembali di perangkat lain.</p><a className="primary-button" href="/signin-with-chatgpt?return_to=%2F%23settings" target="_top">Masuk dengan ChatGPT</a><p className="muted small">Mode sampel tetap dapat digunakan tanpa masuk.</p></div> : <>
      <div className="vault-account"><span><ShieldCheck size={18}/><span>{status.account.email}</span></span><a className="text-button" href="/signout-with-chatgpt?return_to=%2F" target="_top"><LogOut size={15}/>Keluar</a></div>
      <div className="vault-tabs" role="tablist" aria-label="Pengelolaan key">{([['keys', 'API key', KeyRound], ['routing', 'Fallback', SlidersHorizontal], ['history', 'Riwayat', History]] as const).map(([id, label, Icon]) => <button type="button" id={`vault-tab-${id}`} aria-controls={`vault-panel-${id}`} role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} disabled={Boolean(busy)} key={id} className={tab === id ? 'active' : ''} onClick={() => { reset(); setTab(id); }} onKeyDown={e => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); const tabs = ['keys', 'routing', 'history'] as const; const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; reset(); setTab(next); document.getElementById(`vault-tab-${next}`)?.focus(); }}><Icon size={16}/>{label}{id === 'keys' && <span>{keys.length}</span>}</button>)}</div>
      {error && <ErrorBanner message={error}/>} {message && <p className="saved-message" role="status"><Check size={17}/>{message}</p>}
      <div role="tabpanel" id={`vault-panel-${tab}`} aria-labelledby={`vault-tab-${tab}`}>
      {tab === 'keys' && <>
        {status.legacyMigrationAvailable && <div className="vault-callout"><p>Key dari sesi sebelumnya masih tersedia. Pindahkan ke brankas agar tersimpan permanen.</p><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void perform('migrate', { action: 'migrate' }, 'Key sesi sudah dipindahkan ke brankas.')}>Pindahkan key sesi</button></div>}
        <div className="vault-toolbar"><p className="muted small">Hingga 50 key · nilai key selalu disembunyikan</p><button type="button" className="secondary-button" disabled={Boolean(busy) || keys.length >= 50} onClick={() => { reset(); setForm({ ...empty, priority: Math.min(100, keys.length + 1) }); setShowForm(true); }}><Plus size={16}/>Tambah key</button></div>
        {showForm && <form className="vault-form" onSubmit={e => { e.preventDefault(); void perform('save', { action: editing ? 'update' : 'add', ...form, ...(editing ? { id: editing } : {}), secret: form.secret.trim() || undefined }, editing ? 'Pengaturan key diperbarui.' : 'Key tersimpan permanen dalam brankas.', reset); }}>
          <h3>{editing ? 'Edit key' : 'Tambahkan API key'}</h3>
          <div className="two-col"><label className="field"><span>Nama key</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={60} required placeholder="Contoh: Key utama" disabled={Boolean(busy)}/></label><label className="field"><span>Project ID Google Cloud</span><input value={form.project} onChange={e => setForm({ ...form, project: e.target.value })} maxLength={100} placeholder="Contoh: proyek-belajar-123" disabled={Boolean(busy)}/></label></div>
          <p className="muted small">Isi Project ID yang sama untuk key dari proyek yang sama. Key tanpa Project ID dikelompokkan bersama untuk membatasi pemakaian dengan aman.</p>
          <label className="field"><span>{editing ? 'Ganti API key (opsional)' : 'API key Google AI'}</span><input type="password" autoComplete="new-password" spellCheck={false} value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })} minLength={20} maxLength={256} required={!editing} placeholder={editing ? 'Kosongkan untuk mempertahankan key' : 'Tempel API key dari Google AI Studio'} disabled={Boolean(busy)}/></label>
          <div className="two-col"><label className="field"><span>Penggunaan</span><select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as VaultKey['role'] })} disabled={Boolean(busy)}><option value="both">Pembuat soal & evaluator</option><option value="generator">Pembuat soal</option><option value="evaluator">Evaluator</option></select></label><label className="field"><span>Prioritas (1 paling utama)</span><input type="number" min={1} max={100} value={form.priority} onChange={e => setForm({ ...form, priority: Number(e.target.value) })} required disabled={Boolean(busy)}/></label></div>
          <label className="checkbox-row"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} disabled={Boolean(busy)}/>Aktifkan key</label>
          <div className="modal-actions"><button type="button" className="text-button" disabled={Boolean(busy)} onClick={reset}>Batal</button><button className="primary-button" disabled={Boolean(busy)}>{busy === 'save' ? <LoaderCircle size={16} className="spin"/> : <KeyRound size={16}/>}Simpan key</button></div>
        </form>}
        {!keys.length && !showForm && <div className="vault-empty"><KeyRound size={25}/><p>Belum ada API key.</p><span>Tambahkan key utama, lalu key cadangan untuk fallback otomatis.</span></div>}
        <div className="vault-key-list">{keys.map(key => {
          const model = key.role === 'evaluator' ? config.evaluator : config.generator;
          const health = keyState(key, status, model);
          return <article className={`vault-key ${!key.enabled ? 'is-disabled' : ''}`} key={key.id}>
            <div className="vault-key-head"><div><h3>{key.name}<code>••••{key.suffix}</code></h3><p>{key.role === 'both' ? 'Keduanya' : key.role === 'generator' ? 'Pembuat soal' : 'Evaluator'} · Prioritas {key.priority} · {key.project === 'unknown' ? 'Proyek belum diisi' : key.project}</p></div><span className={`pill ${key.enabled && !key.invalid && health.startsWith('Aktif') ? 'success' : ''}`}>{health}</span></div>
            <div className="vault-key-details"><span>{key.successes} berhasil · {key.failures} gagal</span><span>{key.lastUsed ? `Terakhir: ${time(key.lastUsed)}` : 'Belum digunakan'}</span></div>
            <div className="vault-key-actions"><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void perform(`test:${key.id}`, { action: 'test', id: key.id, model: testModel }, 'Akses model tersedia. Kuota pembuatan konten tetap mengikuti Google.')}>{busy === `test:${key.id}` ? <LoaderCircle size={15} className="spin"/> : <RefreshCw size={15}/>}Uji akses</button><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => edit(key)}><Pencil size={15}/>Edit</button><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void perform(`toggle:${key.id}`, { action: 'update', ...key, enabled: !key.enabled }, key.enabled ? 'Key dinonaktifkan.' : 'Key diaktifkan.')}>{key.enabled ? 'Nonaktifkan' : 'Aktifkan'}</button><button type="button" className="text-button danger-text" disabled={Boolean(busy)} onClick={() => setRemove(key)}><Trash2 size={15}/>Hapus</button></div>
            {remove?.id === key.id && <div className="vault-delete"><p>Hapus “{key.name}” dari brankas dan riwayatnya? Key di Google tetap berlaku sampai dicabut di Google AI Studio.</p><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => setRemove(null)}>Batal</button><button type="button" className="text-button danger-text" disabled={Boolean(busy)} onClick={() => void perform(`remove:${key.id}`, { action: 'remove', id: key.id }, 'Key dihapus dari brankas.', () => setRemove(null))}>Hapus key ini</button></div>}
          </article>;
        })}</div>
        {keys.length > 0 && <label className="field vault-test-model"><span>Model untuk uji akses</span><select value={testModel} disabled={Boolean(busy)} onChange={e => setTestModel(e.target.value)}>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
        <div className="security-note"><ShieldCheck size={20}/><p>Key tersimpan terenkripsi di akunmu dan tidak dikirim kembali ke browser. Uji akses memeriksa model tanpa membuat konten. Dapatkan key di <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">Google AI Studio</a>.</p></div>
      </>}
      {tab === 'routing' && <><form className="vault-routing" onSubmit={e => { e.preventDefault(); void perform('settings', { action: 'settings', mode, maxAttempts }, 'Pengaturan fallback disimpan.'); }}>
        <h3>Pemilihan key otomatis</h3><p className="muted">Fallback menggunakan model yang kamu pilih. Key yang nonaktif, invalid, atau sedang menunggu pemulihan akan dilewatkan.</p>
        <label className={`vault-mode ${mode === 'priority' ? 'selected' : ''}`}><input type="radio" name="routing-mode" value="priority" checked={mode === 'priority'} onChange={() => setMode('priority')} disabled={Boolean(busy)}/><span><b>Prioritas & cadangan</b><span>Gunakan key utama terlebih dahulu, lalu cadangan bila gagal.</span></span></label>
        <label className={`vault-mode ${mode === 'balanced' ? 'selected' : ''}`}><input type="radio" name="routing-mode" value="balanced" checked={mode === 'balanced'} onChange={() => setMode('balanced')} disabled={Boolean(busy)}/><span><b>Pembagian beban</b><span>Pilih key yang paling lama tidak digunakan; permintaan berbeda dapat memakai key berbeda.</span></span></label>
        <label className="field"><span>Maksimal percobaan per permintaan</span><select value={maxAttempts} onChange={e => setMaxAttempts(Number(e.target.value))} disabled={Boolean(busy)}><option value={1}>1 · tanpa percobaan tambahan</option><option value={2}>2 · satu percobaan tambahan</option><option value={3}>3 · dua percobaan tambahan</option></select></label>
        <div className="vault-callout"><p>Key dari proyek Google yang sama berbagi batas kuota. Mengganti key dalam proyek tersebut tidak menambah kuota. Waktu tunggu provider akan dihormati.</p><p>Permintaan ganda dicegah. Percobaan dibatasi dalam 85 detik; timeout tetap dapat menghabiskan kuota bila Google sudah memprosesnya.</p></div>
        <div className="modal-actions"><button className="primary-button" disabled={Boolean(busy)}>{busy === 'settings' && <LoaderCircle size={16} className="spin"/>}Simpan pengaturan</button></div>
      </form><details className="vault-backup"><summary>Cadangan & pemulihan key</summary><div>
        <p className="muted small">Cadangan dilindungi kata sandi yang kamu tentukan. Simpan file dan kata sandinya terpisah; cadangan tidak dapat dibuka bila kata sandinya hilang.</p>
        <label className="field"><span>Kata sandi cadangan (minimal 12 karakter)</span><input type="password" autoComplete="new-password" maxLength={256} value={passphrase} onChange={e => setPassphrase(e.target.value)} disabled={Boolean(busy)}/></label>
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void backup('export')}>{busy === 'backup:export' && <LoaderCircle size={16} className="spin"/>}Unduh cadangan terenkripsi</button>
        <label className="field"><span>File untuk dipulihkan</span><input ref={fileInput} type="file" accept="application/json,.json" disabled={Boolean(busy)} onChange={e => setBackupFile(e.target.files?.[0] || null)}/></label>
        <button type="button" className="secondary-button" disabled={Boolean(busy) || !backupFile} onClick={() => void backup('import')}>{busy === 'backup:import' && <LoaderCircle size={16} className="spin"/>}Pulihkan cadangan</button>
        <p className="muted small">Pemulihan menambahkan key tanpa menimpa key yang sudah ada. Pengaturan fallback mengikuti cadangan.</p>
      </div></details></>}
      {tab === 'history' && <>
        <div className="vault-toolbar"><p className="muted small">30 percobaan terbaru · hingga 100 disimpan</p><button type="button" className="text-button" disabled={Boolean(busy)} onClick={async () => { try { onStatus(await api<KeyStatus>('/api/credentials', undefined, 'GET')); } catch (e) { setError((e as Error).message); } }}><RefreshCw size={15}/>Perbarui</button></div>
        {!events.length ? <div className="vault-empty"><History size={25}/><p>Belum ada aktivitas.</p><span>Hasil percobaan dan perpindahan key akan muncul di sini.</span></div> : <ol className="vault-history">{events.map((e, i) => <li key={`${e.requestId}:${e.attempt}:${i}`}><div><b>{e.keyName}</b><span>{outcomeLabel[e.outcome] || 'Pemrosesan gagal'}{e.attempt > 1 ? ` · Percobaan ${e.attempt}` : ''}</span></div><p>{e.model} · {e.role === 'test' ? 'Uji akses' : e.role === 'generator' ? 'Pembuat soal' : 'Evaluator'} · {(e.duration / 1000).toFixed(1)} dtk</p><time dateTime={new Date(e.createdAt).toISOString()}>{time(e.createdAt)}</time></li>)}</ol>}
        <p className="muted small">Riwayat berisi status dan durasi. Nilai API key, teks latihan, dan jawaban tidak dicatat di sini.</p>
      </>}
      </div>
    </>}
  </div></Modal>;
}
