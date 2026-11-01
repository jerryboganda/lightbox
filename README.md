# Lightbox

A study platform for an FCPS-II radiology class, served at https://lightbox.polytronx.com.

Its content comes from a verification pipeline: 463 facts (420 verified), 420 flashcards, 183 topic notes, 180 past-paper MCQs and 69 atlas images. Every fact keeps its source page and a status badge: **Cited**, **Agreed**, **Unchecked**, **Disputed** or **Edition clash**. Lightbox shows the content and never edits it. Notes, comments and AI answers stay separate from it and carry their own labels.

Classmates sign in with usernames that the admin issues. There is no self sign-up and no email.

**Stack:** Astro 7 (server output, Node adapter), React 19 islands, Tailwind CSS 4, Motion, SQLite (better-sqlite3), FSRS scheduling (ts-fsrs) and MiniSearch.

## Feature tour

| Area | Routes | What it does |
|---|---|---|
| Home | `/` | **Smart today**: pick a time budget and get an ordered plan (due cards, mistakes, new cards, a quiz, a weak topic) where each step opens a ready session. Also daily goals, the streak with freezes, projected exam readiness, "continue where you left off", class nudges and announcements. First sign-in asks three onboarding questions (exam date, daily time, confidence) that seed the goals and the plan. |
| Study | `/study`, `/study/<system>`, `/study/<system>/<topic>` | 183 topic notes in 13 systems. Every line shows its status and fact IDs, and the contents list follows your scroll. The reader adds mastery dots, **Learn this topic**, a blur-to-recall **Self-test**, **Read aloud**, a **Quick check**, AI study aids, and resumes where you stopped. |
| | `/study/<system>/print`, `/study/compare` | Printable notes for a system. Two to four topics side by side. A system page can also be **saved offline** as a pack. |
| | `/fix/<topic>` | Fix-it flow for a weak topic: key points, a drill, a three-question check and a recovery score. |
| Facts | `/facts`, `/facts/<id>` | Fact explorer with filters saved in the URL, and a page per fact with its evidence and neighbouring facts. |
| Sources | `/sources`, `/sources/<file>/<unit>` | The original page text next to the facts taken from it. |
| Atlas | `/atlas` | 69 images, each with its exact source caption. Lightbox adds no diagnosis. |
| Practice | `/practice`, `/practice/cards` | FSRS flashcards with a per-student desired retention, new cards paced to the exam date, interleaved queues and leech detection, plus your own cards. |
| | `/practice/mcq` | The past-paper MCQ bank, answered blind, with a sure/unsure/guess confidence, the key and evidence shown after you answer, and an AI **"Why B, not C?"** that explains your mistake. Wrong answers and lucky guesses join the **mistake bank** (`?set=mistakes`) and come back after 1, 3, 7 and 21 days. |
| | `/practice/builder`, `/practice/builder?mode=exam`, `/practice/exam/<id>` | Quiz builder and timed exam simulator, with a results review. |
| | `/practice/toacs`, `/practice/toacs/<id>` | Timed TOACS image stations, self-graded against the source captions, with an optional AI coach that suggests a grade. |
| | `/practice/ai` | AI-generated MCQs that an admin has approved. |
| Analytics | `/analytics` | Activity heatmap, mastery by system, accuracy trend, forgetting curve, confidence calibration, exam readiness with an exam-day projection, and weak topics with a Fix-it link. |
| Library | `/library`, `/library/c/<id>`, `/library/shared` | Bookmarks, weak spots, collections (private or shared with the class), notes, highlights (which can become flashcards), your own cards and a 30-day history. |
| | `/library/high-yield` | **My high-yield sheet**: a printable one-page sheet built from your own lapses, Again ratings, wrong answers and weak marks. |
| Review | `/review`, `/review/pipeline` | Disputed MCQs, paper-versus-source items, edition clashes, unchecked facts, MCQs not answered blind, unreadable pages. A pipeline explorer. |
| Class | `/class`, `/notifications` | Comment threads, upvotes, error reports, class polls on disputed MCQs, the leaderboard and in-app notifications. The **weekly challenge** (the same 15 keyed questions for everyone, one minute each, with a ranked board) and anonymous **class insights** ("where the class slips", shown only once 3 or more people contributed). |
| Tutor | `/tutor` | AI tutor chat grounded in Lightbox facts. Answers cite fact IDs, carry a grounding badge, are labelled as AI and are capped per day. One-tap next steps follow each answer. |
| Export | Library, collection, system and account pages | Anki `.apkg` decks, CSV and "download my data". See [Exports](#exports). |
| Account | `/account` | Password, display name, theme, motion, density, text size, desired retention, a daily Web Push reminder, offline packs and "download my data". |
| Admin | `/admin` | Accounts with an onboarding kit (login slips and WhatsApp messages), announcements and the audit log, plus moderation, polls, the AI queue with bulk generation and batch review, AI quality, content gaps and health (see [the admin guide](docs/admin-guide.md)). |

These are available on every page:

- **Ctrl K palette:** search facts, topics, MCQs and captions. It understands radiology abbreviations (RML, SUFE, DCIS) and British or American spellings, can narrow to the current topic or system, and suggests "Did you mean" when nothing matches.
- **Keyboard shortcuts:** press `?` for the list. `g` then `h`, `s`, `f`, `p`, `a`, `l`, `c` or `t` jumps to Home, Study, Facts, Practice, Analytics, Library, Class or Tutor.
- **Highlighter:** select text to highlight it, add a note, make a flashcard, copy it with its source or search for it.
- **Focus timer:** a 25/5 or 50/10 Pomodoro tied to your daily goals.
- **Focus mode** and **light/dark theme**.
- **Installable offline app**, with due-count badges on the mobile tab bar.

AI also appears in these places:

- "Explain" on a fact page, and "Why B, not C?" after a wrong MCQ answer.
- Topic study aids in the reader: a 60-second recap, memory hooks and how the topic is examined.
- The TOACS coach, which marks your private answer against the page's facts.
- Summaries of disputed evidence in the review centre.
- "Generate MCQs" in the topic reader.

Each AI answer shows how well it stood on the notes and has thumbs up/down; admins see the votes under AI quality.

Guides: [student guide](docs/student-guide.md) · [admin guide](docs/admin-guide.md).

## Roles and permissions

| | Member | Admin |
|---|---|---|
| Study, practise, library, analytics, exports | yes | yes |
| Comment, upvote, report an error, vote in polls | yes | yes |
| Share a collection with the class | own collections | own collections |
| Change facts, cards, notes or MCQs | no (the pipeline owns content) | no |
| Create accounts, reset passwords, disable users, change roles, post announcements | no | yes |
| Hide comments, resolve reports, run polls, approve AI MCQs | no | yes |

Every page needs a sign-in except `/login`. Health checks and the offline assets are also public.

`/admin` and `/api/admin/*` are for admins only. Every API route checks who owns what it reads or writes. A new account must change its password at first sign-in. Moderation and approval actions are written to the audit log.

## Environment variables

| Variable | Purpose |
|---|---|
| `ADMIN_USERNAME`, `ADMIN_DISPLAY_NAME`, `ADMIN_INITIAL_PASSWORD` | Create the first admin when the database is empty. They must choose a new password at first sign-in. |
| `DB_PATH` | SQLite file. Defaults to `./data/lightbox.db`; Docker uses `/data/lightbox.db`. |
| `HOST`, `PORT` | Where the Node server listens. Docker uses `0.0.0.0:4321`. |
| `OPENCODE_API_KEY` | Key for the OpenCode Go gateway. Without it, the AI features show "AI unavailable" and everything else works. |
| `AI_MODEL` | The model on the Go gateway. Default `deepseek-v4.1-flash`. |
| `AI_REASONING` | Thinking effort sent as `reasoning_effort`. Default `max`; set it empty to omit. Thinking tokens share `max_tokens` on the gateway, and the per-feature ceilings already leave room for it. |
| `AI_DAILY_CAP` | AI requests per person per day. Default 30. |
| `AI_FALLBACK` | Set to `zen` to fall back to the paid OpenCode Zen gateway when Go fails. Empty means no fallback. |
| `AI_FALLBACK_MODEL` | The model to use on the fallback gateway. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Daily study reminders (Web Push). Run `npm run vapid` and paste its three lines. Left empty, the reminder setting is hidden. |
| `LOG_LEVEL` | Server log threshold: `warn` (default), `info` or `error`. Logs are JSON lines; warnings and errors also feed **Admin › Health**. |

Copy `.env.example` to `.env` for local development. Keys belong only in `.env` locally and in `/opt/lightbox/.env` on the server, never in the repository.

## Develop

```bash
npm install
cp .env.example .env          # set ADMIN_USERNAME / ADMIN_INITIAL_PASSWORD for the first admin
npm run dev
```

The first admin is created from `.env` on first start. Everyone else gets an account from the Admin page.

## Content export (pipeline to site)

The study content is generated from the pipeline output folder, which is only ever read. The output is committed under `src/data` and `src/assets/atlas`:

```bash
npm run export-content -- "D:/Radiology Exam Material/_output"
```

The export fails if any count doesn't match the source.

## Exports

Signed-in users can take their cards and data out of Lightbox. Nothing here is cached, by the server or by the service worker.

| Endpoint | Returns |
|---|---|
| `GET /api/export/anki?scope=…` | An Anki 2.1 package, `lightbox-<scope>.apkg`, with one deck named `Lightbox::<scope label>`. |
| `GET /api/export/cards.csv?scope=…` | UTF-8 CSV with a BOM, columns Front, Back, Source, Status, Fact. |
| `GET /api/export/me.json` | All of the caller's own data. See the details below. |

- **Scopes:**
  - `all`: the 420 verified cards.
  - `system:<key>`: for example `system:chest`.
  - `bookmarks` and `weak`: your marked facts that have cards, plus your own marked cards.
  - `mine`: your own cards.
  - `collection:<id>`: a collection you own or one shared with the class. Its facts count, and so do the facts of its topics.
- **Anki notes:** use the note type "Lightbox (verified card)". The Source and Status fields appear under each answer. Each note's guid is stable per fact, so importing a newer export updates cards instead of duplicating them. Your own cards are labelled "not verified by Lightbox".
- **`me.json`:** contains your profile basics, marks, collections with their items, notes, highlights, your cards, goals, exams with answers, MCQ attempts, flashcard reviews, study sessions, and your comments, votes, reports, poll votes and AI tutor chats. It never includes other people's data, password hashes or sessions.

The builder (`src/server/anki.ts`) writes a legacy schema-11 `collection.anki2` in memory with better-sqlite3 and zips it with `zlib`. It needs no extra dependencies.

## Offline

`public/sw.js` handles requests as follows:

- **Hashed assets and icons:** cache-first.
- **Pages:** network-first, falling back to the cached copy or `/offline`.
- **`/api/data/*` and `/api/search-index`:** stale-while-revalidate.
- **Every other API**, including exports, AI, notifications and comments: never cached or intercepted.
- **Offline packs:** **Save offline** on a system page (`src/scripts/offline.ts`) stores its topic pages, print view and every asset they need in the `lb-packs` cache. The service worker answers offline page loads from any cache, packs included. Packs survive version bumps and are listed, with their size, under **Account › Offline packs**.
- **Push:** reminders arrive empty and the worker asks `/api/push/summary` what to say, so no study data passes through the push service.

To force clients to refresh their caches, bump `V` in `sw.js` (currently `lb-v3`). Signing out clears every cache, packs included. The app manifest has shortcuts to flashcards, a timed exam, the tutor and the library.

## Test

```bash
npm test                      # Vitest: data counts, auth, scheduling, personal layer, exams, analytics, exports, planner, streaks, challenge, search
npx astro check
npm run build
npm run e2e                   # Playwright: desktop and mobile, light and dark, axe accessibility scans
```

Parallel checkouts each use their own e2e port: `E2E_PORT=4414 npx playwright test`. The e2e server starts from `dist/`, so build first.

## Deploy

Every push to `main` triggers `.github/workflows/deploy.yml`:

1. Runs the tests and type check.
2. Builds a Docker image to `ghcr.io/jerryboganda/lightbox`.
3. Deploys it to the VPS with a health check, rolling back automatically if the check fails.

One-time setup on the server owner's side:

1. Add the GitHub repository secrets:
   - `VPS_HOST`: the server IP.
   - `VPS_SSH_KEY`: a private key whose public key is in the server's `root` authorized keys. A dedicated deploy key is best.
2. On the VPS, create `/opt/lightbox/.env` (see `.env.example` and the table above).
3. In Nginx Proxy Manager, add a proxy host `lightbox.polytronx.com` forwarding to `lightbox-web` port `4321`. Turn on websockets, the SSL certificate and force SSL.

The compose project lives in `/opt/lightbox` (`deploy/compose.yml`). It has two services:

- `lightbox-web`: limited to 512 MB, with the data volume at `./data`.
- `lightbox-backup`.

## Backups

The `lightbox-backup` container writes `/opt/lightbox/backups/lightbox-YYYY-MM-DD-HH-MM.db` every night at 03:00 Pakistan time and keeps 14 days.

To take a backup now:

```bash
docker exec lightbox-backup node deploy/backup.mjs --once
```

For restoring a backup, see the [admin guide](docs/admin-guide.md#backups-and-restore).
