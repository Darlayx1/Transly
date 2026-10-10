'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { History, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { accountClient, accountError } from '@/lib/transly/account';
import { StorageLayer } from '@/lib/transly/storage-layer';
import type { useAccountHistory } from '@/hooks/use-account-history';
import { ErrorBanner } from './ui';

type AccountHistory = ReturnType<typeof useAccountHistory>;
type Mode = 'login' | 'signup' | 'confirm' | 'reset' | 'recovery' | 'password';
export function AccountPanel({ open, section, onClose, history, onResume, onBusyChange }: { open: boolean; section: 'account' | 'history'; onClose: () => void; history: AccountHistory; onResume: (id: string) => void; onBusyChange: (busy: boolean) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importHistoryChoice, setImportHistoryChoice] = useState(true);
  const [importConfigChoice, setImportConfigChoice] = useState(true);
  const [importKeysChoice, setImportKeysChoice] = useState(true);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [logins, setLogins] = useState<{ id: string; created_at: string }[]>([]);
  const locked = useRef(false);
  const client = accountClient();
  const userId = history.user?.id;
  const formMode: Mode = history.recoveryRequired ? 'password' : mode;

  useEffect(() => {
    if (!open) { setPassword(''); setCode(''); setError(''); }
  }, [open]);
  useEffect(() => {
    setLogins([]);
    if (!open || section !== 'history' || !userId || !client) return;
    let active = true;
    void client.from('login_events').select('id,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20).then(({ data, error }) => {
      if (!active) return;
      if (error) setError('Riwayat masuk belum dapat dimuat.');
      else setLogins(data || []);
    });
    return () => { active = false; };
  }, [open, section, userId, client, history.syncing]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const redirectTo = window.location.origin + window.location.pathname;
      if (formMode === 'login') {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setPassword('');
      } else if (formMode === 'signup') {
        const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        setPassword('');
        if (!data.session) { setMode('confirm'); setNotice('Periksa email dan buka tautan konfirmasi untuk kembali ke Transly. Jika email berisi kode, masukkan kode di sini.'); }
      } else if (formMode === 'confirm' || formMode === 'recovery') {
        const { error } = await client.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: formMode === 'confirm' ? 'signup' : 'recovery' });
        if (error) { setError('Kode tidak valid atau sudah kedaluwarsa. Periksa kode atau minta kode baru.'); return; }
        setCode('');
        setMode(formMode === 'recovery' ? 'password' : 'login');
      } else if (formMode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (error) throw error;
        setMode('recovery'); setNotice('Jika email terdaftar, tautan pemulihan akan dikirim. Buka tautan untuk kembali ke Transly dan membuat kata sandi baru. Jika email berisi kode, masukkan di sini.');
      } else {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        history.finishRecovery(); setPassword(''); setMode('login'); setNotice('Kata sandi berhasil diperbarui.');
      }
    } catch (error) { setError(accountError(error as { message: string; code?: string })); }
    finally { locked.current = false; setBusy(false); }
  };
  const changeMode = (next: Mode) => { setMode(next); setError(''); setNotice(''); setPassword(''); setCode(''); };
  const signedIn = Boolean(history.user) && formMode !== 'password';
  return <div className="account-body">
    {error && <ErrorBanner message={error} onDismiss={() => setError('')}/>}
    {notice && <p role="status" className="account-notice">{notice}</p>}
    {section === 'account' && (signedIn ? <>
      <div className="account-summary"><span><UserRound size={20}/>{history.user?.email}</span><button className="text-button" disabled={busy || history.syncing} onClick={async () => {
        if (!client || locked.current) return;
        locked.current = true; setBusy(true);
        try { const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error; changeMode('login'); }
        catch (error) { setError(accountError(error as { message: string })); }
        finally { locked.current = false; setBusy(false); }
      }}><LogOut size={16}/>Keluar</button></div>
      <p className="muted">Latihan dan evaluasi tersimpan pada akun ini dan dapat dibuka dari perangkat lain.</p>
    </> : client ? <form className="account-form" onSubmit={submit}>
      <h3>{({ login: 'Masuk ke Transly', signup: 'Buat akun', confirm: 'Konfirmasi email', reset: 'Pulihkan kata sandi', recovery: 'Periksa email pemulihan', password: 'Buat kata sandi baru' })[formMode]}</h3>
      {formMode !== 'password' && <label>Email<input type="email" autoComplete="email" required value={email} disabled={busy || formMode === 'confirm' || formMode === 'recovery'} onChange={e => setEmail(e.target.value)}/></label>}
      {['login', 'signup', 'password'].includes(formMode) && <><label>Kata sandi<input type="password" aria-describedby={formMode !== 'login' ? 'account-password-help' : undefined} autoComplete={formMode === 'login' ? 'current-password' : 'new-password'} minLength={formMode === 'login' ? 1 : 12} required value={password} disabled={busy} onChange={e => setPassword(e.target.value)}/></label>{formMode !== 'login' && <small id="account-password-help" className="muted">Minimal 12 karakter.</small>}</>}
      {['confirm', 'recovery'].includes(formMode) && <label>Kode dari email (jika tersedia)<input type="text" inputMode="numeric" autoComplete="one-time-code" required value={code} disabled={busy} onChange={e => setCode(e.target.value)}/></label>}
      <button className="primary-button" disabled={busy}>{busy ? 'Memproses…' : ({ login: 'Masuk', signup: 'Daftar', confirm: 'Konfirmasi kode', reset: 'Kirim email pemulihan', recovery: 'Verifikasi kode', password: 'Simpan kata sandi' })[formMode]}</button>
      <div className="account-links">
        {formMode === 'login' ? <><button type="button" className="text-button" disabled={busy} onClick={() => changeMode('signup')}>Buat akun</button><button type="button" className="text-button" disabled={busy} onClick={() => changeMode('reset')}>Lupa kata sandi?</button></> : formMode !== 'password' && <button type="button" className="text-button" disabled={busy} onClick={() => changeMode('login')}>Kembali ke masuk</button>}
        {formMode === 'confirm' && <button type="button" className="text-button" disabled={busy} onClick={async () => {
          if (locked.current) return;
          locked.current = true; setBusy(true); setError('');
          try { const { error } = await client.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: window.location.origin + window.location.pathname } }); if (error) throw error; setNotice('Email konfirmasi telah diminta kembali. Periksa email.'); }
          catch (error) { setError(accountError(error as { message: string })); }
          finally { locked.current = false; setBusy(false); }
        }}>Kirim ulang email</button>}
        {formMode === 'recovery' && <button type="button" className="text-button" disabled={busy} onClick={() => changeMode('reset')}>Minta email baru</button>}
      </div>
    </form> : <div className="account-notice"><h3>Login belum tersedia</h3><p>Penyimpanan akun sedang disiapkan. Latihan dan draft tetap dapat disimpan pada perangkat ini.</p></div>)}
    {section === 'history' && <section className="account-history"><div className="account-toolbar"><h3><History size={18}/>Riwayat latihan</h3>{history.user && <button className="secondary-button" disabled={history.syncing || busy} onClick={() => void history.sync()}><RefreshCw size={15}/>{history.syncing ? 'Menyinkronkan…' : 'Sinkronkan'}</button>}</div>
      <p className="muted small" role="status">{history.user ? history.message || 'Draft disimpan otomatis.' : 'Riwayat ini hanya tersimpan pada perangkat ini. Masuk untuk menyimpan ke akun.'}</p>
      {!history.entries.length ? <p className="account-empty">Belum ada latihan tersimpan.</p> : <ol className="account-session-list">{[...history.entries].sort((a, b) => b.session.startedAt - a.session.startedAt).map(entry => <li key={entry.session.id}>
        <div><b>{entry.session.challenge.title}</b><span>{new Date(entry.session.startedAt).toLocaleString('id-ID')} · {entry.session.sample ? 'Contoh · ' : ''}{entry.session.result ? `Nilai ${entry.session.result.overallScore}` : 'Draft'}{history.user && entry.dirty ? ' · Belum tersinkron' : ''}</span></div>
        <button className="secondary-button" disabled={busy} onClick={() => { onResume(entry.session.id); onClose(); }}>Buka</button>
      </li>)}</ol>}
      {history.user && <div className="account-import-section">
        {!showImport ? (
          <button type="button" className="text-button" disabled={history.syncing || busy} onClick={() => setShowImport(true)}>
            Impor data lokal ke akun
          </button>
        ) : (
          <div className="account-import-card">
            <h4>Pilih data lokal yang akan disalin ke akun:</h4>
            <label className="checkbox-item">
              <input type="checkbox" checked={importHistoryChoice} onChange={e => setImportHistoryChoice(e.target.checked)}/>
              <span>Riwayat latihan ({typeof window !== 'undefined' ? StorageLayer.readHistory('guest').entries.length : 0} sesi tamu)</span>
            </label>
            <label className="checkbox-item">
              <input type="checkbox" checked={importConfigChoice} onChange={e => setImportConfigChoice(e.target.checked)}/>
              <span>Pengaturan latihan & pilihan model</span>
            </label>
            <label className="checkbox-item">
              <input type="checkbox" checked={importKeysChoice} onChange={e => setImportKeysChoice(e.target.checked)}/>
              <span>API key lokal ({typeof window !== 'undefined' ? StorageLayer.readGuestVault().keys.length : 0} key pada perangkat)</span>
            </label>
            <p className="muted small">Data asli pada ruang tamu tetap tersimpan dan tidak dihapus.</p>
            <div className="account-import-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setShowImport(false)}>Batal</button>
              <button type="button" className="primary-button" disabled={busy || (!importHistoryChoice && !importConfigChoice && !importKeysChoice)} onClick={async () => {
                setBusy(true);
                try {
                  await history.importGuest({ history: importHistoryChoice, config: importConfigChoice, keys: importKeysChoice });
                  setShowImport(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}>Salin ke akun</button>
            </div>
          </div>
        )}
      </div>}
      {history.storageFailed && <ErrorBanner message="Penyimpanan perangkat tidak tersedia atau penuh. Jangan tutup halaman sebelum riwayat berhasil disinkronkan."/>}
    </section>}
    {section === 'history' && signedIn && <section className="account-history"><h3>Riwayat masuk akun</h3>{logins.length ? <ol className="account-login-list">{logins.map(event => <li key={event.id}>{new Date(event.created_at).toLocaleString('id-ID')}</li>)}</ol> : <p className="muted small">Belum ada aktivitas masuk yang tercatat.</p>}</section>}
  </div>;
}
