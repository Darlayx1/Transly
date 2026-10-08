import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { models } from './config';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const cookieName = 'transly_credentials';
export const pagesOrigin = 'https://darlayx1.github.io';
export const isPagesRequest = (request: Request) => request.headers.get('origin') === pagesOrigin;
const runtime = env as unknown as { SESSION_SECRET?: string; GEMINI_API_KEY?: string };
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return json({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof z.ZodError) return json({ error: { code: 'INVALID_INPUT', message: 'Data belum lengkap atau tidak valid. Periksa konfigurasi dan coba lagi.' } }, 400);
  return json({ error: { code: 'SERVER_ERROR', message: 'Server sedang mengalami kendala. Jawaban tetap tersimpan. Silakan coba lagi.' } }, 500);
}
export async function readBody(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && !isPagesRequest(request)) throw new AppError('FORBIDDEN', 'Permintaan tidak diizinkan.', 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site' && !isPagesRequest(request)) throw new AppError('FORBIDDEN', 'Permintaan tidak diizinkan.', 403);
  if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('INVALID_INPUT', 'Format permintaan tidak valid.', 415);
  if (Number(request.headers.get('content-length')) > 60000) throw new AppError('TOO_LARGE', 'Teks terlalu panjang.', 413);
  const text = await request.text();
  if (text.length > 60000) throw new AppError('TOO_LARGE', 'Teks terlalu panjang.', 413);
  try { return JSON.parse(text); } catch { throw new AppError('INVALID_INPUT', 'Data permintaan tidak valid.'); }
}
async function encryptionKey() {
  const secret = runtime.SESSION_SECRET ?? process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new AppError('NOT_CONFIGURED', 'Penyimpanan key belum dikonfigurasi oleh pengelola aplikasi.', 503);
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64 = (v: string) => Uint8Array.from(atob(v.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const credentialSchema = z.object({ generator: z.string().max(256), evaluator: z.string().max(256), expires: z.number() });
type Credentials = z.infer<typeof credentialSchema>;
export async function readCredentials(request: Request): Promise<Credentials | null> {
  const value = isPagesRequest(request) ? request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1] : request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!value || value.length > 3000) return null;
  try {
    const [iv, encrypted] = value.split('.');
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: encoder.encode(cookieName) }, await encryptionKey(), unb64(encrypted));
    const c = credentialSchema.parse(JSON.parse(decoder.decode(bytes)));
    return c.expires > Date.now() ? c : null;
  } catch { return null; }
}
export async function credentialCookie(request: Request, generator: string, evaluator: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(JSON.stringify({ generator, evaluator, expires: Date.now() + 86400000 }));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(cookieName) }, await encryptionKey(), data));
  return `${cookieName}=${b64(iv)}.${b64(encrypted)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=86400${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export const clearCookie = (request: Request) => `${cookieName}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
export async function resolveKey(request: Request, role: 'generator' | 'evaluator') {
  const keys = await readCredentials(request);
  const key = keys?.[role] || runtime.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new AppError('KEY_REQUIRED', 'Tambahkan API key Google AI di Pengaturan AI untuk memulai.');
  return key;
}
export const hasServerKey = () => Boolean(runtime.GEMINI_API_KEY || process.env.GEMINI_API_KEY);

// Best-effort isolate-local throttling. Upstream quota remains authoritative.
const requests = new Map<string, { count: number; reset: number }>();
export async function throttle(key: string) {
  const id = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(key))));
  const now = Date.now();
  if (requests.size > 1000) for (const [k, v] of requests) if (v.reset < now) requests.delete(k);
  const state = requests.get(id);
  if (state && state.reset > now && state.count >= 12) throw new AppError('RATE_LIMIT', 'Terlalu banyak permintaan. Tunggu satu menit sebelum mencoba lagi.', 429);
  requests.set(id, !state || state.reset <= now ? { count: 1, reset: now + 60000 } : { ...state, count: state.count + 1 });
}
export async function generateJson(key: string, modelId: string, prompt: string, schema: unknown): Promise<unknown> {
  const model = models.find(m => m.id === modelId);
  if (!model) throw new AppError('MODEL_UNAVAILABLE', 'Pilih model yang tersedia.');
  const config = model.structured ? { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 16000 } : { maxOutputTokens: 16000 };
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt + '\nReturn only valid JSON matching this schema: ' + JSON.stringify(schema) }] }], generationConfig: config }),
      signal: AbortSignal.timeout(90000),
    });
  } catch (e) {
    throw new AppError('NETWORK_ERROR', e instanceof Error && /timeout|abort/i.test(e.name) ? 'AI membutuhkan waktu terlalu lama. Coba kembali atau pilih model lain.' : 'Tidak dapat terhubung ke layanan AI. Periksa koneksi dan coba lagi.', 504);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status === 400) {
      // Do not expose upstream errors, which can contain request details.
      let message = ''; try { message = String((await response.json() as { error?: { message?: string } }).error?.message ?? ''); } catch { /* ignore */ }
      if (/api.?key|credential|permission/i.test(message) || response.status !== 400) throw new AppError('INVALID_KEY', 'API key tidak valid atau tidak memiliki akses. Perbarui key di Pengaturan AI.', 401);
      throw new AppError('MODEL_UNAVAILABLE', 'Model tidak mendukung permintaan ini. Pilih model lain di Pengaturan AI.', 422);
    }
    if (response.status === 429) throw new AppError('QUOTA_EXCEEDED', 'Kuota AI habis atau batas permintaan tercapai. Tunggu sebentar, periksa kuota Google AI, atau gunakan key lain.', 429);
    if (response.status === 404) throw new AppError('MODEL_UNAVAILABLE', 'Model belum tersedia untuk API key ini. Pilih model lain di Pengaturan AI.', 422);
    throw new AppError('PROVIDER_ERROR', 'Layanan AI sedang bermasalah. Jawaban tetap tersimpan; coba kembali nanti.', 502);
  }
  const payload = await response.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[] };
  const text = payload.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('') ?? '';
  if (!text) throw new AppError('EMPTY_RESPONSE', 'AI tidak menghasilkan jawaban. Coba ulangi atau gunakan topik lain.', 502);
  try { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new AppError('INVALID_RESPONSE', 'Format jawaban AI tidak dapat dibaca. Silakan coba lagi atau pilih model lain.', 502); }
}
