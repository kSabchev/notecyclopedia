import { fromNodeHeaders } from 'better-auth/node'
import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
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
  console.error(err)
  res.status(500).json({ error: 'Something went wrong' })
}

/** Express route params are typed loosely in v5; this reads one as a string. */
export const param = (req: Request, name: string): string => {
  const v = req.params[name]
  if (typeof v !== 'string') throw new HttpError(400, `Missing ${name}`)
  return v
}
