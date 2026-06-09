import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          include: ['src/server/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'client',
          include: ['src/routes/**/*.test.tsx', 'src/components/**/*.test.tsx'],
          environment: 'jsdom',
          globals: true,
        },
      },
    ],
  },
})
