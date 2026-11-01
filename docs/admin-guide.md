# Lightbox admin guide

This guide covers running Lightbox for the class:

- [Accounts](#accounts)
- [Announcements](#announcements)
- [Moderation](#moderation)
- [Class polls](#class-polls)
- [Weekly challenge and class insights](#weekly-challenge-and-class-insights)
- [The AI queue](#the-ai-queue)
- [Content gaps](#content-gaps)
- [Health](#health)
- [Daily reminders](#daily-reminders)
- [Exports and the pipeline](#exports-and-the-pipeline)
- [Backups and restore](#backups-and-restore)
- [Rotating the OpenCode key](#rotating-the-opencode-key)

Everything under `/admin` is for admins only, and each request checks the role again. Admin actions are written to the audit log, and the latest ones are listed under **Recent activity** on the Admin page.

## Accounts

There is no self sign-up. You issue every account from **Admin › Add a classmate** (`/admin`).

1. **Fill in the details:**
   - **Username:** 3 to 32 characters. Letters, numbers, dot, dash and underscore are allowed, and it's stored in lower case. For example `ayesha.k`.
   - **Display name:** what classmates see on comments and the leaderboard. It falls back to the username.
   - **Role:** *member* for classmates, *admin* for anyone who helps you moderate.
2. **Send the temporary password.** Lightbox shows it once, in the form `abcd-efgh-jkmn`. The **Copy login details** button copies a ready-made message with the link, username and password. Send it privately, in person or by direct message.
3. **First sign-in:** the classmate must choose their own password before they can do anything else. It needs at least 10 characters, mixing letters with numbers or symbols. They then answer three quick questions (exam date, daily time and confidence) that set their goals and their daily plan.

### Setting up the whole class

The **Users** tab opens with a set-up checklist that ticks itself off as you go:

1. **Create an account for each classmate.** Choose **Several** to paste the whole class at once, one person per line.
2. **Share the logins.** The password dialog can:
   - **print cut-out login slips**, one per person, with the link, username, temporary password and first-sign-in steps;
   - **send each person a WhatsApp message** with the same details, using the button beside their name.
3. **Chase anyone who has not signed in.** The checklist shows how many people haven't chosen a password yet and filters the list to them.
4. **Post a welcome announcement.** Mention the weekly challenge in Class.

The **Users** list has these actions on each row:

| Action | What happens |
|---|---|
| **Reset password** | Issues a new temporary password. It also signs the person out everywhere and makes them choose a new password again. |
| **Disable / Enable** | Disabling signs the person out at once and blocks sign-in. Their collections stop appearing as class collections. Their data stays, so enabling them again restores everything. |
| **Make admin / Make member** | Lightbox always keeps at least one active admin. |

After 8 failed attempts, sign-in is throttled for 15 minutes for that username and address. Sessions last 30 days.

The very first admin is created from the `ADMIN_USERNAME`, `ADMIN_DISPLAY_NAME` and `ADMIN_INITIAL_PASSWORD` values in `.env`. This only happens while the database has no users.

## Announcements

**Admin › Announcement** posts a short message, up to 600 characters, to everyone's Home dashboard. Hide it when it's no longer needed.

## Moderation

Classmates can comment on facts, topics, MCQs, images and disputed items. They can also upvote comments and report errors. Comments and reports never change the content itself, which belongs to the pipeline.

- **Comments:** an admin can hide a comment and give a reason. A hidden comment stays in the database with who hid it and why, so you can show it again later. Authors can edit or delete their own comments.
- **Reports:** each report records:
  - **What it's about:** a fact, topic, MCQ, image or comment.
  - **Kind:** wrong, source, typo, unclear, duplicate, offensive or other.
  - **Details:** an optional quote and the page it came from.

  Work through the queue and set each report to **accepted**, **rejected** or **fixed**, with a short resolution note.
- **Rate limits:** comments, reports and AI requests are rate-limited per person, which stops a stuck key or a bad day from flooding the class.

## Class polls

Class polls let everyone vote on a disputed MCQ's key. You can also run a custom poll with your own question and options.

- Each MCQ has at most one poll.
- Each person has one vote and can change it until the poll closes.
- A poll can have a closing time, or you can close it by hand.

Poll results are opinion, not evidence. Lightbox keeps showing the pipeline's verdict and evidence beside them.

## Weekly challenge and class insights

Both run on their own; there's nothing to set up.

- **Weekly challenge:** every Monday (Pakistan time), Lightbox picks 15 keyed, undisputed past-paper MCQs, spread across systems and clear of the last four weeks' questions. Everyone gets the same set, one minute per question, with one attempt each. Attempts whose time runs out are scored as they stand. The board on **Class** ranks the week's finishers by score, then speed, and Home nudges people who haven't finished.
- **Where the class slips:** an anonymous summary on **Class** of the questions most people get wrong (with the most popular wrong answer) and the topics with the most forgotten cards and wrong answers over the last 30 days. It never shows names, and an item appears only once at least 3 different people contributed. Use it to choose what to go over in a teaching session.

## The AI queue

AI features run through the OpenCode Go gateway (see the `OPENCODE_API_KEY` and `AI_*` settings in the README):

- **Explain this fact**
- **The tutor**, with one-tap next steps
- **Why B, not C?** after a wrong MCQ answer
- **Topic study aids:** a 60-second recap, memory hooks and how the topic is examined
- **The TOACS coach**
- **Disputed-evidence summaries**
- **Generate MCQs**

All of them are labelled as AI, cite the Lightbox fact IDs they used, and never replace verified content. Answers are cached, and each person has a daily cap (`AI_DAILY_CAP`).

Generated MCQs go into the approval queue on **Admin › AI review** as **pending**. For each one, check the stem, the options, the key and the explanation against the cited facts. You can edit them inline. Then:

- **Approve** it, and it appears in `/practice/ai` for everyone.
- **Reject** it, with a reason the creator sees, and it stays out of practice.

To work faster:

- **Review several at once:** tick questions (or **Choose all**), then **Approve chosen** or **Reject chosen** with one reason.
- **Fill thin topics with AI questions:** pick topics (or **Pick the thinnest**), choose how many per topic, and **Generate**. Lightbox writes each topic's questions from its verified facts only, drops near-duplicates of questions already in the bank, and sends the rest to the queue. A daily cap or a missing key stops the run.

**AI quality** on the same tab shows each AI feature's volume over recent days: answers, how many were shared from the cache, failures, average time, and grounding. **Grounded** means every citation is a fact the AI was given. **Unsourced** answers cited nothing and are worth spot-checking. It also shows the students' thumbs up and down. Only the counts are logged, never the answer text.

Approvals and rejections are written to the audit log. If the gateway is down or the key is missing, the AI features say "AI unavailable" and the rest of Lightbox works as normal.

## Content gaps

**Admin › Content gaps** shows what the notes are missing, from how the class actually uses them:

- **Tutor questions the notes could not answer.**
- **Questions the class gets wrong.**
- **Cards the class keeps forgetting.**
- **Read topics with no past-paper question.**
- **Unverified facts people are reading.**

Hand these to the pipeline as candidates for new facts, better cards or verification. Lightbox itself never changes content.

## Health

**Admin › Health** shows how the server is doing since its last restart:

- Uptime, errors and warnings in the last 24 hours, memory, database size and the Node version.
- **Failing routes**, **slowest routes** and **busiest routes**.
- **Recent warnings and errors**, including JavaScript errors reported by students' browsers (rate-limited).

The server writes JSON log lines to standard output. Set `LOG_LEVEL` to `info` for more detail while debugging.

## Daily reminders

Students can turn on one study reminder a day under **Account › Study settings**. Reminders need a VAPID key pair on the server:

1. On a development machine, run `npm run vapid`. It prints three lines.
2. Paste them into `/opt/lightbox/.env` as `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` or `https:` contact).
3. Restart the web container.

Without the keys, the reminder setting is hidden. Pushes arrive empty and the app asks the server what to show, so no study data passes through the browser vendors' push services. Keep the same keys: changing them silently breaks everyone's existing subscriptions.

## Exports and the pipeline

Content flows one way: the pipeline's `_output` folder feeds the site, and the site never writes back.

1. **Reports to the pipeline:** export the open reports as JSON from the moderation view. Hand the file to the pipeline run that fixes facts, cards or keys.
2. **Pipeline to the site:** after the pipeline has fixed the content, regenerate the site data on a development machine and deploy:
   ```bash
   npm run export-content -- "D:/Radiology Exam Material/_output"
   npm test && npm run build
   git commit -am "Content update" && git push      # the workflow deploys it
   ```
   The export fails if any count doesn't match the source, which stops a partial copy from shipping.
3. **Close the loop:** mark the matching reports as **fixed**.

Students can also take content out themselves:

- **Anki decks or CSV:** from the Library, a collection or a system page. These use `/api/export/anki` and `/api/export/cards.csv`.
- **Their own data as JSON:** from the Account page (`/api/export/me.json`).

These exports only ever contain the requesting user's own data, plus verified cards.

## Backups and restore

The `lightbox-backup` container copies the SQLite database every night at 03:00 Pakistan time:

- **Location:** `/opt/lightbox/backups/lightbox-YYYY-MM-DD-HH-MM.db`
- **Kept:** 14 days.
- **Method:** SQLite's online backup, so the copy is consistent while the site keeps running.

**Take a backup now**, for example before a risky change:

```bash
docker exec lightbox-backup node deploy/backup.mjs --once
ls -lh /opt/lightbox/backups | tail -3
```

**Copy a backup off the server** from your own machine:

```bash
scp vps:/opt/lightbox/backups/lightbox-2026-10-05-03-00.db .
```

**Restore a backup:**

```bash
cd /opt/lightbox
docker compose stop web
cp data/lightbox.db data/lightbox.before-restore.db          # keep the current state, just in case
cp backups/lightbox-2026-10-05-03-00.db data/lightbox.db
rm -f data/lightbox.db-wal data/lightbox.db-shm              # stale write-ahead files must not be replayed onto the restored copy
chown 1000:1000 data/lightbox.db
docker compose start web
curl -s https://lightbox.polytronx.com/api/health
```

Anything written after the backup was taken is lost. That includes reviews, comments and new accounts, so tell the class.

To check a backup without restoring it, open it with `sqlite3 lightbox-….db 'PRAGMA integrity_check; SELECT COUNT(*) FROM users;'`.

## Rotating the OpenCode key

Rotate the key if it may have leaked or a classmate has seen it, or as routine hygiene.

1. Create a new key in the OpenCode dashboard.
2. On the VPS, edit `/opt/lightbox/.env` and replace `OPENCODE_API_KEY=` with the new key.
3. Recreate the web container so it reads the new environment. A plain `restart` keeps the old values.
   ```bash
   cd /opt/lightbox && docker compose up -d --force-recreate web
   ```
4. Open any fact page and press **Explain** to check that the AI answers.
5. Revoke the old key in the OpenCode dashboard.

Use the same steps to change `AI_MODEL`, `AI_DAILY_CAP` or the fallback settings. Never commit a key to the repository, and never paste it into chat or an issue.
