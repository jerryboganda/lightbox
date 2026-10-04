import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     display_name TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
     must_change INTEGER NOT NULL DEFAULT 1,
     disabled INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     last_seen_at INTEGER
   );
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     user_agent TEXT
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE mcq_attempts (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     qid TEXT NOT NULL,
     choice TEXT NOT NULL,
     correct INTEGER,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX mcq_user ON mcq_attempts(user_id, qid);
   CREATE TABLE srs_cards (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     fact_id TEXT NOT NULL,
     card TEXT NOT NULL,
     due INTEGER NOT NULL,
     introduced INTEGER NOT NULL,
     PRIMARY KEY (user_id, fact_id)
   );
   CREATE INDEX srs_due ON srs_cards(user_id, due);
   CREATE TABLE srs_log (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     fact_id TEXT NOT NULL,
     rating INTEGER NOT NULL,
     reviewed_at INTEGER NOT NULL,
     client_id TEXT UNIQUE
   );
   CREATE INDEX srs_log_user ON srs_log(user_id, reviewed_at);
   CREATE TABLE visits (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     ref TEXT NOT NULL,
     title TEXT NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (user_id, kind, ref)
   );
   CREATE TABLE announcements (
     id INTEGER PRIMARY KEY,
     body TEXT NOT NULL,
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL,
     active INTEGER NOT NULL DEFAULT 1
   );
   CREATE TABLE audit_log (
     id INTEGER PRIMARY KEY,
     actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     action TEXT NOT NULL,
     target TEXT,
     at INTEGER NOT NULL
   );`,
];

function open() {
  const file = process.env.DB_PATH || path.resolve('data/lightbox.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  const v = db.pragma('user_version', { simple: true }) as number;
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.transaction(() => { db.exec(MIGRATIONS[i]); db.pragma(`user_version = ${i + 1}`); })();
  }
  return db;
}

// One connection per process (dev HMR re-imports modules).
const g = globalThis as unknown as { __lbdb?: Database.Database };
export const db = (g.__lbdb ??= open());
export const now = () => Date.now();
export const audit = (actorId: number | null, action: string, target = '') =>
  db.prepare('INSERT INTO audit_log (actor_id, action, target, at) VALUES (?, ?, ?, ?)').run(actorId, action, target, now());
