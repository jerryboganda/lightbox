import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import { hash } from '@node-rs/argon2';
import fs from 'node:fs';

// Admin console. Runs once per project against one database: every test seeds its own rows (directly in the
// e2e database, since the class and AI packages own the member-side writers) and afterAll removes them.
const facts = JSON.parse(fs.readFileSync('src/data/facts.json', 'utf8')) as { id: string; fact: string }[];
const sql = () => { const d = new Database('data/e2e.db'); d.pragma('busy_timeout = 5000'); return d; };
const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const made = { users: [] as string[], polls: [] as number[], comments: [] as number[], reports: [] as number[], ai: [] as number[] };
const hydrated = (page: Page, name: string) =>
  page.waitForFunction((n) => [...document.querySelectorAll('astro-island')].some((i) => i.getAttribute('component-url')?.includes(n) && !i.hasAttribute('ssr')), name);
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
const now = () => Date.now();

function member(name = 'Dr Seed Member', password_hash = 'x', mustChange = 1) {
  const username = `m${tag()}`, d = sql();
  const id = Number(d.prepare("INSERT INTO users (username, display_name, password_hash, role, must_change, created_at) VALUES (?, ?, ?, 'member', ?, ?)").run(username, name, password_hash, mustChange, now()).lastInsertRowid);
  d.close();
  made.users.push(username);
  return { id, username };
}
const one = <T>(q: string, ...a: unknown[]) => { const d = sql(); try { return d.prepare(q).get(...a) as T; } finally { d.close(); } };
const run = (q: string, ...a: unknown[]) => { const d = sql(); try { return Number(d.prepare(q).run(...a).lastInsertRowid); } finally { d.close(); } };

test.afterAll(() => {
  const d = sql();
  const del = (table: string, ids: number[]) => ids.length && d.prepare(`DELETE FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`).run(JSON.stringify(ids));
  del('polls', made.polls); del('comments', made.comments); del('reports', made.reports); del('ai_mcqs', made.ai);
  d.prepare('DELETE FROM users WHERE username IN (SELECT value FROM json_each(?))').run(JSON.stringify(made.users));
  d.close();
});

test('every console section renders, keeps its place in the tabs and fits the screen', async ({ page }) => {
  const tabs: [string, RegExp][] = [['overview', /what is waiting for you/], ['users', /Issue accounts/], ['moderation', /Act on reports/], ['polls', /Ask the class a question/],
    ['ai', /AI-drafted questions/], ['announcements', /Short notices/], ['audit', /Every admin and moderation action/]];
  for (const [t, blurb] of tabs) {
    await page.goto(`/admin?tab=${t}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
    await expect(page.locator('main').getByText(blurb)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Admin sections' }).locator('[aria-current="page"]')).toHaveCount(1);
    await noHorizontalScroll(page);
  }
  await page.goto('/admin');
  await expect(page.getByRole('list', { name: 'Key numbers' }).getByRole('link')).toHaveCount(6);
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
});

test('create an account: the temporary password shows once, then reset, disable, enable and role', async ({ page }) => {
  const u = `c${tag()}`;
  made.users.push(u);
  await page.goto('/admin?tab=users');
  await hydrated(page, 'Users');
  const create = page.getByRole('region', { name: 'Add classmates' });
  await create.getByLabel('Username').fill(u);
  await create.getByLabel('Display name').fill('Dr Console Test');
  await create.getByRole('button', { name: 'Create account' }).click();
  const dlg = page.getByRole('dialog', { name: 'Temporary password' });
  await expect(dlg).toBeVisible();
  const pw = (await dlg.getByLabel(`Temporary password for @${u}`).textContent())!;
  expect(pw).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  expect(page.url()).not.toContain(pw);
  await dlg.getByRole('button', { name: 'Done' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText(pw)).toHaveCount(0);
  expect(one<{ action: string }>("SELECT action FROM audit_log WHERE action = 'user.create' AND target = ?", u)).toBeTruthy();

  await page.reload();
  await hydrated(page, 'Users');
  await page.getByRole('searchbox', { name: 'Search people' }).fill(u);
  const row = page.locator(`[data-user="${u}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Never signed in');
  await expect(page.getByText(pw)).toHaveCount(0);

  await row.getByRole('button', { name: `Reset password for @${u}` }).click();
  await page.getByRole('dialog', { name: `Reset @${u}'s password?` }).getByRole('button', { name: 'Reset password' }).click();
  const pw2 = (await dlg.getByLabel(`Temporary password for @${u}`).textContent())!;
  expect(pw2).not.toBe(pw);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();

  await row.getByRole('button', { name: `Disable @${u}` }).click();
  await page.getByRole('dialog', { name: `Disable @${u}?` }).getByRole('button', { name: 'Disable account' }).click();
  await expect(row.getByText('disabled', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: `Enable @${u}` }).click();
  await expect(row.getByText('disabled', { exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: `Make @${u} an admin` }).click();
  await expect(row.getByText('admin', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: `Make @${u} a member` }).click();
  await expect(row.getByText('member', { exact: true })).toBeVisible();
  expect(one<{ role: string; disabled: number }>('SELECT role, disabled FROM users WHERE username = ?', u)).toEqual({ role: 'member', disabled: 0 });
  await noHorizontalScroll(page);
});

test('bulk create checks every line first, then lists each password once', async ({ page }) => {
  const a = `b${tag()}`, b = `b${tag()}z`;
  made.users.push(a, b);
  await page.goto('/admin?tab=users');
  await hydrated(page, 'Users');
  const create = page.getByRole('region', { name: 'Add classmates' });
  await create.getByRole('radio', { name: 'Several' }).click();
  const box = create.getByLabel(/One per line/);
  await box.fill(`${a}, Dr Bulk One\nnot valid!, Oops\n${b}, Dr Bulk Two`);
  await create.getByRole('button', { name: 'Create 3 accounts' }).click();
  await expect(create.getByRole('alert', { name: 'Lines to fix' })).toContainText('Line 2');
  expect(one('SELECT id FROM users WHERE username = ?', a)).toBeUndefined();

  await box.fill(`${a}, Dr Bulk One\n${b}, Dr Bulk Two`);
  await create.getByRole('button', { name: 'Create 2 accounts' }).click();
  const dlg = page.getByRole('dialog', { name: '2 temporary passwords' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel(/^Temporary password for @/)).toHaveCount(2);
  await expect(dlg.getByRole('button', { name: 'Copy all' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator(`[data-user="${a}"]`)).toBeVisible();
  await expect(page.locator(`[data-user="${b}"]`)).toContainText('Dr Bulk Two');
  expect(one<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action = 'user.create' AND target IN (?, ?)", a, b).n).toBe(2);
});

test('members are kept out of the console and every admin endpoint', async ({ browser, baseURL }) => {
  const m = member('Dr Not Admin', await hash('member-pass-123'), 0);
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Username').fill(m.username);
  await page.getByLabel('Password', { exact: true }).fill('member-pass-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${baseURL}/`);
  await page.goto('/admin?tab=users');
  await expect(page).toHaveURL(`${baseURL}/`);
  for (const url of ['/api/admin/polls', '/api/admin/export/users.csv', '/api/admin/export/reports.json']) expect((await page.request.get(url)).status()).toBe(403);
  expect((await page.request.post('/api/admin/users', { data: { username: `x${tag()}` } })).status()).toBe(403);
  expect((await page.request.post('/api/admin/reports/1', { data: { status: 'fixed' } })).status()).toBe(403);
  await ctx.close();
});

test('reports show the item in context; accept with a note notifies the reporter, then mark fixed', async ({ page }) => {
  const m = member('Dr Reporter'), f = facts[7], note = `Checked against Dahnert ${tag()}`;
  const rid = run("INSERT INTO reports (user_id, item_type, item_id, kind, body, quote, path, created_at) VALUES (?, 'fact', ?, 'wrong', 'The value is off by a factor of ten.', 'quoted words', ?, ?)", m.id, f.id, `/facts/${f.id}`, now());
  made.reports.push(rid);
  await page.goto('/admin?tab=moderation');
  await hydrated(page, 'Reports');
  const card = page.locator(`[data-report="${rid}"]`);
  await expect(card).toContainText(f.fact.slice(0, 40));
  await expect(card).toContainText('quoted words');
  await expect(card.getByRole('link', { name: /Open fact/ })).toHaveAttribute('href', `/facts/${f.id}`);
  await card.getByLabel('Note to Dr Reporter (optional)').fill(note);
  await card.getByRole('button', { name: 'Accept' }).click();
  await expect(card).toHaveCount(0);
  expect(one('SELECT status, resolution FROM reports WHERE id = ?', rid)).toEqual({ status: 'accepted', resolution: note });
  expect(one('SELECT kind, title, body, href FROM notifications WHERE user_id = ? ORDER BY id DESC', m.id)).toEqual({ kind: 'report', title: 'Your report was accepted', body: note, href: `/facts/${f.id}` });

  await page.goto('/admin?tab=moderation&status=accepted&type=fact');
  await hydrated(page, 'Reports');
  await expect(card).toContainText('Accepted by @e2e');
  await card.getByRole('button', { name: 'Mark fixed' }).click();
  await expect(card).toHaveCount(0);
  expect(one('SELECT status, resolution FROM reports WHERE id = ?', rid)).toEqual({ status: 'fixed', resolution: note });
  expect(one<{ target: string }>("SELECT target FROM audit_log WHERE action = 'report.fix' ORDER BY id DESC").target).toBe(`#${rid} fact ${f.id}`);

  const res = await page.request.get('/api/admin/export/reports.json');
  expect(res.headers()['content-type']).toContain('application/json');
  expect(res.headers()['content-disposition']).toMatch(/^attachment; filename="lightbox-reports-\d{4}-\d{2}-\d{2}\.json"$/);
  const r = (await res.json()).reports.find((x: { id: number }) => x.id === rid);
  expect(r).toMatchObject({ status: 'fixed', kind: 'wrong', quote: 'quoted words', reporter: { username: m.username }, item: { type: 'fact', id: f.id, statement: f.fact } });
});

test('comments: hide with a reason, unhide, and delete for good', async ({ page }) => {
  const m = member('Dr Commenter'), body = `Rude remark ${tag()}`;
  const cid = run("INSERT INTO comments (user_id, item_type, item_id, body, created_at) VALUES (?, 'fact', ?, ?, ?)", m.id, facts[2].id, body, now());
  made.comments.push(cid);
  await page.goto('/admin?tab=moderation&view=comments');
  await hydrated(page, 'Comments');
  const row = page.locator(`[data-comment="${cid}"]`);
  await expect(row).toContainText(body);
  await row.getByRole('button', { name: 'Hide' }).click();
  await row.getByRole('button', { name: 'Off-topic' }).click();
  await row.getByRole('button', { name: 'Hide comment' }).click();
  await expect(row).toContainText('Hidden by @e2e: Off-topic');
  expect(one('SELECT hidden, hidden_reason FROM comments WHERE id = ?', cid)).toEqual({ hidden: 1, hidden_reason: 'Off-topic' });
  expect(one<{ title: string }>('SELECT title FROM notifications WHERE user_id = ? ORDER BY id DESC', m.id).title).toBe('Your comment was hidden');

  await row.getByRole('button', { name: 'Unhide' }).click();
  await expect(row).not.toContainText('Hidden by');
  await row.getByRole('button', { name: `Delete comment by @${m.username}` }).click();
  await page.getByRole('dialog', { name: 'Delete this comment for good?' }).getByRole('button', { name: 'Delete comment' }).click();
  await expect(row).toHaveCount(0);
  expect(one('SELECT id FROM comments WHERE id = ?', cid)).toBeUndefined();
});

test('polls: publish with options, results, close, reopen and delete', async ({ page }) => {
  const q = `Mock exam day ${tag()}?`, voters = [member('Dr Voter One'), member('Dr Voter Two')];
  await page.goto('/admin?tab=polls');
  await hydrated(page, 'Polls');
  const form = page.getByRole('form', { name: 'New poll' });
  await form.getByLabel('Question').fill(q);
  await form.getByLabel('Option A', { exact: true }).fill('Saturday');
  await form.getByLabel('Option B', { exact: true }).fill('Sunday');
  await form.getByRole('button', { name: 'Add option' }).click();
  await expect(form.getByLabel('Option C', { exact: true })).toBeFocused();
  await form.getByLabel('Option C', { exact: true }).fill('Monday');
  await form.getByRole('button', { name: 'Publish poll' }).click();
  const card = page.locator('[data-poll]').filter({ hasText: q });
  await expect(card).toBeVisible();
  const pid = Number(await card.getAttribute('data-poll'));
  made.polls.push(pid);
  expect(one<{ href: string }>("SELECT href FROM notifications WHERE user_id = ? AND kind = 'poll' ORDER BY id DESC", voters[0].id).href).toBe(`/class#poll-${pid}`);

  for (const v of voters) run("INSERT INTO poll_votes (poll_id, user_id, choice, created_at) VALUES (?, ?, 'B', ?)", pid, v.id, now());
  await page.reload();
  await hydrated(page, 'Polls');
  await expect(card.locator('[data-voters]')).toHaveText('2');
  await expect(card.getByRole('listitem', { name: /^B\. Sunday: 2 votes, 100%/ })).toBeVisible();
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(card.locator('[data-state]')).toHaveText('Closed');
  await card.getByRole('button', { name: 'Reopen' }).click();
  await expect(card.locator('[data-state]')).toHaveText('Open');
  await card.getByRole('button', { name: `Delete poll: ${q}` }).click();
  await page.getByRole('dialog', { name: 'Delete this poll?' }).getByRole('button', { name: 'Delete poll' }).click();
  await expect(card).toHaveCount(0);
  expect(one('SELECT id FROM polls WHERE id = ?', pid)).toBeUndefined();
});

test('AI review: edit and approve, reject with a reason; the creator hears back', async ({ page }) => {
  const m = member('Dr Generator'), stem = `Which sign is classic ${tag()}?`;
  const add = (s: string) => run(`INSERT INTO ai_mcqs (created_by, fact_ids, stem, options, key, explanation, created_at) VALUES (?, ?, ?, ?, 'A', 'Because the fact says so.', ?)`,
    m.id, JSON.stringify([facts[0].id]), s, JSON.stringify({ A: 'First', B: 'Second', C: 'Third' }), now());
  const a = add(stem), b = add(`${stem} (second)`);
  made.ai.push(a, b);
  await page.goto('/admin?tab=ai');
  await hydrated(page, 'AiQueue');
  const ca = page.locator(`[data-aimcq="${a}"]`), cb = page.locator(`[data-aimcq="${b}"]`);
  await expect(ca.getByText('AI draft · unverified')).toBeVisible();
  await expect(ca.getByRole('link', { name: facts[0].id })).toHaveAttribute('href', `/facts/${facts[0].id}`);
  await expect(ca).toContainText(facts[0].fact.slice(0, 30));
  await ca.getByLabel('Stem').fill(`${stem} Edited.`);
  await ca.getByLabel('B is the key').check();
  await ca.getByRole('button', { name: 'Approve' }).click();
  await expect(ca).toHaveCount(0);
  expect(one('SELECT status, stem, key FROM ai_mcqs WHERE id = ?', a)).toEqual({ status: 'approved', stem: `${stem} Edited.`, key: 'B' });
  expect(one<{ title: string }>('SELECT title FROM notifications WHERE user_id = ? ORDER BY id DESC', m.id).title).toBe('Your AI question was approved');

  await cb.getByRole('button', { name: 'Reject' }).click();
  await cb.getByRole('button', { name: 'Key is wrong' }).click();
  await cb.getByRole('button', { name: 'Reject question' }).click();
  await expect(cb).toHaveCount(0);
  expect(one('SELECT status FROM ai_mcqs WHERE id = ?', b)).toEqual({ status: 'rejected' });
  expect(one('SELECT title, body FROM notifications WHERE user_id = ? ORDER BY id DESC', m.id)).toEqual({ title: 'Your AI question was not approved', body: 'Key is wrong' });
  await page.goto('/admin?tab=ai&status=approved');
  await expect(page.locator(`[data-aimcq="${a}"]`)).toContainText('Approved by @e2e');
});

test('an announcement can notify everyone, shows on home, and comes down', async ({ page }) => {
  const m = member('Dr Reader'), text = `Mock TOACS moved to Hall B ${tag()}`;
  await page.goto('/admin?tab=announcements');
  await page.getByLabel('Announcement', { exact: true }).fill(text);
  await page.getByLabel('Also notify everyone').check();
  await page.getByRole('button', { name: 'Post to dashboards' }).click();
  const live = page.locator('[data-ann]').filter({ hasText: text });
  await expect(live).toBeVisible();
  expect(one('SELECT kind, body FROM notifications WHERE user_id = ? ORDER BY id DESC', m.id)).toEqual({ kind: 'announcement', body: text });
  await page.goto('/');
  await expect(page.getByText(text)).toBeVisible();
  await page.goto('/admin?tab=announcements');
  await live.getByRole('button', { name: 'Take down' }).click();
  await expect(page.locator('[data-ann]').filter({ hasText: text })).toHaveCount(0);
});

test('the audit log filters by area, searches targets and pages by 50', async ({ page }) => {
  const t = `zz${tag()}`, d = sql();
  const ins = d.prepare("INSERT INTO audit_log (actor_id, action, target, at) VALUES ((SELECT id FROM users WHERE username = 'e2e'), ?, ?, ?)");
  d.transaction(() => { for (let i = 0; i < 55; i++) ins.run(i % 2 ? 'poll.close' : 'comment.hide', `${t} #${i}`, now() - i * 1000); })();
  d.close();
  await page.goto(`/admin?tab=audit&q=${t}`);
  await expect(page.getByText('Showing 1–50 of 55 matching entries')).toBeVisible();
  await expect(page.getByText(`${t} #0`, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Older' }).click();
  await expect(page.getByText('Showing 51–55 of 55 matching entries')).toBeVisible();
  await page.getByLabel('What').selectOption('poll');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/action=poll/);
  await expect(page.getByText('Showing 1–27 of 27 matching entries')).toBeVisible();
  await expect(page.locator('main').getByText('closed poll').first()).toBeVisible();
  await expect(page.locator('main').getByText('hid comment')).toHaveCount(0);
  await noHorizontalScroll(page);
});

test('exports are attachments with the right types and no secrets', async ({ page }) => {
  const csv = await page.request.get('/api/admin/export/users.csv');
  expect(csv.headers()['content-type']).toBe('text/csv; charset=utf-8');
  expect(csv.headers()['content-disposition']).toMatch(/^attachment; filename="lightbox-users-\d{4}-\d{2}-\d{2}\.csv"$/);
  const body = await csv.text();
  expect(body).toContain('username,display_name,role,disabled,created,last_seen');
  expect(body).toMatch(/\ne2e,E2E Tester,admin,no,/);
  expect(body).not.toMatch(/argon|\$v=|password/i);
  const cm = await page.request.get('/api/admin/export/comments.json');
  expect(cm.headers()['content-disposition']).toContain('lightbox-comments-');
  expect(await cm.json()).toHaveProperty('comments');
});

test.describe('accessibility', () => {
  test.beforeAll(() => {
    // Something in every queue, so the scans see real cards.
    const m = member('Dr Axe');
    made.reports.push(run("INSERT INTO reports (user_id, item_type, item_id, kind, body, path, created_at) VALUES (?, 'fact', ?, 'typo', 'A typo.', ?, ?)", m.id, facts[1].id, `/facts/${facts[1].id}`, now()));
    made.comments.push(run("INSERT INTO comments (user_id, item_type, item_id, body, created_at, hidden, hidden_reason) VALUES (?, 'fact', ?, 'Hidden for the scan', ?, 1, 'Off-topic')", m.id, facts[1].id, now()));
    made.ai.push(run(`INSERT INTO ai_mcqs (created_by, fact_ids, stem, options, key, created_at) VALUES (?, ?, 'A stem long enough for the scan?', ?, 'A', ?)`, m.id, JSON.stringify([facts[1].id]), JSON.stringify({ A: 'One', B: 'Two' }), now()));
    made.polls.push(run("INSERT INTO polls (item_type, question, options, created_at) VALUES ('custom', 'Scan poll?', ?, ?)", JSON.stringify({ A: 'Yes', B: 'No' }), now()));
    run("INSERT INTO ai_usage (user_id, day, n, tokens) VALUES (?, ?, 3, 1200)", m.id, new Date(now() + 5 * 3_600_000).toISOString().slice(0, 10));
  });
  for (const scheme of ['light', 'dark'] as const) for (const t of ['overview', 'users', 'moderation', 'moderation&view=comments', 'polls', 'ai', 'announcements', 'audit']) {
    test(`no serious accessibility issues on /admin?tab=${t} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/admin?tab=${t}`);
      await page.waitForTimeout(900);
      const r = await new AxeBuilder({ page }).disableRules(['region']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});
