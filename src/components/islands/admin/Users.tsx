// Accounts: directory with search and filters, per-person activity, and create one or several accounts.
import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Download, KeyRound, Search, Shield, ShieldCheck, UserCheck, UserPlus, UsersRound, UserX, X } from 'lucide-react';
import type { UserRow } from '../../../server/admin';
import { toast } from '../../../scripts/toast';
import { ago, api, bump, Credentials, fail, full, initials, plural, useConfirm, type Cred } from './kit';

export interface AdminUsersProps { users: UserRow[]; meId: number; now: number; filter?: string }
const DAY = 86_400_000;
const FILTERS = [['all', 'All'], ['admins', 'Admins'], ['members', 'Members'], ['awaiting', 'Awaiting first sign-in'], ['active', 'Active this week'], ['disabled', 'Disabled']] as const;
type Filter = (typeof FILTERS)[number][0];
const sortUsers = (a: UserRow, b: UserRow) => a.disabled - b.disabled || a.role.localeCompare(b.role) || a.username.localeCompare(b.username);

export default function AdminUsers({ users: initial, meId, now, filter: f0 }: AdminUsersProps) {
  const reduce = useReducedMotion();
  const [users, setUsers] = useState(initial);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>(FILTERS.some(([k]) => k === f0) ? (f0 as Filter) : 'all');
  const [busy, setBusy] = useState<number | null>(null);
  const [creds, setCreds] = useState<Cred[] | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [confirm, confirmDialog] = useConfirm();

  const match = (u: UserRow, k: Filter) => k === 'all' || (k === 'admins' ? u.role === 'admin' : k === 'members' ? u.role === 'member' : k === 'awaiting' ? !!u.mustChange && !u.disabled
    : k === 'active' ? !!u.lastSeen && u.lastSeen >= now - 7 * DAY : !!u.disabled);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, users.filter((u) => match(u, k)).length])), [users]);
  const needle = q.trim().toLowerCase();
  const shown = users.filter((u) => match(u, filter) && (!needle || u.username.includes(needle) || u.name.toLowerCase().includes(needle)));

  const pickFilter = (k: Filter) => {
    setFilter(k);
    const url = new URL(location.href);
    if (k === 'all') url.searchParams.delete('filter'); else url.searchParams.set('filter', k);
    history.replaceState(history.state, '', url);
  };
  const upsert = (rows: UserRow[]) => {
    setUsers((list) => [...list.filter((u) => !rows.some((r) => r.id === u.id)), ...rows].sort(sortUsers));
  };
  const added = (rows: UserRow[], c: Cred[]) => {
    upsert(rows);
    bump('users', rows.length);
    setFresh(new Set(rows.map((r) => r.id)));
    setQ(''); pickFilter('all');
    setCreds(c);
  };

  async function act(u: UserRow, action: 'reset' | 'role' | 'toggle') {
    if (action === 'reset' && !(await confirm({ title: `Reset @${u.username}'s password?`, body: 'They are signed out everywhere and get a new temporary password, shown to you once.', confirm: 'Reset password' }))) return;
    if (action === 'toggle' && !u.disabled && !(await confirm({ title: `Disable @${u.username}?`, body: 'They are signed out now and cannot sign in until you enable the account again. Their study data stays.', confirm: 'Disable account', danger: true }))) return;
    if (action === 'role' && u.id === meId && !(await confirm({ title: 'Give up your admin role?', body: 'You will lose access to this console straight away.', confirm: 'Make me a member', danger: true }))) return;
    setBusy(u.id);
    try {
      const r = await api<{ text: string; user?: UserRow; password?: string; username?: string }>(`/api/admin/users/${u.id}`, 'POST', { action });
      if (r.user) upsert([r.user]);
      if (action === 'toggle') bump('users', u.disabled ? 1 : -1);
      if (r.password) setCreds([{ username: u.username, name: u.name, password: r.password }]);
      else toast(r.text, 'ok');
      if (action === 'role' && u.id === meId) location.assign('/');
    } catch (e) { fail(e); } finally { setBusy(null); }
  }

  return (
    <div className="adm-users">
      <CreatePanel onAdded={added} />
      <section className="panel adm-dir" aria-labelledby="dir-h">
        <header className="adm-dir-h">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="adm-ico"><UsersRound size={18} aria-hidden="true" /></span>
            <div className="min-w-0"><h2 id="dir-h" className="font-medium">Directory</h2><p className="text-xs text-muted" aria-live="polite">Showing <span className="num">{shown.length}</span> of <span className="num">{users.length}</span></p></div>
          </div>
          <label className="adm-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search people</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or username" autoComplete="off" spellCheck={false} />
            {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search"><X size={14} aria-hidden="true" /></button>}
          </label>
          <a href="/api/admin/export/users.csv" className="btn btn-sm btn-ghost" download><Download size={15} aria-hidden="true" />CSV</a>
        </header>
        <div className="adm-chips" role="group" aria-label="Filter people">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => pickFilter(k)}>{label}<span className="num text-muted">{counts[k]}</span></button>
          ))}
        </div>
        <div className="urow urow-head" aria-hidden="true"><span>Person</span><span>Role</span><span>Activity</span><span>Last seen</span><span></span></div>
        <ul className="ulist" aria-label="People">
          <AnimatePresence initial={false}>
            {shown.map((u) => (
              <motion.li key={u.id} layout={reduce ? false : 'position'} initial={{ opacity: 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }} className={`urow${u.disabled ? ' is-off' : ''}${fresh.has(u.id) ? ' is-new' : ''}`} data-user={u.username}>
                <div className="u-who">
                  <span className={`u-av${u.role === 'admin' ? ' is-admin' : ''}`} aria-hidden="true">{initials(u.name)}</span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{u.name}{u.id === meId && <span className="font-normal text-faint"> · you</span>}</div>
                    <div className="num truncate text-xs text-muted">@{u.username}</div>
                  </div>
                </div>
                <div className="u-tags">
                  <span className={`badge ${u.role === 'admin' ? 's-edition' : 's-neutral'}`}>{u.role}</span>
                  {!!u.mustChange && !u.disabled && <span className="badge s-unchecked" title="Has not chosen a password yet">new</span>}
                  {!!u.disabled && <span className="badge s-disputed">disabled</span>}
                </div>
                <dl className="u-stats">
                  <div><dt>Reviews</dt><dd className="num">{u.reviews}</dd></div>
                  <div><dt>MCQs</dt><dd className="num">{u.answered}</dd></div>
                  <div><dt>Comments</dt><dd className="num">{u.comments}</dd></div>
                  <div><dt>Reports</dt><dd className="num">{u.reports}</dd></div>
                  <div><dt>AI today</dt><dd className="num">{u.aiToday}</dd></div>
                </dl>
                <div className="u-seen text-xs text-muted">{u.lastSeen ? <time dateTime={new Date(u.lastSeen).toISOString()} title={full(u.lastSeen)}>{ago(u.lastSeen, now)}</time> : <span className="text-faint">Never signed in</span>}</div>
                <div className="u-act">
                  <button type="button" className="btn btn-sm btn-ghost !px-2" disabled={busy === u.id} onClick={() => act(u, 'reset')} aria-label={`Reset password for @${u.username}`} title="Reset password"><KeyRound size={15} aria-hidden="true" /></button>
                  <button type="button" className="btn btn-sm btn-ghost !px-2" disabled={busy === u.id} onClick={() => act(u, 'role')} aria-label={u.role === 'admin' ? `Make @${u.username} a member` : `Make @${u.username} an admin`} title={u.role === 'admin' ? 'Make member' : 'Make admin'}>
                    {u.role === 'admin' ? <ShieldCheck size={15} aria-hidden="true" /> : <Shield size={15} aria-hidden="true" />}
                  </button>
                  {u.id !== meId && (
                    <button type="button" className={`btn btn-sm btn-ghost !px-2${u.disabled ? ' text-ok' : ''}`} disabled={busy === u.id} onClick={() => act(u, 'toggle')} aria-label={`${u.disabled ? 'Enable' : 'Disable'} @${u.username}`} title={u.disabled ? 'Enable' : 'Disable'}>
                      {u.disabled ? <UserCheck size={15} aria-hidden="true" /> : <UserX size={15} aria-hidden="true" />}
                    </button>
                  )}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {!shown.length && (
          <div className="adm-none"><Search size={18} aria-hidden="true" /><p>No one matches{q ? <> “<span className="text-ink">{q}</span>”</> : ' this filter'}.</p><button type="button" className="btn btn-sm" onClick={() => { setQ(''); pickFilter('all'); }}>Show everyone</button></div>
        )}
      </section>
      <Credentials rows={creds} onClose={() => setCreds(null)} />
      {confirmDialog}
    </div>
  );
}

function CreatePanel({ onAdded }: { onAdded: (rows: UserRow[], creds: Cred[]) => void }) {
  const [mode, setMode] = useState<'one' | 'bulk'>('one');
  const [busy, setBusy] = useState(false);
  const [one, setOne] = useState({ username: '', displayName: '', role: 'member' });
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<{ line: number; raw: string; error: string }[]>([]);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).length;

  async function createOne(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ user: UserRow; password: string }>('/api/admin/users', 'POST', one);
      onAdded([r.user], [{ username: r.user.username, name: r.user.name, password: r.password }]);
      setOne({ username: '', displayName: '', role: 'member' });
    } catch (err) { fail(err); } finally { setBusy(false); }
  }
  async function createMany(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const r = await api<{ created: Cred[]; users: UserRow[] }>('/api/admin/users/bulk', 'POST', { text });
      onAdded(r.users, r.created);
      setText('');
    } catch (err) {
      const lines = (err as { data?: { lines?: { line: number; raw: string; error: string }[] } }).data?.lines;
      if (lines?.length) setErrors(lines);
      fail(err);
    } finally { setBusy(false); }
  }

  return (
    <section className="panel adm-create" aria-labelledby="create-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="adm-ico"><UserPlus size={18} aria-hidden="true" /></span>
          <div className="min-w-0"><h2 id="create-h" className="font-medium">Add classmates</h2><p className="text-xs text-muted">Each gets a temporary password, shown to you once.</p></div>
        </div>
        <div className="seg" role="radiogroup" aria-label="How many">
          <button type="button" role="radio" aria-checked={mode === 'one'} onClick={() => setMode('one')}>One</button>
          <button type="button" role="radio" aria-checked={mode === 'bulk'} onClick={() => setMode('bulk')}>Several</button>
        </div>
      </div>
      {mode === 'one' ? (
        <form className="adm-one" onSubmit={createOne}>
          <label>Username
            <input className="field num" name="username" required pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,31}" autoCapitalize="none" spellCheck={false} autoComplete="off" placeholder="ayesha.amjad"
              value={one.username} onChange={(e) => setOne({ ...one, username: e.target.value })} />
          </label>
          <label>Display name
            <input className="field" name="displayName" maxLength={60} autoComplete="off" placeholder="Dr Ayesha Amjad" value={one.displayName} onChange={(e) => setOne({ ...one, displayName: e.target.value })} />
          </label>
          <label>Role
            <select className="field" name="role" value={one.role} onChange={(e) => setOne({ ...one, role: e.target.value })}><option value="member">Member</option><option value="admin">Admin</option></select>
          </label>
          <button className="btn btn-primary justify-center" disabled={busy}><UserPlus size={16} aria-hidden="true" />{busy ? 'Creating…' : 'Create account'}</button>
        </form>
      ) : (
        <form className="adm-many" onSubmit={createMany}>
          <div className="min-w-0">
            <label className="block text-sm font-medium" htmlFor="bulk-text">One per line: <span className="num font-normal text-muted">username, Display Name</span></label>
            <textarea id="bulk-text" className="lb-ta num adm-bulk mt-1.5" rows={6} required maxLength={20000} spellCheck={false} autoCapitalize="none" value={text}
              onChange={(e) => { setText(e.target.value); setErrors([]); }} placeholder={'ayesha.amjad, Dr Ayesha Amjad\nbilal.k, Dr Bilal Khan\nsana.r, Dr Sana Rauf'} aria-describedby="bulk-help" aria-invalid={errors.length > 0} />
            {errors.length > 0 && (
              <ul className="adm-errs mt-2" role="alert" aria-label="Lines to fix">
                {errors.map((x) => <li key={x.line}><span className="num text-faint">Line {x.line}</span><span className="min-w-0"><code className="num">{x.raw}</code><span className="block text-bad">{x.error}</span></span></li>)}
              </ul>
            )}
          </div>
          <div className="adm-many-side">
            <p id="bulk-help" className="text-xs text-muted">All join as members, up to 50 at a time. Every line is checked first; nothing is created until all of them pass.</p>
            <p className="num text-2xl font-medium" aria-live="polite">{lines}<span className="ml-1.5 font-sans text-sm font-normal text-muted">{lines === 1 ? 'account' : 'accounts'}</span></p>
            <button className="btn btn-primary w-full justify-center" disabled={busy || !lines}><UsersRound size={16} aria-hidden="true" />{busy ? 'Creating…' : lines ? `Create ${plural(lines, 'account')}` : 'Create accounts'}</button>
          </div>
        </form>
      )}
    </section>
  );
}
