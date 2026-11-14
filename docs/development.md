# Development

How the code is organised, how to test and measure it, and what to do when something goes wrong. Running the app is in
the [README](../README.md); settings are in [configuration](configuration.md).

## Stack

| Part | Tech |
|---|---|
| Monorepo | pnpm workspaces: `apps/web`, `apps/server`, `packages/shared` |
| Web | React 19, TypeScript, Vite, TanStack Router and Query, Tailwind CSS 4, TipTap, KaTeX, i18next (English, Bulgarian) |
| Server | Node 22, Express 5, Drizzle ORM, PostgreSQL 16 with pgvector, Better Auth (email and password), pg-boss jobs, multer |
| Files | unpdf (PDF), officeparser (DOCX, PPTX, XLSX, ODF), Claude for images |
| AI | Claude API (`@anthropic-ai/sdk`), streamed over server-sent events; Voyage embeddings (optional) |
| Calculators | JSON validated with zod, evaluated by a restricted math.js |
| Checks | Biome (lint and format), TypeScript, Vitest, `node --test`, Playwright, GitHub Actions |

The design reference is in [`design/`](../design/README.md).

## Layout

```
packages/shared/src   Logic used by both apps, with unit tests: calculator engine (calculator*.ts), orbit maths,
                      the page document, math text, study plans, plan and mission files, formatting, types
apps/server/src
  routes/             HTTP routes, one file per area, each with its integration test
  services/           What the routes do: backup/, study/, chat and chat tools, calculator generation and review,
                      daily questions, topic hubs, page review, article drafts, retrieval and indexing, jobs
  services/prompts.ts Every prompt sent to Claude
  db/                 Drizzle schema; migrations are in apps/server/drizzle
  testing/            Helpers for integration tests
apps/web/src
  routes/             One screen per route, loaded on demand
  components/         Shared parts; larger screens have folders: ai/, calculator/, widgets/orbit/
  lib/                The API client, formatting, lectures and links helpers
  locales/            UI text, one file per language
apps/web/tests/e2e    Browser tests
```

## How it fits together

- **Courses** are the unit of sharing. Members are owners, editors or viewers, and every route checks membership
  (`access.ts`). Calculators, pins, links, AI sessions and exam plans are personal.
- **Pages** store TipTap JSON. A save creates a revision (refused if it is based on an older one), gives headings and
  formulas stable ids, and updates the formula index, terms and references in the same transaction. Text for AI
  retrieval is chunked and indexed in a background job.
- **Uploads** are stored in `UPLOAD_DIR`; a background job extracts their text and indexes it.
- **Search** uses Postgres full-text search with the `simple` configuration, which works for Bulgarian and English. The
  search box needs every word; AI retrieval matches any word of the question and ranks chunks matching more words
  first, plus vector search when `VOYAGE_API_KEY` is set.
- **The AI portal** retrieves chunks of your notes and streams Claude's answer with `[n]` citations. Claude may call
  tools while answering (`show_orbit`, `find_calculators`, `run_calculator`); invalid tool calls go back to it with the
  error. The history sent is the latest turns within a size budget, with the sources attached to the newest message
  only, so earlier turns come from the prompt cache.
- **Single-answer AI features** (calculator review and rework, daily questions, quick checks, topic hubs, page review,
  exam plans) go through `callTool` (`services/ai-tool.ts`): the tool's answer is checked by the feature's schema, an
  invalid answer is sent back once with what was wrong (not for page review, whose answer is a whole page), and every
  call's usage is recorded. Calculator generation and PDF article drafts have their own flow.
- **Prompts** live in `services/prompts.ts`, built from shared pieces: the math style, physical constants as
  constants, and the rule that notes, pages and files are data, not instructions. `prompts.test.ts` checks that every
  prompt keeps them.
- **Every Claude call** goes through `claude-client.ts`, which checks the user's daily budget, logs the call (images
  left out) and maps API errors to messages.
- **Orbits** are computed from the starting orbit and the elapsed time, not stepped frame by frame, so long runs do not
  drift. Tests check the propagation against numerical integration (to a metre after more than an orbit) and the J2
  rates against integration with the full J2 acceleration (within 1% over 20 days). Derived values use the same formulas
  as the built-in *Elliptical orbit* calculator (`ORBIT_CALCULATOR`) in plain code, so orbit-only pages do not load
  math.js.
- **Days** are counted in each user's time zone (`user.timezone`, `localDate()` in `packages/shared/src/time.ts`).

## Shared helpers

Do each of these in one place, and reuse it:

| Helper | Where | For |
|---|---|---|
| `issuesText` | `@nc/shared` | A zod error as one line |
| `fileSlug` | `@nc/shared` | A download's file name |
| `parseCalculatorJson` | `@nc/shared` | A calculator from JSON text |
| `markdownBlocks`, `tidyLatex` | `@nc/shared` | AI text and formulas saved to pages |
| `sendAs` | server `http.ts` | Download headers |
| `localeInput` | server `http.ts` | The UI language in a request |
| `isUniqueViolation` | server `db/index.ts` | A duplicate-key error |
| `callTool`, `fromSchema`, `invalidAnswer` | server `services/ai-tool.ts` | Calling Claude with a tool and checking its answer |
| `withoutImages` | server `services/claude-client.ts` | A request as logged |
| `formatCost`, `useDayLabel`, `todayLocal` | web `lib/format.ts` | Costs and days |
| `LectureLabel`, `OriginalLink` | web `components/LectureLinks.tsx` | Links to a lecture and its original |

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Web and server in watch mode |
| `pnpm lint` | Biome lint and format check (`pnpm format` fixes formatting) |
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | All tests: shared, server, browser |
| `pnpm coverage` | Shared and server tests with coverage, failing below the minimums |
| `pnpm build` | Build everything; the server then serves `apps/web/dist` |
| `pnpm db:generate` | Create a migration after changing `apps/server/src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm --filter @nc/web bundle-report` | After a build: the JavaScript each route downloads (gzip) |
| `pnpm --filter @nc/server bench` | Time page view, save, search and more on a seeded course in the test database |

## Tests

| Layer | Where | Runner | Covers |
|---|---|---|---|
| Unit | `packages/shared/src/*.test.ts` | Vitest | Calculator engine and unit checks, orbit maths, documents, math text, study plans, file formats |
| Unit | `apps/server/src/**/*.test.ts` | `node --test` (tsx) | AI helper and prompts, each AI feature against a stand-in for Claude, search queries, costs |
| Integration | `apps/server/src/**/*.integration.test.ts` | `node --test` (tsx) | The API on the test database, one file per area |
| End to end | `apps/web/tests/e2e` | Playwright | Journeys in a real browser against the real API, with Claude mocked |

Setting up once:

1. Create the test database: `docker compose exec db createdb -U nc notecyclopedia_test`.
2. Set `NC_TEST_DATABASE_URL` in `.env` (see `.env.example`); its name must end in `_test`. The tests migrate it.
3. Install the browser: `pnpm --filter @nc/web exec playwright install chromium`.

The browser tests start their own servers on ports 3101 and 5273, so they run next to `pnpm dev`. CI sets up the
database and browser itself.

Server test files are found by name, so a new one runs without being listed. Each runs in its own process, in parallel.
Integration tests use `apps/server/src/testing/`:

- `database.ts` points the server at the test database, never at Claude, and migrates under a lock.
- `api.ts` starts the API for one test file, signs users up, calls the API as them (`send`, `ok`), makes courses,
  pages, uploads and calculators, and removes what those users made at the end. Background jobs are off unless a test
  asks for them.
- `claude.ts` is a local stand-in for the Anthropic Messages API, plain and streamed. With `claudeEnv(fake)` the API calls
  it through the real SDK, so a test covers the chat route, tool rounds, the usage log and the budget.

The web app has no unit tests of its own: its logic lives in `@nc/shared`, and the browser tests cover the screens.

### Coverage

`pnpm coverage` prints a summary, writes an HTML report for `@nc/shared` to `packages/shared/coverage`, and fails below
the minimums in `packages/shared/vitest.config.ts` and the server's `test:coverage` script. Keep the minimums a little
under the current numbers. Node counts comment lines in TypeScript as uncovered, so the server's per-file line numbers
read low for well-commented files; its branch and function numbers are exact.

## Performance

Measure with the bundle report and the benchmark above. The last measurements, on a desktop with the production build
(JavaScript gzip) and the test database (median of 40 runs, 150 pages of about 11 kB), in November 2026:

| | Before Phase 7 | After Phase 7 (#17, #25) |
|---|---|---|
| App shell (every page) | 168 kB | 143 kB, plus 12–14 kB for the active language |
| Reading a page, beyond the shell | 330 kB | 90 kB |
| AI portal, beyond the shell | 401 kB | 120 kB |
| Search, 150 pages | 163 ms | 15 ms |
| Search, 600 pages | | 22 ms |
| Open a page / references / formula card | 3 / 4 / 7 ms | unchanged |
| Save a page | 56 ms | unchanged |
| Orbit diagram playing, with J2 and ground track | 60 fps | unchanged |

What keeps it fast:

- Pages are read without the editor, which loads only to edit. The Markdown renderer, the calculator engine (math.js)
  and orbit diagrams load only when needed, and each language's UI text is its own file.
- Search reads a stored, indexed `search_vector`.
- A chat answer nobody reads any more (tab closed, or another question asked) stops Claude too.
- Built files are cached for good (their names change with each build); a page open across an update reloads once.

## Security

- Never commit `.env`, keys or database dumps.
- Notes, pages and files are passed to Claude as data, never as instructions (checked by `prompts.test.ts`).
- Uploads are served with the type of their extension, and only safe types inline.
- Tests refuse any database whose name does not end in `_test`, and never call Claude.
- Prompt logs can hold private material; only `ADMIN_EMAILS` can read them, and they expire.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot find package …` when tests or the server start | `pnpm install` (a dependency change can leave links out of date). |
| Tests say `NC_TEST_DATABASE_URL must point to a dedicated database ending in _test` | Create the test database and set the variable (see [Tests](#tests)). |
| Browser tests fail to start | Install Chromium (step 3 above), and check that ports 3101 and 5273 are free. |
| AI buttons say AI is not configured | Set `ANTHROPIC_API_KEY` and restart the server. |
| AI requests are refused with a daily limit message | `AI_DAILY_TOKEN_LIMIT` was reached; it frees up over 24 hours. |
| Create wiki article finds no text | The PDF is scanned; run OCR on it first. |
| Database not running | `pnpm db:up` starts it; `docker compose stop db` stops it. |
