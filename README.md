# Notecyclopedia

A shared study encyclopedia: a wiki of lectures and notes with formulas, uploaded source files,
reusable calculators, and an AI portal (ask, tutor, check my working, summarize, solve, build calculator) grounded
in your notes.

Design reference: [`design/`](design/README.md).

## Stack

| Part | Tech |
|---|---|
| Monorepo | pnpm workspaces: `apps/web`, `apps/server`, `packages/shared` |
| Web | React 19, TypeScript, Vite, TanStack Router + Query, Tailwind CSS v4, TipTap editor, KaTeX, i18next (bg/en) |
| Server | Node 22, Express 5, Drizzle ORM, PostgreSQL 16 + pgvector, Better Auth (email + password), pg-boss jobs, multer uploads |
| Files | unpdf (PDF), officeparser (DOCX/PPTX/XLSX/ODF), Claude vision for photos |
| AI | Claude API (`@anthropic-ai/sdk`), streamed over SSE; Voyage embeddings (optional) |
| Calculators | JSON spec validated with zod, evaluated with a sandboxed math.js; export to .json / .py / .html / .xlsx |

## Getting started

Requirements: Node 22+, pnpm 10+, Docker (for Postgres).

```bash
pnpm install
cp .env.example .env          # then set BETTER_AUTH_SECRET (and ANTHROPIC_API_KEY for AI)
pnpm db:up                    # Postgres + pgvector in Docker
pnpm db:migrate               # create tables (also gives existing formula blocks their ids)
pnpm dev                      # web on http://localhost:5173, API on :3001
```

Open http://localhost:5173, create an account, create a course, and add pages.
To share a course with classmates, they sign up first, then the course owner invites them by email
(as editor or viewer) from the course page.
Use the theme control in the navigation or sign-in screen to switch between light and dark mode;
your choice is saved in this browser.

## Course protocols

Upload protocols to an individual course to keep its protocol documents organized with the rest of
the course materials. Each protocol belongs to the course it was uploaded to.

## Docker container

```sh
pnpm db:up
docker compose stop db
```

## Data backup

Open **Profile → Data backup** to download a versioned ZIP backup or restore one. Backups include
courses you can access, pages and revision history, calculators, course constants, and uploaded file contents. They do
not include sign-in credentials, sessions, AI conversations, or browser-local preferences. Import
validates and previews the archive before creating new private copies owned by the signed-in user;
it never merges with or overwrites existing data. Derived formula and search indexes are rebuilt,
and uploaded files are queued for re-indexing.

The page shows when your last backup download finished. With no backup yet, or one older than 14 days, it reminds you
to download a fresh one. Nothing is backed up automatically.

## Lectures and useful links

- **Original lectures:** in **Uploads**, give a lecture number when uploading a lecture's slides or PDF (one file at a
  time), or use **Mark as original lecture** on an uploaded file. Every course numbers its own lectures, so the number
  always goes with a course: the upload course beside it, or the course picked in the mark form (a file marked as
  another course's lecture moves to that course). The lectures of that course that already have an original are listed,
  and a taken number is caught before saving. One original per lecture of a course, kept in backups (a file moved to
  another course with its page is unmarked). An article created
  from it starts with its lecture number.
- **Lectures** (sidebar): only the originals, in lecture order. Each opens the original file and lists its subset: the
  pages with that lecture number (the article made from it, its parts and notes), its example problems and its
  calculators. Lectures that have pages or calculators but no original yet are named underneath, with a link to
  Uploads. **Edit** puts a **Move lecture** button on each card: pick a course (or keep it) and the lecture number
  there; the original moves, and by default its pages, example problems and calculators too, all renumbered. Files
  attached to those pages and the search index follow; a number already taken in that course is caught first.
- **Any page type can carry a lecture number** (lecture, theory, notes, sources, example problems). The Wiki and course
  pages switch between **By type** (sections, reorderable) and **By lecture**: each lecture with a link to its
  original, then the lecture, its theory, notes and sources, its example problems and its calculators; pages not tied
  to a lecture come last. The choice is remembered in the browser. A page with a lecture number links to that
  lecture's original.
- **Calculators** tagged with a course can also be tagged with one of its lectures (**Lecture (optional)** in the
  editor); an untagged calculator has none. The tag is kept in backups.
- **Useful links** (sidebar): NASA's Eyes, the Copernicus Browser, JPL Horizons and CelesTrak built in, each with a
  note on what it is for. Add your own (name, address, note); they are saved to your profile, only `http(s)` addresses
  are accepted, and removing one asks first.

## Course structure

A course's pages are shown in sections: **Lectures** (by lecture number), **Example problems**, **Theory**, **Notes**
and **Sources**; empty sections are hidden and each can be collapsed. An example problem's lecture number is the
lecture it practises: problems are listed under their lecture, and each lecture shows how many it has. Reordering
(**Edit order**) moves pages within their section.

The **Formulas** page groups formulas by subject (course) and then by lecture, with subject filter chips next to the
text filter.

## Terms and references

Every heading in a page is a **term**: it gets a stable id (like formulas, kept across edits) and appears in search,
where it ranks above whole pages, so searching a topic opens the page at that section. Theory pages rank above the
lectures they summarise.

**Reference** in the editor's toolbar links the selected text, or inserts a name, to a page or to a term on it
(`/pages/<page>#<heading id>`). References open inside the app and scroll to the heading; they are underlined with
dots to tell them apart from external links. Each page lists what references it under **Referenced by**, with the
section each one points to, and **On this page** links to its own sections. Backups keep references, pointing them at
the imported copies; the AI review keeps heading ids and references. `pnpm db:migrate` gives headings of existing
pages their ids.

**Theory pages are topic hubs**: a short overview of a topic, its key formulas, and links to where the course covers it,
rather than a copy of the lectures (copies drift apart and make search and the AI see everything twice). On a theory
page, **Draft topic hub with AI** uses the title as the topic: Claude writes the overview and formulas from the
course's notes and picks, from the course's matching sections and pages, where it is covered. The links are built by
the app from that list, so they always point at existing sections. The draft only fills the editor; nothing is saved
until you save. Its model is the `topic-hub` feature in `ANTHROPIC_MODELS_JSON`.

## Help while reading

While reading a page, select some text and choose **Explain**, **Why does this hold?** or **Show an example**; click a
formula block for the same questions. The answer opens in a side panel, with the page as its source (one Claude call
per question, only when asked; its cost is shown), and can be continued in the AI portal.

- **Formula cards** (no AI): clicking a formula shows where else the same formula appears in your courses (LaTeX
  compared without spaces), linking to it on that page, and the calculators made from or embedded in its page.
- **Pin a formula** to your home page with the ☆ in front of it while reading, on its card, or in the **Formulas** list
  (★ when pinned). Pins are your own: they are not part of the page, so pinning makes no revision and every member of
  the course, viewers included, pins for themselves. Remove one from **Pinned formulas** on the home page with its ×
  (it asks first). Formulas pinned before pins were personal stay pinned for everyone in their course.
- **Keep the answer:** **Add to page** opens the page editor with the answer added at the end as an unsaved change,
  under a heading naming the question; review or edit it, then save, or leave to discard it. In the AI portal,
  **Save to page…** does the same for any page an answer cites. An explanation kept this way is paid for once.

## Page history and AI review

Open a page's **History** tab to see every saved revision. **Show changes** lists what that revision added and
removed compared with the one before it, block by block (formulas appear as LaTeX), and collapses long unchanged
stretches. Editors can **Restore this version**: the old title and content are saved as a new revision, so
nothing in the history is lost, and a restore that races another save is rejected like a conflicting edit.

**Review & polish** asks Claude to check a page and propose a revised version. The proposed version opens in an
editor next to the current page, so you can adjust it before accepting; **Restore AI version** discards your
edits to it. Nothing is saved until you choose **Accept changes**, which saves the edited version as a new revision.

## Calculators, plots and images in pages

The editor toolbar's **Calculator** button inserts a calculator from the library into a page, shown either as an
interactive calculator or as a **plot**: choose the input to sweep along the x-axis, its range, and up to four
outputs. Outputs with different units get a chart each, so no chart has two y-scales. Readers can change the other
inputs, read values with the pointer or the arrow keys, and open a table of the values.

A block stores a copy of the calculator, so it works for everyone who can read the page (library calculators are
personal), survives backups, and is visible to search and the AI. Editors can choose **Update from library** to pull
in later changes to their own original. Blocks are validated when a page is saved.

The **Image** button uploads a PNG, JPEG, GIF or WebP file to the page's course and shows it with an optional
caption. Images are indexed like other uploads: with `ANTHROPIC_API_KEY` set, Claude transcribes each one for search,
which is a paid API call per image.

Uploaded files are served with the type that matches their extension, and only PDFs, images and plain text open in
the browser; everything else downloads.

### Your calculator library

Calculators are personal: only you see, change and run yours. The **Course** field is a tag, not sharing: it can be
any course you belong to, and it sorts the library and links the calculator to the course's lectures. Deleting a
course, or leaving it, clears the tag; the calculators stay yours.

- **Sort and filter:** the library is grouped by course (in course order, untagged last) and then by lecture, or
  sorted by name or by last edited, with a **Show course** filter.
- **Archive:** hides a calculator from the library, the calculator picker and the tutor; pages that embed it keep
  working. It is listed under **Archived**, where **Restore** brings it back.
- **Duplicate:** a copy (with its course and lecture tags) to rework while the original stays as it is for the pages
  that embed it. The copy links to its original.
- **Rework with AI:** describe the change ("solve for the radius instead", "add the escape speed"); one Claude call,
  only when you press **Propose changes**, returns the reworked calculator as changes, like **Check formulas with
  AI**. **Edit with these changes** opens them in the editor; nothing is saved until you press Save. Duplicate first
  to keep the original.

### Checking calculators

Each calculator is checked automatically, without AI, whenever it is shown or edited: every formula must evaluate with
the default values, every input and constant must be used, and each formula's units must give the unit of its output
(units are compared as SI dimensions with math.js, so `sqrt(mu / r)` with μ in km³/s² and r in km gives km/s). Inputs
without a unit count as plain numbers, angles in degrees or radians are treated as numbers, and formulas that use a
constant without a stated unit, or a unit math.js does not know (`AU`, `%`), are not unit-checked rather than guessed.

Physical constants are constants, not inputs. A gravitational parameter given as an input (key `mu`, `μ`, `GM` or
`mu_…`, or labelled "gravitational parameter") is flagged, and **Make it a constant** turns it into one in the editor:
the same key, so the formulas and pages that embed the calculator are unaffected, with the input's default as its value
and its label and unit as its description. Any other input can be turned into a constant with **Make constant** in the
editor. The built-in orbit and Hohmann calculators hold the Earth's μ as a constant (the orbit diagram uses its central
body's own μ), and AI-generated calculators are asked to put μ, G, g₀, c and the like in their constants.

**Check formulas with AI** asks Claude to review the physics or mathematics of each formula, units and conversions,
defaults, the theory and the step explanations, with the automatic checks attached. It lists its findings and, when
something should change, the exact changes (old and new formula, added or removed inputs and outputs, constant units).
**Edit with these changes** opens them in the editor; nothing is saved until you press Save, and Cancel keeps the
calculator as it was. The correction keeps the input and output keys where it can, because pages that embed the
calculator refer to them. Set its model with the `calculator-review` feature in `ANTHROPIC_MODELS_JSON`.

## Orbit diagrams

Choose **Orbit diagram** in the toolbar's **Calculator** dialog to add an interactive two-body orbit to a page, or open
**Orbits** in the navigation for a standalone viewer (its URL takes the elements, e.g. `/orbit?a=26600&e=0.74&i=63.4&argp=270`).

- Set the six classical elements (a, e, i, Ω, ω, ν) with sliders or numbers, pick a preset, or change the central body.
- The **orbital plane** view shows the body at a focus, periapsis and apoapsis, the position and velocity vectors, the
  true anomaly and the flight-path angle. The velocity arrow's length is the speed (longest at periapsis), and faint
  arrows at both apsides show vₚ and vₐ to the same scale. **Equal areas** shades sectors swept in equal times
  (Kepler's second law).
- The **3D view** shows the orbit against the reference plane (the part behind it dashed), the line of nodes and the
  Ω, i and ω angles. Drag it, or use the Turn and Tilt sliders, to rotate.
- **Play** runs the orbit on a simulated clock: **Time warp** sets how many simulated seconds pass per real second
  (real time to ×100 000; ×1 000 by default, where a low orbit takes about 5 s and a geostationary one 86 s), so orbits
  keep their true periods relative to each other. The satellite moves at a steady mean anomaly, so it speeds up near
  periapsis. The current speed and the simulated time are shown above the views; the clock restarts when you change
  the orbit.
- Derived values include the speeds at periapsis and apoapsis, the circular and escape speeds at the current
  radius, and the J2 drift of the node and periapsis (deg/day).
- **J2 drift** adds the first-order secular effect of the body's equatorial bulge while playing: the node regresses
  (westward for prograde orbits; eastward for retrograde ones, which is what makes the Sun-synchronous preset follow the
  Sun at about 0.986° a day) and the periapsis precesses, except at the critical inclination 63.4° (Molniya, Tundra).
  Because the drift is slow, the 3D view also draws the orbit 30 days later (dotted), and the readout shows how far Ω
  and ω have drifted since the clock started (ω only for e ≥ 0.01: a nearly circular orbit has no clear periapsis); at ×100 000 a second of viewing is more than a day. Short-period
  oscillations, drag and third bodies are not modelled.
- **Ground track** shows the point under the satellite on the rotating body for three orbits at a time (flown part
  solid), on a labelled 30° longitude–latitude grid, with coastlines for Earth (Natural Earth 1:110m land, public domain,
  loaded only when the ground track is shown). For Earth, **Start (UTC)** (the current time by default) fixes Earth's
  rotation at the start through the Greenwich sidereal angle, so longitudes are real, taking Ω from the vernal
  equinox. For the Moon and Mars the prime meridian starts at the reference direction x, so longitudes are relative.
- The orbit shown is computed from the starting orbit and the simulated time (not stepped frame by frame), so long
  runs do not drift. Tests check the propagation against step-by-step numerical integration (to a metre after more
  than an orbit) and the J2 rates against integration with the full J2 acceleration (to within 1% over 20 days). While playing, the values table and the element fields update ten times a second.
- Derived values come from the same formulas as the built-in *Elliptical orbit* calculator
  (`ORBIT_CALCULATOR` in `packages/shared/src/orbit.ts`), computed in plain code (`orbitValues`, tested to agree with
  the calculator), so pages with only orbit diagrams do not load the calculator engine (math.js). In a page the
  diagram shows the key values (altitudes, period, speeds, and the J2 drift when on) with **More values** for the rest;
  the standalone viewer shows them all. Small rates are shown with fixed decimals (0.0004 deg/day).

Readers can explore freely; in the editor, **Save orbit** stores the current elements as the block's starting orbit.
Only closed orbits are supported (eccentricity below 0.99).

**GMAT and FreeFlyer files.** GMAT scripts (`.script`) and FreeFlyer mission plans (`.MissionPlan`) can be uploaded like
other files. **Preview** shows them as read-only text (nothing is executed) and lists each spacecraft whose initial
orbit the file defines, as Keplerian elements or as a Cartesian state, with **Open in orbit viewer**. GMAT spacecraft
in a lunar or Martian coordinate system orbit that body; others orbit Earth.

The files are read with an independent parser of their plain-text property assignments; no GMAT or FreeFlyer code,
libraries or documentation are included, and neither program is needed. FreeFlyer is a trademark of a.i. solutions, Inc.
GMAT (General Mission Analysis Tool) is developed by NASA. Notecyclopedia is not affiliated with or endorsed by
a.i. solutions or NASA.

**AI.** In the AI portal, Claude can show an orbit diagram with its answer (for example "show me a Molniya orbit"); the
diagram is interactive and can be opened in the orbit viewer.

## AI tutor

The AI portal has six modes. **Ask** answers questions about your notes. **Tutor** helps you solve a problem yourself:
it explains the idea, asks what you have tried and gives one hint at a time. **Next hint** and **Show full solution**
buttons appear under its answers. **Check my working** takes the problem and your attempt, typed or as up to three
photos (**Add photo**, or paste an image into the message box), and points out the first mistake instead of redoing
the problem. **Summarize**, **Solve** and **Build calculator** work as before.

- **Numbers come from your calculators.** In every mode Claude can search your saved calculators
  (`find_calculators`) and run one (`run_calculator`) instead of doing the arithmetic itself. Each run is shown under
  the answer with the values used and its step-by-step solution; you can change the inputs there. Only your own
  calculators, not archived ones, are visible to it.
- **Calculators on request.** Only Build calculator makes calculators automatically. Under a Solve answer, or a full
  solution from the tutor, **Make a calculator from this** makes them from the solution and stores them with the
  answer, so you pay only when you want them. A request with several independent calculations gets one calculator
  for each (up to six); steps that feed into each other stay in one calculator.
- **Cost of each answer.** Every answer shows its tokens (input, of which cached, and output), the estimated cost
  from `ANTHROPIC_PRICING_JSON` and the model used, summed over all Claude calls it took.
- **A model per feature.** `ANTHROPIC_MODEL` is the default; `ANTHROPIC_MODELS_JSON` overrides it per feature, e.g.
  `{"ask":"claude-haiku-5-5","summarize":"claude-haiku-5-5"}`. Features are the portal modes (`ask`, `tutor`,
  `check`, `summarize`, `solve`, `calculator`) and `calculator-spec`, `calculator-review`, `topic-hub`, `daily-question`, `article-draft`,
  `page-review` and `image`
  (photo transcription for uploads). Add a pricing entry for each model you use.

Photos are downscaled in the browser (at most 1568 px on the long edge, JPEG) and stored with the conversation, so
follow-up questions still see them; the usage log stores them without the image data.

## Daily questions

**Daily questions** (in the sidebar, and **Today's question** on the home page) are study questions about your recent
lectures. Questions are made only when you ask, one Claude call each, and answers are hidden until you want them.

- **Today's question:** press **Generate**; the first question of your day (in your time zone) stays today's question,
  so pressing it again costs nothing. Pick a course, or all your courses; the choice is remembered in the browser.
- **New question:** **Ask me a question** makes another one at any time, in addition to today's.
- **No duplicates:** topics are the headings (terms) of your six most recent lectures and theory pages, chosen without AI.
  A topic you were never asked about comes first; once all have been used, the one asked about longest ago. When a
  topic comes up again, Claude is shown your earlier questions on it and asked for a different aspect.
- **Grounded:** the question and model answer come from the notes of that section, in the language of your notes
  (decided by the app, with your interface language as the fallback); anything beyond the notes is labelled.
- **All questions:** every question, newest first and grouped by day, with a subject filter, text search and **Load more**.
- **Check my answer** opens the tutor's *Check my working* mode with the question and your answer. **Tell it as a story**
  and **Harder question** are stored, so each costs at most one call; **Ask your own question** opens the tutor with
  your message started. **Save to page** appends a question, its answer and expansions to its page as a new revision.
  The AI cost so far is shown under each question.

Its model is the `daily-question` feature in `ANTHROPIC_MODELS_JSON` (a cheaper model such as Haiku suits it).

## Study companion

- **Where was I** (home page): the pages you opened most recently, your latest AI sessions (pick a tutor session up
  where you left it), and **Topics you asked about**: the pages your answers of the last 30 days were drawn from,
  most asked first. It comes from your own activity, so it costs nothing. Until you open pages, recently edited ones
  show.
- **Exam prep** (sidebar): choose a course, the exam date (up to 90 days ahead), minutes a day, the weekdays you study
  on, and optionally the exam's scope (which pages it covers) and how well you know each page (*I know it*, *Shaky*,
  *New to me*). Claude proposes a revision plan over those pages and their sections in one call, spending more time
  on shaky and new ones; only your study days are offered, and the app fills in the dates and page links, so they
  always point at real days and pages. Its model is the `exam-plan` feature in `ANTHROPIC_MODELS_JSON`.
- **Keeping the plan up to date** (no AI): tick tasks off, rename, remove or add tasks (with or without a page),
  move a task to any study day before the exam, or change the exam date. **Catch up** spreads unfinished tasks from
  past days over the study days left, least busy days first; after moving the exam earlier, **Move before the exam**
  does the same for tasks on or after it. Each change is saved at once.
- **Several exams per course** (a midterm and a final, a retake): plans are not limited per course, but proposing
  one for a course that already has a plan with its exam ahead warns first and offers to open it. Plans whose exam
  has passed are folded under **Past exams**. Click a plan's title to rename it.
- **Pause / Resume:** a paused plan is kept as it is, but left out of today's revision and of the reminder about
  existing plans; paused plans are listed apart.
- **Export / import** (no AI): **Export** downloads the plan as a JSON file. **Import a plan** reads one into any of your
  courses: tasks are linked to that course's pages by id, else by the same title; tasks whose page is not there keep
  its name without a link. Ticked-off tasks are reset unless you keep them.
- **Share a copy** with another member of the plan's course: they find it under **Shared with you** and accept it (it
  becomes their own plan, starting with nothing ticked off) or decline it. The copy is taken when you send it; plans
  are never edited jointly, so each student keeps their own progress.
- **Today's revision** (home page): today's tasks from your plans, ticked off in place, with a link to catch up when
  earlier tasks are left.
- **Check my understanding** under an answer (AI portal and the reading help panel): two or three short questions
  about that explanation, made only when you press it (one call, feature `quick-check`) and kept with the answer, so
  opening it again costs nothing. Answers stay hidden until you show them. No schedule and no streaks.

## Time zone

Each account has a time zone (`user.timezone`) that defines its day for daily features. All accounts use
`Europe/Sofia` (Eastern European Time, UTC+2, UTC+3 in summer) until a setting is added;
`localDate()` in `packages/shared/src/time.ts` gives the date of a moment in a user's zone.

## Create wiki articles from PDFs

**Uploads** lists your files 50 at a time (**Show more** loads the next ones), with a search by file name and a
course filter.

After a text-based PDF finishes indexing, open **Uploads** and choose **Create wiki article**.
The AI creates an editable draft from the extracted PDF text; review and edit the title, tags,
article, and formula blocks before accepting it. Accepting creates a new lecture page in the same
course and links the original PDF in the page's source files. The normal page-save process adds its
formula blocks to the formula index. Draft generation requires `ANTHROPIC_API_KEY` and currently
supports extracted PDF text up to 80,000 characters.
Scanned PDFs without embedded text need OCR before they can be used for article generation.

Generate a secret with `openssl rand -base64 32`.

## Claude API usage administration

Set `ADMIN_EMAILS` in the server environment to a comma-separated list of account emails that may open
**Claude API usage** from the navigation. The admin-only page lists recent Claude requests and their
full text prompts, status, model, token usage, and estimated USD cost. Image request payload bytes are
omitted from stored prompts. Prompt logs can contain private questions and course materials, so only
trusted administrators should be allowlisted.

Calls are stored in the `claude_api_calls` table after applying the latest database migrations. Logs are automatically
removed after `ANTHROPIC_LOG_RETENTION_DAYS` (90 days by default). The
page loads the most recent calls in batches of 50. Estimated prices are based on input/output and
prompt-cache token rates in `ANTHROPIC_PRICING_JSON`; add entries for every configured model and keep
them aligned with [Anthropic's current pricing](https://platform.claude.com/docs/en/about-claude/pricing).
Estimates are not billing records and calls for models without a configured rate show no cost.

Set `AI_DAILY_TOKEN_LIMIT` to cap how many tokens (input, output and cache writes) each user may use in a
rolling 24 hours; further AI requests return an error until usage drops below the limit. `0` (the default)
means no limit. The budget is computed from the same `claude_api_calls` log, so it also resets if logs are pruned.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run web and server in watch mode |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test` | Unit tests, database-backed API workflows, and Playwright browser journeys |
| `pnpm lint` | Biome lint + format check |
| `pnpm db:generate` | Create a migration after changing `apps/server/src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm build` | Build everything; `apps/server` then serves `apps/web/dist` in production |
| `pnpm --filter @nc/web bundle-report` | After a build: JavaScript each route downloads (gzip) |
| `pnpm --filter @nc/server bench` | Time page view, save, search and more on a seeded course in the test database |

The API and browser tests require `NC_TEST_DATABASE_URL` to point to a dedicated PostgreSQL
database whose name ends in `_test`, set in the environment or in `.env` (the tests read only that line
from `.env`). Create it once with `docker compose exec db createdb -U nc notecyclopedia_test`; the API
workflow test applies migrations to it. The browser tests start their own servers on ports 3101 and 5273, so
they can run while `pnpm dev` is running. Install Playwright's Chromium browser with
`pnpm --filter @nc/web exec playwright install chromium`.
CI provisions the test database and browser automatically.

## Performance

Measured on a desktop with the production build (JavaScript, gzip) and the test database (API, median of 40
runs, 150 pages of about 11 kB). Rerun with the two commands above.

| | Before Phase 7 | Now |
|---|---|---|
| Reading a page (beyond the 160 kB app shell) | 330 kB | 90 kB |
| AI portal | 401 kB | 120 kB |
| Search, 150 pages | 163 ms | 15 ms |
| Search, 600 pages | — | 22 ms |
| Open a page / references / formula card | 3 / 4 / 7 ms | unchanged |
| Save a page | 56 ms | unchanged |
| Orbit diagram playing, with J2 and ground track | 60 fps | unchanged |

- Pages are read without the editor: the reader draws the saved document with the same blocks, and the editor
  (TipTap) loads only to edit. The Markdown renderer loads with the first question in the help panel; the
  calculator engine and orbit diagrams load only when an answer shows one.
- Search reads a stored, indexed `search_vector` instead of rebuilding one from every page's text.
- A chat answer you stop reading (closing the tab, or asking another question in the help panel) now stops
  Claude too, so you pay only for what was streamed.
- Built files are cached for good (their names change with every build) and `index.html` is checked on every
  visit; a page open across an update reloads once instead of failing to load a removed file.

## How it fits together

- **Courses** are the unit of sharing. Members are `owner`, `editor` or `viewer`; every API route checks membership.
- **Pages** store TipTap JSON and can optionally be assigned a lecture number, shown in the wiki and article.
- **Web navigation** loads route screens on demand, and the sidebar collapses into a mobile navigation drawer.
  Each save creates a revision (with conflict detection) and updates the formula index in the same transaction.
  Formula blocks get a stable `id` on save, so a formula keeps its index row across edits. Re-chunking the text
  for AI retrieval runs as a background job (unless the page is hidden from AI).
- **Pages** can be moved between courses where you have editor access. Attached files and calculators sourced
  from the page move with it, and AI retrieval indexes are updated.
- **Files** upload to `UPLOAD_DIR`, then a background job extracts text and indexes it.
- **Search** uses Postgres full-text search with the `simple` config (works for Bulgarian and English).
  The search box requires every word; AI retrieval matches any word of the question and ranks chunks
  that match more words first. The AI also uses vector search when `VOYAGE_API_KEY` is set.
- **AI portal** retrieves relevant chunks and streams Claude's answer with `[n]` citations. Claude can call tools
  while answering (`show_orbit`, `find_calculators`, `run_calculator`); tool calls are validated and errors go back
  to Claude so it can retry. In Build mode (or on request) it asks Claude for calculator specs via tool use (one
  `save_calculator` call per calculator), then validates and test-runs each; only invalid ones go back to Claude
  with the error, and valid ones are kept. Chat sends the most recent turns that fit a size budget, with the
  retrieved sources attached to the latest message only, so earlier turns are served from the prompt cache; a
  second cache breakpoint after the question lets tool rounds re-read the sources from the cache.
- **Calculators** (`packages/shared/src/calculator.ts`) are plain JSON:

```json
{ "version": 1, "name": "Projectile motion",
  "theory": "Horizontal speed is constant; vertically the projectile accelerates downward at g.",
  "inputs":  [{ "key": "v0", "label": "Initial speed", "unit": "m/s", "default": 20 },
              { "key": "theta", "label": "Angle", "unit": "deg", "default": 30 },
              { "key": "g", "label": "Gravity", "unit": "m/s²", "default": 9.81 }],
  "outputs": [{ "key": "T", "label": "Flight time", "unit": "s", "expr": "2 * v0 * sin(theta deg) / g",
                "explanation": "Twice the time to reach the top." },
              { "key": "R", "label": "Range", "unit": "m", "expr": "v0 * cos(theta deg) * T" }] }
```

`theory` (paragraphs separated by blank lines) and each output's `explanation` are optional. A calculator's page
shows the theory and a **step-by-step solution**: each result's formula, the same formula with the current values
and units filled in, and the result. AI-made calculators are asked to include both.

Exports:

| Format | What you get |
|---|---|
| `.json` | The calculator definition, for import elsewhere. |
| `.py` | A Python function; the theory goes in the docstring and each explanation above its step. |
| `.html` | A standalone page that works offline: the calculator, the theory and a live step-by-step solution. |
| `.xlsx` | An Excel workbook: yellow input cells, each result an Excel formula over them with its formula text and explanation, and the theory on a second sheet. Excel recalculates when inputs change; values are also stored for viewers that do not recalculate. |

Calculator expressions are validated against the portable Python/JavaScript export subset when
saved: arithmetic, comparisons, `and`/`or`/`not`, nested `condition ? value : value` expressions,
and the math functions supported by both exporters. Unsupported syntax is rejected with its
output formula identified rather than failing only when someone exports it.

- **Constants** include built-in scientific references and course-shared definitions. Adding one to a
  calculator copies its numeric value and unit metadata into that calculator; units are descriptive
  and are not automatically converted.

## Roadmap

Notecyclopedia is first a personal study assistant and tutor; sharing it with classmates comes later.
The plan follows four rules:

- **Help on request.** Nothing calls Claude in the background or on a schedule, so API credits go only where you ask.
- **Tutor before solver.** Explanations and hints come first; the full solution is one click away, never hidden.
- **Compute, don't guess.** Numbers come from your calculators and the orbit code, not from the model.
- **Keep what you paid for.** Any answer can be saved into a page, so the same explanation is never generated twice.

### Phase 0: Foundations

- [x] Keyword retrieval matches any query term (ranked), so natural-language questions find notes without embeddings.
- [x] Formula blocks carry a stable `id`; the formula index is upserted by it instead of rebuilt on every save.
- [x] Page retrieval indexing runs as a background job instead of inside the save request.
- [x] One Claude call wrapper for logging, error mapping and a per-user daily token budget.
- [x] Chat sends a bounded history with prompt caching; retrieved sources move out of the system prompt.
- [x] Revision diff and restore.
- [x] Per-user timezone (needed for "daily" features); every account defaults to `Europe/Sofia` (EET) for now.

### Phase 1: Widget block

- [x] A `widget` editor node with lazily loaded kinds, validated on save and described in `docToText` for search and AI.
- [x] `calculator` widget: embed a saved calculator inside a page.
- [x] `plot` widget: sweep one calculator input and plot up to four outputs (SVG), one chart per unit.
- [x] Image blocks.
- [x] Calculator theory and step-by-step solutions (in the app and the HTML export), and an `.xlsx` export with live
      Excel formulas.

### Phase 2: Orbit diagram (Kepler elements)

- [x] `packages/shared/src/orbit.ts`: Kepler's equation solver, elements ↔ state vectors, projection math, with tests.
- [x] `orbit` widget: sliders for a, e, i, Ω, ω, ν; orbital-plane view (focus, apsides, r/v vectors, true anomaly,
      flight-path angle) and a rotatable 3D view (reference plane, line of nodes, Ω/i/ω arcs) in plain SVG.
- [x] Animation over time (mean → eccentric → true anomaly), optional equal-areas overlay; presets (ISS, Sun-synchronous,
      GTO, GEO, Molniya, Tundra); Earth, Moon and Mars as central bodies.
- [x] Derived values (rₚ, rₐ, p, T, h, ε, vis-viva speed, flight-path angle) from a shared calculator spec.
- [x] Read-only GMAT/FreeFlyer previews, with "Open in orbit viewer" for spacecraft given as Keplerian elements or a
      Cartesian state.
- [x] AI `show_orbit` tool ("show me a Molniya orbit").

### Phase 3: Tutor in the AI portal

- [x] Tutor mode: explains from your notes, asks what you have tried, and gives the next hint; the full worked
      solution is always one click away ("Show full solution"). Solve mode stays for when you just need the answer.
- [x] Check my working: paste or photograph a handwritten solution; Claude finds the first mistake and explains it
      instead of redoing the whole problem.
- [x] `run_calculator` tool: the tutor gets numbers from your saved calculators (with their step-by-step solution)
      instead of doing arithmetic itself, alongside `show_orbit`.
- [x] A model per feature (e.g. Haiku for quick explanations, Sonnet for checking work), and the token cost of each
      answer shown in the thread.

### Course structure and references

- [x] Course overview in sections (lectures, example problems, theory, notes, sources); example problems listed under
      the lecture they practise.
- [x] Formulas grouped by subject and lecture.
- [x] Headings as terms: searchable, linkable, with references between pages and "Referenced by" on each page.
- [x] Theory pages as topic hubs, drafted with AI on request and linking to where the course covers the topic.

### Phase 4: Daily question

- [x] "Today's question" card on the home page: generated when you press Generate (at most once a day, then stored),
      from one of your course pages chosen by lecture recency and skipping recently used topics; optionally pinned to
      one course. Grounded in the notes, with anything beyond them labeled.
- [x] Show answer, or "Check my answer" with the Phase 3 checker; answering is never required.
- [x] Expand it, each on request and stored:
  - **Story**: the idea told through a real mission, discovery or engineering problem.
  - **Advanced**: a harder follow-up that builds on the same topic.
  - **Your own question**: ask anything about the topic; it opens a tutor thread with the question as context.
- [x] Past questions in a small archive; any question or expansion can be saved to its page.
- [x] Daily questions in the sidebar: more questions on demand, avoiding repeated topics and questions, and all questions
      by day with a subject filter and search.

### Phase 5a: Orbit speeds

- [x] Velocity arrow scaled to the actual speed, with v at periapsis and apoapsis marked on the orbit and a live
      speed readout while it plays.
- [x] vₚ, vₐ, escape speed and circular speed at the current radius in the derived values.
- [x] Simulated clock with time warp (×1 … ×10 000) and elapsed time, instead of every orbit taking 12 seconds,
      so a LEO and a GEO orbit play at their true relative speeds.

### Phase 5b: Orbit physics

- [x] J2 perturbation (toggle): nodal regression and apsidal precession, so the Sun-synchronous and 63.4° Molniya/Tundra
      presets show why they work.
- [x] Ground track with the body's rotation, on a longitude–latitude map with coastlines.
- [ ] Transfer diagram, separate from the orbit diagram: two circular orbits and the Hohmann transfer between them at a
      sensible scale, a spacecraft that flies it with both burns, and the phase angle for meeting a target. Its numbers
      come from the built-in `HOHMANN_CALCULATOR` (Δv of both burns and transfer time, checked against Curtis Ex. 6.1).

### Phase 6: Help where you read

- [x] Select text or a formula on a page → Explain / Why does this hold? / Show an example, answered in a side
      panel with the page as context.
- [x] "Save to page" for any tutor answer: it opens in the page editor as an unsaved addition to review, so an
      explanation is paid for once.
- [x] Formula cards (no AI): where else a formula appears and the calculators made from or embedded in its page.
- [x] Backlinks between pages ("Referenced by", see Course structure and references).

### Phase 7: Performance and reliability

- [x] Profile the slow paths (page view, save, search, orbit interaction) and record a baseline (see
      [Performance](#performance)). Time to first token needs real Claude calls and was not measured.
- [x] Read-only page view that does not load the editor (240 kB gzip less per page view).
- [x] Fix what the profile shows: search from a stored index, lazy help panel and portal widgets, stopped chat
      answers stop Claude, caching that survives updates, client errors no longer reported as server errors.
- [ ] Verify PDF-to-article generation against the PDF that previously failed; add a regression fixture if reproducible.

### Phase 8: Study companion

- [x] "Where was I" on the home page: recently opened pages, AI sessions, and topics you asked about. Topics
      come from the pages your answers cited, so no AI call is needed (not tagged by Claude as first planned).
- [x] Exam prep: from an exam date, propose a revision plan over the course's pages in one call; saved and editable.
- [x] Quick check on request: after an explanation, offer 2–3 questions only when you ask. No schedule, no streaks.
- [ ] Run the exam plan and quick check once against real Claude (tests mock every AI call), and measure time to
      first token in the same session (open from Phase 7).

### Lectures and links

- [x] Original lectures: an upload (slides or PDF) marked as the original of lecture N of a course, while uploading
      or later; numbers are per course, taken ones are caught before saving.
- [x] Lectures tab: only the originals, in order, each with its pages, example problems and calculators; **Edit →
      Move lecture** moves a whole lecture to another course or number.
- [x] Wiki and course pages grouped **By type** or **By lecture**; a page links to its lecture's original.
- [x] Calculators tagged with a lecture of their course.
- [x] Useful links: built-in tools (NASA's Eyes, Copernicus Browser, JPL Horizons, CelesTrak) and your own.
- [ ] Article from the original: start **Create wiki article** from a lecture card whose original has no article
      yet (together with the PDF check from Phase 7).
- [ ] *Quiz me on this lecture* on a lecture card: a quick check with the lecture's pages as the source, only when
      clicked.

### Phase 8b: Exam prep follow-ups

- [ ] Lecture-aware plans: scope a plan by lectures (e.g. "Lectures 1–6") instead of a page list, and show each day's
      lecture with its original, pages and example problems.
- [ ] Use what the app knows when proposing a plan: pages you asked about most and pages you barely opened go into
      the same call, at no extra cost.
- [ ] Time per task: estimate minutes from a page's length and formulas, and show each day's load against the
      minutes a day.
- [ ] One-click actions on a task: open the page, *Quiz me on this* (a question about that page) or ask the tutor
      with the page as the source; AI only when clicked.
- [ ] Exam formula sheet: the key and pinned formulas of the pages in scope, grouped by lecture, printable (no AI).

### Small fixes

- [x] Uploads: search by file name, filter by course, and 50 at a time with **Show more** (the list used to stop at the
      latest 200 files).
- [x] Moving a single page to another course: calculators made from it keep their lecture tag only when it is the
      page's own lecture number (the page keeps its number); any other tag is cleared, as the page's original is
      unmarked.
- [x] Backup reminder: the Backup page shows when your last backup download finished, and warns after 14 days or
      when there is none (no automatic job).

### Calculator library

- [x] Calculators are personal, with a course tag that sorts and links them to lectures without sharing them.
- [x] Library grouped by course and lecture, sortable by name or last edited, with a course filter.
- [x] Archive and restore; pages that embed an archived calculator keep working.
- [x] Rework: **Duplicate** (a copy linked to its original) and **Rework with AI** (one call on request, shown as
      changes to review before saving).

### Package split

Split `@nc/shared` into workspace packages with clear boundaries (not published yet). Pages that need only one
part then load only that part, and the Vite tree-shaking override in `apps/web/vite.config.ts` can go. Lower
priority: it has no visible benefit until something is published, so it comes after Phase 8b and the transfer diagram.

- [ ] `@nc/orbit`: orbit maths (Kepler propagation, J2 rates, ground track, sidereal time, transfers, mission
      files), with no dependencies; the `CalculatorSpec` type it borrows moves behind a small interface.
- [ ] `@nc/orbit-view`: the React orbit diagram and the coastline map, depending on `@nc/orbit`.
- [ ] `@nc/calc`: calculator specs, the limited math.js evaluator, checks, explanations and Excel/Python export.
- [ ] `@nc/doc`: page document helpers (block ids, terms, references, links, text) and the read-only renderer.
- [ ] Later, if wanted: publish `@nc/orbit` / `@nc/orbit-view`, or build a standalone orbit viewer page.

### Later: sharing

- [ ] Deployment (e.g. Railway/Fly + managed Postgres) and a storage interface for uploads (local disk / R2).
- [ ] Password reset, email verification, rate limits and account deletion.

### Dropped

- Question banks generated after every save, FSRS scheduling and a scheduled daily quiz: they turn the tool into
  homework and spend credits in the background. The daily question (Phase 4) is generated only when you ask.
