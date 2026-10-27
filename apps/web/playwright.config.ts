import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { defineConfig, devices } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const rootEnv = path.resolve(here, '../../.env')
// Only the test database is read from .env, so the dev database and API keys never reach the test servers.
const databaseUrl =
  process.env.NC_TEST_DATABASE_URL ||
  (existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, 'utf8')).NC_TEST_DATABASE_URL : undefined)

if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error(
    'NC_TEST_DATABASE_URL must point to a dedicated database ending in _test. Set it in .env (see .env.example).',
  )

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'pnpm --filter @nc/server exec tsx src/index.ts',
      cwd: here,
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl ?? process.env.DATABASE_URL,
        BETTER_AUTH_SECRET: 'dedicated-browser-test-secret-at-least-32-characters',
        BETTER_AUTH_URL: 'http://127.0.0.1:5173',
        WEB_ORIGIN: 'http://127.0.0.1:5173',
        NC_DISABLE_BACKGROUND_JOBS: 'true',
        PORT: '3001',
        UPLOAD_DIR: path.join(here, '.playwright-uploads'),
      },
    },
    {
      command: 'pnpm --filter @nc/web exec vite --host 127.0.0.1',
      cwd: here,
      url: 'http://127.0.0.1:5173/login',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
