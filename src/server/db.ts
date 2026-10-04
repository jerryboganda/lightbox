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
  // v2: personal layer, study rhythm, exams. item_type is one of fact | topic | mcq | image | card.
  `CREATE TABLE marks (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     item_type TEXT NOT NULL,
     item_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('bookmark','weak')),
     created_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, item_type, item_id, kind)
   );
   CREATE TABLE collections (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     shared INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX collections_user ON collections(user_id);
   CREATE TABLE collection_items (
     collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
     item_type TEXT NOT NULL,
     item_id TEXT NOT NULL,
     position INTEGER NOT NULL DEFAULT 0,
     added_at INTEGER NOT NULL,
     PRIMARY KEY (collection_id, item_type, item_id)
   );
   CREATE TABLE notes (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     item_type TEXT NOT NULL,
     item_id TEXT NOT NULL,
     body TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     UNIQUE (user_id, item_type, item_id)
   );
   CREATE TABLE highlights (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     path TEXT NOT NULL,
     quote TEXT NOT NULL,
     prefix TEXT NOT NULL DEFAULT '',
     suffix TEXT NOT NULL DEFAULT '',
     color TEXT NOT NULL DEFAULT 'amber',
     note TEXT NOT NULL DEFAULT '',
     fact_id TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX highlights_user_path ON highlights(user_id, path);
   CREATE TABLE user_cards (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     front TEXT NOT NULL,
     back TEXT NOT NULL,
     fact_id TEXT,
     path TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE goals (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     cards INTEGER NOT NULL DEFAULT 30,
     mcqs INTEGER NOT NULL DEFAULT 20,
     minutes INTEGER NOT NULL DEFAULT 60,
     exam_date TEXT,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE study_sessions (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('focus','break')),
     started_at INTEGER NOT NULL,
     seconds INTEGER NOT NULL,
     client_id TEXT UNIQUE
   );
   CREATE INDEX study_sessions_user ON study_sessions(user_id, started_at);
   CREATE TABLE exams (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     mode TEXT NOT NULL CHECK (mode IN ('quiz','exam','toacs')),
     title TEXT NOT NULL,
     config TEXT NOT NULL,
     items TEXT NOT NULL,
     time_limit INTEGER,
     started_at INTEGER NOT NULL,
     finished_at INTEGER,
     score INTEGER,
     total INTEGER
   );
   CREATE INDEX exams_user ON exams(user_id, started_at);
   CREATE TABLE exam_answers (
     exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
     item_id TEXT NOT NULL,
     choice TEXT,
     correct INTEGER,
     flagged INTEGER NOT NULL DEFAULT 0,
     ms INTEGER NOT NULL DEFAULT 0,
     answered_at INTEGER,
     PRIMARY KEY (exam_id, item_id)
   );
   ALTER TABLE mcq_attempts ADD COLUMN ms INTEGER;
   ALTER TABLE mcq_attempts ADD COLUMN source TEXT NOT NULL DEFAULT 'bank';`,
  // v3: class (comments, votes, reports, polls, notifications) and AI. Comment item_type adds 'dispute'; vote item_type adds 'comment'.
  `CREATE TABLE comments (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     item_type TEXT NOT NULL,
     item_id TEXT NOT NULL,
     parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
     body TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     edited_at INTEGER,
     deleted INTEGER NOT NULL DEFAULT 0,
     hidden INTEGER NOT NULL DEFAULT 0,
     hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     hidden_reason TEXT NOT NULL DEFAULT ''
   );
   CREATE INDEX comments_item ON comments(item_type, item_id, created_at);
   CREATE INDEX comments_user ON comments(user_id, created_at);
   CREATE TABLE votes (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     item_type TEXT NOT NULL,
     item_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, item_type, item_id)
   );
   CREATE INDEX votes_item ON votes(item_type, item_id);
   CREATE TABLE reports (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     item_type TEXT NOT NULL,
     item_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('wrong','source','typo','unclear','duplicate','offensive','other')),
     body TEXT NOT NULL DEFAULT '',
     quote TEXT NOT NULL DEFAULT '',
     path TEXT,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected','fixed')),
     resolution TEXT NOT NULL DEFAULT '',
     resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     resolved_at INTEGER,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX reports_status ON reports(status, created_at);
   CREATE TABLE notifications (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL DEFAULT '',
     href TEXT,
     created_at INTEGER NOT NULL,
     read_at INTEGER
   );
   CREATE INDEX notifications_user ON notifications(user_id, read_at, created_at);
   CREATE TABLE polls (
     id INTEGER PRIMARY KEY,
     item_type TEXT NOT NULL DEFAULT 'custom' CHECK (item_type IN ('mcq','custom')),
     item_id TEXT,
     question TEXT NOT NULL,
     options TEXT NOT NULL,
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL,
     closes_at INTEGER,
     closed INTEGER NOT NULL DEFAULT 0,
     UNIQUE (item_type, item_id)
   );
   CREATE TABLE poll_votes (
     poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     choice TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (poll_id, user_id)
   );
   CREATE TABLE ai_cache (
     key TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     model TEXT NOT NULL,
     body TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     hits INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE ai_usage (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     day TEXT NOT NULL,
     n INTEGER NOT NULL DEFAULT 0,
     tokens INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day)
   );
   CREATE TABLE ai_chats (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     context TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX ai_chats_user ON ai_chats(user_id, updated_at);
   CREATE TABLE ai_messages (
     id INTEGER PRIMARY KEY,
     chat_id INTEGER NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('user','assistant')),
     content TEXT NOT NULL,
     cites TEXT NOT NULL DEFAULT '[]',
     created_at INTEGER NOT NULL
   );
   CREATE INDEX ai_messages_chat ON ai_messages(chat_id, id);
   CREATE TABLE ai_mcqs (
     id INTEGER PRIMARY KEY,
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     topic_slug TEXT,
     fact_ids TEXT NOT NULL,
     stem TEXT NOT NULL,
     options TEXT NOT NULL,
     key TEXT NOT NULL,
     explanation TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
     reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     reviewed_at INTEGER,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX ai_mcqs_status ON ai_mcqs(status, created_at);`,
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
