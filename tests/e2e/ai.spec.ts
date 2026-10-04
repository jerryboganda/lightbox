import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import http from 'node:http';

// AI features. The normal run has no key, so every AI surface must show "not configured" and nothing else may break.
// With AI_BASE_URL pointing at localhost (plus any OPENCODE_API_KEY value), a mock gateway below streams answers instead:
//   OPENCODE_API_KEY=e2e-mock AI_BASE_URL=http://localhost:4499/v1 E2E_PORT=4413 npx playwright test tests/e2e/ai.spec.ts
const MOCK = /^http:\/\/(localhost|127\.0\.0\.1):\d+/.test(process.env.AI_BASE_URL ?? '') && !!process.env.OPENCODE_API_KEY;
const FACT = 'F-M-001';
const TOPIC = '/study/chest/lobe-collapse-silhouette-signs';
const hydrated = (page: Page, name: string) =>
  page.waitForFunction((n) => [...document.querySelectorAll('astro-island')].some((i) => i.getAttribute('component-url')?.includes(n) && !i.hasAttribute('ssr')), name);
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
const axe = async (page: Page, where?: string) => {
  const b = new AxeBuilder({ page }).disableRules(['region']);
  const r = await (where ? b.include(where) : b).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
};
const withDb = <T>(f: (db: Database.Database) => T) => {
  const db = new Database('data/e2e.db');
  db.pragma('busy_timeout = 5000');
  try { return f(db); } finally { db.close(); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- mock OpenCode gateway (mock mode only) ----
let server: http.Server | undefined;
test.beforeAll(async () => {
  if (!MOCK) return;
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      if (!req.headers['x-opencode-session'] || !req.headers.authorization?.startsWith('Bearer ') || req.headers['user-agent'] !== 'lightbox-tutor/1.0') { res.writeHead(400).end(); return; }
      const body = JSON.parse(raw), sys = body.messages[0].content as string, last = body.messages.at(-1).content as string;
      const ids = [...new Set<string>(last.match(/F-[A-Z]+-\d{3}[a-z]?/g) ?? [])];
      const text = sys.includes('single-best-answer') ? JSON.stringify({ mcqs: ids.slice(0, 2).map((id, i) => ({ stem: `Mock question ${i + 1}: which statement matches the verified note?`, options: { A: `Option one ${i}`, B: `Option two ${i}`, C: `Option three ${i}`, D: `Option four ${i}` }, key: 'B', explanation: `Option two is right [${id}].`, fact_ids: [id] })) })
        : sys.includes('disputed exam item') ? '**Side 1:** The printed key, supported by the key line.\n**Side 2:** The blind answer, supported by the note.\n**Why it is unresolved:** The stem lacks detail.\n**For the exam:** Learn both positions.'
        : last.includes('Explain fact') ? `**Why it matters:** A classic silhouette sign [${ids[0]}].\n**How it is examined:** Usually as a radiograph MCQ.\n**Memory hook:** Middle lobe hugs the heart.\n**Related:** [${ids[1]}] [${ids[2]}]`
        : `Here is what your notes say:\n\n- **First point** from the notes [${ids[0]}]\n- Second point [${ids[1]}]\n\nOpen the cited facts before you rely on this.`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const p of text.match(/[\s\S]{1,6}/g)!) {
        if (res.destroyed) return;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
        await sleep(last.includes('slowly') ? 250 : 6);
      }
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server!.listen(Number(new URL(process.env.AI_BASE_URL!).port), r));
});
test.afterAll(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

test.describe('without an AI key', () => {
  test.skip(MOCK, 'runs without a gateway');

  test('the tutor explains that AI is not configured and keeps the composer off', async ({ page }) => {
    await page.goto('/tutor');
    await expect(page.getByRole('heading', { level: 1, name: 'Tutor' })).toBeVisible();
    await expect(page.getByText('AI is not configured on this server.')).toBeVisible();
    await expect(page.getByLabel('Ask the tutor')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Send question' })).toBeDisabled();
    await noHorizontalScroll(page);
    expect((await page.request.get('/api/ai/status')).status()).toBe(200);
    const r = await page.request.post('/api/ai/explain', { data: { factId: FACT } });
    expect(r.status()).toBe(503);
    expect(await r.json()).toMatchObject({ error: 'AI is not configured on this server.' });
  });

  test('explain, generate and dispute summaries degrade gracefully', async ({ page }) => {
    await page.goto(`/facts/${FACT}`);
    await hydrated(page, 'AiExplain');
    const explain = page.getByRole('button', { name: 'Explain this fact' });
    await explain.click();
    await expect(explain).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'AI explanation' }).getByText('AI is not configured on this server.')).toBeVisible();
    await page.getByRole('button', { name: 'Close explanation' }).click();
    await expect(explain).toHaveAttribute('aria-expanded', 'false');

    await page.goto(TOPIC);
    await hydrated(page, 'AiGenerate');
    const gen = page.getByRole('button', { name: 'Generate MCQs' });
    await gen.click();
    const dlg = page.getByRole('dialog', { name: 'Generate practice MCQs' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText('AI is not configured on this server.')).toBeVisible();
    await expect(dlg.getByRole('button', { name: /^Generate/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(gen).toBeFocused();

    await page.goto('/review');
    await page.getByRole('button', { name: 'AI summary of both sides' }).first().scrollIntoViewIfNeeded(); // client:visible
    await hydrated(page, 'AiDisputeSummary');
    await page.getByRole('button', { name: 'AI summary of both sides' }).first().click();
    await expect(page.getByRole('region', { name: 'AI summary of both sides' }).first().getByText('AI is not configured on this server.')).toBeVisible();
  });
});

test('the AI practice set shows an empty state, then plays approved questions apart from the bank', async ({ page }) => {
  const stem = `E2E approved AI question ${test.info().project.name}`;
  withDb((db) => db.prepare("DELETE FROM ai_mcqs WHERE stem LIKE 'E2E approved AI question%'").run());
  const hadOthers = withDb((db) => (db.prepare("SELECT COUNT(*) n FROM ai_mcqs WHERE status = 'approved'").get() as { n: number }).n > 0);
  await page.goto('/practice');
  const card = page.getByRole('link', { name: /AI practice set/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/\/practice\/ai$/);
  if (!hadOthers) await expect(page.getByRole('heading', { name: 'No approved AI questions yet' })).toBeVisible();
  await noHorizontalScroll(page);

  const id = withDb((db) => Number(db.prepare("INSERT INTO ai_mcqs (created_by, topic_slug, fact_ids, stem, options, key, explanation, status, created_at) VALUES (NULL, 'lobe-collapse-silhouette-signs', ?, ?, ?, 'B', ?, 'approved', ?)")
    .run(JSON.stringify([FACT]), stem, JSON.stringify({ A: 'Left heart border', B: 'Right heart border', C: 'Aortic knob', D: 'Left hemidiaphragm' }), `It silhouettes the right atrium [${FACT}].`, Date.now()).lastInsertRowid));
  try {
    await page.reload();
    await hydrated(page, 'AiMcqPlayer');
    for (let i = 0; i < 60 && !(await page.getByRole('heading', { name: stem }).isVisible()); i++) { await page.keyboard.press('ArrowRight'); await sleep(260); }
    const q = page.locator('article').filter({ has: page.getByRole('heading', { name: stem }) });
    await expect(q.getByText('AI-generated · admin-approved')).toBeVisible();
    await q.getByRole('radio', { name: /Left heart border/ }).click();
    await q.getByRole('button', { name: 'Check answer' }).click();
    await expect(q.getByText('The answer is B.')).toBeVisible();
    await expect(q.getByRole('link', { name: new RegExp(FACT) }).first()).toHaveAttribute('href', `/facts/${FACT}`);
    expect(await axe(page)).toEqual([]);
    await noHorizontalScroll(page);
    // Never mixed into past-paper attempts.
    const attempts = await (await page.request.get('/api/mcq/attempt')).json();
    expect(attempts.some((a: { qid: string }) => a.qid === String(id) || a.qid.startsWith('AI'))).toBe(false);
  } finally {
    withDb((db) => db.prepare('DELETE FROM ai_mcqs WHERE id = ?').run(id));
  }
});

test.describe('with a mock gateway', () => {
  test.skip(!MOCK, 'set AI_BASE_URL to a localhost URL and any OPENCODE_API_KEY to run');

  test('a tutor chat streams a cited answer, persists, renames and deletes', async ({ page, isMobile }) => {
    await page.goto('/tutor');
    await hydrated(page, 'TutorChat');
    const box = page.getByLabel('Ask the tutor');
    await box.fill('What are the signs of right middle lobe collapse?');
    await box.press('Enter');
    const answer = page.locator('.tc-msg.is-ai').last();
    await expect(answer.getByText('Open the cited facts before you rely on this.')).toBeVisible();
    await expect(answer.getByText(/Grounded on \d cited facts?/)).toBeVisible();
    const cite = answer.locator('a.ai-cite').first();
    await expect(cite).toHaveAttribute('href', /\/facts\/F-/);
    await cite.focus();
    await expect(page.locator('.ai-tip')).toBeVisible();
    await expect(page).toHaveURL(/\/tutor\?c=\d+$/);
    expect(await axe(page)).toEqual([]);
    await noHorizontalScroll(page);

    await page.reload();
    await expect(page.locator('.tc-msg.is-user')).toContainText('right middle lobe collapse');
    await expect(page.locator('.tc-msg.is-ai a.ai-cite').first()).toBeVisible();
    const chatId = Number(new URL(page.url()).searchParams.get('c'));
    if (isMobile) await page.getByRole('button', { name: 'Your chats' }).click();
    const scope = isMobile ? page.getByRole('dialog', { name: 'Your chats' }) : page.getByRole('complementary', { name: 'Chats' });
    await scope.getByRole('button', { name: /^Rename chat: What are the signs/ }).click();
    await scope.getByLabel('Chat title').fill('Lobe collapse signs');
    await scope.getByLabel('Chat title').press('Enter');
    await expect(scope.getByRole('button', { name: /^Lobe collapse signs/ })).toBeVisible();
    await scope.getByRole('button', { name: 'Delete chat: Lobe collapse signs' }).click();
    await scope.getByRole('button', { name: 'Confirm: delete chat Lobe collapse signs' }).click();
    await expect(page).toHaveURL(/\/tutor$/);
    expect((await page.request.get(`/api/ai/chats/${chatId}`)).status()).toBe(404);
  });

  test('a topic chat carries its context; stop keeps the partial answer', async ({ page }) => {
    await page.goto(`/tutor?topic=lobe-collapse-silhouette-signs`);
    await hydrated(page, 'TutorChat');
    await expect(page.getByRole('link', { name: 'Topic · Lobar collapse — silhouette sign' })).toBeVisible();
    await page.getByRole('button', { name: /^Summarise Lobar collapse/ }).click();
    await expect(page.locator('.tc-msg.is-ai').last().locator('.tc-foot')).toBeVisible();
    await page.getByLabel('Ask the tutor').fill('Answer slowly please');
    await page.getByRole('button', { name: 'Send question' }).click();
    await expect(page.locator('.tc-msg.is-ai').last()).toContainText('Here');
    await page.getByRole('button', { name: 'Stop answering' }).click();
    await expect(page.getByRole('button', { name: 'Send question' })).toBeVisible();
    const id = Number(new URL(page.url()).searchParams.get('c'));
    const saved = await (await page.request.get(`/api/ai/chats/${id}`)).json();
    expect(saved.chat.title).toBe('Lobar collapse — silhouette sign');
    expect(saved.messages.at(-1)).toMatchObject({ role: 'assistant', content: expect.stringMatching(/…$/) });
    await page.request.delete(`/api/ai/chats/${id}`, { headers: { 'content-type': 'application/json' } });
  });

  test('explain, dispute summaries and generated MCQs stream through the mock', async ({ page }) => {
    await page.goto(`/facts/${FACT}`);
    await hydrated(page, 'AiExplain');
    await page.getByRole('button', { name: 'Explain this fact' }).click();
    const panel = page.getByRole('region', { name: 'AI explanation' });
    await expect(panel.getByText('Middle lobe hugs the heart.')).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Revise with' })).toBeVisible();
    expect(await axe(page, '[aria-label="AI explanation"]')).toEqual([]);

    await page.goto('/review');
    await page.getByRole('button', { name: 'AI summary of both sides' }).first().scrollIntoViewIfNeeded(); // client:visible
    await hydrated(page, 'AiDisputeSummary');
    await page.getByRole('button', { name: 'AI summary of both sides' }).first().click();
    await expect(page.getByRole('region', { name: 'AI summary of both sides' }).first().getByText('Learn both positions.')).toBeVisible();

    await page.goto(TOPIC);
    await hydrated(page, 'AiGenerate');
    await page.getByRole('button', { name: 'Generate MCQs' }).click();
    const dlg = page.getByRole('dialog', { name: 'Generate practice MCQs' });
    await dlg.getByRole('radio', { name: '2' }).click();
    await dlg.getByRole('button', { name: 'Generate 2' }).click();
    await expect(dlg.getByText('Sent to admins for review')).toBeVisible();
    await expect(dlg.getByText('Mock question 1', { exact: false })).toBeVisible();
    expect(await axe(page, 'dialog.ai-dialog')).toEqual([]);
    await dlg.getByRole('button', { name: 'Done' }).click();
    withDb((db) => db.prepare("DELETE FROM ai_mcqs WHERE stem LIKE 'Mock question%'").run());
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`no serious accessibility issues on the AI pages (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ['/tutor', '/tutor?topic=lobe-collapse-silhouette-signs', '/practice/ai', '/practice']) {
      await page.goto(path);
      await page.waitForTimeout(900);
      await noHorizontalScroll(page);
      expect(await axe(page), path).toEqual([]);
    }
  });

  test(`no serious accessibility issues on the AI controls (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/facts/${FACT}`);
    await hydrated(page, 'AiExplain');
    await page.getByRole('button', { name: 'Explain this fact' }).click();
    await page.waitForTimeout(MOCK ? 1500 : 600);
    expect(await axe(page, '[aria-label="AI explanation"]')).toEqual([]);
    await page.goto(TOPIC);
    await hydrated(page, 'AiGenerate');
    await page.getByRole('button', { name: 'Generate MCQs' }).click();
    await page.waitForTimeout(600);
    expect(await axe(page, 'dialog.ai-dialog')).toEqual([]);
    await page.keyboard.press('Escape');
    await page.goto('/review');
    await page.getByRole('button', { name: 'AI summary of both sides' }).first().scrollIntoViewIfNeeded(); // client:visible
    await hydrated(page, 'AiDisputeSummary');
    await page.getByRole('button', { name: 'AI summary of both sides' }).first().click();
    await page.waitForTimeout(MOCK ? 1500 : 600);
    expect(await axe(page, '#mcqs')).toEqual([]);
  });
}
