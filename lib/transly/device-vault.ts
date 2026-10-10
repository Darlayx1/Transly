import { clientCredentialSchema } from './credential-schema';
import { loadDeviceKeys } from './client-keys';
import type { PracticeConfig } from './schema';
import type { KeyStatus, VaultKey, VaultEvent } from './vault-types';

export type DeviceVaultKey = VaultKey & { secret: string };
export type DeviceVault = { keys: DeviceVaultKey[]; events?: VaultEvent[]; settings: { mode: 'priority' | 'balanced'; maxAttempts: number } };
const storageKey = (owner: string) => `transly.ai-keys.v2:${owner}`;
export const emptyDeviceVault = (): DeviceVault => ({ keys: [], settings: { mode: 'priority', maxAttempts: 3 } });
export function readDeviceVault(owner = 'guest'): DeviceVault {
  const empty = emptyDeviceVault();
  if (typeof window === 'undefined') return empty;
  const raw = localStorage.getItem(storageKey(owner));
  if (raw) {
    const parsed = JSON.parse(raw) as DeviceVault;
    if (!Array.isArray(parsed.keys) || parsed.keys.some(key => !clientCredentialSchema.safeParse({ generator: key.secret, evaluator: key.secret }).success)) throw new Error('Daftar API key tidak dapat dibaca. Data tersimpan tidak diubah.');
    return { keys: parsed.keys, events: Array.isArray(parsed.events) ? parsed.events.slice(-100) : [], settings: { mode: parsed.settings?.mode === 'balanced' ? 'balanced' : 'priority', maxAttempts: Math.min(3, Math.max(1, parsed.settings?.maxAttempts || 3)) } };
  }
  // Legacy device keys belong to the guest, never silently to a signed-in user.
  if (owner !== 'guest') return empty;
  const legacy = loadDeviceKeys();
  for (const [role, secret] of Object.entries(legacy)) {
    if (!secret) continue;
    const duplicate = empty.keys.find(key => key.secret === secret);
    if (duplicate) { duplicate.role = 'both'; continue; }
    empty.keys.push(newDeviceKey(role === 'gemini' ? 'Key utama' : role === 'generator' ? 'Pembuat soal' : 'Penilai terjemahan', secret, role === 'gemini' ? 'both' : role as VaultKey['role'], empty.keys.length + 1));
  }
  if (empty.keys.length) { writeDeviceVault(owner, empty); localStorage.removeItem('transly.device_keys.v1'); }
  return empty;
}
export function writeDeviceVault(owner: string, vault: DeviceVault) {
  localStorage.setItem(storageKey(owner), JSON.stringify(vault));
}
export function newDeviceKey(name: string, secret: string, role: VaultKey['role'] = 'both', priority = 1): DeviceVaultKey {
  if (!name.trim() || name.trim().length > 60 || !Number.isInteger(priority) || priority < 1 || priority > 100) throw new Error('Isi nama key dan urutan penggunaan 1–100.');
  if (!clientCredentialSchema.safeParse({ generator: secret, evaluator: secret }).success) throw new Error('API key harus berisi 20–256 karakter tanpa spasi.');
  return { id: crypto.randomUUID(), name, secret, provider: 'gemini', project: 'unknown', role, priority, enabled: true, suffix: secret.slice(-4), invalid: false, testedAt: null, testedModel: null, lastUsed: null, successes: 0, failures: 0 };
}
export function deviceVaultStatus(vault: DeviceVault): KeyStatus {
  const available = (role: 'generator' | 'evaluator') => vault.keys.some(key => key.enabled && !key.invalid && (key.role === 'both' || key.role === role));
  return { device: true, account: null, generator: available('generator'), evaluator: available('evaluator'), custom: vault.keys.length > 0, server: false, keys: vault.keys.map(key => { const { secret, ...metadata } = key; void secret; return metadata; }), settings: vault.settings, health: [], events: [...(vault.events || [])].reverse() };
}
export function deviceCandidates(vault: DeviceVault, config: PracticeConfig, role: 'generator' | 'evaluator') {
  const selected = config[role === 'generator' ? 'generatorKeyId' : 'evaluatorKeyId'];
  return vault.keys.filter(key => key.enabled && !key.invalid && (key.role === 'both' || key.role === role) && (!selected || key.id === selected)).sort((a, b) => vault.settings.mode === 'balanced' ? (a.lastUsed || 0) - (b.lastUsed || 0) : a.priority - b.priority);
}
export function deviceRequestConfig(config: PracticeConfig): PracticeConfig {
  return { ...config, generatorKeyId: undefined, evaluatorKeyId: undefined, generatorFallback: undefined, evaluatorFallback: undefined };
}
