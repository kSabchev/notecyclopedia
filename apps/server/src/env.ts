import path from 'node:path'

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined || v === '') throw new Error(`Missing environment variable ${name} (see .env.example)`)
  return v
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: req('DATABASE_URL', 'postgres://nc:nc@localhost:5432/notecyclopedia'),
  authSecret: req(
    'BETTER_AUTH_SECRET',
    process.env.NODE_ENV === 'production' ? undefined : 'dev-secret-change-me-0123456789',
  ),
  authUrl: req('BETTER_AUTH_URL', 'http://localhost:5173'),
  webOrigin: req('WEB_ORIGIN', 'http://localhost:5173'),
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? './uploads'),
  anthropicKey: process.env.ANTHROPIC_API_KEY || null,
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  voyageKey: process.env.VOYAGE_API_KEY || null,
  voyageModel: process.env.VOYAGE_MODEL || 'voyage-3.5',
  /** Embedding size stored in the chunks table; voyage-3.5 defaults to 1024. */
  embeddingDim: 1024,
}
