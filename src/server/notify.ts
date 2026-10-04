import { db, now } from './db';

export interface Note { kind: string; title: string; body?: string; href?: string }

// In-app notifications. 'admins' / 'all' fan out to active accounts; `except` skips the actor.
export function notify(to: number | number[] | 'admins' | 'all', n: Note, except?: number) {
  const ids = typeof to === 'number' ? [to]
    : Array.isArray(to) ? to
    : (db.prepare(`SELECT id FROM users WHERE disabled = 0${to === 'admins' ? " AND role = 'admin'" : ''}`).all() as { id: number }[]).map((r) => r.id);
  const ins = db.prepare('INSERT INTO notifications (user_id, kind, title, body, href, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const t = now();
  db.transaction(() => {
    for (const id of new Set(ids)) if (id !== except) ins.run(id, n.kind.slice(0, 40), n.title.slice(0, 200), (n.body ?? '').slice(0, 500), n.href ?? null, t);
  })();
}
