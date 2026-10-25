import { createApp } from './app'
import { env } from './env'
import { startJobs, stopJobs } from './services/jobs'

const app = createApp()
await startJobs()
const server = app.listen(env.port, () => console.log(`Notecyclopedia API on http://localhost:${env.port}`))

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    server.close()
    await stopJobs()
    process.exit(0)
  })
