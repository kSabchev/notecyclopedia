# Configuration

The server reads its settings from environment variables, or from `.env` in the repository root (copy
`.env.example`). Never commit `.env`: it holds your API keys and database password.

## Server

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3001` | Port of the API (and of the built web app in production). |
| `DATABASE_URL` | `postgres://nc:nc@localhost:5432/notecyclopedia` | PostgreSQL 16 with pgvector. `pnpm db:up` starts one in Docker. |
| `BETTER_AUTH_SECRET` | a development value | Signs sign-in sessions. **Required in production**: a long random string, for example from `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | `http://localhost:5173` | The address people open the app at. |
| `WEB_ORIGIN` | `http://localhost:5173` | The web app's origin, trusted for sign-in requests. |
| `UPLOAD_DIR` | `./uploads` | Where uploaded files are stored. Back it up with the database. |

## AI

The app works without an API key; AI buttons then say AI is not configured.

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Turns on the AI features. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | The model for every AI feature without its own. |
| `ANTHROPIC_MODELS_JSON` | `{}` | A model per feature, for example `{"ask":"claude-haiku-5-5","daily-question":"claude-haiku-5-5"}`. See the feature names below. |
| `ANTHROPIC_PRICING_JSON` | Sonnet, Haiku and Opus 5.5 rates | US dollars per million tokens, per model (`input`, `output`, `cacheRead`, `cacheWrite5m`, `cacheWrite1h`), for the costs shown. Add every model you use and keep the rates in line with [Anthropic's pricing](https://platform.claude.com/docs/en/about-claude/pricing). A model without a rate shows no cost. |
| `AI_DAILY_TOKEN_LIMIT` | `0` (no limit) | Tokens (input, output and cache writes) each user may use in a rolling 24 hours. Further AI requests are refused until usage drops. `.env.example` sets 2,000,000. |
| `ADMIN_EMAILS` | none | Comma-separated account emails that may open **Claude API usage**, which shows full prompts. |
| `ANTHROPIC_LOG_RETENTION_DAYS` | `90` | How long the Claude call log (with prompts) is kept. The daily limit is counted from the same log. |
| `VOYAGE_API_KEY` | none | Optional: adds semantic (vector) search to the AI's retrieval. Without it, retrieval is by keyword. |
| `VOYAGE_MODEL` | `voyage-3.5` | The Voyage embedding model. |

**Feature names** for `ANTHROPIC_MODELS_JSON`:

| Feature | Used by |
|---|---|
| `ask`, `tutor`, `check`, `summarize`, `solve`, `calculator` | The AI portal modes (also the reading help panel) |
| `calculator-spec` | Making calculators (Build calculator, Make a calculator from this) |
| `calculator-review` | Check formulas with AI, Rework with AI |
| `topic-hub` | Draft topic hub with AI |
| `daily-question` | Daily questions and their expansions |
| `exam-plan` | Exam prep plans |
| `quick-check` | Check my understanding |
| `article-draft` | Create wiki article from a PDF |
| `page-review` | Review & polish |
| `image` | Transcribing uploaded images |

A cheaper model such as Haiku suits `ask`, `summarize`, `daily-question` and `quick-check`.

## Tests and development

| Variable | Default | What it does |
|---|---|---|
| `NC_TEST_DATABASE_URL` | none | A dedicated database for the tests; its name must end in `_test`. The tests read only this line from `.env`. See [development](development.md#tests). |
| `NC_DISABLE_BACKGROUND_JOBS` | unset | `true` runs page indexing inline and skips upload ingestion. The browser and API tests set it. |
| `NC_API_PORT` | `3001` | The API port the web dev server proxies `/api` to. The browser tests use their own. |
| `ANTHROPIC_BASE_URL` | Anthropic's API | Read by the Anthropic SDK. The API tests point it at a local stand-in for Claude. |
