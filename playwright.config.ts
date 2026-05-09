import path from 'path';
import { defineConfig, devices } from '@playwright/test';

const extensionPath = path.join(process.cwd(), 'dist');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1, // keep single worker for extension stability
  reporter: 'list',
  webServer: {
    command: 'python3 -m http.server 3333 --directory tests/e2e/pages',
    port: 3333,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    headless: false, // extensions require headed mode
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-extension',
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
        launchOptions: {
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
          ],
        },
      },
    },
  ],
});

