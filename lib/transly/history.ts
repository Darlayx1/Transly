import { sessionSchema, type PracticeSession } from './schema';

export type HistoryEntry = { session: PracticeSession & { id: string }; version: number; dirty: boolean };
export type HistoryCache = { activeId: string | null; entries: HistoryEntry[] };
export const historyKey = (owner: string) => `transly.history.v1:${owner}`;
export const emptyHistory = (): HistoryCache => ({ activeId: null, entries: [] });

export function identifySession(session: PracticeSession): PracticeSession & { id: string } {
  return { ...session, id: session.id || crypto.randomUUID() };
}

export function readHistory(storage: Pick<Storage, 'getItem'>, owner: string): HistoryCache {
  const raw = storage.getItem(historyKey(owner));
  if (!raw) {
    // Legacy data belongs to the guest, never silently to whichever account signs in.
    if (owner !== 'guest') return emptyHistory();
    const old = storage.getItem('transly.session.v1');
    if (!old) return emptyHistory();
    const parsed = sessionSchema.safeParse(JSON.parse(old));
    if (!parsed.success) return emptyHistory();
    const session = identifySession(parsed.data);
    return { activeId: session.id, entries: [{ session, version: 0, dirty: true }] };
  }
  const cache = JSON.parse(raw) as HistoryCache;
  if (!cache || !Array.isArray(cache.entries)) throw new Error('Invalid history cache');
  const entries = cache.entries.flatMap(entry => {
    const parsed = sessionSchema.safeParse(entry.session);
    if (!parsed.success || !parsed.data.id || !Number.isSafeInteger(entry.version) || entry.version < 0) return [];
    return [{ session: { ...parsed.data, id: parsed.data.id }, version: entry.version, dirty: Boolean(entry.dirty) }];
  });
  return { entries, activeId: entries.some(e => e.session.id === cache.activeId) ? cache.activeId : null };
}

export function updateHistory(cache: HistoryCache, session: PracticeSession | null): HistoryCache {
  if (!session) return { ...cache, activeId: null };
  const identified = identifySession(session);
  const previous = cache.entries.find(e => e.session.id === identified.id);
  return {
    activeId: identified.id,
    entries: [{ session: identified, version: previous?.version || 0, dirty: true }, ...cache.entries.filter(e => e.session.id !== identified.id)],
  };
}

export function mergeHistory(local: HistoryCache, remote: HistoryEntry[]): HistoryCache {
  const merged = new Map(remote.map(entry => [entry.session.id, entry]));
  let activeId = local.activeId;
  for (const entry of local.entries) {
    const cloud = merged.get(entry.session.id);
    if (entry.dirty && cloud && entry.version !== cloud.version) {
      if (JSON.stringify(entry.session) === JSON.stringify(cloud.session)) continue;
      // Explicit reload keeps both versions; the local draft becomes a separate session.
      const copy = { ...entry.session, id: crypto.randomUUID() };
      merged.set(copy.id, { session: copy, version: 0, dirty: true });
      if (activeId === entry.session.id) activeId = copy.id;
    } else if (entry.dirty || !cloud) merged.set(entry.session.id, entry);
  }
  const entries = [...merged.values()].sort((a, b) => b.session.startedAt - a.session.startedAt);
  return { entries, activeId: activeId || entries[0]?.session.id || null };
}

export function acknowledgeSave(cache: HistoryCache, sent: HistoryEntry, version: number): HistoryCache {
  return { ...cache, entries: cache.entries.map(entry => entry.session.id === sent.session.id
    ? { ...entry, version, dirty: JSON.stringify(entry.session) !== JSON.stringify(sent.session) }
    : entry) };
}
