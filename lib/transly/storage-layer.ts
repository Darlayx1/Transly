import { configSchema, defaultConfig, sessionSchema, type PracticeConfig } from './schema';
import { emptyHistory, identifySession, type HistoryCache, type HistoryEntry } from './history';
import { emptyDeviceVault, newDeviceKey, type DeviceVault, type DeviceVaultKey } from './device-vault';
import { loadDeviceKeys } from './client-keys';
import { isAccountOwner, extractUserId, type StorageOwner } from './owner';

export const STORAGE_PREFIX = {
  CONFIG: 'transly.config.v2:',
  HISTORY: 'transly.history.v2:',
  GUEST_KEYS: 'transly.ai-keys.v2:guest',
  ACCOUNT_KEYS_META: 'transly.ai-keys-meta.v2:',
};

export class StorageLayer {
  private static getStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  // Configuration management
  static readConfig(owner: StorageOwner, fallback: PracticeConfig = defaultConfig): PracticeConfig {
    const storage = this.getStorage();
    if (!storage) return fallback;

    const raw = storage.getItem(STORAGE_PREFIX.CONFIG + owner);
    if (raw) {
      try {
        const parsed = configSchema.safeParse(JSON.parse(raw));
        if (parsed.success) return parsed.data;
      } catch {}
    }

    // Migration for guest from v1
    if (owner === 'guest') {
      const legacyGuest = storage.getItem('transly.config.v1:guest') || storage.getItem('transly.config.v1');
      if (legacyGuest) {
        try {
          const parsed = configSchema.safeParse(JSON.parse(legacyGuest));
          if (parsed.success) {
            this.writeConfig('guest', parsed.data);
            return parsed.data;
          }
        } catch {}
      }
    }

    // Account users never inherit guest config implicitly
    return fallback;
  }

  static writeConfig(owner: StorageOwner, config: PracticeConfig): void {
    const storage = this.getStorage();
    if (!storage) return;
    try {
      storage.setItem(STORAGE_PREFIX.CONFIG + owner, JSON.stringify(config));
    } catch {
      throw new Error('Penyimpanan pengaturan gagal. Periksa memori perangkat.');
    }
  }

  // History management
  static readHistory(owner: StorageOwner): HistoryCache {
    const storage = this.getStorage();
    if (!storage) return emptyHistory();

    const raw = storage.getItem(STORAGE_PREFIX.HISTORY + owner);
    if (raw) {
      try {
        const cache = JSON.parse(raw) as HistoryCache;
        if (cache && Array.isArray(cache.entries)) {
          const entries = cache.entries.flatMap(entry => {
            const parsed = sessionSchema.safeParse(entry.session);
            if (!parsed.success || !parsed.data.id || !Number.isSafeInteger(entry.version) || entry.version < 0) return [];
            return [{ session: { ...parsed.data, id: parsed.data.id }, version: entry.version, dirty: Boolean(entry.dirty) }];
          });
          return { entries, activeId: entries.some(e => e.session.id === cache.activeId) ? cache.activeId : null };
        }
      } catch {}
    }

    // Check v1 migration for guest
    if (owner === 'guest') {
      const v1Guest = storage.getItem('transly.history.v1:guest') || storage.getItem('transly.session.v1');
      if (v1Guest) {
        try {
          let entries: HistoryEntry[] = [];
          let activeId: string | null = null;
          if (v1Guest.startsWith('{') && v1Guest.includes('"entries"')) {
            const parsed = JSON.parse(v1Guest) as HistoryCache;
            if (Array.isArray(parsed.entries)) {
              entries = parsed.entries.flatMap(entry => {
                const s = sessionSchema.safeParse(entry.session);
                return s.success && s.data.id ? [{ session: { ...s.data, id: s.data.id }, version: entry.version || 0, dirty: true }] : [];
              });
              activeId = parsed.activeId;
            }
          } else {
            const single = sessionSchema.safeParse(JSON.parse(v1Guest));
            if (single.success) {
              const identified = identifySession(single.data);
              entries = [{ session: identified, version: 0, dirty: true }];
              activeId = identified.id;
            }
          }
          if (entries.length > 0) {
            const migrated: HistoryCache = { entries, activeId };
            this.writeHistory('guest', migrated);
            return migrated;
          }
        } catch {}
      }
    }

    // Check v1 migration for account
    if (isAccountOwner(owner)) {
      const userId = extractUserId(owner);
      const v1Account = storage.getItem(`transly.history.v1:${owner}`) || (userId ? storage.getItem(`transly.history.v1:${userId}`) : null);
      if (v1Account) {
        try {
          const parsed = JSON.parse(v1Account) as HistoryCache;
          if (Array.isArray(parsed.entries)) {
            const entries = parsed.entries.flatMap(entry => {
              const s = sessionSchema.safeParse(entry.session);
              return s.success && s.data.id ? [{ session: { ...s.data, id: s.data.id }, version: entry.version || 0, dirty: Boolean(entry.dirty) }] : [];
            });
            const migrated: HistoryCache = { entries, activeId: parsed.activeId };
            this.writeHistory(owner, migrated);
            return migrated;
          }
        } catch {}
      }
    }

    return emptyHistory();
  }

  static writeHistory(owner: StorageOwner, cache: HistoryCache): void {
    const storage = this.getStorage();
    if (!storage) return;
    try {
      storage.setItem(STORAGE_PREFIX.HISTORY + owner, JSON.stringify(cache));
    } catch {
      throw new Error('Penyimpanan riwayat gagal. Periksa memori perangkat.');
    }
  }

  // Guest Device Vault (Guest only - raw secrets stay local on device)
  static readGuestVault(): DeviceVault {
    const storage = this.getStorage();
    const empty = emptyDeviceVault();
    if (!storage) return empty;

    const raw = storage.getItem(STORAGE_PREFIX.GUEST_KEYS);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as DeviceVault;
        if (Array.isArray(parsed.keys)) {
          return {
            keys: parsed.keys,
            events: Array.isArray(parsed.events) ? parsed.events.slice(-100) : [],
            settings: {
              mode: parsed.settings?.mode === 'balanced' ? 'balanced' : 'priority',
              maxAttempts: Math.min(3, Math.max(1, parsed.settings?.maxAttempts || 3)),
            },
          };
        }
      } catch {}
    }

    // Check legacy device keys
    const legacy = loadDeviceKeys();
    for (const [role, secret] of Object.entries(legacy)) {
      if (!secret) continue;
      const duplicate = empty.keys.find(key => key.secret === secret);
      if (duplicate) { duplicate.role = 'both'; continue; }
      empty.keys.push(newDeviceKey(
        role === 'gemini' ? 'Key utama' : role === 'generator' ? 'Pembuat soal' : 'Penilai terjemahan',
        secret,
        role === 'gemini' ? 'both' : (role as DeviceVaultKey['role']),
        empty.keys.length + 1
      ));
    }
    if (empty.keys.length) {
      this.writeGuestVault(empty);
      try { storage.removeItem('transly.device_keys.v1'); } catch {}
    }
    return empty;
  }

  static writeGuestVault(vault: DeviceVault): void {
    const storage = this.getStorage();
    if (!storage) throw new Error('Penyimpanan API key pada perangkat tidak tersedia.');
    try {
      storage.setItem(STORAGE_PREFIX.GUEST_KEYS, JSON.stringify(vault));
    } catch {
      throw new Error('Penyimpanan API key tamu gagal.');
    }
  }

  // Account Keys Metadata Cache (NO secrets - only masked keys and statuses)
  static readAccountKeysMeta(owner: `account:${string}`): unknown | null {
    const storage = this.getStorage();
    if (!storage) return null;
    try {
      const raw = storage.getItem(STORAGE_PREFIX.ACCOUNT_KEYS_META + owner);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  static writeAccountKeysMeta(owner: `account:${string}`, meta: unknown): void {
    const storage = this.getStorage();
    if (!storage) return;
    try {
      storage.setItem(STORAGE_PREFIX.ACCOUNT_KEYS_META + owner, JSON.stringify(meta));
    } catch {}
  }

  // Cleanup on logout
  static clearAccountCache(userId: string): void {
    const storage = this.getStorage();
    if (!storage || !userId) return;

    const accountOwner = `account:${userId}`;
    const keysToRemove = [
      STORAGE_PREFIX.CONFIG + accountOwner,
      STORAGE_PREFIX.HISTORY + accountOwner,
      STORAGE_PREFIX.ACCOUNT_KEYS_META + accountOwner,
      `transly.config.v1:${accountOwner}`,
      `transly.config.v1:${userId}`,
      `transly.history.v1:${accountOwner}`,
      `transly.history.v1:${userId}`,
      `transly.ai-keys.v2:${accountOwner}`,
      `transly.ai-keys.v2:${userId}`,
    ];

    for (const key of keysToRemove) {
      try {
        storage.removeItem(key);
      } catch {}
    }
  }

  // Check if account has dirty entries pending sync
  static hasPendingAccountChanges(owner: `account:${string}`): boolean {
    const cache = this.readHistory(owner);
    return cache.entries.some(e => e.dirty);
  }
}
