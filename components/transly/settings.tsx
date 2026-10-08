'use client';
import { useState } from 'react';
import { KeyRound, ShieldCheck, SlidersHorizontal, Check, LoaderCircle } from 'lucide-react';
import { models } from '@/lib/transly/config';
import type { PracticeConfig } from '@/lib/transly/schema';
import { api, ErrorBanner, Modal } from './ui';
import { pagesMode } from '@/lib/transly/transport';

export type KeyStatus = { generator: boolean; evaluator: boolean; custom: boolean; server: boolean };
export function ModelSelect({ role, value, onChange }: { role: 'generator' | 'evaluator'; value: string; onChange: (v: string) => void }) {
  return <label className="field"><span>{role === 'generator' ? 'Pembuat soal' : 'Evaluator'}</span><select value={value} onChange={e => onChange(e.target.value)}>{models.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select></label>;
}
export function Settings({ open, onClose, config, onConfig, status, onStatus }: { open: boolean; onClose: () => void; config: PracticeConfig; onConfig: (c: PracticeConfig) => void; status: KeyStatus; onStatus: (s: KeyStatus) => void }) {
  const [generator, setGenerator] = useState(''); const [evaluator, setEvaluator] = useState('');
  const [same, setSame] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  const close = () => { if (busy) return; setGenerator(''); setEvaluator(''); setError(''); setSaved(false); onClose(); };
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError(''); setSaved(false);
    try { await api('/api/credentials', { generator, evaluator: same ? generator : evaluator }); setGenerator(''); setEvaluator(''); onStatus(await api<KeyStatus>('/api/credentials', undefined, 'GET')); setSaved(true); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (busy) return; setBusy(true); setError('');
    try { await api('/api/credentials', {}, 'DELETE'); onStatus(await api<KeyStatus>('/api/credentials', undefined, 'GET')); setSaved(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal open={open} onClose={close} title="Pengaturan AI"><div className="modal-body">
    <p className="muted">Pilih pasangan model untuk cara belajarmu.</p><div className="two-col"><ModelSelect role="generator" value={config.generator} onChange={v => onConfig({ ...config, generator: v })}/><ModelSelect role="evaluator" value={config.evaluator} onChange={v => onConfig({ ...config, evaluator: v })}/></div>
    <div className="section-divider"/><div className="section-label"><KeyRound size={18}/><h3>API key Google AI</h3>{status.custom && <span className="pill success">Tersimpan</span>}</div>
    <p className="muted small">Gunakan key dari <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">Google AI Studio</a>. Ketersediaan model bergantung pada akses dan kuota key kamu.</p>
    <form onSubmit={save}><label className="field"><span>{status.custom ? 'Ganti key pembuat soal' : 'Key pembuat soal'}</span><input type="password" value={generator} onChange={e => { setGenerator(e.target.value); setSaved(false); }} autoComplete="off" spellCheck={false} minLength={20} maxLength={256} required placeholder="Masukkan API key"/></label>
      <label className="checkbox-row"><input type="checkbox" checked={same} onChange={e => setSame(e.target.checked)}/>Gunakan key yang sama untuk evaluator</label>
      {!same && <label className="field"><span>Key evaluator</span><input type="password" value={evaluator} onChange={e => setEvaluator(e.target.value)} autoComplete="off" spellCheck={false} minLength={20} maxLength={256} required placeholder="Masukkan API key evaluator"/></label>}
      <div className="security-note"><ShieldCheck size={20}/><p>{pagesMode ? 'Key dienkripsi oleh server. Sesi terenkripsi hanya disimpan dalam memori tab; masukkan kembali key setelah refresh. Key tidak disimpan di perangkat.' : 'Key dienkripsi di server, berlaku 24 jam, dan tidak dapat dibaca JavaScript browser. Hapus key kapan saja di sini.'}</p></div>
      {error && <ErrorBanner message={error}/>} {saved && <p className="saved-message" role="status"><Check size={17}/> Key tersimpan. Siap digunakan.</p>}
      <div className="modal-actions">{status.custom && <button type="button" className="text-button danger-text" disabled={busy} onClick={remove}>Hapus key</button>}<button className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={18} className="spin"/> : <KeyRound size={17}/>}Simpan key</button></div>
    </form></div></Modal>;
}
export const settingsIcon = SlidersHorizontal;
