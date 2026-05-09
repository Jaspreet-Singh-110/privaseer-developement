import path from 'path';
import { chromium, type BrowserContext, expect, test as base } from '@playwright/test';

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
};

const extensionPath = path.join(process.cwd(), 'dist');

export const test = base.extend<ExtensionFixtures>({
  context: async (_fixtures, provideContext) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      timeout: 120000, // 2 minutes for Rosetta 2 translation on first run
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--disable-gpu', // Reduce GPU overhead
        '--disable-dev-shm-usage', // Overcome limited resource problems
      ],
    });

    await provideContext(context);
    await context.close();
  },

  extensionId: async ({ context }, provideExtensionId) => {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = serviceWorker.url().split('/')[2];
    await provideExtensionId(extensionId);
  },
});

export { expect };
