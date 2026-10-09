'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { History, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { accountClient, accountError } from '@/lib/transly/account';
import type { useAccountHistory } from '@/hooks/use-account-history';
import { ErrorBanner, Modal } from './ui';

type AccountHistory = ReturnType<typeof useAccountHistory>;
type Mode = 'login' | 'signup' | 'confirm' | 'reset' | 'recovery' | 'password';
export function AccountPanel({ open, onClose, history, onResume }: { open: boolean; onClose: () => void; history: AccountHistory; onResume: (id: string) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [logins, setLogins] = useState<{ id: string; created_at: string }[]>([]);
  const locked = useRef(false);
  const client = accountClient();
  const userId = history.user?.id;

  useEffect(() => {
    if (!open) { setPassword(''); setCode(''); setError(''); }
  }, [open]);
  useEffect(() => {
    setLogins([]);
    if (!open || !userId || !client) return;
    let active = true;
    void client.from('login_events').select('id,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20).then(({ data, error }) => {
      if (!active) return;
      if (error) setError('Riwayat masuk belum dapat dimuat.');
      else setLogins(data || []);
    });
    return () => { active = false; };
  }, [open, userId, client, history.syncing]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'login') {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setPassword('');
      } else if (mode === 'signup') {
        const { data, error } = await client.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        setPassword('');
        if (!data.session) { setMode('confirm'); setNotice('Periksa email, lalu masukkan kode konfirmasi di sini.'); }
      } else if (mode === 'confirm' || mode === 'recovery') {
        const { error } = await client.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: mode === 'confirm' ? 'signup' : 'recovery' });
        if (error) { setError('Kode tidak valid atau sudah kedaluwarsa. Periksa kode atau minta kode baru.'); return; }
        setCode('');
        setMode(mode === 'recovery' ? 'password' : 'login');
      } else if (mode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email.trim());
        if (error) throw error;
        setMode('recovery'); setNotice('Jika email terdaftar, kode pemulihan akan dikirim. Masukkan kode di sini.');
      } else {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        setPassword(''); setMode('login'); setNotice('Kata sandi berhasil diperbarui.');
      }
    } catch (error) { setError(accountError(error as { message: string; code?: string })); }
    finally { locked.current = false; setBusy(false); }
  };
  const changeMode = (next: Mode) => { setMode(next); setError(''); setNotice(''); setPassword(''); setCode(''); };
  const signedIn = Boolean(history.user) && mode !== 'password';
  return <Modal open={open} onClose={() => { if (!busy) onClose(); }} title="Akun & riwayat" className="account-modal"><div className="modal-body account-body">
    {error && <ErrorBanner message={error} onDismiss={() => setError('')}/>}
    {notice && <p role="status" className="account-notice">{notice}</p>}
    {signedIn ? <>
      <div className="account-summary"><span><UserRound size={20}/>{history.user?.email}</span><button className="text-button" disabled={busy || history.syncing} onClick={async () => {
        if (!client || locked.current) return;
        locked.current = true; setBusy(true);
        try { const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error; changeMode('login'); }
        catch (error) { setError(accountError(error as { message: string })); }
        finally { locked.current = false; setBusy(false); }
      }}><LogOut size={16}/>Keluar</button></div>
      <p className="muted">Latihan dan evaluasi tersimpan pada akun ini dan dapat dibuka dari perangkat lain.</p>
    </> : client ? <form className="account-form" onSubmit={submit}>
      <h3>{({ login: 'Masuk ke Transly', signup: 'Buat akun', confirm: 'Konfirmasi email', reset: 'Pulihkan kata sandi', recovery: 'Masukkan kode pemulihan', password: 'Buat kata sandi baru' })[mode]}</h3>
      {mode !== 'password' && <label>Email<input type="email" autoComplete="email" required value={email} disabled={busy || mode === 'confirm' || mode === 'recovery'} onChange={e => setEmail(e.target.value)}/></label>}
      {['login', 'signup', 'password'].includes(mode) && <><label>Kata sandi<input type="password" aria-describedby={mode !== 'login' ? 'account-password-help' : undefined} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 12} required value={password} disabled={busy} onChange={e => setPassword(e.target.value)}/></label>{mode !== 'login' && <small id="account-password-help" className="muted">Minimal 12 karakter.</small>}</>}
      {['confirm', 'recovery'].includes(mode) && <label>Kode dari email<input type="text" inputMode="numeric" autoComplete="one-time-code" required value={code} disabled={busy} onChange={e => setCode(e.target.value)}/></label>}
      <button className="primary-button" disabled={busy}>{busy ? 'Memproses…' : ({ login: 'Masuk', signup: 'Daftar', confirm: 'Konfirmasi', reset: 'Kirim kode pemulihan', recovery: 'Verifikasi kode', password: 'Simpan kata sandi' })[mode]}</button>
      <div className="account-links">
        {mode === 'login' ? <><button type="button" className="text-button" disabled={busy} onClick={() => changeMode('signup')}>Buat akun</button><button type="button" className="text-button" disabled={busy} onClick={() => changeMode('reset')}>Lupa kata sandi?</button></> : <button type="button" className="text-button" disabled={busy} onClick={() => changeMode('login')}>Kembali ke masuk</button>}
        {mode === 'confirm' && <button type="button" className="text-button" disabled={busy} onClick={async () => {
          if (locked.current) return;
          locked.current = true; setBusy(true); setError('');
          try { const { error } = await client.auth.resend({ type: 'signup', email: email.trim() }); if (error) throw error; setNotice('Kode baru telah diminta. Periksa email.'); }
          catch (error) { setError(accountError(error as { message: string })); }
          finally { locked.current = false; setBusy(false); }
        }}>Kirim ulang kode</button>}
        {mode === 'recovery' && <button type="button" className="text-button" disabled={busy} onClick={() => changeMode('reset')}>Minta kode baru</button>}
      </div>
    </form> : <div className="account-notice"><h3>Login belum tersedia</h3><p>Penyimpanan akun sedang disiapkan. Latihan dan draft tetap dapat disimpan pada perangkat ini.</p></div>}
    <section className="account-history"><div className="account-toolbar"><h3><History size={18}/>Riwayat latihan</h3>{history.user && <button className="secondary-button" disabled={history.syncing || busy} onClick={() => void history.sync()}><RefreshCw size={15}/>{history.syncing ? 'Menyinkronkan…' : 'Sinkronkan'}</button>}</div>
      <p className="muted small" role="status">{history.user ? history.message || 'Draft disimpan otomatis.' : 'Riwayat ini hanya tersimpan pada perangkat ini. Masuk untuk menyimpan ke akun.'}</p>
      {!history.entries.length ? <p className="account-empty">Belum ada latihan tersimpan.</p> : <ol className="account-session-list">{[...history.entries].sort((a, b) => b.session.startedAt - a.session.startedAt).map(entry => <li key={entry.session.id}>
        <div><b>{entry.session.challenge.title}</b><span>{new Date(entry.session.startedAt).toLocaleString('id-ID')} · {entry.session.sample ? 'Contoh · ' : ''}{entry.session.result ? `Nilai ${entry.session.result.overallScore}` : 'Draft'}{history.user && entry.dirty ? ' · Belum tersinkron' : ''}</span></div>
        <button className="secondary-button" disabled={busy} onClick={() => { onResume(entry.session.id); onClose(); }}>Buka</button>
      </li>)}</ol>}
      {history.user && <button className="text-button" disabled={history.syncing || busy} onClick={() => { if (window.confirm('Salin riwayat tamu perangkat ini ke akun yang sedang masuk?')) history.importGuest(); }}>Salin riwayat tamu ke akun</button>}
      {history.storageFailed && <ErrorBanner message="Penyimpanan perangkat tidak tersedia atau penuh. Jangan tutup halaman sebelum riwayat berhasil disinkronkan."/>}
    </section>
    {signedIn && <section className="account-history"><h3>Riwayat masuk akun</h3>{logins.length ? <ol className="account-login-list">{logins.map(event => <li key={event.id}>{new Date(event.created_at).toLocaleString('id-ID')}</li>)}</ol> : <p className="muted small">Belum ada aktivitas masuk yang tercatat.</p>}</section>}
  </div></Modal>;
}
