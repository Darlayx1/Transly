'use client';
import { useEffect, useRef, useState } from 'react';
import { KeyRound, ShieldCheck, Plus, Check, LoaderCircle, Pencil, Trash2, RefreshCw, LogOut, History, LayoutDashboard, Archive, ExternalLink, Sparkles, Eye, EyeOff } from 'lucide-react';
import { models, modelProvider, modelLabel, defaultProviderModel, providers, type Provider } from '@/lib/transly/config';
import { withRoleModel, type PracticeConfig } from '@/lib/transly/schema';
import { apiOrigin, pagesMode } from '@/lib/transly/transport';
import { outcomeLabel, keyAvailability, hasUsableKey, roleReady, type KeyStatus, type VaultKey } from '@/lib/transly/vault-types';
import { api, ErrorBanner, Modal } from './ui';
import { backupMaterial } from '@/lib/transly/backup-material';
import { loadDeviceKeys, saveDeviceKeys, clearDeviceKeys, deviceCredentialPayload, maskKey, type DeviceKeys } from '@/lib/transly/client-keys';

const empty = { provider: 'gemini' as Provider, name: '', project: '', role: 'both' as VaultKey['role'], priority: 1, enabled: true, secret: '' };
const tabs = [
  { id: 'overview', label: 'Ringkasan', icon: LayoutDashboard },
  { id: 'keys', label: 'API key', icon: KeyRound },
  { id: 'models', label: 'Model & penggunaan', icon: Sparkles },
  { id: 'backup', label: 'Cadangan & pemulihan', icon: Archive },
  { id: 'history', label: 'Aktivitas', icon: History },
] as const;
type Tab = (typeof tabs)[number]['id'];
type Role = 'generator' | 'evaluator';
const roleLabel = (role: Role) => role === 'generator' ? 'Pembuat soal' : 'Penilai terjemahan';
const time = (value: number) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'short', timeStyle: 'short' }).format(value);
const stateLabels: Record<string, string> = { disabled: 'Nonaktif', invalid: 'Perlu diganti', permission: 'Periksa izin model', cooldown: 'Menunggu pemulihan', tested: 'Akses model teruji', untested: 'Tersimpan · belum teruji', 'wrong-provider': 'Provider berbeda' };

function RoleChoice({ role, config, status, onConfig }: { role: Role; config: PracticeConfig; status: KeyStatus; onConfig: (config: PracticeConfig) => void }) {
  const keyField = role === 'generator' ? 'generatorKeyId' : 'evaluatorKeyId';
  const compatible = (status.keys || []).filter(key => key.role === role || key.role === 'both');
  const ready = hasUsableKey(status, role, config[role], config[keyField]);
  return <section className="ai-role-card">
    <div className="ai-role-title"><h3>{roleLabel(role)}</h3><span className={`pill ${ready ? 'success' : ''}`}>{ready ? 'Key tersedia' : 'Perlu konfigurasi'}</span></div>
    <p className="muted">{role === 'generator' ? 'Menyusun teks sesuai level dan topik latihan.' : 'Menilai ketepatan dan kealamian terjemahanmu.'}</p>
    <div className="two-col"><label className="field"><span>Penyedia AI</span><input value="Google AI Studio" disabled readOnly/></label>
      <label className="field"><span>Model</span><select value={config[role]} onChange={e => onConfig(withRoleModel(config, role, e.target.value))}>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label></div>
    {status.account && <label className="field"><span>Key untuk model ini</span><select value={config[keyField] || ''} onChange={e => onConfig({ ...config, [keyField]: e.target.value || undefined })}><option value="">Otomatis · ikuti urutan key</option>{config[keyField] && !compatible.some(key => key.id === config[keyField]) && <option value={config[keyField]}>Key pilihan sudah tidak tersedia</option>}{compatible.map(key => <option value={key.id} key={key.id}>{key.name} · {stateLabels[keyAvailability(key, status, config[role])]}</option>)}</select><small className="muted">Pilihan otomatis dapat memakai key cadangan yang tersedia di brankas.</small></label>}
    {!ready && <p className="ai-inline-warning">{config[keyField] ? 'Periksa key pilihan, izin model, atau waktu tunggunya.' : `Tambahkan API key Google AI Studio yang aktif untuk ${roleLabel(role).toLowerCase()}.`}</p>}
  </section>;
}

export function VaultSettings({ open, onClose, config, onConfig, status, onStatus }: { open: boolean; onClose: () => void; config: PracticeConfig; onConfig: (c: PracticeConfig) => void; status: KeyStatus; onStatus: (s: KeyStatus) => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [form, setForm] = useState(empty), [editing, setEditing] = useState<string | null>(null), [showForm, setShowForm] = useState(false);
  const [formStart, setFormStart] = useState(JSON.stringify(empty));
  const [visibleSecret, setVisibleSecret] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [remove, setRemove] = useState<VaultKey | null>(null), [pendingLeave, setPendingLeave] = useState<Tab | 'close' | 'reset' | null>(null);
  const [testModel, setTestModel] = useState(config.generator);
  const [mode, setMode] = useState<'priority' | 'balanced'>('priority'), [maxAttempts, setMaxAttempts] = useState(3);
  const [passphrase, setPassphrase] = useState(''), [backupFile, setBackupFile] = useState<File | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null), lock = useRef(false), generation = useRef(0);
  const [deviceKeys, setDeviceKeys] = useState<DeviceKeys>({});
  const [geminiInput, setGeminiInput] = useState('');
  const [visibleGemini, setVisibleGemini] = useState(false);
  const [keySource, setKeySource] = useState<'device' | 'vault'>(status.account ? 'vault' : 'device');

  useEffect(() => {
    if (open) setDeviceKeys(loadDeviceKeys());
  }, [open]);

  useEffect(() => {
    if (!open || pagesMode) return;
    const run = ++generation.current; let active = true;
    api<KeyStatus>('/api/credentials', undefined, 'GET').then(s => { if (active && run === generation.current) onStatus(s); }).catch(e => { if (active && run === generation.current) setError(e.message); });
    return () => { active = false; };
  }, [open, onStatus]);
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [tab]);
  useEffect(() => { setMode(status.settings?.mode || 'priority'); setMaxAttempts(status.settings?.maxAttempts || 3); }, [status.settings?.mode, status.settings?.maxAttempts]);
  useEffect(() => {
    if (!open || !status.account || pagesMode) return;
    const timer = setInterval(() => { if (!lock.current && document.visibilityState === 'visible') { const run = generation.current; api<KeyStatus>('/api/credentials', undefined, 'GET').then(s => { if (run === generation.current) onStatus(s); }).catch(() => {}); } }, 15000);
    return () => clearInterval(timer);
  }, [open, status.account, onStatus]);
  const routingDirty = tab === 'backup' && (mode !== (status.settings?.mode || 'priority') || maxAttempts !== (status.settings?.maxAttempts || 3));
  const dirty = (showForm && JSON.stringify(form) !== formStart) || Boolean(passphrase || backupFile) || Boolean(geminiInput) || routingDirty;
  useEffect(() => {
    if (!open || !dirty) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect);
  }, [open, dirty]);
  function reset() {
    setForm(empty); setFormStart(JSON.stringify(empty)); setEditing(null); setShowForm(false); setVisibleSecret(false); setRemove(null);
    setPassphrase(''); setBackupFile(null); setGeminiInput(''); setVisibleGemini(false);
    if (fileInput.current) fileInput.current.value = '';
  }
  async function saveDeviceKeysForm(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    const nextGemini = geminiInput.trim() || deviceKeys.gemini;
    if (!nextGemini) {
      setError('Masukkan API key Google AI Studio.');
      return;
    }
    const updated: DeviceKeys = {
      ...deviceKeys,
      gemini: nextGemini,
    };
    lock.current = true;
    setBusy('save-device');
    setError('');
    setMessage('');
    try {
      const payload = deviceCredentialPayload(updated);
      saveDeviceKeys(updated);
      setDeviceKeys(updated);
      const data = await api<KeyStatus>('/api/credentials', payload, 'POST');
      onStatus(data);
      setGeminiInput('');
      setMessage('API key tersimpan di perangkat ini. Tidak perlu diisi ulang saat refresh atau membuka kembali.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      lock.current = false;
      setBusy('');
    }
  }
  async function removeDeviceKeysForm() {
    if (lock.current) return;
    lock.current = true;
    setBusy('remove-device');
    setError('');
    setMessage('');
    try {
      clearDeviceKeys();
      setDeviceKeys({});
      await api('/api/credentials', {}, 'DELETE');
      onStatus(await api<KeyStatus>('/api/credentials', undefined, 'GET'));
      setMessage('API key dihapus dari perangkat ini.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      lock.current = false;
      setBusy('');
    }
  }
  function leave(target: Tab | 'close' | 'reset', discard = false) {
    if (lock.current) return;
    if (dirty && !discard) { setPendingLeave(target); return; }
    reset(); setMode(status.settings?.mode || 'priority'); setMaxAttempts(status.settings?.maxAttempts || 3); setPendingLeave(null); setError(''); setMessage('');
    if (target === 'close') { generation.current++; onClose(); } else if (target !== 'reset') setTab(target);
  }
  async function perform(id: string, body: unknown, success: string) {
    if (lock.current) return null;
    lock.current = true; generation.current++; setBusy(id); setError(''); setMessage('');
    try { const data = await api<KeyStatus & { addedId?: string }>('/api/credentials', body); onStatus(data); setMessage(success); return data; }
    catch (e) { setError((e as Error).message); try { onStatus(await api<KeyStatus>('/api/credentials', undefined, 'GET')); } catch {} return null; }
    finally { lock.current = false; setBusy(''); }
  }
  function startForm(key?: VaultKey, provider: Provider = 'gemini') {
    const next = key ? { provider: key.provider, name: key.name, project: key.project === 'unknown' ? '' : key.project, role: key.role, priority: key.priority, enabled: key.enabled, secret: '' } : { ...empty, provider, priority: Math.min(100, (status.keys?.length || 0) + 1) };
    setForm(next); setFormStart(JSON.stringify(next)); setEditing(key?.id || null); setShowForm(true); setVisibleSecret(false); setRemove(null); setMessage(''); setError('');
    setTestModel(models.find(model => model.provider === next.provider && model.id === config.generator)?.id || defaultProviderModel(next.provider));
  }
  async function saveKey(andTest: boolean) {
    const data = await perform('save', { action: editing ? 'update' : 'add', ...form, ...(editing ? { id: editing } : {}), secret: form.secret.trim() || undefined }, 'Key tersimpan terenkripsi.');
    if (!data) return;
    const keyId = editing || data.addedId, model = testModel; reset();
    if (andTest && keyId) { const tested = await perform(`test:${keyId}`, { action: 'test', id: keyId, model }, 'Key tersimpan dan akses model teruji. Ketersediaan kuota diperiksa saat digunakan.'); if (!tested) setMessage('Key sudah tersimpan. Uji akses belum berhasil; periksa pesan berikut.'); }
  }
  async function backup(action: 'export' | 'import') {
    if (lock.current) return;
    if (passphrase.length < 12) { setError('Gunakan kata sandi cadangan minimal 12 karakter.'); return; }
    if (action === 'import' && (!backupFile || backupFile.size > 130000)) { setError('Pilih file cadangan Transly berukuran maksimal 130 KB.'); return; }
    lock.current = true; generation.current++; setBusy(`backup:${action}`); setError(''); setMessage('');
    try {
      const archive = action === 'import' ? JSON.parse(await backupFile!.text()) : undefined;
      if (archive && (archive.format !== 'transly-vault-backup' || ![1, 2].includes(archive.version) || archive.iterations !== 600000 || typeof archive.salt !== 'string' || archive.salt.length > 64)) throw new Error('File cadangan tidak valid.');
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
  const accountRequired = pagesMode || !status.account;
  const managedTab = ['backup', 'history'].includes(tab);
  const tabInfo = tabs.find(item => item.id === tab)!;
  return <Modal open={open} onClose={() => leave('close')} title="Pengaturan AI" className="vault-modal ai-window">
    <div className="ai-window-layout">
      <aside className="ai-window-sidebar"><div className="ai-sidebar-caption">RUANG KONTROL AI</div><nav aria-label="Bagian pengaturan AI">{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} disabled={Boolean(busy)} onClick={() => leave(id)}><Icon size={18}/><span>{label}</span>{id === 'keys' && <small>{status.account ? keys.length : (deviceKeys.gemini ? 1 : 0)}</small>}</button>)}</nav><div className="ai-account"><ShieldCheck size={18}/><div><b>{status.account ? 'Brankas akun' : 'Brankas pribadi'}</b><span title={status.account?.email}>{status.account?.email || 'Tersimpan di perangkat'}</span></div>{status.account && <a href="/signout-with-chatgpt?return_to=%2F" target="_top" aria-label="Keluar dari akun"><LogOut size={16}/></a>}</div></aside>
      <div className="ai-window-content" ref={contentRef}><div className="ai-content-heading"><div><h3>{tabInfo.label}</h3><p>{tab === 'overview' ? 'Hubungkan Google AI Studio, lalu tentukan penggunaannya.' : tab === 'keys' ? 'Kelola API key di perangkat ini atau brankas akun.' : tab === 'models' ? 'Pilih model untuk pembuat soal dan penilai terjemahan.' : tab === 'backup' ? 'Atur cadangan otomatis dan lindungi key tersimpan.' : 'Lihat hasil akses dan percobaan penggunaan AI.'}</p></div><span className="ai-encrypted"><ShieldCheck size={15}/>Terenkripsi</span></div>
        {pendingLeave && <div className="ai-unsaved" role="alertdialog" aria-labelledby="ai-unsaved-title"><h4 id="ai-unsaved-title">Ada perubahan yang belum disimpan</h4><p>Jika dilanjutkan, input key atau pengaturan yang belum disimpan akan dibuang.</p><div><button type="button" className="secondary-button" autoFocus onClick={() => setPendingLeave(null)}>Lanjutkan mengedit</button><button type="button" className="text-button" onClick={() => leave(pendingLeave, true)}>Buang perubahan</button></div></div>}
        {error && <ErrorBanner message={error} onDismiss={() => setError('')}/>} {message && <p className="saved-message" role="status"><Check size={17}/>{message}</p>}
        {managedTab && accountRequired ? <div className="vault-signin"><ShieldCheck size={32}/><h3>{pagesMode ? 'Kelola brankas di Transly utama' : 'Simpan key di akun cloud'}</h3><p>{pagesMode ? 'Fitur brankas multi-key cloud tersedia di situs utama. Key di perangkat ini tetap aktif untuk latihan.' : 'Masuk untuk mengaktifkan riwayat dan cadangan otomatis multi-key di seluruh perangkat.'}</p><a className="primary-button" href={pagesMode ? `${apiOrigin}/#settings` : '/signin-with-chatgpt?return_to=%2F%23settings'} target="_top">{pagesMode ? 'Buka Transly utama' : 'Masuk dengan ChatGPT'}</a><p className="muted small">Latihan sampel dan API key lokal perangkat tetap tersedia tanpa akun.</p></div> : <>
          {tab === 'overview' && <>
            <div className="ai-overview-roles">{(['generator', 'evaluator'] as const).map(role => { const keyId = role === 'generator' ? config.generatorKeyId : config.evaluatorKeyId; const ready = roleReady(status, config, role); const tested = keys.some(key => (!keyId || key.id === keyId) && (key.role === role || key.role === 'both') && keyAvailability(key, status, config[role]) === 'tested'); return <article key={role} className="ai-overview-role"><span className="ai-role-symbol"><Sparkles size={20}/></span><h4>{roleLabel(role)}</h4><p>{modelLabel(config[role])}</p><span className={`pill ${ready ? 'success' : ''}`}>{tested ? 'Akses model teruji' : ready ? 'Key tersedia' : 'Belum terhubung'}</span><button type="button" className="text-button" onClick={() => leave(ready ? 'models' : 'keys')}>{ready ? 'Atur penggunaan' : 'Hubungkan key'}</button></article>; })}</div>
            <div className="ai-section-title"><h4>Penyedia AI</h4><span>{status.account ? `${keys.length} key tersimpan di brankas` : `${deviceKeys.gemini ? 1 : 0} key di perangkat`}</span></div><div className="ai-provider-grid">{(Object.keys(providers) as Provider[]).map(provider => {
              const hasDev = Boolean(deviceKeys[provider]);
              const count = keys.filter(key => key.provider === provider).length;
              return <article key={provider} className="ai-provider-card"><div><span className="ai-provider-mark">G</span><h4>{providers[provider].name}</h4><span className="pill">{status.account ? `${count} key` : hasDev ? 'Tersimpan di perangkat' : 'Belum diatur'}</span></div><p>Model Gemini dan Gemma dari Google AI Studio.</p><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => { setTab('keys'); if (status.account) { setKeySource('vault'); startForm(undefined, provider); } else { setKeySource('device'); } }}>{hasDev || count > 0 ? 'Kelola key' : 'Tambah key'}</button></article>;
            })}</div>
            <div className="ai-help-note"><KeyRound size={19}/><p><b>Mulai dengan API key Google AI Studio.</b> Simpan API key di perangkat Anda, lalu pilih model untuk pembuat soal dan penilai. Key tetap tersimpan saat me-refresh halaman atau membuka kembali browser.</p></div>
          </>}
          {tab === 'keys' && <>
            {status.account && <div className="vault-toolbar" style={{ marginBottom: '16px' }}><div className="ai-filter" aria-label="Sumber key"><button type="button" aria-pressed={keySource === 'device'} onClick={() => setKeySource('device')}>Key di Perangkat</button><button type="button" aria-pressed={keySource === 'vault'} onClick={() => setKeySource('vault')}>Brankas Akun ({keys.length})</button></div></div>}
            {(keySource === 'device' || !status.account) ? (
              <div className="ai-device-storage">
                <div className="vault-callout"><p><b>Penyimpanan di Perangkat:</b> API key Google AI Studio tersimpan lokal di browser perangkat ini (localStorage). Tidak perlu diisi ulang saat refresh atau membuka kembali aplikasi.</p></div>
                <form className="vault-form ai-key-form" onSubmit={saveDeviceKeysForm}>
                  <div className="ai-section-title"><h4>API Key Google AI Studio</h4><span>Tersimpan lokal di browser</span></div>
                  <div className="ai-role-card">
                    <div className="ai-role-title">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span className="ai-provider-mark">G</span>
                        <div><h3>Google AI Studio</h3><p className="muted small">Gemini 3.5, 3.6, 3.7, 3.8 Flash, dan Gemma 4</p></div>
                      </div>
                      <span className={`pill ${deviceKeys.gemini ? 'success' : ''}`}>{deviceKeys.gemini ? `Tersimpan ${maskKey(deviceKeys.gemini)}` : 'Belum diatur'}</span>
                    </div>
                    <label className="field">
                      <span>{deviceKeys.gemini ? 'Ganti API key Google AI Studio' : 'API key Google AI Studio'}</span>
                      <div className="ai-secret-field">
                        <input type={visibleGemini ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={geminiInput} onChange={e => setGeminiInput(e.target.value)} minLength={20} maxLength={256} placeholder={deviceKeys.gemini ? 'Kosongkan jika tetap menggunakan key saat ini' : 'Tempel key dari Google AI Studio'} disabled={Boolean(busy)}/>
                        <button type="button" className="icon-button" aria-label={visibleGemini ? 'Sembunyikan' : 'Tampilkan'} onClick={() => setVisibleGemini(!visibleGemini)}>{visibleGemini ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                        <a className="ai-key-link" href={providers.gemini.keyUrl} target="_blank" rel="noreferrer">Dapatkan API key di Google AI Studio<ExternalLink size={14}/></a>
                        {deviceKeys.gemini && <button type="button" className="text-button danger-text" disabled={Boolean(busy)} onClick={() => removeDeviceKeysForm()}><Trash2 size={14}/>Hapus key dari perangkat</button>}
                      </div>
                    </label>
                  </div>

                  <div className="modal-actions" style={{ marginTop: '20px' }}>
                    <button type="submit" className="primary-button" disabled={Boolean(busy) || !geminiInput.trim()}>{busy === 'save-device' && <LoaderCircle size={16} className="spin"/>}Simpan di perangkat</button>
                  </div>
                </form>
                {!status.account && !pagesMode && (
                  <div className="ai-help-note" style={{ marginTop: '20px' }}><ShieldCheck size={20}/><p>Ingin sinkronisasi antar perangkat? <a href="/signin-with-chatgpt?return_to=%2F%23settings" target="_top"><b>Masuk dengan ChatGPT</b></a> untuk menyimpan key secara permanen di brankas akun cloud.</p></div>
                )}
              </div>
            ) : (
              <>
                {status.legacyMigrationAvailable && <div className="vault-callout"><p>Key dari sesi sebelumnya masih tersedia. Pindahkan ke brankas agar tersimpan permanen.</p><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void perform('migrate', { action: 'migrate' }, 'Key sesi dipindahkan ke brankas.')}>Pindahkan key sesi</button></div>}
                <div className="vault-toolbar"><button type="button" className="primary-button" disabled={Boolean(busy) || keys.length >= 50 || showForm} onClick={() => startForm()}><Plus size={16}/>Tambah key</button></div>
                {showForm && <form className="vault-form ai-key-form" onSubmit={e => { e.preventDefault(); void saveKey(true); }}><div className="ai-section-title"><h4>{editing ? 'Edit API key' : 'Tambahkan API key'}</h4><span>{editing ? 'Pengaturan key' : 'Google AI Studio'}</span></div>
                  <label className="field"><span>1. API key Google AI Studio</span><div className="ai-secret-field"><input autoFocus type={visibleSecret ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })} minLength={20} maxLength={256} required={!editing} placeholder={editing ? 'Kosongkan untuk mempertahankan key' : 'Tempel key dari Google AI Studio'} disabled={Boolean(busy)}/><button type="button" className="icon-button" aria-label={visibleSecret ? 'Sembunyikan key' : 'Tampilkan key yang sedang diketik'} onClick={() => setVisibleSecret(!visibleSecret)}>{visibleSecret ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div><a className="ai-key-link" href={providers.gemini.keyUrl} target="_blank" rel="noreferrer">Dapatkan API key di Google AI Studio<ExternalLink size={14}/></a></label>
                  <div className="two-col"><label className="field"><span>2. Nama key</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={60} required placeholder="Contoh: Key belajar utama" disabled={Boolean(busy)}/></label><label className="field"><span>Model untuk uji akses</span><select value={testModel} onChange={e => setTestModel(e.target.value)} disabled={Boolean(busy)}>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label></div>
                  <details className="ai-advanced"><summary>Pengaturan lanjutan <span>Opsional</span></summary><div><label className="field"><span>{providers.gemini.groupLabel}</span><input maxLength={100} value={form.project} onChange={e => setForm({ ...form, project: e.target.value })} placeholder="Isi jika diketahui" disabled={Boolean(busy)}/><small className="muted">{providers.gemini.groupHint} Gunakan nama yang sama persis untuk kelompok yang sama. Jika kosong, key dikelompokkan secara konservatif.</small></label><div className="two-col"><label className="field"><span>Penggunaan key</span><select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as VaultKey['role'] })} disabled={Boolean(busy)}><option value="both">Pembuat soal & penilai</option><option value="generator">Pembuat soal</option><option value="evaluator">Penilai terjemahan</option></select></label><label className="field"><span>Urutan penggunaan</span><input type="number" min={1} max={100} required value={form.priority} onChange={e => setForm({ ...form, priority: Number(e.target.value) })} disabled={Boolean(busy)}/><small className="muted">Angka lebih kecil digunakan lebih dahulu.</small></label></div><label className="checkbox-row"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} disabled={Boolean(busy)}/>Aktifkan key</label></div></details>
                  <p className="muted small">Uji akses memeriksa key dan daftar model tanpa membuat konten. Izin pembuatan konten dan kuota tetap diperiksa saat latihan.</p><div className="modal-actions"><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => leave('reset')}>Batal</button><button type="submit" className="primary-button" disabled={Boolean(busy)}>{busy && <LoaderCircle size={16} className="spin"/>}Simpan & uji akses</button></div>
                </form>}
                {!showForm && <><div className="vault-key-list">{keys.map(key => { const selectedModel = [config.generator, config.evaluator].find(model => (key.role !== 'generator' || model === config.generator) && (key.role !== 'evaluator' || model === config.evaluator)) || key.testedModel || defaultProviderModel(key.provider); const state = keyAvailability(key, status, selectedModel); const test = testModel || selectedModel; const assigned = config.generatorKeyId === key.id || config.evaluatorKeyId === key.id; return <article className={`vault-key ${!key.enabled ? 'is-disabled' : ''}`} key={key.id}><div className="vault-key-head"><div><span className="ai-provider-badge">Google AI Studio</span><h4>{key.name}<code>••••{key.suffix}</code></h4><p>{key.role === 'both' ? 'Pembuat soal & penilai' : roleLabel(key.role)} · Urutan {key.priority}</p></div><span className={`pill ${state === 'tested' ? 'success' : ''}`}>{stateLabels[state]}</span></div><div className="vault-key-details"><span>{key.lastUsed ? `Terakhir dipakai ${time(key.lastUsed)}` : 'Belum dipakai'}</span><span>{key.successes} berhasil · {key.failures} gagal</span></div><div className="vault-key-actions"><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void perform(`test:${key.id}`, { action: 'test', id: key.id, model: test }, `Akses ${modelLabel(test)} teruji. Kuota diperiksa saat latihan.`)}>{busy === `test:${key.id}` ? <LoaderCircle size={15} className="spin"/> : <RefreshCw size={15}/>}Uji akses</button><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => startForm(key)}><Pencil size={15}/>Edit</button><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void perform(`toggle:${key.id}`, { action: 'update', ...key, enabled: !key.enabled }, key.enabled ? 'Key dinonaktifkan.' : 'Key diaktifkan.')}>{key.enabled ? 'Nonaktifkan' : 'Aktifkan'}</button><button type="button" className="text-button danger-text" disabled={Boolean(busy)} onClick={() => setRemove(key)}><Trash2 size={15}/>Hapus</button></div>{remove?.id === key.id && <div className="vault-delete"><p>Hapus key “{key.name}”?{assigned ? ' Key ini dipilih untuk latihan. Setelah dihapus, ubah pilihan key pada Model & penggunaan.' : ' Key ini tidak akan tersedia untuk latihan berikutnya.'}</p><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => setRemove(null)}>Batal</button><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={async () => { if (await perform(`remove:${key.id}`, { action: 'remove', id: key.id }, 'Key dihapus dari brankas.')) setRemove(null); }}>Hapus key</button></div>}</article>; })}</div>{!keys.length && <div className="vault-empty"><KeyRound size={26}/><p>Belum ada key.</p><span>Tambahkan satu key Google AI Studio untuk memulai.</span></div>}
                  {keys.length > 0 && <label className="field vault-test-model"><span>Model untuk uji akses berikutnya</span><select value={testModel} disabled={Boolean(busy)} onChange={e => setTestModel(e.target.value)}>{models.map(model => <option key={model.id} value={model.id}>{modelLabel(model.id)}</option>)}</select><small className="muted">Key diuji dengan model Google AI Studio yang dipilih.</small></label>}</>}
                <div className="security-note"><ShieldCheck size={20}/><p>Nilai key tersimpan tidak ditampilkan kembali. Hingga 50 key per akun. Key hanya dikirim ke Google AI Studio.</p></div>
              </>
            )}
          </>}
          {tab === 'models' && <><div className="ai-role-settings">{(['generator', 'evaluator'] as const).map(role => <RoleChoice key={role} role={role} config={config} status={status} onConfig={onConfig}/>)}</div><p className="muted small ai-autosave"><Check size={14}/>Pilihan model dan penggunaan tersimpan otomatis di perangkat ini.</p></>}
          {tab === 'backup' && <><form className="vault-routing" onSubmit={e => { e.preventDefault(); void perform('settings', { action: 'settings', mode, maxAttempts }, 'Pengaturan cadangan otomatis disimpan.'); }}><h4>Cadangan otomatis</h4><p className="muted">Berlaku saat memilih key secara otomatis. Key nonaktif, invalid, atau dalam waktu tunggu dilewatkan.</p><label className={`vault-mode ${mode === 'priority' ? 'selected' : ''}`}><input type="radio" name="routing-mode" checked={mode === 'priority'} onChange={() => setMode('priority')} disabled={Boolean(busy)}/><span><b>Utama & cadangan</b><span>Gunakan urutan key, lalu cadangan yang tersedia.</span></span></label><details className="ai-advanced"><summary>Pengaturan lanjutan</summary><div><label className={`vault-mode ${mode === 'balanced' ? 'selected' : ''}`}><input type="radio" name="routing-mode" checked={mode === 'balanced'} onChange={() => setMode('balanced')} disabled={Boolean(busy)}/><span><b>Pembagian beban</b><span>Gunakan key yang paling lama tidak dipakai.</span></span></label><label className="field"><span>Maksimal percobaan per permintaan</span><select value={maxAttempts} onChange={e => setMaxAttempts(Number(e.target.value))} disabled={Boolean(busy)}>{[1, 2, 3].map(n => <option key={n} value={n}>{n} percobaan</option>)}</select></label></div></details><div className="ai-help-note"><ShieldCheck size={18}/><p>Key dalam proyek Google Cloud yang sama berbagi kuota. Mengganti key dalam kelompok tersebut tidak menambah kuota.</p></div><div className="modal-actions"><button className="primary-button" disabled={Boolean(busy)}>{busy === 'settings' && <LoaderCircle size={16} className="spin"/>}Simpan pengaturan</button></div></form><div className="section-divider"/>
            <section className="ai-backup-section"><h4>Cadangkan dan pulihkan key</h4><p className="muted">File berisi key Google AI Studio dalam bentuk terenkripsi. Simpan kata sandinya terpisah; cadangan tidak dapat dibuka tanpa kata sandi.</p><label className="field"><span>Kata sandi cadangan</span><input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={passphrase} onChange={e => setPassphrase(e.target.value)} placeholder="Minimal 12 karakter" disabled={Boolean(busy)}/></label><button type="button" className="secondary-button" disabled={Boolean(busy) || !keys.length} onClick={() => void backup('export')}>{busy === 'backup:export' && <LoaderCircle size={16} className="spin"/>}Unduh cadangan terenkripsi</button><label className="field"><span>File cadangan untuk dipulihkan</span><input ref={fileInput} type="file" accept="application/json,.json" disabled={Boolean(busy)} onChange={e => setBackupFile(e.target.files?.[0] || null)}/></label><button type="button" className="secondary-button" disabled={Boolean(busy) || !backupFile} onClick={() => void backup('import')}>{busy === 'backup:import' && <LoaderCircle size={16} className="spin"/>}Pulihkan cadangan</button><p className="muted small">Cadangan versi lama tetap didukung. Pemulihan menambahkan key tanpa menimpa yang sudah ada; pengaturan cadangan otomatis mengikuti file.</p></section>
          </>}
          {tab === 'history' && <><div className="vault-toolbar"><p className="muted">30 aktivitas terbaru</p><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={async () => { try { onStatus(await api<KeyStatus>('/api/credentials', undefined, 'GET')); } catch (e) { setError((e as Error).message); } }}><RefreshCw size={15}/>Perbarui</button></div>{!events.length ? <div className="vault-empty"><History size={26}/><p>Belum ada aktivitas.</p><span>Hasil uji akses dan penggunaan key akan muncul di sini.</span></div> : <ol className="vault-history">{events.map((event, i) => <li key={`${event.requestId}:${event.attempt}:${i}`}><div><b>{event.keyName}</b><span>{outcomeLabel[event.outcome] || 'Pemrosesan gagal'}{event.attempt > 1 ? ` · Percobaan ${event.attempt}` : ''}</span></div><p>{modelLabel(event.model)} · {event.role === 'test' ? 'Uji akses' : roleLabel(event.role as Role)} · {(event.duration / 1000).toFixed(1)} dtk</p><time dateTime={new Date(event.createdAt).toISOString()}>{time(event.createdAt)}</time></li>)}</ol>}<p className="muted small">Riwayat tidak mencatat nilai API key, teks latihan, atau terjemahan.</p></>}
        </>}
      </div>
    </div><div className="ai-window-footer"><span><ShieldCheck size={14}/>Key pribadi Google AI Studio</span><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => leave('close')}>Selesai</button></div>
  </Modal>;
}
