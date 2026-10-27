import { DEFAULT_TIME_ZONE } from '@nc/shared'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db, schema } from './db'
import { env } from './env'

export const auth = betterAuth({
  secret: env.authSecret,
  baseURL: env.authUrl,
  basePath: '/api/auth',
  trustedOrigins: [env.webOrigin],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  user: {
    additionalFields: {
      locale: { type: 'string', required: false, defaultValue: 'bg', input: true },
      timezone: { type: 'string', required: false, defaultValue: DEFAULT_TIME_ZONE, input: false },
    },
  },
})

export type SessionUser = typeof auth.$Infer.Session.user
