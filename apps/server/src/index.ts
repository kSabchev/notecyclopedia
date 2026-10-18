import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toNodeHandler } from 'better-auth/node'
import express from 'express'
import { auth } from './auth'
import { env } from './env'
import { errorHandler, requireUser } from './http'
import { ai } from './routes/ai'
import { calculators } from './routes/calculators'
import { courses } from './routes/courses'
import { files } from './routes/files'
import { formulas, pages } from './routes/pages'
import { search } from './routes/search'
import { startJobs, stopJobs } from './services/jobs'

const app = express()
app.disable('x-powered-by')

// Better Auth must see the raw body, so it is mounted before express.json().
app.all('/api/auth/*splat', toNodeHandler(auth))
app.use(express.json({ limit: '5mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

const api = express.Router()
api.use(requireUser)
api.use('/courses', courses)
api.use('/pages', pages)
api.use('/formulas', formulas)
api.use('/files', files)
api.use('/calculators', calculators)
api.use('/search', search)
api.use('/ai', ai)
app.use('/api', api)

// In production the server also serves the built web app.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
if (existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }))
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')))
}

app.use(errorHandler)

await startJobs()
const server = app.listen(env.port, () => console.log(`Notecyclopedia API on http://localhost:${env.port}`))

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    server.close()
    await stopJobs()
    process.exit(0)
  })
