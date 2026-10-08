import { env } from 'cloudflare:workers';
import { AppError } from './server';
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
function configuration() {
  const runtime = env as unknown as Record<string, string | undefined>;
  let keys: Record<string, string>;
  try { keys = JSON.parse(runtime.VAULT_ENCRYPTION_KEYS || process.env.VAULT_ENCRYPTION_KEYS || '{}'); }
  catch { throw new AppError('NOT_CONFIGURED', 'Brankas key belum dikonfigurasi.', 503); }
  const active = runtime.VAULT_ACTIVE_VERSION || process.env.VAULT_ACTIVE_VERSION || 'v1';
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(active) || typeof keys[active] !== 'string' || keys[active].length < 32)
    throw new AppError('NOT_CONFIGURED', 'Brankas key belum dikonfigurasi.', 503);
  return { keys, active };
}
export const activeVersion = () => configuration().active;
async function keyFor(version: string) {
  const secret = configuration().keys[version];
  if (!secret || secret.length < 32) throw new AppError('VAULT_LOCKED', 'Key tersimpan belum dapat dibuka. Hubungi pengelola aplikasi.', 503);
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(value: string, context: string) {
  const version = activeVersion(), iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, await keyFor(version), encoder.encode(value));
  return `${version}.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}
export async function unseal(value: string, context: string) {
  try {
    const [version, iv, ciphertext] = value.split('.');
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode(context) }, await keyFor(version), decode(ciphertext)));
  } catch { throw new AppError('VAULT_LOCKED', 'Key tersimpan belum dapat dibuka. Hubungi pengelola aplikasi.', 503); }
}
export async function digest(value: string) { return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
