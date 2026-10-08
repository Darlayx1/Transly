export type VaultKey = {
  id: string; name: string; project: string; role: 'both' | 'generator' | 'evaluator'; priority: number;
  enabled: boolean; suffix: string; invalid: boolean; testedAt: number | null; lastUsed: number | null;
  successes: number; failures: number;
};
export type VaultHealth = { scope: string; model: string; until: number; code: string };
export type VaultEvent = { keyName: string; model: string; role: string; outcome: string; duration: number; attempt: number; requestId: string; createdAt: number };
export type KeyStatus = {
  generator: boolean; evaluator: boolean; custom: boolean; server: boolean;
  account?: { email: string } | null; legacyMigrationAvailable?: boolean;
  keys?: VaultKey[]; health?: VaultHealth[]; events?: VaultEvent[]; running?: string[];
  settings?: { mode: 'priority' | 'balanced'; maxAttempts: number };
};
export type RoutingInfo = { requestId: string; fallback: boolean; attempts: { keyName: string; outcome: string; attempt: number }[] };
export const outcomeLabel: Record<string, string> = {
  SUCCESS: 'Berhasil', TEST_OK: 'Akses model tersedia', INVALID_KEY: 'Key tidak valid', KEY_PERMISSION_DENIED: 'Izin model tidak tersedia',
  MODEL_UNAVAILABLE: 'Model tidak tersedia', RATE_LIMIT: 'Batas frekuensi', QUOTA_EXCEEDED: 'Kuota terbatas',
  TIMEOUT: 'Batas waktu', NETWORK_ERROR: 'Koneksi provider', PROVIDER_ERROR: 'Gangguan provider', INVALID_RESPONSE: 'Jawaban belum valid',
  EMPTY_RESPONSE: 'Jawaban kosong', RESPONSE_TRUNCATED: 'Jawaban terpotong', SAFETY_BLOCKED: 'Konten diblokir', UNSUPPORTED_PARAMETER: 'Parameter tidak didukung',
  SERVER_ERROR: 'Pemrosesan gagal', VAULT_LOCKED: 'Brankas belum dapat dibuka', NOT_CONFIGURED: 'Brankas belum dikonfigurasi',
};
