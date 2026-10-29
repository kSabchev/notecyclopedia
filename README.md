# Notecyclopedia

A shared study encyclopedia: a wiki of lectures and notes with formulas, uploaded source files,
reusable calculators, and an AI portal (ask, summarize, solve, build calculator) grounded in your notes.

Design reference: [`design/`](design/README.md).

## Stack

| Part | Tech |
|---|---|
| Monorepo | pnpm workspaces: `apps/web`, `apps/server`, `packages/shared` |
| Web | React 19, TypeScript, Vite, TanStack Router + Query, Tailwind CSS v4, TipTap editor, KaTeX, i18next (bg/en) |
| Server | Node 22, Express 5, Drizzle ORM, PostgreSQL 16 + pgvector, Better Auth (email + password), pg-boss jobs, multer uploads |
| Files | unpdf (PDF), officeparser (DOCX/PPTX/XLSX/ODF), Claude vision for photos |
| AI | Claude API (`@anthropic-ai/sdk`), streamed over SSE; Voyage embeddings (optional) |
| Calculators | JSON spec validated with zod, evaluated with a sandboxed math.js; export to .json / .py / .html |

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

A block stores a copy of the calculator, so it works for everyone who can read the page (even when the library
calculator is personal), survives backups, and is visible to search and the AI. Editors can choose
**Update from library** to pull in later changes to the original. Blocks are validated when a page is saved.

The **Image** button uploads a PNG, JPEG, GIF or WebP file to the page's course and shows it with an optional
caption. Images are indexed like other uploads: with `ANTHROPIC_API_KEY` set, Claude transcribes each one for search,
which is a paid API call per image.

Uploaded files are served with the type that matches their extension, and only PDFs, images and plain text open in
the browser; everything else downloads.

## Orbit diagrams

Choose **Orbit diagram** in the toolbar's **Calculator** dialog to add an interactive two-body orbit to a page, or open
**Orbits** in the navigation for a standalone viewer (its URL takes the elements, e.g. `/orbit?a=26600&e=0.74&i=63.4&argp=270`).

- Set the six classical elements (a, e, i, Ω, ω, ν) with sliders or numbers, pick a preset, or change the central body.
- The **orbital plane** view shows the body at a focus, periapsis and apoapsis, the position and velocity vectors, the
  true anomaly and the flight-path angle. **Equal areas** shades sectors swept in equal times (Kepler's second law).
- The **3D view** shows the orbit against the reference plane (the part behind it dashed), the line of nodes and the
  Ω, i and ω angles. Drag it, or use the Turn and Tilt sliders, to rotate.
- **Play** animates the motion at a steady mean anomaly, so the satellite speeds up near periapsis.
- Derived values come from the same formulas as the built-in *Elliptical orbit* calculator
  (`ORBIT_CALCULATOR` in `packages/shared/src/orbit.ts`).

Readers can explore freely; in the editor, **Save orbit** stores the current elements as the block's starting orbit.
Only closed orbits are supported (eccentricity below 0.99).

**GMAT and FreeFlyer files.** GMAT scripts (`.script`) and FreeFlyer mission plans (`.MissionPlan`) can be uploaded like
other files. **Preview** shows them as read-only text (nothing is executed) and lists each spacecraft whose initial
orbit the file defines, as Keplerian elements or as a Cartesian state, with **Open in orbit viewer**. GMAT spacecraft
in a lunar or Martian coordinate system orbit that body; others orbit Earth.

**AI.** In the AI portal, Claude can show an orbit diagram with its answer (for example "show me a Molniya orbit"); the
diagram is interactive and can be opened in the orbit viewer.

## Time zone

Each account has a time zone (`user.timezone`) that defines its day for daily features. All accounts use
`Europe/Sofia` (Eastern European Time, UTC+2, UTC+3 in summer) until a setting is added;
`localDate()` in `packages/shared/src/time.ts` gives the date of a moment in a user's zone.

## Create wiki articles from PDFs

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

The API and browser tests require `NC_TEST_DATABASE_URL` to point to a dedicated PostgreSQL
database whose name ends in `_test`, set in the environment or in `.env` (the tests read only that line
from `.env`). Create it once with `docker compose exec db createdb -U nc notecyclopedia_test`; the API
workflow test applies migrations to it. The browser tests start their own servers on ports 3101 and 5273, so
they can run while `pnpm dev` is running. Install Playwright's Chromium browser with
`pnpm --filter @nc/web exec playwright install chromium`.
CI provisions the test database and browser automatically.

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
- **AI portal** retrieves relevant chunks, streams Claude's answer with `[n]` citations, and in Solve/Build modes
  asks Claude for a calculator spec via tool use, then validates and test-runs it before showing it.
  Chat sends the most recent turns that fit a size budget, with the retrieved sources attached to the
  latest message only, so earlier turns are served from the prompt cache.
- **Calculators** (`packages/shared/src/calculator.ts`) are plain JSON:

```json
{ "version": 1, "name": "Projectile motion",
  "inputs":  [{ "key": "v0", "label": "Initial speed", "unit": "m/s", "default": 20 },
              { "key": "theta", "label": "Angle", "unit": "deg", "default": 30 },
              { "key": "g", "label": "Gravity", "unit": "m/s²", "default": 9.81 }],
  "outputs": [{ "key": "T", "label": "Flight time", "unit": "s", "expr": "2 * v0 * sin(theta deg) / g" },
              { "key": "R", "label": "Range", "unit": "m", "expr": "v0 * cos(theta deg) * T" }] }
```

Calculator expressions are validated against the portable Python/JavaScript export subset when
saved: arithmetic, comparisons, `and`/`or`/`not`, nested `condition ? value : value` expressions,
and the math functions supported by both exporters. Unsupported syntax is rejected with its
output formula identified rather than failing only when someone exports it.

- **Constants** include built-in scientific references and course-shared definitions. Adding one to a
  calculator copies its numeric value and unit metadata into that calculator; units are descriptive
  and are not automatically converted.

## Roadmap

The phases build on each other: stable formula IDs and a general widget block are the foundation for
interactive diagrams, quizzes and daily study content.

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

### Phase 3: Quizzes and spaced repetition

- [ ] Question bank per page (multiple choice, true/false, formula recall), generated in the background after saves
      and marked stale when the page changes; editors can review and edit items.
- [ ] Numeric questions generated from calculators with randomized inputs and exact answers (no AI call).
- [ ] FSRS scheduling; a daily quiz of due items plus a few new ones from the latest lectures.

### Phase 4: Daily topic and "Today"

- [ ] One daily topic per user, chosen by lecture recency, weak quiz results and novelty; expanded by Claude,
      grounded in the notes, with content beyond the notes labeled. Generated lazily on first visit of the day.
- [ ] Check questions from the daily topic feed the quiz bank; "Save as note" goes through the review flow.
- [ ] "Today" on the home page: daily topic, due quiz count, streak.

### Phase 5: Delivery and polish

- [ ] Storage interface for uploads (local disk / R2) and deployment config (e.g. Railway/Fly + managed Postgres).
- [ ] Static read-only page renderer, so viewing a page does not load the editor. (The calculator engine already
      loads only on screens that compute something.)
- [ ] Backlinks between pages.
- [ ] Verify PDF-to-article generation against the PDF that previously failed; add a regression fixture if reproducible.
