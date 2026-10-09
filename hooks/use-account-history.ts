'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { accountClient, accountError } from '@/lib/transly/account';
import { sessionSchema, type PracticeSession } from '@/lib/transly/schema';
import { acknowledgeSave, emptyHistory, historyKey, identifySession, mergeHistory, readHistory, updateHistory, type HistoryCache, type HistoryEntry } from '@/lib/transly/history';

export function useAccountHistory() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [cache, setCache] = useState<HistoryCache>(emptyHistory);
  const [storageFailed, setStorageFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [revision, setRevision] = useState(0);
  const state = useRef(cache);
  const owner = useRef('');
  const generation = useRef(0);
  const running = useRef<number | null>(null);
  const blocked = useRef(false);
  const mounted = useRef(true);

  const persist = useCallback((next: HistoryCache) => {
    state.current = next;
    setCache(next);
    try { localStorage.setItem(historyKey(owner.current), JSON.stringify(next)); }
    catch { setStorageFailed(true); }
  }, []);

  const sync = useCallback(async (reload = false) => {
    const client = accountClient();
    const token = generation.current;
    const userId = owner.current;
    if (!client || !userId || userId === 'guest' || running.current === token) return;
    if (blocked.current && !reload) return;
    running.current = token;
    setSyncing(true);
    setMessage('');
    const active = () => mounted.current && token === generation.current;
    try {
      if (reload) {
        blocked.current = false;
        // Paginate so existing sessions are not lost behind an arbitrary display limit.
        const remote: HistoryEntry[] = [];
        for (let offset = 0; ; offset += 100) {
          const { data, error } = await client.from('practice_sessions').select('id,payload,version').eq('user_id', userId).order('created_at', { ascending: false }).order('id').range(offset, offset + 99);
          if (!active()) return;
          if (error) throw error;
          for (const row of data || []) {
            const parsed = sessionSchema.safeParse(row.payload);
            if (parsed.success) remote.push({ session: { ...parsed.data, id: row.id }, version: row.version, dirty: false });
          }
          if (!data || data.length < 100) break;
        }
        persist(mergeHistory(state.current, remote));
      }
      for (const entry of state.current.entries.filter(e => e.dirty)) {
        if (!active()) return;
        const { data, error } = await client.rpc('save_practice_session', { session_id: entry.session.id, session_payload: entry.session, expected_version: entry.version, expected_owner: userId });
        if (!active()) return;
        if (error) throw error;
        persist(acknowledgeSave(state.current, entry, Number(data)));
      }
      if (active()) {
        setMessage(state.current.entries.some(e => e.dirty) ? 'Perubahan terbaru menunggu sinkronisasi.' : 'Riwayat tersimpan di akun.');
        // Edits made during an in-flight save get their own debounced pass.
        if (state.current.entries.some(e => e.dirty)) setRevision(value => value + 1);
      }
    } catch (error) {
      if (active()) {
        blocked.current = true;
        setMessage(`${accountError(error as { message: string; code?: string })} Gunakan Sinkronkan untuk mencoba kembali.`);
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
    const selectOwner = (nextUser: User | null) => {
      if (!mounted.current) return;
      const nextOwner = nextUser?.id || 'guest';
      setUser(nextUser);
      if (owner.current === nextOwner) return;
      generation.current++;
      owner.current = nextOwner;
      blocked.current = false;
      setSyncing(false);
      setMessage('');
      setStorageFailed(false);
      let next = emptyHistory();
      try { next = readHistory(localStorage, nextOwner); }
      catch { setStorageFailed(true); }
      persist(next);
      setReady(true);
      if (nextUser) {
        void sync(true);
        const token = generation.current;
        void client?.rpc('record_login', { expected_owner: nextOwner }).then(({ error }) => {
          if (error && mounted.current && token === generation.current) setMessage('Riwayat masuk belum tercatat. Riwayat latihan tetap disinkronkan secara terpisah.');
        });
      }
    };
    if (!client) selectOwner(null);
    else {
      subscription = client.auth.onAuthStateChange((_event, session) => {
        // Do not invoke auth/database methods inside the SDK's auth callback lock.
        queueMicrotask(() => selectOwner(session?.user || null));
      }).data.subscription;
      void client.auth.getSession().then(({ data, error }) => {
        if (!mounted.current || owner.current) return;
        if (error) { setMessage(accountError(error)); selectOwner(null); }
        else selectOwner(data.session?.user || null);
      }).catch(() => { if (!owner.current) selectOwner(null); });
    }
    return () => { mounted.current = false; generation.current++; subscription?.unsubscribe(); };
  }, [persist, sync]);

  useEffect(() => {
    if (!ready || !user) return;
    const timer = setTimeout(() => void sync(), 1000);
    return () => clearTimeout(timer);
  }, [revision, ready, user, sync]);

  const setSession = useCallback((next: PracticeSession | null) => {
    if (!owner.current) return;
    persist(updateHistory(state.current, next ? identifySession(next) : null));
    if (owner.current !== 'guest') setMessage(blocked.current ? 'Draft tersimpan di perangkat. Gunakan Sinkronkan untuk mencoba kembali.' : 'Perubahan terbaru menunggu sinkronisasi.');
    setRevision(value => value + 1);
  }, [persist]);
  const selectSession = useCallback((id: string) => {
    if (state.current.entries.some(e => e.session.id === id)) persist({ ...state.current, activeId: id });
  }, [persist]);
  const importGuest = useCallback(() => {
    if (!user) return;
    try {
      const guest = readHistory(localStorage, 'guest');
      let next = state.current;
      for (const entry of guest.entries) {
        if (!next.entries.some(saved => saved.session.id === entry.session.id)) next = updateHistory(next, entry.session);
      }
      persist(next);
      setRevision(value => value + 1);
      setMessage(`${guest.entries.length} sesi perangkat ditambahkan ke akun.`);
    } catch { setStorageFailed(true); }
  }, [persist, user]);

  return {
    user, ready, storageFailed, message, syncing, setMessage, setSession, selectSession, importGuest,
    session: cache.entries.find(e => e.session.id === cache.activeId)?.session || null,
    entries: cache.entries,
    sync: () => sync(true),
  };
}
