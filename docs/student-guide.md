# Lightbox student guide

Lightbox is our class's FCPS-II radiology revision space. Everything in it comes from the papers and slides we were given, and every fact was checked by a pipeline before it got here. This guide shows how to get the most out of it.

## Sign in

Your admin gives you a username and a temporary password. At your first sign-in you choose your own password: at least 10 characters, mixing letters with numbers or symbols. You stay signed in for 30 days on each device. If you forget your password, ask the admin to reset it.

To install Lightbox as an app, open it on your phone and choose **Add to Home screen** (Android) or **Share › Add to Home Screen** (iPhone). Pages you have opened stay readable when you lose signal.

## Read the badges

Every fact, and every line of the topic notes, carries a status:

| Badge | Meaning |
|---|---|
| **Cited** (green) | Checked against a cited source. The link is on the fact page. |
| **Agreed** (cyan) | A descriptive fact where the source and textbook knowledge agree. |
| **Unchecked** (amber) | No source found yet. Don't treat it as verified. |
| **Disputed** (red) | The sources disagree. Both positions are kept. |
| **Edition clash** (violet) | An older text and a newer guideline differ. Both are kept. |

Hover over a badge to see what it means. Open any fact (`/facts/<id>`) to see its source page, its evidence and the original page text.

## Find anything: Ctrl K

Press **Ctrl K** (or tap the search icon) to search facts, topics, MCQs and image captions from any page. The palette can also jump to any page or start the focus timer.

## Study

- **Study** (`/study`): 183 topic notes grouped into 13 systems. A topic's contents list follows you as you scroll.
- **Compare topics** (`/study/compare`): put two to four topics side by side.
- **Print all** on a system page: printable notes with the statuses written out.
- **Fact explorer** (`/facts`): filter all 463 facts by status, source, kind or system. Your filters are kept in the address, so you can bookmark a view.
- **Atlas** (`/atlas`): 69 images with their exact source captions. Tap an image to zoom.
- **Focus mode** (the expand icon in the top bar) hides the navigation so you can read.

## Flashcards and FSRS

Open **Practice › Flashcards** (`/practice/cards`). The 420 cards come from verified facts. Lightbox schedules them with **FSRS**, which works out the best moment to show each card again, just before you would forget it.

1. Read the front, try to recall the answer, then tap the card or press **Space** to flip it.
2. Rate how it went:

   | Rating | Key | Use it when |
   |---|---|---|
   | **Again** | 1 | You didn't know it. |
   | **Hard** | 2 | You recalled it with effort. |
   | **Good** | 3 | You recalled it normally. Pressing Space again also rates Good. |
   | **Easy** | 4 | It was instant. |

   On a phone you can also swipe: right for Good, left for Again.
3. Be honest. Pressing Again isn't a failure. It brings the card back sooner, which is exactly what you want.

You get **20 new cards a day**, plus whatever is due. Cards you fail come back within the same session. Reviews save even when you're offline and sync when you reconnect. Flag a card as a **weak spot** to drill it later.

## MCQs, quizzes and timed exams

- **MCQ bank** (`/practice/mcq`): past-paper questions, answered blind. After you answer, you see the key, the verdict and the evidence. Disputed keys are flagged, and questions with no key in the source are marked as unscored.
- **Build a quiz** (`/practice/builder`): pick a ready-made set, such as a **Full paper** or **Quick 10**, or filter by paper, system, key status and your own history (for example, only the ones you got wrong). In **Practice** mode you check each answer as you go.
- **Timed exam** (`/practice/builder?mode=exam`): set a time per question or for the whole paper. Answers save as you go. You can flag questions and jump around with the question grid, and the key only appears after you submit. The results page reviews every question, and you can retake the same paper.

## TOACS stations

**Practice › TOACS** (`/practice/toacs`) runs timed image stations of 30, 60, 90 or 120 seconds.

1. Look at the image. Press **Z** to zoom.
2. Type your answer in the box. It stays private and is never saved.
3. Compare your answer with the model answer. The model answer comes only from the source caption and the facts on the same page, each with its status. Lightbox adds no diagnosis of its own.
4. Grade yourself **Got it**, **Partly** or **Missed**. Partly counts as half, and you can repeat the stations you missed.

## The highlighter

Select any text in a topic note and a toolbar appears:

- **Four highlight colours.** Your highlights come back every time you open the page.
- **Note:** pin a private note to the highlight.
- **Make a flashcard:** opens a card prefilled from the verified fact. Your card joins your daily reviews.
- **Copy with source:** copies the text with the page title, its fact ID and source page, and a link back.
- **Search:** searches Lightbox for the selection.

Tap an existing highlight to recolour it, edit its note or delete it. Keyboard users can press **Tab** right after selecting to reach the toolbar.

## Your library

**Library** (`/library`) collects everything you've saved. Only you can see it:

- **Bookmarks** and **Weak spots:** set with the bookmark and flag icons on facts, topics, MCQs, images and cards.
- **Collections:** group items around a revision theme. Share a collection with the class when it's ready. Classmates' shared collections are under **Class collections**, where you can copy them into your own library.
- **Notes:** your private notes, with **Highlights** grouped by page.
- **My cards:** the flashcards you made. You can edit or delete them here.
- **History:** what you read, answered and reviewed over the last 30 days.

## Export to Anki

You can take Lightbox cards into Anki, AnkiDroid or AnkiMobile:

- **Library › Export to Anki:** choose all verified cards, one system, your bookmarks, your weak spots, your own cards or one of your collections. You'll see how many cards are in your choice before you download.
- **On a collection page:** **Export to Anki**.
- **On a system page** (for example `/study/chest`): **Anki deck**.

Pick **Anki deck (.apkg)** or **Spreadsheet (.csv)**, then download.

- **Anki desktop:** choose **File › Import** and pick the `.apkg` file.
- **AnkiDroid or AnkiMobile:** open the downloaded file and share it to Anki.

The deck is called `Lightbox::<your choice>`. Each card shows its source and status under the answer. If you import a newer export later, Anki updates the cards you already have instead of adding duplicates. Your own cards are labelled as not verified.

To keep a copy of everything else, go to **Account › Download my data**. You get one JSON file with your bookmarks, collections, notes, highlights, cards, goals, exams, answers, reviews, focus sessions, comments, reports and AI tutor chats.

## Focus timer and goals

The timer pill sits in the bottom corner of every page.

- **Sessions:** start a **25/5** or **50/10** Pomodoro. It keeps running as you move between pages. You can show the countdown in the tab title or play a soft chime when a phase ends.
- **Daily goals:** set them in the timer panel. There are goals for cards, MCQs and focus minutes, plus an optional exam date. Home shows your progress against them.
- **Analytics** (`/analytics`): your activity heatmap, mastery by system, accuracy trend, forgetting curve, exam readiness and weakest topics.

## The AI tutor

**Tutor** (`/tutor`) answers questions using only Lightbox facts. AI also appears as **Explain** on fact pages and **Generate MCQs** in topic notes.

- **Grounded:** answers cite the fact IDs they used. Open them and check. If Lightbox doesn't cover something, the tutor says so instead of guessing.
- **Not verified:** AI text is always labelled as AI. Treat it as a study partner's explanation, not as verified content.
- **Daily limit:** each person has a daily limit, and repeated questions are answered from a cache.
- **Practice MCQs:** generated MCQs only reach **Practice › AI MCQs** (`/practice/ai`) after an admin has reviewed them.

## Class

**Class** (`/class`) is where we help each other:

- Discuss facts, MCQs and disputed items in comment threads, and upvote good explanations.
- Vote in class polls on disputed keys.
- See the leaderboard.

Use **Report** on a fact or topic when something looks wrong. Reports go to the admins and on to the pipeline, which owns the content. Lightbox itself never changes a fact because of a comment or a vote.

Questions or problems? Ask your admin.
