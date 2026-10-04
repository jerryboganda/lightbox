# Lightbox

FCPS-II radiology study platform for a class: verified facts, topic notes, spaced-repetition flashcards, past-paper MCQs, an image atlas and a review centre for disputed items. Served at https://lightbox.polytronx.com.

Stack: Astro 7 (server output, Node adapter), React 19 islands, Tailwind CSS 4, Motion, SQLite (better-sqlite3), FSRS scheduling (ts-fsrs).

## Develop

```bash
npm install
cp .env.example .env        # set ADMIN_USERNAME / ADMIN_INITIAL_PASSWORD for the first admin
npm run dev
```

The first admin is created from `.env` on first start and must choose a new password at first sign-in. Everyone else gets an account from the Admin page.

## Content

Study content is generated from the pipeline output folder and committed under `src/data` and `src/assets/atlas`:

```bash
npm run export-content -- "D:/Radiology Exam Material/_output"
```

The export fails if any count does not match the source.

## Test

```bash
npm test          # unit tests (data integrity, auth, scheduling)
npm run build
npm run e2e       # Playwright: desktop + mobile, light + dark, axe accessibility
```

## Deploy

Every push to `main` runs the tests, builds a Docker image to `ghcr.io/jerryboganda/lightbox`, and deploys it to the VPS with a health check and automatic rollback (`.github/workflows/deploy.yml`). One-time setup on the server owner's side:

1. GitHub repository secrets: `VPS_HOST` (the server IP) and `VPS_SSH_KEY` (a private key whose public key is in the server's `root` authorized keys; a dedicated deploy key is best).
2. On the VPS, create `/opt/lightbox/.env` (see `.env.example`).
3. In Nginx Proxy Manager, add a proxy host `lightbox.polytronx.com` forwarding to `lightbox-web` port `4321` (websockets on, SSL certificate on, force SSL on).

Backups: the `lightbox-backup` container writes `/opt/lightbox/backups/lightbox-*.db` every night at 03:00 Pakistan time and keeps 14 days.
