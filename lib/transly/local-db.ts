// Portable development only; production uses the platform D1 binding.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
let database: D1Database | undefined;
export function localDatabase(): D1Database {
  if (database) return database;
  mkdirSync('.sites-runtime', { recursive: true });
  const sqlite = new DatabaseSync(resolve('.sites-runtime/vault.sqlite'));
  sqlite.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) {
    if (sqlite.prepare('SELECT name FROM local_migrations WHERE name = ?').get(tag)) continue;
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(readFileSync(`drizzle/${tag}.sql`, 'utf8'));
      sqlite.prepare('INSERT INTO local_migrations VALUES (?)').run(tag);
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
  function prepare(sql: string, values: (string | number | null)[] = []) {
    const execute = () => {
      const statement = sqlite.prepare(sql);
      const returnsRows = statement.columns().length > 0;
      const rows = returnsRows ? statement.all(...values) : [];
      const result = returnsRows ? { changes: Number(sqlite.prepare('SELECT changes() n').get()?.n || 0) } : statement.run(...values);
      return { success: true, results: rows, meta: { changes: Number(result.changes) } };
    };
    return {
      bind: (...bindings: (string | number | null)[]) => prepare(sql, bindings),
      first: async (column?: string) => { const row = sqlite.prepare(sql).get(...values); return row ? column ? row[column] : row : null; },
      all: async () => execute(), run: async () => execute(),
      _execute: execute,
    };
  }
  database = { prepare, batch: async (statements: { _execute: () => unknown }[]) => {
    sqlite.exec('BEGIN');
    try { const results = statements.map(statement => statement._execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  return database;
}
