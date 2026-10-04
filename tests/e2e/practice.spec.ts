import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Every test makes its own sessions, so the desktop and mobile runs share one database safely.
const exam = async (page: Page, data: object) => {
  const r = await page.request.post('/api/exams', { data: { count: 5, filters: { status: ['keyed'] }, ...data } });
  expect(r.status()).toBe(201);
  return (await r.json()).id as number;
};
const toacs = async (page: Page, baseURL: string, form: Record<string, string>) => {
  const r = await page.request.post('/api/toacs', { form, headers: { origin: baseURL }, maxRedirects: 0 });
  expect(r.status()).toBe(303);
  return Number(r.headers().location.match(/\/practice\/toacs\/(\d+)$/)![1]);
};
const visible = (page: Page, name: RegExp) => page.getByRole('button', { name }).filter({ visible: true }).first();
const watchErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
};
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

test('practice hub offers every mode and resumes a recent session', async ({ page }) => {
  const title = `Hub check ${Date.now()}`;
  const id = await exam(page, { mode: 'quiz', title });
  await page.goto('/practice');
  for (const name of ['Custom quiz', 'Timed exam', 'TOACS stations']) await expect(page.getByRole('heading', { name })).toBeVisible();
  const row = page.getByRole('link', { name: new RegExp(title) });
  await expect(row).toContainText('Resume');
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/practice/exam/${id}$`));
  await noHorizontalScroll(page);
});

test('builder counts matches live and starts a practice quiz with instant feedback', async ({ page }) => {
  await page.goto('/practice/builder');
  const live = page.locator('[aria-live="polite"]').filter({ hasText: 'match' });
  await expect(live).toContainText('81');
  await page.getByRole('button', { name: /^IMM Aug 2025/ }).click();
  await expect(live).toContainText('31');
  await page.getByRole('button', { name: /^IMM Aug 2025/ }).click();
  await page.getByRole('button', { name: /^Has a key/ }).click();
  await expect(live).toContainText('39');
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: /^Start practice/ }).click();
  await expect(page).toHaveURL(/\/practice\/exam\/\d+$/);
  await page.getByRole('radio').first().click();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByText(/^Correct\.$|^The key says/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/^Correct\.$|^The key says/)).toBeVisible(); // a checked answer stays checked
});

test('a timed exam autosaves, resumes where you left off and submits to a review', async ({ page }) => {
  const errors = watchErrors(page);
  const id = await exam(page, { mode: 'exam', perQuestion: 60 });
  await page.goto(`/practice/exam/${id}`);
  await expect(page.getByRole('timer').filter({ visible: true }).first()).toHaveText(/[45]:\d\d/);
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/answer') && r.ok()), page.keyboard.press('1')]);
  await expect(page.getByRole('radio').first()).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: /^Flag/ }).click();
  await expect(page.getByRole('button', { name: /^Flagged/ })).toHaveAttribute('aria-pressed', 'true');
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/answer') && r.ok()), page.getByRole('button', { name: /^Next/ }).click()]);
  await expect(page.getByText('Question 2 of 5')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Question 2 of 5')).toBeVisible();
  await page.getByRole('button', { name: 'Previous question' }).click();
  await expect(page.getByRole('radio').first()).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: /^Flagged/ })).toBeVisible();

  await visible(page, /^Submit( exam)?$/).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('4 unanswered');
  await expect(dlg).toContainText('1 flagged');
  await dlg.getByRole('button', { name: 'Submit now' }).click();
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await expect(page.getByRole('figure', { name: /Score/ })).toBeVisible();
  await page.getByRole('button', { name: /^Unanswered/ }).click();
  await expect(page.locator('[data-rlist] > li:visible')).toHaveCount(4);
  await page.getByRole('button', { name: /^Flagged/ }).click();
  await expect(page.locator('[data-rlist] > li:visible')).toHaveCount(1);
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: /Retake wrong ones/ }).click();
  await expect(page).not.toHaveURL(new RegExp(`/practice/exam/${id}$`));
  await expect(page.getByRole('button', { name: 'Check answer' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('an exam submits itself when the clock runs out', async ({ page }) => {
  const id = await exam(page, { mode: 'exam', timing: 'total', totalMinutes: 1 });
  await page.clock.install();
  await page.goto(`/practice/exam/${id}`);
  await expect(page.getByText('Question 1 of 5')).toBeVisible();
  await page.clock.fastForward('01:02');
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await expect(page.getByText(/^Unanswered/).first()).toBeVisible();
});

test('TOACS runs stations, reveals the source answer and grades to a summary', async ({ page }) => {
  await page.goto('/practice/toacs');
  await page.getByText('WhatsApp images').click();
  await page.locator('#ts-count').fill('5');
  await page.getByText('30 s').click();
  await expect(page.locator('[data-out]')).toHaveText('5');
  await page.getByRole('button', { name: 'Start stations' }).click();
  await expect(page).toHaveURL(/\/practice\/toacs\/\d+$/);
  for (let k = 0; k < 5; k++) {
    await expect(page.getByText(`Station ${k + 1} of 5`)).toBeVisible();
    await page.getByLabel(/Your answer/).fill('private guess');
    await page.getByRole('button', { name: 'Reveal model answer' }).click();
    await expect(page.getByText('SOURCE CAPTION')).toBeVisible();
    await expect(page.getByText(/FACTS FROM THIS PAGE/)).toBeVisible();
    await page.getByRole('button', { name: k % 2 ? /Missed/ : /Got it/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Stations', exact: true })).toBeVisible();
  await expect(page.getByRole('figure', { name: /Score: 60 percent/ })).toBeVisible();
  await expect(page.getByText('private guess')).toHaveCount(0);
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: /Repeat missed/ }).click();
  await expect(page.getByText('Station 1 of 2')).toBeVisible();
});

test('MCQ bank deep link opens the requested question', async ({ page }) => {
  await page.goto('/practice/mcq?q=FEB2025-Q13');
  await expect(page.getByRole('heading', { level: 2 })).toContainText('ovarian mass');
});

test('exam APIs reject bad input and unknown sessions', async ({ page }) => {
  expect((await page.request.post('/api/exams', { data: { mode: 'exam', count: 5, perQuestion: 1 } })).status()).toBe(400);
  expect((await page.request.post('/api/exams', { data: { mode: 'quiz', count: 0 } })).status()).toBe(400);
  expect((await page.request.post('/api/exams', { data: 'not json' })).status()).toBe(400);
  const id = await exam(page, { mode: 'exam', perQuestion: 60 });
  expect((await page.request.post(`/api/exams/${id}/answer`, { data: { item: 'NOPE', choice: 'A' } })).status()).toBe(400);
  expect((await page.request.post('/api/exams/99999999/answer', { data: { item: 'x', choice: 'A' } })).status()).toBe(404);
  expect((await page.request.post('/api/exams/99999999/finish', { data: {} })).status()).toBe(404);
  await page.goto('/practice/exam/99999999');
  await expect(page).toHaveURL(/\/practice$/);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`no serious accessibility issues on practice pages (${scheme})`, async ({ page, baseURL }) => {
    const quiz = await exam(page, { mode: 'quiz', filters: { status: ['disputed'] } });
    const live = await exam(page, { mode: 'exam', perQuestion: 60 });
    const done = await exam(page, { mode: 'exam', perQuestion: 60, filters: {} });
    await page.request.post(`/api/exams/${done}/finish`, { data: {} });
    const run = await toacs(page, baseURL!, { count: '5', seconds: '60', group: '' });
    const over = await toacs(page, baseURL!, { count: '5', seconds: '30', group: 'IMM toacs march 2026' });
    await page.request.post(`/api/exams/${over}/finish`, { data: {} });
    await page.emulateMedia({ colorScheme: scheme });
    const scan = async (path: string, act?: () => Promise<void>) => {
      await page.goto(path);
      await page.waitForTimeout(900);
      if (act) { await act(); await page.waitForTimeout(500); }
      const r = await new AxeBuilder({ page }).disableRules(['region']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${path} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    };
    await scan('/practice');
    await scan('/practice/builder');
    await scan('/practice/builder?mode=exam');
    await scan(`/practice/exam/${live}`);
    await scan(`/practice/exam/${quiz}`, async () => { await page.getByRole('radio').first().click(); await page.getByRole('button', { name: 'Check answer' }).click(); });
    await scan(`/practice/exam/${done}`, async () => { await page.locator('details summary').first().click(); });
    await scan('/practice/toacs');
    await scan(`/practice/toacs/${run}`, async () => { await page.getByRole('button', { name: 'Reveal model answer' }).click(); });
    await scan(`/practice/toacs/${over}`);
  });
}
