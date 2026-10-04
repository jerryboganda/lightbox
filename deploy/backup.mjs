// Nightly SQLite backup at 03:00 Pakistan time; keeps KEEP_DAYS days. Runs forever in its own container.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB = process.env.DB_PATH || '/data/lightbox.db';
const DIR = process.env.BACKUP_DIR || '/backups';
const KEEP = Number(process.env.KEEP_DAYS || 14) * 86_400_000;
const TZ = 5 * 3_600_000;

async function backupOnce() {
  if (!fs.existsSync(DB)) return console.log('no database yet');
  const stamp = new Date(Date.now() + TZ).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const dest = path.join(DIR, `lightbox-${stamp}.db`);
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  await db.backup(dest);
  db.close();
  for (const f of fs.readdirSync(DIR)) {
    const p = path.join(DIR, f);
    if (f.startsWith('lightbox-') && Date.now() - fs.statSync(p).mtimeMs > KEEP) fs.rmSync(p);
  }
  console.log('backup written', dest);
}

const untilThree = () => {
  const local = Date.now() + TZ, day = 86_400_000;
  const next = Math.floor(local / day) * day + 3 * 3_600_000;
  return (next > local ? next : next + day) - local;
};

if (process.argv.includes('--once')) await backupOnce();
else for (;;) { await new Promise((r) => setTimeout(r, untilThree())); await backupOnce().catch((e) => console.error('backup failed', e)); }
