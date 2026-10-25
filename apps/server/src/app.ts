import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toNodeHandler } from 'better-auth/node'
import express from 'express'
import { auth } from './auth'
import { errorHandler, requireUser } from './http'
import { ai } from './routes/ai'
import { backup } from './routes/backup'
import { calculators } from './routes/calculators'
import { courses } from './routes/courses'
import { files } from './routes/files'
import { formulas, pages } from './routes/pages'
import { search } from './routes/search'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')

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
  api.use('/backup', backup)
  api.use('/search', search)
  api.use('/ai', ai)
  app.use('/api', api)

  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }))
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')))
  }

  app.use(errorHandler)
  return app
}
