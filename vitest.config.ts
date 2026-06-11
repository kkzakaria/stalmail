import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: 'server',
          include: ['src/server/**/*.test.ts', 'src/lib/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: 'client',
          include: [
            'src/routes/**/*.test.{ts,tsx}',
            'src/components/**/*.test.{ts,tsx}',
            'src/i18n/**/*.test.{ts,tsx}',
          ],
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test-setup.ts'],
        },
      },
    ],
  },
})
