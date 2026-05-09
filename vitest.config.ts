import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(() => {
  const isStryker = process.env.STRYKER_MUTATION === '1';

  const exclude = [
    '**/node_modules/**',
    '**/dist/**',
    '**/.stryker-tmp/**',
    '**/tests/e2e/**',
    ...(isStryker
      ? [
          'src/tests/popup/settings-page.test.tsx',
          'src/tests/content-scripts/email-autofill.test.ts',
          'src/tests/welcome/welcome.test.tsx',
        ]
      : []),
  ];

  return {
    plugins: [react({ jsxRuntime: 'automatic' })],
    esbuild: {
      sourcemap: isStryker ? false : undefined,
    },
    build: {
      sourcemap: isStryker ? false : undefined,
      rollupOptions: isStryker ? {
        output: {
          sourcemap: false,
        }
      } : undefined,
    },
    optimizeDeps: {
      esbuildOptions: {
        sourcemap: isStryker ? false : undefined,
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: isStryker
        ? ['./src/tests/stryker-vite-shim.ts', './src/tests/setup.ts']
        : ['./src/tests/setup.ts'],
      exclude,
      // Use threads pool for Stryker to avoid birpc race conditions
      pool: isStryker ? 'threads' : 'forks',
      poolOptions: {
        forks: {
          singleFork: false,
        },
        threads: {
          singleThread: isStryker ? true : false,
        },
      },
      coverage: {
        provider: 'v8' as const,
        reporter: ['text', 'json', 'html', 'lcov'],
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        exclude: [
          'src/**/*.test.ts',
          'src/**/*.test.tsx',
          'src/tests/**',
          'src/vite-env.d.ts',
          'src/manifest.json',
        ],
        thresholds: {
          lines: 80,
          functions: 85,
          branches: 75,
          statements: 80,
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
  };
});
