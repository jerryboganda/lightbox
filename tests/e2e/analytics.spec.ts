import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
const goalsNow = async (page: Page) => (await page.request.get('/api/goals')).json();
const firstCard = async (page: Page) => ((await (await page.request.get('/api/data/anki')).json()) as { factId: string }[])[0].factId;

test('analytics shows every chart with a takeaway and fits the screen', async ({ page }) => {
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
  for (const h of ['Exam readiness', 'Activity', 'Weak topics', 'Forgetting curve', 'Mastery by system', 'MCQ accuracy', 'Time spent'])
    await expect(page.getByRole('heading', { level: 2, name: h, exact: true })).toBeVisible();
  await expect(page.locator('.ch-take').first()).not.toBeEmpty();
  await page.getByText('How this is calculated').click();
  await expect(page.getByText(/Readiness = 30% coverage/)).toBeVisible();
  await noHorizontalScroll(page);
});

test('a forgotten card becomes a weak topic with a drill link, and the heatmap is keyboard explorable', async ({ page }) => {
  const fact = await firstCard(page);
  const r = await page.request.post('/api/srs/review', { data: { factId: fact, rating: 1, reviewedAt: Date.now(), clientId: `e2e-again-${Date.now()}-${Math.random()}` } });
  expect((await r.json()).ok).toBe(1);
  await page.goto('/analytics');
  const weak = page.locator('#weak');
  await expect(weak.getByText(/Again rating/).first()).toBeVisible();
  await expect(weak.getByRole('link', { name: /^Drill cards:/ }).first()).toHaveAttribute('href', /\/practice\/cards\?focus=/);
  const today = page.locator('#activity [data-rove] [tabindex="0"]');
  await expect(today).toHaveAttribute('aria-label', /card review/);
  await today.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#activity [data-rove] [tabindex="0"]')).toBeFocused();
  await expect(page.locator('#ch-tip')).toHaveAttribute('data-on', '');
});

test('goals API validates input and returns today\'s progress', async ({ page }) => {
  const before = await goalsNow(page);
  expect(before.goals).toMatchObject({ cards: expect.any(Number), mcqs: expect.any(Number), minutes: expect.any(Number) });
  expect(before.done).toMatchObject({ cards: expect.any(Number), mcqs: expect.any(Number), minutes: expect.any(Number) });
  for (const bad of [{ ...before.goals, cards: 501 }, { ...before.goals, minutes: -5 }, { ...before.goals, mcqs: 'ten' }, { ...before.goals, examDate: '2026-02-31' }]) {
    const r = await page.request.put('/api/goals', { data: bad });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toBeTruthy();
  }
  const r = await page.request.put('/api/goals', { data: { ...before.goals, cards: (before.goals.cards % 200) + 1 } });
  expect(r.status()).toBe(200);
  expect((await r.json()).goals.cards).toBe((before.goals.cards % 200) + 1);
  expect((await page.request.post('/api/study/session', { data: { kind: 'nap', seconds: 60, startedAt: Date.now(), clientId: 'bad-kind-123' } })).status()).toBe(400);
});

test('study timer runs, pauses and survives navigation and reload', async ({ page }) => {
  await page.goto('/practice');
  await page.getByRole('button', { name: /Open study timer/ }).click();
  const panel = page.getByRole('dialog', { name: 'Study timer' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Start focus' }).click();
  await expect(panel.locator('.tm-clock')).not.toHaveText('25:00', { timeout: 4000 });
  await panel.getByRole('button', { name: 'Pause' }).click();
  const paused = await panel.locator('.tm-clock').textContent();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.getByRole('link', { name: 'Study', exact: true }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.locator('.tm-pill-time')).toHaveText(paused!);
  await page.reload();
  await expect(page.locator('.tm-pill-time')).toHaveText(paused!);
  await expect(page.getByRole('button', { name: 'Resume timer' })).toBeVisible();
});

test('a focus phase that ended while away is recorded once', async ({ page }) => {
  const before = (await goalsNow(page)).done.minutes as number;
  await page.goto('/api/health'); // same origin, no timer island yet
  await page.evaluate(() => {
    const t = Date.now();
    localStorage.setItem('lb-timer', JSON.stringify({ phase: 'focus', focus: 1, brk: 1, total: 60_000, left: 60_000, endsAt: t - 1000, startedAt: t - 61_000, id: crypto.randomUUID(), sound: false, title: false, dock: 'pill' }));
  });
  await page.goto('/practice');
  await expect(page.getByText('Your focus session finished while you were away.')).toBeVisible();
  await expect.poll(async () => (await goalsNow(page)).done.minutes, { timeout: 5000 }).toBe(before + 1);
  await expect(page.locator('.tm-pill-phase')).toHaveText('Break');
});

test('daily goals edit from the analytics page and show on home', async ({ page }) => {
  await page.goto('/analytics');
  await page.getByRole('button', { name: 'Daily goals' }).click();
  const panel = page.getByRole('dialog', { name: 'Study timer' });
  const mcqs = panel.getByLabel('MCQs per day');
  await expect(mcqs).toBeVisible();
  const next = (Number(await mcqs.inputValue()) % 90) + 5;
  await mcqs.fill(String(next));
  await panel.getByRole('button', { name: 'Save goals' }).click();
  await expect(page.getByText('Goals saved')).toBeVisible();
  await expect(panel.getByText(`/${next}`, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.locator('.gr-item', { hasText: 'MCQs answered' })).toContainText(`/ ${next}`);
  await page.getByRole('link', { name: /Exam readiness \d+ out of 100/ }).click();
  await expect(page).toHaveURL(/\/analytics$/);
});

test('timer minimises to a dot and remembers it', async ({ page }) => {
  await page.goto('/study');
  await page.getByRole('button', { name: /Open study timer/ }).click();
  await page.getByRole('button', { name: 'Minimise timer to a dot' }).click();
  await expect(page.getByRole('button', { name: /Show study timer/ })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Show study timer/ }).click();
  await expect(page.getByRole('button', { name: /Open study timer/ })).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`no serious accessibility issues on /analytics (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/analytics');
    await page.waitForTimeout(1200);
    const r = await new AxeBuilder({ page }).disableRules(['region']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  test(`no serious accessibility issues in the open timer panel (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/practice');
    await page.getByRole('button', { name: /Open study timer/ }).click();
    await expect(page.getByRole('dialog', { name: 'Study timer' })).toBeVisible();
    await page.waitForTimeout(600);
    const r = await new AxeBuilder({ page }).include('#lb-timer-panel').analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}
