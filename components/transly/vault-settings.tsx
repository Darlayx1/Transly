'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { KeyRound, Plus, Check, LoaderCircle, Pencil, Trash2, RefreshCw, History, Sparkles, Eye, EyeOff, UserRound } from 'lucide-react';
import { models } from '@/lib/transly/config';
import { withRoleModel, type PracticeConfig } from '@/lib/transly/schema';
import { keyAvailability, roleReady, outcomeLabel, type KeyStatus, type VaultKey } from '@/lib/transly/vault-types';
import { readDeviceVault, writeDeviceVault, newDeviceKey, deviceVaultStatus } from '@/lib/transly/device-vault';
import type { useAccountHistory } from '@/hooks/use-account-history';
import { api, ErrorBanner, Modal } from './ui';
import { AccountPanel } from './account-panel';

const tabs = [
  { id: 'account', label: 'Akun', icon: UserRound },
  { id: 'keys', label: 'API key', icon: KeyRound },
  { id: 'models', label: 'Model & penggunaan', icon: Sparkles },
  { id: 'history', label: 'Riwayat', icon: History },
] as const;
type Tab = typeof tabs[number]['id'];
const emptyForm = { name: '', secret: '', role: 'both' as VaultKey['role'], priority: 1 };
const stateLabels: Record<string, string> = { disabled: 'Nonaktif', invalid: 'Perlu diganti', permission: 'Periksa izin model', cooldown: 'Menunggu pemulihan', tested: 'Akses model teruji', untested: 'Belum diuji', 'wrong-provider': 'Provider berbeda' };
type Props = { open: boolean; onClose: () => void; config: PracticeConfig; onConfig: (c: PracticeConfig) => void; status: KeyStatus; onStatus: (s: KeyStatus) => void; history: ReturnType<typeof useAccountHistory>; onResume: (id: string) => void };

export function VaultSettings({ open, onClose, config, onConfig, status, onStatus, history, onResume }: Props) {
  const [tab, setTab] = useState<Tab>('account');
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [remove, setRemove] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState<Tab | 'close' | null>(null);
  const [formStart, setFormStart] = useState(JSON.stringify(emptyForm));
  const content = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const owner = history.user?.id || 'guest';
  const currentOwner = useRef(owner);
  useLayoutEffect(() => { currentOwner.current = owner; }, [owner]);
  const dirty = showForm && JSON.stringify(form) !== formStart;
  const keys = status.keys || [];
  const cloud = Boolean(status.account) && !status.device;

  useEffect(() => {
    if (history.recoveryRequired) setTab('account');
  }, [history.recoveryRequired]);
  useEffect(() => {
    setShowForm(false); setEditing(null); setForm(emptyForm); setVisible(false); setRemove(null); setError(''); setMessage(''); setPendingLeave(null);
  }, [owner]);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [tab]);
  useEffect(() => {
    if (!open || !dirty) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [open, dirty]);

  function leave(next: Tab | 'close', discard = false) {
    if (lock.current || accountBusy) return;
    if (dirty && !discard) { setPendingLeave(next); return; }
    setShowForm(false); setEditing(null); setForm(emptyForm); setVisible(false); setRemove(null); setPendingLeave(null); setError(''); setMessage('');
    if (next === 'close') onClose(); else setTab(next);
  }
  function startForm(key?: VaultKey) {
    const next = key ? { name: key.name, secret: '', role: key.role, priority: key.priority } : { ...emptyForm, priority: keys.length + 1 };
    setForm(next); setFormStart(JSON.stringify(next)); setEditing(key?.id || null); setShowForm(true); setVisible(false); setRemove(null); setError(''); setMessage('');
  }
  async function operate(action: string, work: () => Promise<void>, success: string) {
    if (lock.current) return;
    const startedOwner = owner;
    lock.current = true; setBusy(action); setError(''); setMessage('');
    try { await work(); if (currentOwner.current === startedOwner) setMessage(success); }
    catch (e) { if (currentOwner.current === startedOwner) setError((e as Error).message); }
    finally { lock.current = false; setBusy(''); }
  }
  function saveLocal(vault: ReturnType<typeof readDeviceVault>) {
    writeDeviceVault(owner, vault); if (currentOwner.current === owner) onStatus(deviceVaultStatus(vault));
  }
  async function saveKey() {
    await operate('save', async () => {
      if (cloud) onStatus(await api<KeyStatus>('/api/credentials', { action: editing ? 'update' : 'add', ...form, provider: 'gemini', project: keys.find(key => key.id === editing)?.project || '', enabled: keys.find(key => key.id === editing)?.enabled ?? true, ...(editing ? { id: editing } : {}), secret: form.secret.trim() || undefined }));
      else {
        const vault = readDeviceVault(owner);
        const existing = vault.keys.find(key => key.id === editing);
        if (editing && !existing) throw new Error('Key sudah tidak tersedia. Muat ulang daftar.');
        const fresh = newDeviceKey(form.name.trim(), form.secret.trim() || existing?.secret || '', form.role, form.priority);
        if (vault.keys.some(key => key.id !== editing && key.secret === fresh.secret)) throw new Error('API key ini sudah ada di daftar.');
        if (existing) vault.keys = vault.keys.map(key => key.id === editing ? { ...key, name: fresh.name, secret: fresh.secret, suffix: fresh.suffix, role: fresh.role, priority: fresh.priority, invalid: false, testedAt: form.secret.trim() ? null : key.testedAt, testedModel: form.secret.trim() ? null : key.testedModel } : key);
        else { if (vault.keys.length >= 50) throw new Error('Maksimal 50 API key.'); vault.keys.push(fresh); }
        saveLocal(vault);
      }
      setShowForm(false); setForm(emptyForm); setEditing(null); setVisible(false);
    }, 'API key berhasil disimpan.');
  }
  async function updateKey(key: VaultKey, action: 'toggle' | 'remove' | 'test') {
    await operate(action + ':' + key.id, async () => {
      if (cloud) onStatus(await api<KeyStatus>('/api/credentials', action === 'test' ? { action: 'test', id: key.id, model: config.generator } : action === 'remove' ? { action: 'remove', id: key.id } : { action: 'update', ...key, enabled: !key.enabled }));
      else {
        const vault = readDeviceVault(owner);
        const item = vault.keys.find(entry => entry.id === key.id);
        if (!item) throw new Error('Key sudah tidak tersedia.');
        if (action === 'remove') vault.keys = vault.keys.filter(entry => entry.id !== key.id);
        if (action === 'toggle') item.enabled = !item.enabled;
        if (action === 'test') {
          const model = key.role === 'evaluator' ? config.evaluator : config.generator;
          const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(models.find(item => item.id === model)?.upstreamId || model), { headers: { 'x-goog-api-key': item.secret }, signal: AbortSignal.timeout(15000) });
          if (currentOwner.current !== owner) throw new Error('Akun berubah. Uji akses dibatalkan.');
          if (!response.ok) throw new Error(response.status === 429 ? 'Kuota atau batas frekuensi tercapai. Coba uji kembali nanti.' : response.status === 400 || response.status === 403 ? 'Key tidak valid atau tidak memiliki izin model ini.' : 'Model belum dapat diakses. Periksa model dan koneksi.');
          const data = await response.json() as { name?: string; supportedGenerationMethods?: string[] };
          if (!data.supportedGenerationMethods?.includes('generateContent')) throw new Error('Model ini belum mendukung pembuatan konten dengan key tersebut.');
          item.testedAt = Date.now(); item.testedModel = model; item.invalid = false;
        }
        saveLocal(vault);
      }
      if (action === 'remove') {
        onConfig({ ...config, generatorKeyId: config.generatorKeyId === key.id ? undefined : config.generatorKeyId, evaluatorKeyId: config.evaluatorKeyId === key.id ? undefined : config.evaluatorKeyId });
        setRemove(null);
      }
    }, action === 'test' ? 'Akses model berhasil diuji. Kuota konten diperiksa saat latihan.' : action === 'remove' ? 'API key dihapus.' : key.enabled ? 'API key dinonaktifkan.' : 'API key diaktifkan.');
  }
  async function saveRouting(mode: 'priority' | 'balanced', maxAttempts: number) {
    await operate('routing', async () => {
      if (cloud) onStatus(await api<KeyStatus>('/api/credentials', { action: 'settings', mode, maxAttempts }));
      else { const vault = readDeviceVault(owner); vault.settings = { mode, maxAttempts }; saveLocal(vault); }
    }, 'Pengaturan penggunaan disimpan.');
  }
  const tabInfo = tabs.find(item => item.id === tab)!;
  return <Modal open={open} onClose={() => leave('close')} title="Pengaturan AI" className="vault-modal ai-window">
    <div className="ai-window-layout">
      <aside className="ai-window-sidebar"><div className="ai-sidebar-caption">PENGATURAN AI</div><nav aria-label="Bagian pengaturan AI">{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} disabled={Boolean(busy) || accountBusy} onClick={() => leave(id)}><Icon size={18}/><span>{label}</span></button>)}</nav></aside>
      <div className="ai-window-content" ref={content}><div className="ai-content-heading"><div><h3>{tabInfo.label}</h3><p>{tab === 'account' ? 'Kelola akun dan akses Transly.' : tab === 'keys' ? 'Tambahkan dan kelola API key untuk latihan.' : tab === 'models' ? 'Atur model dan API key untuk setiap peran.' : 'Latihan, evaluasi, dan aktivitas akun di satu tempat.'}</p></div></div>
        {pendingLeave && <div className="ai-unsaved" role="alertdialog" aria-labelledby="ai-unsaved-title"><h4 id="ai-unsaved-title">Ada perubahan yang belum disimpan</h4><p>Input yang belum disimpan akan dibuang.</p><div><button type="button" className="secondary-button" autoFocus onClick={() => setPendingLeave(null)}>Lanjutkan mengedit</button><button type="button" className="text-button" onClick={() => leave(pendingLeave, true)}>Buang perubahan</button></div></div>}
        {error && <ErrorBanner message={error} onDismiss={() => setError('')}/>}{message && <p className="saved-message" role="status"><Check size={17}/>{message}</p>}
        <div hidden={tab !== 'account' && tab !== 'history'}><AccountPanel key={owner} open={open && (tab === 'account' || tab === 'history')} section={tab === 'history' ? 'history' : 'account'} history={history} onClose={onClose} onResume={onResume} onBusyChange={setAccountBusy}/></div>
        {tab === 'keys' && <>
          <div className="vault-toolbar"><button type="button" className="primary-button" disabled={Boolean(busy) || showForm || keys.length >= 50} onClick={() => startForm()}><Plus size={16}/>Tambahkan API key</button></div>
          {showForm && <form className="vault-form ai-key-form" onSubmit={e => { e.preventDefault(); void saveKey(); }}>
            <h4>{editing ? 'Edit API key' : 'Tambahkan API key'}</h4>
            <label className="field"><span>Nama key</span><input autoFocus required maxLength={60} value={form.name} disabled={Boolean(busy)} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Contoh: Key belajar"/></label>
            <label className="field"><span>API key</span><div className="ai-secret-field"><input type={visible ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} minLength={20} maxLength={256} required={!editing} value={form.secret} disabled={Boolean(busy)} onChange={e => setForm({ ...form, secret: e.target.value })} placeholder={editing ? 'Kosongkan untuk mempertahankan key' : 'Tempel API key Google AI Studio'}/><button type="button" className="icon-button" aria-label={visible ? 'Sembunyikan key' : 'Tampilkan key'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label>
            <div className="two-col"><label className="field"><span>Penggunaan key</span><select value={form.role} disabled={Boolean(busy)} onChange={e => setForm({ ...form, role: e.target.value as VaultKey['role'] })}><option value="both">Pembuat soal & penilai</option><option value="generator">Pembuat soal</option><option value="evaluator">Penilai terjemahan</option></select></label><label className="field"><span>Urutan penggunaan</span><input type="number" min={1} max={100} required value={form.priority} disabled={Boolean(busy)} onChange={e => setForm({ ...form, priority: Number(e.target.value) })}/></label></div>
            <div className="modal-actions"><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => leave('keys')}>Batal</button><button type="submit" className="primary-button" disabled={Boolean(busy)}>{busy === 'save' && <LoaderCircle size={16} className="spin"/>}Simpan API key</button></div>
          </form>}
          <div className="vault-key-list">{keys.map(key => <article className={'vault-key' + (!key.enabled ? ' is-disabled' : '')} key={key.id}><div className="vault-key-head"><div><h4>{key.name} <code>••••{key.suffix}</code></h4><p>{key.role === 'both' ? 'Pembuat soal & penilai' : key.role === 'generator' ? 'Pembuat soal' : 'Penilai terjemahan'} · Urutan {key.priority}</p></div><span className="pill">{stateLabels[keyAvailability(key, status, key.role === 'evaluator' ? config.evaluator : config.generator)]}</span></div><div className="vault-key-details"><span>{key.successes} berhasil · {key.failures} gagal</span></div><div className="vault-key-actions"><button type="button" className="text-button" disabled={Boolean(busy) || showForm} onClick={() => void updateKey(key, 'test')}><RefreshCw size={15}/>Uji akses</button><button type="button" className="text-button" disabled={Boolean(busy) || showForm} onClick={() => startForm(key)}><Pencil size={15}/>Edit</button><button type="button" className="text-button" disabled={Boolean(busy) || showForm} onClick={() => void updateKey(key, 'toggle')}>{key.enabled ? 'Nonaktifkan' : 'Aktifkan'}</button><button type="button" className="text-button danger-text" disabled={Boolean(busy) || showForm} onClick={() => setRemove(key.id)}><Trash2 size={15}/>Hapus</button></div>{remove === key.id && <div className="vault-delete"><p>Hapus key “{key.name}”?</p><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => setRemove(null)}>Batal</button><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void updateKey(key, 'remove')}>Hapus key</button></div>}</article>)}</div>
          {!keys.length && !showForm && <div className="vault-empty"><KeyRound size={26}/><p>Belum ada API key.</p><span>Tambahkan key untuk mulai menggunakan AI.</span></div>}
          <p className="muted small ai-autosave">{cloud ? 'API key tersimpan terenkripsi di brankas.' : 'API key tersimpan pada perangkat ini, terpisah untuk setiap akun. Riwayat latihan disinkronkan melalui akun.'}</p>
        </>}
        {tab === 'models' && <><div className="ai-role-settings">{(['generator', 'evaluator'] as const).map(role => {
          const keyField = role === 'generator' ? 'generatorKeyId' : 'evaluatorKeyId';
          const compatible = keys.filter(key => key.role === role || key.role === 'both');
          return <section className="ai-role-card" key={role}><div className="ai-role-title"><h3>{role === 'generator' ? 'Pembuat soal' : 'Penilai terjemahan'}</h3><span className="pill">{roleReady(status, config, role) ? 'Key tersedia' : 'Perlu konfigurasi'}</span></div><label className="field"><span>Model</span><select aria-label={role === 'generator' ? 'Model pembuat soal' : 'Model penilai terjemahan'} value={config[role]} onChange={e => onConfig(withRoleModel(config, role, e.target.value))}>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><label className="field"><span>API key</span><select aria-label={role === 'generator' ? 'API key pembuat soal' : 'API key penilai terjemahan'} value={config[keyField] || ''} onChange={e => onConfig({ ...config, [keyField]: e.target.value || undefined })}><option value="">Otomatis</option>{config[keyField] && !compatible.some(key => key.id === config[keyField]) && <option value={config[keyField]}>Key pilihan tidak tersedia</option>}{compatible.map(key => <option key={key.id} value={key.id}>{key.name} · {stateLabels[keyAvailability(key, status, config[role])]}</option>)}</select></label></section>;
        })}</div><div className="section-divider"/><section className="vault-routing"><h4>Penggunaan otomatis</h4><p className="muted small">Key nonaktif dilewatkan. Key alternatif digunakan saat akses atau kuota key sebelumnya gagal.</p><div className="two-col"><label className="field"><span>Urutan penggunaan</span><select value={status.settings?.mode || 'priority'} disabled={Boolean(busy)} onChange={e => void saveRouting(e.target.value as 'priority' | 'balanced', status.settings?.maxAttempts || 3)}><option value="priority">Ikuti urutan key</option><option value="balanced">Key paling lama tidak dipakai</option></select></label><label className="field"><span>Maksimal percobaan</span><select value={status.settings?.maxAttempts || 3} disabled={Boolean(busy)} onChange={e => void saveRouting(status.settings?.mode || 'priority', Number(e.target.value))}>{[1, 2, 3].map(n => <option key={n} value={n}>{n} percobaan</option>)}</select></label></div></section><p className="muted small ai-autosave"><Check size={14}/>Pilihan disimpan otomatis.</p></>}
        {tab === 'history' && <section className="account-history"><h3>Penggunaan AI</h3>{status.events?.length ? <ol className="account-login-list">{status.events.map((event, index) => <li key={index}>{event.keyName} · {event.model} · {outcomeLabel[event.outcome] || event.outcome} · {new Date(event.createdAt).toLocaleString('id-ID')}</li>)}</ol> : <p className="muted small">Belum ada aktivitas AI.</p>}</section>}
      </div>
    </div>
  </Modal>;
}
