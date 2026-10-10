'use client';
import { LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { apiOrigin, pagesMode, getSessionToken, setSessionToken, getAuthToken, getCredentialToken, setCredentialToken } from '@/lib/transly/transport';

export function Modal({ open, onClose, title, children, className = '' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && !ref.current?.open) ref.current?.showModal(); else if (!open && ref.current?.open) ref.current?.close(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  return <dialog ref={ref} className={`modal ${className}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-label={title}>
    <div className="modal-head"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Tutup" onClick={onClose}><X size={20}/></button></div>{children}
  </dialog>;
}
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return <div className="error-banner" role="alert"><TriangleAlert size={19}/><span>{message}</span>{onDismiss && <button className="icon-button" onClick={onDismiss} aria-label="Tutup pesan"><X size={17}/></button>}</div>;
}
export function Processing({ evaluation }: { evaluation: boolean }) {
  return <div className="processing" role="status" aria-live="polite"><div className="processing-symbol"><LoaderCircle className="spin" size={30}/></div><h2>{evaluation ? 'Membaca makna di balik kata.' : 'Menyiapkan tantangan untukmu.'}</h2><p>{evaluation ? 'AI sedang menelaah ketepatan makna, tata bahasa, dan kealamian terjemahan.' : 'AI sedang menyusun teks sesuai level, topik, dan gaya pilihanmu.'}</p><div className="processing-steps"><span>01 <b>{evaluation ? 'Memahami konteks' : 'Menyesuaikan level'}</b></span><span>02 <b>{evaluation ? 'Meninjau terjemahan' : 'Menyusun teks'}</b></span><span>03 <b>{evaluation ? 'Merangkai feedback' : 'Menyiapkan latihan'}</b></span></div><p className="muted small">Proses biasanya memerlukan beberapa detik. Jawabanmu tetap tersimpan.</p></div>;
}
const pendingRequests = new Map<string, { id: string; expires: number }>();
export async function api<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  let response;
  const headers: Record<string, string> = body === undefined ? {} : { 'Content-Type': 'application/json' };
  const operation = method === 'POST' && ['/api/generate', '/api/evaluate'].includes(url) ? `${url}:${JSON.stringify(body)}` : '';
  if (operation) {
    for (const [key, value] of pendingRequests) if (value.expires <= Date.now()) pendingRequests.delete(key);
    if (!pendingRequests.has(operation)) pendingRequests.set(operation, { id: crypto.randomUUID(), expires: Date.now() + 600000 });
    headers['Idempotency-Key'] = pendingRequests.get(operation)!.id;
  }
  const authJwt = getAuthToken();
  const credToken = getCredentialToken();
  if (authJwt) {
    headers['X-Transly-Auth'] = `Bearer ${authJwt}`;
    headers['Authorization'] = `Bearer ${authJwt}`;
  }
  if (credToken) {
    headers['X-Transly-Credentials'] = credToken;
    if (!authJwt) {
      headers['Authorization'] = `Bearer ${credToken}`;
    }
  }
  try { response = await fetch(apiOrigin + url, { method, credentials: pagesMode ? 'omit' : 'same-origin', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(100000) }); }
  catch { throw new Error('Koneksi terputus atau permintaan terlalu lama. Jawaban tersimpan; silakan coba kembali.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('Server belum dapat merespons. Silakan coba kembali.'); }
  if (!response.ok) { const detail = (data as { error?: { message?: string; code?: string } }).error; throw Object.assign(new Error(detail?.message || 'Terjadi kendala. Silakan coba kembali.'), { code: detail?.code }); }
  if (operation) pendingRequests.delete(operation);
  if (url === '/api/credentials' && method === 'POST') { const token = (data as { sessionToken?: unknown }).sessionToken; if (typeof token === 'string') setCredentialToken(token); }
  if (url === '/api/credentials' && method === 'DELETE') setCredentialToken('');
  return data as T;
}
