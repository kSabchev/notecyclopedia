import path from 'node:path'
import { z } from 'zod'

type ClaudePricing = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite5m?: number
  cacheWrite1h?: number
}

function claudePricing(): Record<string, ClaudePricing> {
  const raw =
    process.env.ANTHROPIC_PRICING_JSON ??
    '{"claude-sonnet-5-5":{"input":2,"output":10,"cacheRead":0.1,"cacheWrite5m":2.5,"cacheWrite1h":4}}'
  return z
    .record(
      z.string().min(1),
      z.object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cacheRead: z.number().nonnegative().optional(),
        cacheWrite5m: z.number().nonnegative().optional(),
        cacheWrite1h: z.number().nonnegative().optional(),
      }),
    )
    .parse(JSON.parse(raw))
}

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
  anthropicPricing: claudePricing(),
  adminEmails: new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  ),
  anthropicLogRetentionDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .parse(process.env.ANTHROPIC_LOG_RETENTION_DAYS ?? '90'),
  voyageKey: process.env.VOYAGE_API_KEY || null,
  voyageModel: process.env.VOYAGE_MODEL || 'voyage-3.5',
  /** Embedding size stored in the chunks table; voyage-3.5 defaults to 1024. */
  embeddingDim: 1024,
}
