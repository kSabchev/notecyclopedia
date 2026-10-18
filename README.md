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

Generate a secret with `openssl rand -base64 32`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run web and server in watch mode |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test` | Unit tests (calculator engine, document helpers) |
| `pnpm lint` | Biome lint + format check |
| `pnpm db:generate` | Create a migration after changing `apps/server/src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm build` | Build everything; `apps/server` then serves `apps/web/dist` in production |

## How it fits together

- **Courses** are the unit of sharing. Members are `owner`, `editor` or `viewer`; every API route checks membership.
- **Pages** store TipTap JSON. Each save creates a revision (with conflict detection), re-extracts formula blocks
  into the formula index, and re-chunks the text for AI retrieval (unless the page is hidden from AI).
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
