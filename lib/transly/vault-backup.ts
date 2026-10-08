import { z } from 'zod';
import { AppError } from './server';
import { addKey, getKeys, getSettings, saveSettings } from './vault';
import { unseal } from './vault-crypto';
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
};
const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const wrappingSchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
const backupSchema = z.object({ format: z.literal('transly-vault-backup'), version: z.literal(1), salt: z.string().max(64), iv: z.string().max(64), ciphertext: z.string().max(120000), iterations: z.literal(600000) });
const contentSchema = z.object({
  keys: z.array(z.object({ name: z.string().trim().min(1).max(60), project: z.string().max(100), role: z.enum(['both', 'generator', 'evaluator']), priority: z.number().int().min(1).max(100), enabled: z.boolean(), secret: z.string().trim().min(20).max(256) })).max(50),
  settings: z.object({ mode: z.enum(['priority', 'balanced']), maxAttempts: z.number().int().min(1).max(3) }),
});
async function backupKey(wrappingKey: string) {
  const bytes = decode(wrappingSchema.parse(wrappingKey));
  if (bytes.length !== 32) throw new AppError('BACKUP_INVALID', 'Cadangan tidak valid.', 400);
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function exportBackup(owner: string, wrappingKey: string, suppliedSalt: string) {
  const salt = decode(suppliedSalt);
  if (salt.length !== 16) throw new AppError('BACKUP_INVALID', 'Cadangan tidak valid.', 400);
  const [keys, settings] = await Promise.all([getKeys(owner), getSettings(owner)]);
  const records = [];
  for (const key of keys) records.push({ name: key.name, project: key.project, role: key.role, priority: key.priority, enabled: Boolean(key.enabled), secret: await unseal(key.ciphertext, `transly:key:${owner}:${key.id}`) });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('transly-vault-backup:v1') }, await backupKey(wrappingKey), encoder.encode(JSON.stringify({ keys: records, settings })));
  return { format: 'transly-vault-backup', version: 1, iterations: 600000, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}
export async function importBackup(owner: string, wrappingKey: string, input: unknown) {
  const backup = backupSchema.parse(input);
  let content: z.infer<typeof contentSchema>;
  try {
    const salt = decode(backup.salt), iv = decode(backup.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid backup');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('transly-vault-backup:v1') }, await backupKey(wrappingKey), decode(backup.ciphertext));
    content = contentSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch { throw new AppError('BACKUP_INVALID', 'Cadangan tidak dapat dibuka. Periksa kata sandi dan file cadangan.', 400); }
  let imported = 0, skipped = 0;
  // Additive and safe to retry; existing records are never overwritten.
  for (const key of content.keys) {
    try { await addKey(owner, key); imported++; }
    catch (error) {
      if (error instanceof AppError && ['DUPLICATE_KEY', 'KEY_LIMIT'].includes(error.code)) skipped++;
      else throw error;
    }
  }
  await saveSettings(owner, content.settings);
  return { imported, skipped };
}
