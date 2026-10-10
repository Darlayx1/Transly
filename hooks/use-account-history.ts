'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { accountClient, accountError } from '@/lib/transly/account';
import { sessionSchema, type PracticeSession } from '@/lib/transly/schema';
import { acknowledgeSave, emptyHistory, identifySession, mergeHistory, updateHistory, type HistoryCache, type HistoryEntry } from '@/lib/transly/history';
import { StorageLayer } from '@/lib/transly/storage-layer';
import { getStorageOwner, isAccountOwner, extractUserId, type StorageOwner } from '@/lib/transly/owner';
import { setAuthToken, setCredentialToken } from '@/lib/transly/transport';
import { api } from '@/components/transly/ui';

export function useAccountHistory() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [cache, setCache] = useState<HistoryCache>(emptyHistory);
  const [storageFailed, setStorageFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [revision, setRevision] = useState(0);
  const state = useRef(cache);
  const owner = useRef<StorageOwner>('guest');
  const generation = useRef(0);
  const running = useRef<number | null>(null);
  const blocked = useRef(false);
  const mounted = useRef(true);
  const abortController = useRef<AbortController | null>(null);

  const persist = useCallback((next: HistoryCache) => {
    state.current = next;
    setCache(next);
    try {
      StorageLayer.writeHistory(owner.current, next);
    } catch {
      setStorageFailed(true);
    }
  }, []);

  const sync = useCallback(async (reload = false) => {
    const client = accountClient();
    const token = generation.current;
    const currentOwner = owner.current;
    const userId = extractUserId(currentOwner);

    if (!client || !userId || !isAccountOwner(currentOwner) || running.current === token) return;
    if (blocked.current && !reload) return;

    running.current = token;
    setSyncing(true);
    setMessage('');
    const active = () => mounted.current && token === generation.current && owner.current === currentOwner;

    try {
      if (reload) {
        blocked.current = false;
        const remote: HistoryEntry[] = [];
        for (let offset = 0; ; offset += 100) {
          const { data, error } = await client
            .from('practice_sessions')
            .select('id,payload,version')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .order('id')
            .range(offset, offset + 99);

          if (!active()) return;
          if (error) throw error;
          for (const row of data || []) {
            const parsed = sessionSchema.safeParse(row.payload);
            if (parsed.success) {
              remote.push({ session: { ...parsed.data, id: row.id }, version: row.version, dirty: false });
            }
          }
          if (!data || data.length < 100) break;
        }
        if (!active()) return;
        persist(mergeHistory(state.current, remote));
      }

      for (const entry of state.current.entries.filter(e => e.dirty)) {
        if (!active()) return;
        const { data, error } = await client.rpc('save_practice_session', {
          session_id: entry.session.id,
          session_payload: entry.session,
          expected_version: entry.version,
          expected_owner: userId,
        });
        if (!active()) return;
        if (error) throw error;
        persist(acknowledgeSave(state.current, entry, Number(data)));
      }

      if (active()) {
        setMessage(state.current.entries.some(e => e.dirty) ? 'Perubahan terbaru menunggu sinkronisasi.' : 'Riwayat tersimpan di akun.');
        if (state.current.entries.some(e => e.dirty)) setRevision(value => value + 1);
      }
    } catch (error) {
      if (active()) {
        const errObj = error as { message?: string; code?: string; status?: number };
        const isAuthExpired = errObj.status === 401 || errObj.message?.toLowerCase().includes('jwt') || errObj.message?.toLowerCase().includes('token');
        blocked.current = true;
        if (isAuthExpired) {
          setMessage('Sesi login telah berakhir. Masuk kembali untuk melanjutkan sinkronisasi akun.');
        } else {
          setMessage(`${accountError(errObj as { message: string; code?: string })} Gunakan Sinkronkan untuk mencoba kembali.`);
        }
      }
    } finally {
      if (running.current === token) running.current = null;
      if (active()) setSyncing(false);
    }
  }, [persist]);

  useEffect(() => {
    mounted.current = true;
    const client = accountClient();
    let subscription: { unsubscribe: () => void } | undefined;
    let disposed = false;
    let initialized = false;
    let authRevision = 0;

    const selectOwner = (nextUser: User | null, authSession?: Session | null) => {
      if (disposed || !mounted.current) return;
      const nextOwner = getStorageOwner(nextUser?.id);
      const prevOwner = owner.current;

      setUser(nextUser);
      if (!nextUser) setRecoveryRequired(false);

      // If logging out or switching
      if (!initialized || prevOwner !== nextOwner) {
        initialized = true;
        abortController.current?.abort();
        abortController.current = new AbortController();
        generation.current++;
        running.current = null;
        blocked.current = false;
        setSyncing(false);
        setMessage('');
        setStorageFailed(false);

        // When logging out of an account, purge its device cache to prevent lingering on shared devices
        if (isAccountOwner(prevOwner)) {
          const prevId = extractUserId(prevOwner);
          if (prevId) StorageLayer.clearAccountCache(prevId);
          setAuthToken('');
          setCredentialToken('');
        }

        owner.current = nextOwner;

        if (nextUser && authSession?.access_token) {
          setAuthToken(authSession.access_token);
          setCredentialToken('');
        }

        let next = emptyHistory();
        try {
          next = StorageLayer.readHistory(nextOwner);
        } catch {
          setStorageFailed(true);
        }
        persist(next);
        setReady(true);

        if (nextUser) {
          void sync(true);
          const token = generation.current;
          void client?.rpc('record_login', { expected_owner: nextUser.id }).then(({ error }) => {
            if (error && mounted.current && token === generation.current) {
              setMessage('Riwayat masuk belum tercatat. Riwayat latihan tetap disinkronkan secara terpisah.');
            }
          });
        }
      } else {
        // Same owner, but token may have refreshed
        if (nextUser && authSession?.access_token) {
          setAuthToken(authSession.access_token);
        }
        setReady(true);
      }
    };

    if (!client) {
      selectOwner(null);
    } else {
      const initialAuthRevision = authRevision;
      subscription = client.auth.onAuthStateChange((event, authSession) => {
        const eventRevision = ++authRevision;
        queueMicrotask(() => {
          if (disposed || eventRevision !== authRevision) return;
          if (mounted.current && event === 'PASSWORD_RECOVERY') setRecoveryRequired(true);
          selectOwner(authSession?.user || null, authSession);
        });
      }).data.subscription;

      void client.auth.getSession().then(({ data, error }) => {
        if (disposed || !mounted.current || authRevision !== initialAuthRevision) return;
        if (error) {
          setMessage(accountError(error));
          selectOwner(null);
        } else {
          selectOwner(data.session?.user || null, data.session);
        }
      }).catch(() => {
        if (!disposed && authRevision === initialAuthRevision) {
          setMessage('Sesi akun belum dapat dimuat. Coba masuk kembali.');
          selectOwner(null);
        }
      });

      // Handle multi-tab authentication synchronization
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key?.includes('supabase.auth.token') || e.key === 'transly.auth_token.v1') {
          const requestRevision = ++authRevision;
          void client.auth.getSession().then(({ data }) => {
            if (!disposed && mounted.current && requestRevision === authRevision) selectOwner(data.session?.user || null, data.session);
          }).catch(() => { /* Keep the current owner when a cross-tab refresh fails. */ });
        }
      };
      window.addEventListener('storage', handleStorageChange);
      return () => {
        disposed = true;
        window.removeEventListener('storage', handleStorageChange);
        mounted.current = false;
        generation.current++;
        abortController.current?.abort();
        subscription?.unsubscribe();
      };
    }

    return () => {
      disposed = true;
      mounted.current = false;
      generation.current++;
      abortController.current?.abort();
      subscription?.unsubscribe();
    };
  // Auth events update user state; depending on that state would resubscribe
  // and trigger another INITIAL_SESSION event on every update.
  }, [persist, sync]);

  useEffect(() => {
    if (!ready || !user) return;
    const timer = setTimeout(() => void sync(), 1000);
    return () => clearTimeout(timer);
  }, [revision, ready, user, sync]);

  const setSession = useCallback((next: PracticeSession | null) => {
    if (!owner.current) return;
    persist(updateHistory(state.current, next ? identifySession(next) : null));
    if (isAccountOwner(owner.current)) {
      setMessage(blocked.current ? 'Draft tersimpan di perangkat. Gunakan Sinkronkan untuk mencoba kembali.' : 'Perubahan terbaru menunggu sinkronisasi.');
    }
    setRevision(value => value + 1);
  }, [persist]);

  const selectSession = useCallback((id: string) => {
    if (state.current.entries.some(e => e.session.id === id)) {
      persist({ ...state.current, activeId: id });
    }
  }, [persist]);

  // Import guest data to account with granular choices
  const importGuest = useCallback(async (options: { history?: boolean; config?: boolean; keys?: boolean } = { history: true }) => {
    if (!user) return;
    try {
      let importedHistory = 0;
      if (options.history !== false) {
        const guestHistory = StorageLayer.readHistory('guest');
        let next = state.current;
        for (const entry of guestHistory.entries) {
          if (!next.entries.some(saved => saved.session.id === entry.session.id)) {
            next = updateHistory(next, entry.session);
            importedHistory++;
          }
        }
        persist(next);
        setRevision(value => value + 1);
      }

      if (options.config) {
        const guestConfig = StorageLayer.readConfig('guest');
        StorageLayer.writeConfig(owner.current, guestConfig);
      }

      if (options.keys) {
        const guestVault = StorageLayer.readGuestVault();
        if (guestVault.keys.length > 0) {
          await api('/api/credentials', {
            action: 'import_keys',
            keys: guestVault.keys.map(k => ({ name: k.name, secret: k.secret, role: k.role, priority: k.priority })),
          });
        }
      }

      setMessage(`Data lokal berhasil disalin ke akun.`);
    } catch {
      setStorageFailed(true);
    }
  }, [persist, user]);

  return {
    user,
    ready,
    storageFailed,
    message,
    syncing,
    setMessage,
    setSession,
    selectSession,
    importGuest,
    recoveryRequired,
    finishRecovery: () => setRecoveryRequired(false),
    session: cache.entries.find(e => e.session.id === cache.activeId)?.session || null,
    entries: cache.entries,
    sync: () => sync(true),
  };
}
