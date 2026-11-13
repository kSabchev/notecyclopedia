import { LOCALES } from '@nc/shared'
import { fromNodeHeaders } from 'better-auth/node'
import type { NextFunction, Request, Response } from 'express'
import { ZodError, z } from 'zod'
import { type SessionUser, auth } from './auth'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what)
export const forbidden = () => new HttpError(403, 'You do not have access to this')

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}

export async function requireUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!s) return next(new HttpError(401, 'Sign in required'))
    req.user = s.user
    next()
  } catch (e) {
    next(e)
  }
}

/** The signed-in user; only valid after requireUser. */
export const me = (req: Request): SessionUser => {
  if (!req.user) throw new HttpError(401, 'Sign in required')
  return req.user
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
  if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid input', issues: err.issues })
  // Errors from Express itself carry a status: malformed JSON (400), a body over the limit (413), a missing
  // built file (404). They are the client's, not a server failure.
  const status = (err as { status?: unknown } | null)?.status
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const message = status === 404 ? 'Not found' : status === 413 ? 'Request too large' : 'Invalid request'
    return res.status(status).json({ error: message })
  }
  console.error(err)
  res.status(500).json({ error: 'Something went wrong' })
}

/** Express route params are typed loosely in v5; this reads one as a string. */
export const param = (req: Request, name: string): string => {
  const v = req.params[name]
  if (typeof v !== 'string') throw new HttpError(400, `Missing ${name}`)
  return v
}

/** The reader's interface language: the fallback for AI text when the notes are too short to tell their language. */
export const localeInput = z.enum(LOCALES).optional()

/**
 * Sends the response as a file named `name`: downloaded, or shown in the browser with `inline`. The header carries an
 * ASCII name for old browsers and the full name for the rest (RFC 6266).
 */
export function sendAs(res: Response, name: string, opts: { type?: string; inline?: boolean } = {}) {
  if (opts.type) res.setHeader('content-type', opts.type)
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  res.setHeader(
    'content-disposition',
    `${opts.inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  )
}
