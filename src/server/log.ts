import { db, now } from './db';

// Structured logs: one JSON line per event on stdout/stderr (picked up by `docker logs` / journald), warnings and
// errors also kept in a small SQLite ring buffer for the admin Health tab. Request timings are aggregated in memory.
export type Level = 'info' | 'warn' | 'error';
export interface LogFields { route?: string; status?: number; ms?: number; message?: string; userId?: number | null }
export const LOG = { keep: 2000, slowMs: 1500, maxMessage: 1000 };
const RANK: Record<Level, number> = { info: 0, warn: 1, error: 2 };
const threshold = (): Level => { const l = (process.env.LOG_LEVEL ?? '').trim().toLowerCase(); return l === 'info' || l === 'error' ? l : 'warn'; };

let writes = 0;
export function log(level: Level, kind: string, f: LogFields = {}) {
  const message = (f.message ?? '').slice(0, LOG.maxMessage);
  if (RANK[level] >= RANK[threshold()]) {
    const line = JSON.stringify({ t: new Date().toISOString(), level, kind, ...f, message: message || undefined });
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  }
  if (level === 'info') return;
  try {
    db.prepare('INSERT INTO app_log (level, kind, route, status, ms, message, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(level, kind.slice(0, 40), (f.route ?? '').slice(0, 200), f.status ?? null, f.ms === undefined ? null : Math.round(f.ms), message, f.userId ?? null, now());
    if (++writes % 100 === 0) db.prepare('DELETE FROM app_log WHERE id <= (SELECT MAX(id) FROM app_log) - ?').run(LOG.keep);
  } catch { /* logging must never break a request */ }
}

export const errorText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}${e.stack ? `\n${e.stack.split('\n').slice(1, 6).join('\n')}` : ''}` : String(e));

// ---- request timings (since the process started) ----
interface RouteStat { n: number; errors: number; slow: number; total: number; max: number }
const routes = new Map<string, RouteStat>();
const started = now();
/** Records one request; logs 5xx as errors and slow requests as warnings. */
export function observe(route: string, method: string, status: number, ms: number, userId: number | null) {
  const key = `${method} ${route}`;
  const s = routes.get(key) ?? { n: 0, errors: 0, slow: 0, total: 0, max: 0 };
  s.n++; s.total += ms; s.max = Math.max(s.max, ms);
  if (status >= 500) s.errors++;
  if (ms >= LOG.slowMs) s.slow++;
  if (routes.size < 500 || routes.has(key)) routes.set(key, s);
  if (status >= 500) log('error', 'http', { route: key, status, ms, userId });
  else if (ms >= LOG.slowMs) log('warn', 'slow', { route: key, status, ms, userId });
  else log('info', 'http', { route: key, status, ms, userId });
}

// ---- client error beacon: a few per user per minute ----
const beacons = new Map<number, { at: number; n: number }>();
export function clientError(userId: number, body: unknown) {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!message) return false;
  const t = now(), r = beacons.get(userId);
  if (r && t - r.at < 60_000) { if (++r.n > 10) return false; } else beacons.set(userId, { at: t, n: 1 });
  const where = typeof b.url === 'string' ? b.url.slice(0, 200) : '';
  const stack = typeof b.stack === 'string' ? `\n${b.stack.slice(0, 600)}` : '';
  log('warn', 'client', { route: where, message: message.slice(0, 300) + stack, userId });
  return true;
}

// ---- admin Health tab ----
export function health() {
  const day = now() - 86_400_000;
  const counts = db.prepare('SELECT level, kind, COUNT(*) n FROM app_log WHERE at >= ? GROUP BY level, kind ORDER BY n DESC').all(day) as { level: Level; kind: string; n: number }[];
  const recent = db.prepare('SELECT id, level, kind, route, status, ms, message, user_id userId, at FROM app_log ORDER BY id DESC LIMIT 50').all() as
    { id: number; level: Level; kind: string; route: string; status: number | null; ms: number | null; message: string; userId: number | null; at: number }[];
  const list = [...routes.entries()].map(([route, s]) => ({ route, n: s.n, errors: s.errors, slow: s.slow, avg: Math.round(s.total / s.n), max: Math.round(s.max) }));
  const mem = process.memoryUsage();
  let dbBytes = 0;
  try { dbBytes = (db.pragma('page_count', { simple: true }) as number) * (db.pragma('page_size', { simple: true }) as number); } catch {}
  return {
    uptime: now() - started,
    memory: { rss: mem.rss, heap: mem.heapUsed },
    dbBytes,
    node: process.version,
    counts,
    recent,
    slowest: [...list].sort((a, b) => b.avg - a.avg).slice(0, 10),
    busiest: [...list].sort((a, b) => b.n - a.n).slice(0, 10),
    failing: list.filter((r) => r.errors > 0).sort((a, b) => b.errors - a.errors).slice(0, 10),
  };
}

/** Tests only. */
export const resetStats = () => { routes.clear(); beacons.clear(); };
