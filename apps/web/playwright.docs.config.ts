import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/** The documentation screenshots (`pnpm docs:screenshots`): the browser-test servers, with their own tests. */
export default defineConfig({ ...base, testDir: './tests/docs', retries: 0 })
