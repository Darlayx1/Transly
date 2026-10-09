import { modelProvider, type Provider } from './config';
import type { PracticeConfig } from './schema';
export type VaultKey = {
  provider: Provider; testedModel: string | null;
  id: string; name: string; project: string; role: 'both' | 'generator' | 'evaluator'; priority: number;
  enabled: boolean; suffix: string; invalid: boolean; testedAt: number | null; lastUsed: number | null;
  successes: number; failures: number;
};
export type VaultHealth = { scope: string; model: string; until: number; code: string };
export type VaultEvent = { keyName: string; model: string; provider?: Provider; role: string; outcome: string; duration: number; attempt: number; requestId: string; createdAt: number };
export type KeyStatus = {
  generator: boolean; evaluator: boolean; custom: boolean; server: boolean;
  serverProviders?: Provider[]; legacyProviders?: Provider[];
  account?: { email: string } | null; legacyMigrationAvailable?: boolean;
  keys?: VaultKey[]; health?: VaultHealth[]; events?: VaultEvent[]; running?: string[];
  settings?: { mode: 'priority' | 'balanced'; maxAttempts: number };
};
export type RoutingInfo = { requestId: string; fallback: boolean; provider: Provider; model: string; attempts: { keyName: string; provider: Provider; model: string; outcome: string; attempt: number }[] };
export const quotaScope = (key: Pick<VaultKey, 'project'>) => `project:${key.project}`;
export function keyAvailability(key: VaultKey, status: KeyStatus, model: string, now = Date.now()) {
  if (key.provider !== modelProvider(model)) return 'wrong-provider';
  if (!key.enabled) return 'disabled';
  if (key.invalid) return 'invalid';
  const blocked = status.health?.find(h => h.model === model && h.until > now && ['provider:gemini', 'provider', `key:${key.id}`, quotaScope(key)].includes(h.scope));
  if (blocked) return blocked.until > 8e15 ? 'permission' : 'cooldown';
  return key.testedAt && key.testedModel === model ? 'tested' : 'untested';
}
export function hasUsableKey(status: KeyStatus, role: 'generator' | 'evaluator', model: string, keyId?: string) {
  const provider = modelProvider(model);
  if (!status.account) return !keyId && ((status.serverProviders?.includes(provider) ?? (provider === 'gemini' && status.server)) || (status.legacyProviders?.includes(provider) ?? (provider === 'gemini' && status.custom)));
  return (status.keys || []).some(key => (!keyId || key.id === keyId) && (key.role === role || key.role === 'both') && ['tested', 'untested'].includes(keyAvailability(key, status, model)));
}
export function roleReady(status: KeyStatus, config: PracticeConfig, role: 'generator' | 'evaluator') {
  const keyId = role === 'generator' ? config.generatorKeyId : config.evaluatorKeyId;
  const fallback = role === 'generator' ? config.generatorFallback : config.evaluatorFallback;
  if (!status.account && (keyId || fallback)) return false;
  if (keyId && !(status.keys || []).some(key => key.id === keyId && key.provider === modelProvider(config[role]) && ['both', role].includes(key.role))) return false;
  return hasUsableKey(status, role, config[role], keyId) || Boolean(fallback && hasUsableKey(status, role, fallback));
}
export const outcomeLabel: Record<string, string> = {
  SUCCESS: 'Berhasil', TEST_OK: 'Akses model tersedia', INVALID_KEY: 'Key tidak valid', KEY_PERMISSION_DENIED: 'Izin model tidak tersedia',
  MODEL_UNAVAILABLE: 'Model tidak tersedia', RATE_LIMIT: 'Batas frekuensi', QUOTA_EXCEEDED: 'Kuota terbatas',
  TIMEOUT: 'Batas waktu', NETWORK_ERROR: 'Koneksi provider', PROVIDER_ERROR: 'Gangguan provider', INVALID_RESPONSE: 'Jawaban belum valid',
  EMPTY_RESPONSE: 'Jawaban kosong', RESPONSE_TRUNCATED: 'Jawaban terpotong', SAFETY_BLOCKED: 'Konten diblokir', UNSUPPORTED_PARAMETER: 'Parameter tidak didukung',
  SERVER_ERROR: 'Pemrosesan gagal', VAULT_LOCKED: 'Brankas belum dapat dibuka', NOT_CONFIGURED: 'Brankas belum dikonfigurasi',
};
