# Lightbox

A study platform for an FCPS-II radiology class, served at https://lightbox.polytronx.com.

Its content comes from a verification pipeline: 463 facts (420 verified), 420 flashcards, 183 topic notes, 180 past-paper MCQs and 69 atlas images. Every fact keeps its source page and a status badge: **Cited**, **Agreed**, **Unchecked**, **Disputed** or **Edition clash**. Lightbox shows the content and never edits it. Notes, comments and AI answers stay separate from it and carry their own labels.

Classmates sign in with usernames that the admin issues. There is no self sign-up and no email.

**Stack:** Astro 7 (server output, Node adapter), React 19 islands, Tailwind CSS 4, Motion, SQLite (better-sqlite3), FSRS scheduling (ts-fsrs) and MiniSearch.

## Feature tour

| Area | Routes | What it does |
|---|---|---|
| Home | `/` | Daily goals, cards due, streak, "continue where you left off", announcements. |
| Study | `/study`, `/study/<system>`, `/study/<system>/<topic>` | 183 topic notes in 13 systems. Every line shows its status and fact IDs, and the contents list follows your scroll. |
| | `/study/<system>/print`, `/study/compare` | Printable notes for a system. Two to four topics side by side. |
| Facts | `/facts`, `/facts/<id>` | Fact explorer with filters saved in the URL, and a page per fact with its evidence and neighbouring facts. |
| Sources | `/sources`, `/sources/<file>/<unit>` | The original page text next to the facts taken from it. |
| Atlas | `/atlas` | 69 images, each with its exact source caption. Lightbox adds no diagnosis. |
| Practice | `/practice`, `/practice/cards` | FSRS flashcards, with 20 new cards a day plus your own cards. |
| | `/practice/mcq` | The past-paper MCQ bank, answered blind, with the key and evidence shown after you answer. |
| | `/practice/builder`, `/practice/builder?mode=exam`, `/practice/exam/<id>` | Quiz builder and timed exam simulator, with a results review. |
| | `/practice/toacs`, `/practice/toacs/<id>` | Timed TOACS image stations, self-graded against the source captions. |
| | `/practice/ai` | AI-generated MCQs that an admin has approved. |
| Analytics | `/analytics` | Activity heatmap, mastery by system, accuracy trend, forgetting curve, exam readiness and weak topics. |
| Library | `/library`, `/library/c/<id>`, `/library/shared` | Bookmarks, weak spots, collections (private or shared with the class), notes, highlights, your own cards and a 30-day history. |
| Review | `/review`, `/review/pipeline` | Disputed MCQs, paper-versus-source items, edition clashes, unchecked facts, MCQs not answered blind, unreadable pages. A pipeline explorer. |
| Class | `/class`, `/notifications` | Comment threads, upvotes, error reports, class polls on disputed MCQs, the leaderboard and in-app notifications. |
| Tutor | `/tutor` | AI tutor chat grounded in Lightbox facts. Answers cite fact IDs, are labelled as AI and are capped per day. |
| Export | Library, collection, system and account pages | Anki `.apkg` decks, CSV and "download my data". See [Exports](#exports). |
| Account | `/account` | Password, display name, theme, motion, density, text size, and "download my data". |
| Admin | `/admin` | Accounts, announcements and the audit log, plus moderation, polls and the AI queue (see [the admin guide](docs/admin-guide.md)). |

These are available on every page:

- **Ctrl K palette:** search facts, topics, MCQs and captions.
- **Highlighter:** select text to highlight it, add a note, make a flashcard, copy it with its source or search for it.
- **Focus timer:** a 25/5 or 50/10 Pomodoro tied to your daily goals.
- **Focus mode** and **light/dark theme**.
- **Installable offline app.**

AI also appears in three other places:

- "Explain" on a fact page.
- Summaries of disputed evidence in the review centre.
- "Generate MCQs" in the topic reader.

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
| `AI_MODEL` | The model on the Go gateway. Default `deepseek-v4-flash`. |
| `AI_DAILY_CAP` | AI requests per person per day. Default 30. |
| `AI_FALLBACK` | Set to `zen` to fall back to the paid OpenCode Zen gateway when Go fails. Empty means no fallback. |
| `AI_FALLBACK_MODEL` | The model to use on the fallback gateway. |

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
- **`me.json`:** contains your profile basics, marks, collections with their items, notes, highlights, your cards, goals, exams with answers, MCQ attempts, flashcard reviews and study sessions. It never includes other people's data, password hashes or sessions.

The builder (`src/server/anki.ts`) writes a legacy schema-11 `collection.anki2` in memory with better-sqlite3 and zips it with `zlib`. It needs no extra dependencies.

## Offline

`public/sw.js` handles requests as follows:

- **Hashed assets and icons:** cache-first.
- **Pages:** network-first, falling back to the cached copy or `/offline`.
- **`/api/data/*` and `/api/search-index`:** stale-while-revalidate.
- **Every other API**, including exports, AI, notifications and comments: never cached or intercepted.

To force clients to refresh their caches, bump `V` in `sw.js`. Signing out clears the caches. The app manifest has shortcuts to flashcards, a timed exam, the tutor and the library.

## Test

```bash
npm test                      # Vitest: data counts, auth, scheduling, personal layer, exams, analytics, exports
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
