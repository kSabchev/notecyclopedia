import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The barrel and the type declarations have no code of their own.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/types.ts'],
      reporter: ['text-summary', 'text', 'html'],
      // A floor a little under today's numbers, so a drop shows up in CI.
      thresholds: { lines: 93, branches: 83, functions: 90 },
    },
  },
})
