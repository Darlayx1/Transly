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
export function parseJsonResponse(rawText: string): unknown {
  let text = rawText.trim();
  if (!text) throw new AppError('EMPTY_RESPONSE', 'AI tidak menghasilkan jawaban. Coba ulangi atau gunakan topik lain.', 502);
  if (text.length > 500000) throw new AppError('TOO_LARGE', 'Format jawaban AI terlalu besar.', 413);

  // Remove inline thinking tags if any leaked into text
  text = text.replace(/<(?:thought|think)>[\s\S]*?<\/(?:thought|think)>/gi, '').trim();

  // 1. Direct parse
  try {
    return JSON.parse(text);
  } catch { /* proceed */ }

  // 2. Fenced code block: ```json ... ``` or ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      const repaired = fenced[1].trim().replace(/,\s*([}\]])/g, '$1');
      try {
        return JSON.parse(repaired);
      } catch { /* proceed */ }
    }
  }

  // 3. Extract JSON object { ... }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // 4. Controlled repair: remove trailing commas before closing braces/brackets
      const repaired = candidate.replace(/,\s*([}\]])/g, '$1');
      try {
        return JSON.parse(repaired);
      } catch { /* proceed */ }
    }
  }

  throw new AppError('INVALID_RESPONSE', 'Format jawaban AI tidak dapat dibaca. Silakan coba lagi atau pilih model lain.', 502);
}

export async function generateJson(key: string, modelId: string, prompt: string, schema: unknown): Promise<unknown> {
  const model = models.find(m => m.id === modelId);
  if (!model) throw new AppError('MODEL_UNAVAILABLE', 'Pilih model yang tersedia.');

  // Gemma uses prompt-based JSON and supports minimal/high thinking levels.
  // Minimal leaves the output budget for the passage or evaluation itself.
  const config = model.structured
    ? { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 16000 }
    : { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'minimal' } };

  const promptText = model.structured
    ? prompt
    : `${prompt}\nReturn only valid JSON matching this schema: ${JSON.stringify(schema)}`;

  const bodyPayload = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: config,
  });

  const maxAttempts = 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: bodyPayload,
        signal: AbortSignal.timeout(90000),
      });
    } catch (e) {
      const isTimeout = e instanceof Error && /timeout|abort/i.test(e.name);
      const appErr = new AppError(
        isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        isTimeout
          ? 'AI membutuhkan waktu terlalu lama. Coba kembali atau pilih model lain.'
          : 'Tidak dapat terhubung ke layanan AI. Periksa koneksi dan coba lagi.',
        504
      );
      console.warn(`[transly:${model.id}] attempt ${attempt} network error: ${appErr.code}`);
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw appErr;
    }

    if (!response.ok) {
      let message = '';
      try {
        message = String((await response.json() as { error?: { message?: string } }).error?.message ?? '');
      } catch { /* ignore */ }

      console.warn(`[transly:${model.id}] attempt ${attempt} upstream status: ${response.status}`);

      if (response.status === 401) {
        throw new AppError('INVALID_KEY', 'API key tidak valid atau tidak memiliki akses. Perbarui key di Pengaturan AI.', 401);
      }
      if (response.status === 403) {
        if (/api.?key|credential/i.test(message)) {
          throw new AppError('INVALID_KEY', 'API key tidak valid atau tidak memiliki akses. Perbarui key di Pengaturan AI.', 401);
        }
        if (/permission/i.test(message)) {
          throw new AppError('KEY_PERMISSION_DENIED', 'API key tidak memiliki izin untuk menggunakan model ini. Pastikan akun memiliki akses.', 403);
        }
        throw new AppError('INVALID_KEY', 'API key tidak valid atau tidak memiliki akses. Perbarui key di Pengaturan AI.', 401);
      }
      if (response.status === 400) {
        if (/api.?key|credential/i.test(message)) {
          throw new AppError('INVALID_KEY', 'API key tidak valid atau tidak memiliki akses. Perbarui key di Pengaturan AI.', 401);
        }
        throw new AppError('UNSUPPORTED_PARAMETER', 'Model tidak mendukung format permintaan atau parameter yang dikirim.', 400);
      }
      if (response.status === 404) {
        throw new AppError('MODEL_UNAVAILABLE', 'Model belum tersedia untuk API key ini. Pilih model lain di Pengaturan AI.', 422);
      }
      if (response.status === 429) {
        if (/rate.?limit|requests.?per/i.test(message)) {
          throw new AppError('RATE_LIMIT', 'Batas frekuensi permintaan tercapai. Tunggu satu menit sebelum mencoba lagi.', 429);
        }
        throw new AppError('QUOTA_EXCEEDED', 'Kuota AI habis atau batas permintaan tercapai. Tunggu sebentar, periksa kuota Google AI, atau gunakan key lain.', 429);
      }
      if (response.status >= 500) {
        if (attempt < maxAttempts) {
          console.warn(`[transly:${model.id}] retrying after provider 5xx...`);
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        throw new AppError('PROVIDER_ERROR', 'Layanan AI sedang bermasalah. Jawaban tetap tersimpan; coba kembali nanti.', 502);
      }
      throw new AppError('PROVIDER_ERROR', 'Layanan AI sedang bermasalah. Jawaban tetap tersimpan; coba kembali nanti.', 502);
    }

    let payload: {
      candidates?: {
        content?: { parts?: { text?: string; thought?: boolean }[] };
        finishReason?: string;
      }[];
      promptFeedback?: { blockReason?: string };
    };

    try {
      payload = await response.json();
    } catch {
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw new AppError('INVALID_RESPONSE', 'Format jawaban AI tidak dapat dibaca. Silakan coba lagi atau pilih model lain.', 502);
    }

    if (payload.promptFeedback?.blockReason === 'SAFETY') {
      throw new AppError('SAFETY_BLOCKED', 'Permintaan diblokir oleh kebijakan keamanan AI. Silakan ubah topik atau kalimat yang digunakan.', 422);
    }

    const candidate = payload.candidates?.[0];
    if (!candidate) {
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw new AppError('EMPTY_RESPONSE', 'AI tidak menghasilkan jawaban. Coba ulangi atau gunakan topik lain.', 502);
    }

    if (candidate.finishReason === 'SAFETY') {
      throw new AppError('SAFETY_BLOCKED', 'Konten diblokir oleh kebijakan keamanan AI. Silakan ubah topik atau kalimat yang digunakan.', 422);
    }

    if (candidate.finishReason === 'MAX_TOKENS' || candidate.finishReason === 'LENGTH') {
      throw new AppError('RESPONSE_TRUNCATED', 'Jawaban AI terpotong karena mencapai batas panjang maksimum token. Silakan coba kembali.', 502);
    }

    const parts = candidate.content?.parts ?? [];
    const text = parts.filter(p => !p.thought).map(p => p.text ?? '').join('');

    try {
      return parseJsonResponse(text);
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts) {
        console.warn(`[transly:${model.id}] JSON parse failed on attempt ${attempt}, retrying...`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
    }
  }

  if (lastError instanceof AppError) throw lastError;
  throw new AppError('INVALID_RESPONSE', 'Format jawaban AI tidak dapat dibaca. Silakan coba lagi atau pilih model lain.', 502);
}
