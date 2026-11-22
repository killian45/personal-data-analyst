import { defineConfig } from 'vitest/config'

// Database tests: run against the LOCAL Supabase stack only
// ("npm run db:start" first, then "npm run test:db").
// They are kept out of "npm test" because they need the stack running.
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts', 'src/**/*.dbtest.ts'],
    environment: 'node',
    globalSetup: ['./supabase/tests/globalSetup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
