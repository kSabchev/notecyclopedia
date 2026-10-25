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
pnpm db:migrate               # create tables
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
courses you can access, pages and revision history, calculators, and uploaded file contents. They do
not include sign-in credentials, sessions, AI conversations, or browser-local preferences. Import
validates and previews the archive before creating new private copies owned by the signed-in user;
it never merges with or overwrites existing data. Derived formula and search indexes are rebuilt,
and uploaded files are queued for re-indexing.

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

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run web and server in watch mode |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test` | Unit tests and server backup tests |
| `pnpm lint` | Biome lint + format check |
| `pnpm db:generate` | Create a migration after changing `apps/server/src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm build` | Build everything; `apps/server` then serves `apps/web/dist` in production |

## How it fits together

- **Courses** are the unit of sharing. Members are `owner`, `editor` or `viewer`; every API route checks membership.
- **Pages** store TipTap JSON and can optionally be assigned a lecture number, shown in the wiki and article.
  Each save creates a revision (with conflict detection), re-extracts formula blocks into the formula index,
  and re-chunks the text for AI retrieval (unless the page is hidden from AI).
- **Pages** can be moved between courses where you have editor access. Attached files and calculators sourced
  from the page move with it, and AI retrieval indexes are updated.
- **Files** upload to `UPLOAD_DIR`, then a background job extracts text and indexes it.
- **Search** uses Postgres full-text search with the `simple` config (works for Bulgarian and English).
  The AI also uses vector search when `VOYAGE_API_KEY` is set.
- **AI portal** retrieves relevant chunks, streams Claude's answer with `[n]` citations, and in Solve/Build modes
  asks Claude for a calculator spec via tool use, then validates and test-runs it before showing it.
- **Calculators** (`packages/shared/src/calculator.ts`) are plain JSON:

```json
{ "version": 1, "name": "Projectile motion",
  "inputs":  [{ "key": "v0", "label": "Initial speed", "unit": "m/s", "default": 20 },
              { "key": "theta", "label": "Angle", "unit": "deg", "default": 30 },
              { "key": "g", "label": "Gravity", "unit": "m/s²", "default": 9.81 }],
  "outputs": [{ "key": "T", "label": "Flight time", "unit": "s", "expr": "2 * v0 * sin(theta deg) / g" },
              { "key": "R", "label": "Range", "unit": "m", "expr": "v0 * cos(theta deg) * T" }] }
```

## Next steps

- Collapsible navigation on phones
- Code-split the web bundle (math.js, TipTap and KaTeX load up front)
- Image blocks and embedded calculators inside pages
- Revision diff and restore
- Calculator builder UI (form instead of raw JSON) and plots
- Deployment config (e.g. Railway/Fly + managed Postgres + R2 for files)
