import { expect, test, type APIRequestContext, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Class layer: threads, reports, polls, notifications and the class hub.
// Runs once per project against one database, so each test makes its own data and tolerates what an earlier run left.
const hydrated = (page: Page, name: string) =>
  page.waitForFunction((n) => [...document.querySelectorAll('astro-island')].some((i) => i.getAttribute('component-url')?.includes(n) && !i.hasAttribute('ssr')), name);
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
const factIds = async (page: Page) => ((await (await page.request.get('/api/data/facts')).json()) as { id: string; status: string }[]).filter((f) => f.status !== 'disputed').map((f) => f.id);
const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const serious = async (page: Page, include?: string) => {
  const b = new AxeBuilder({ page }).disableRules(['region']);
  const r = await (include ? b.include(include) : b).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
};

// A second account (made through the admin API) that signs in over the API, so the e2e admin has someone to talk to.
async function classmate(page: Page, playwright: PlaywrightWorkerArgs['playwright'], baseURL: string) {
  const tag = stamp(), username = `mate-${tag}`, name = `Mate ${tag.slice(-5).toUpperCase()}`, Origin = baseURL;
  const temp = ((await (await page.request.post('/api/admin/users', { data: { username, displayName: name, role: 'member' } })).json()) as { password?: string }).password;
  expect(temp, 'the admin API returns the temporary password').toBeTruthy();
  const ctx: APIRequestContext = await playwright.request.newContext({ baseURL });
  await ctx.post('/api/auth/login', { form: { username, password: temp! }, headers: { Origin } });
  await ctx.post('/api/auth/password', { form: { current: temp!, next: 'mate-chosen-pass-7', confirm: 'mate-chosen-pass-7' }, headers: { Origin } });
  return { ctx, name };
}

test('discuss a fact: post, edit, get a reply and an upvote, follow the notification, delete', async ({ page, playwright, baseURL }, info) => {
  const fact = (await factIds(page))[info.project.name === 'mobile' ? 31 : 30];
  const mate = await classmate(page, playwright, baseURL!);
  const text = `Is the lateral sign reliable? ${stamp()} <img src=x onerror=alert(1)>`;

  await page.goto(`/facts/${fact}#discussion`);
  await hydrated(page, 'Thread');
  const thread = page.locator('#discussion');
  await thread.getByLabel('Add to the discussion').fill(text);
  await page.keyboard.press('Control+Enter');
  const mine = thread.locator('li', { hasText: text }).first();
  await expect(mine).toBeVisible();
  await expect(thread.getByText('Comment posted.')).toBeAttached();
  await expect(thread.locator('img[src="x"]')).toHaveCount(0); // stays text
  const id = Number((await mine.getAttribute('id'))!.slice(2));

  await mine.getByRole('button', { name: 'Edit' }).click();
  await mine.getByLabel('Edit your comment').fill(`${text} (edited)`);
  await mine.getByRole('button', { name: 'Save' }).click();
  await expect(mine.getByText('· edited')).toBeVisible();
  await expect(mine.getByRole('button', { name: /^Upvote/ })).toHaveCount(0); // never on your own comment

  // The classmate replies and upvotes; the e2e user is told about the reply.
  const reply = await (await mate.ctx.post('/api/comments', { data: { type: 'fact', id: fact, body: 'Yes, on the lateral view.', parentId: id } })).json();
  expect(reply.comment.parentId).toBe(id);
  expect((await mate.ctx.post('/api/votes', { data: { type: 'comment', id, on: true } })).ok()).toBe(true);
  expect((await mate.ctx.post('/api/votes', { data: { type: 'comment', id: reply.comment.id, on: true } })).status()).toBe(403);

  await page.goto('/class');
  await hydrated(page, 'NotificationBell');
  const bell = page.getByRole('button', { name: /^Notifications, \d+ unread/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const pop = page.getByRole('dialog', { name: 'Notifications' });
  await pop.getByRole('link', { name: new RegExp(`${mate.name} replied to your comment`) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/facts/${fact}#discussion$`));
  await hydrated(page, 'Thread');
  const again = page.locator(`#c-${id}`);
  await expect(again.getByText('Yes, on the lateral view.')).toBeVisible();
  await expect(again.getByText('1 upvote')).toBeAttached();

  // Upvote the classmate's reply, then delete the parent: its reply stays under a placeholder.
  const up = page.locator(`#c-${reply.comment.id}`).getByRole('button', { name: /^Upvote/ });
  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await again.getByRole('button', { name: 'Delete' }).first().click();
  await again.getByRole('button', { name: 'Delete?' }).click();
  await expect(again.getByText('[deleted]')).toBeVisible();
  await page.reload();
  await hydrated(page, 'Thread');
  await expect(page.locator(`#c-${id}`).getByText('[deleted]')).toBeVisible();
  await expect(page.locator(`#c-${reply.comment.id}`)).toBeVisible();
  await expect(page.locator(`#c-${reply.comment.id}`).getByRole('button', { name: /^Upvote/ })).toHaveAttribute('aria-pressed', 'true');
  await noHorizontalScroll(page);
  await mate.ctx.dispose();
});

test('report a fact once per kind from its page', async ({ page }, info) => {
  const fact = (await factIds(page))[info.project.name === 'mobile' ? 41 : 40];
  await page.goto(`/facts/${fact}`);
  await hydrated(page, 'ReportButton');
  const send = async () => {
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Report a problem' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Send report' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Choose what is wrong.');
    await dlg.getByLabel(/^Typo/).check();
    await dlg.getByLabel(/Details/).fill('The unit is missing.');
    await dlg.getByRole('button', { name: 'Send report' }).click();
    return dlg;
  };
  const dlg = await send();
  await expect(page.getByRole('status').getByText('Thanks. An admin will review it.')).toBeVisible();
  await expect(dlg).toBeHidden();
  await send();
  await expect(dlg.getByRole('alert')).toContainText('You already reported this');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});

test('report a selection from the highlighter toolbar, with the quote', async ({ page }, info) => {
  await page.goto('/study/physics/bremsstrahlung');
  await hydrated(page, 'Highlighter');
  await page.evaluate(() => {
    const el = document.querySelector('#main .point p')!;
    const t = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const r = document.createRange();
    r.setStart(t, 0); r.setEnd(t, Math.min(24, t.data.length));
    getSelection()!.removeAllRanges(); getSelection()!.addRange(r);
  });
  await page.getByRole('toolbar', { name: 'Selection tools' }).getByRole('button', { name: 'Report a problem' }).click();
  const dlg = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(dlg.getByLabel('Selected text')).not.toBeEmpty();
  await dlg.getByLabel(info.project.name === 'mobile' ? /^Duplicate/ : /^Unclear/).check();
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/reports')), dlg.getByRole('button', { name: 'Send report' }).click()]);
  expect([201, 409]).toContain(res.status());
  const body = res.request().postDataJSON();
  expect(body).toMatchObject({ type: 'fact', path: '/study/physics/bremsstrahlung' });
  expect(body.quote.length).toBeGreaterThan(1);
  if (res.status() === 409) await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});

test('class poll on a disputed MCQ hides the split until you vote', async ({ page }) => {
  await page.goto('/review#mcqs');
  const card = page.locator('#mcqs article').first();
  await card.scrollIntoViewIfNeeded();
  await hydrated(page, 'Poll');
  const poll = card.locator('section', { hasText: 'Class opinion' });
  await expect(poll.getByRole('list')).toBeVisible();
  const change = poll.getByRole('button', { name: 'Change vote' });
  if (await change.isVisible()) await change.click(); // an earlier project already voted
  await expect(poll.getByRole('list', { name: 'Results' })).toHaveCount(0);
  const options = poll.getByRole('button', { name: /^Vote / });
  const target = options.nth((await options.count()) - 1);
  await target.click();
  const results = poll.getByRole('list', { name: 'Results' });
  await expect(results).toBeVisible();
  await expect(results.getByText('Your vote')).toBeAttached();
  await expect(poll.getByText('Polls never change the answer key.')).toBeVisible();
  await expect(card.getByText(/^key$/)).toBeVisible(); // the key on the card is untouched
});

test('the class hub shows the board, switches period and fits the screen', async ({ page }) => {
  await page.request.post('/api/mcq/attempt', { data: { qid: 'FEB2025-Q12', choice: 'A', ms: 1000 } });
  await page.goto('/class');
  await expect(page.getByRole('heading', { level: 1, name: 'Class' })).toBeVisible();
  const board = page.locator('#board');
  await expect(board.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
  await expect(board.locator('[data-pane="week"]').getByText(/E2E Tester/).first()).toBeVisible();
  await board.getByRole('radio', { name: 'All time' }).click();
  await expect(board.getByRole('radio', { name: 'All time' })).toHaveAttribute('aria-checked', 'true');
  await expect(board.locator('[data-pane="all"]')).toBeVisible();
  await expect(board.locator('[data-pane="week"]')).toBeHidden();
  await board.getByText('How points work').click();
  await expect(board.getByText(/Card review/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Open polls' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent discussion' })).toBeVisible();
  await noHorizontalScroll(page);
});

test('notifications page filters unread and marks all read', async ({ page, playwright, baseURL }, info) => {
  const fact = (await factIds(page))[info.project.name === 'mobile' ? 51 : 50];
  const mate = await classmate(page, playwright, baseURL!);
  const { comment } = await (await page.request.post('/api/comments', { data: { type: 'fact', id: fact, body: `Notify me ${stamp()}` } })).json();
  await mate.ctx.post('/api/comments', { data: { type: 'fact', id: fact, body: 'A reply for the list', parentId: comment.id } });
  await page.goto('/notifications?filter=unread');
  await expect(page.getByRole('link', { name: `${mate.name} replied to your comment` })).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  await page.reload();
  await expect(page.getByText('No unread notifications')).toBeVisible();
  await page.goto('/notifications');
  await expect(page.getByRole('link', { name: `${mate.name} replied to your comment` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  await mate.ctx.dispose();
});

test('MCQ bank opens a discussion once the answer is checked', async ({ page }) => {
  await page.goto('/practice/mcq?q=FEB2025-Q12');
  await expect(page.getByRole('button', { name: /^Discussion/ })).toHaveCount(0);
  await page.getByRole('radiogroup', { name: 'Options' }).getByRole('radio').first().click();
  await page.getByRole('button', { name: 'Check answer' }).click();
  const row = page.getByRole('button', { name: /^Discussion/ });
  await expect(row).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Add to the discussion')).toBeVisible();
  // Keys inside the thread never drive the player's shortcuts: Enter on the row folds it, it does not move on.
  const stem = await page.getByRole('heading', { level: 2 }).first().textContent();
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText(stem!);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`no serious accessibility issues on class pages (${scheme})`, async ({ page }) => {
    const fact = (await factIds(page))[30];
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ['/class', '/notifications', '/notifications?filter=unread', `/facts/${fact}#discussion`]) {
      await page.goto(path);
      await page.waitForTimeout(1200);
      await noHorizontalScroll(page);
      expect(await serious(page), path).toEqual([]);
    }
  });

  test(`no serious accessibility issues in the open thread, poll, report dialog and bell (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/review#mcqs');
    const card = page.locator('#mcqs article').first();
    // The thread itself must be on screen to hydrate (client:visible); after a vote the poll's results push it below a phone's fold.
    await card.getByRole('button', { name: /^Discussion/ }).scrollIntoViewIfNeeded();
    await hydrated(page, 'Thread');
    await card.getByRole('button', { name: /^Discussion/ }).click();
    await page.waitForTimeout(700);
    expect(await serious(page, '#mcqs article')).toEqual([]);
    await page.goto(`/facts/${(await factIds(page))[30]}`);
    await hydrated(page, 'ReportButton');
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    await page.waitForTimeout(600);
    expect(await serious(page, 'dialog.lb-dialog')).toEqual([]);
    await page.keyboard.press('Escape');
    await hydrated(page, 'NotificationBell');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.waitForTimeout(600);
    expect(await serious(page, '#lb-notif')).toEqual([]);
  });
}
