import type { BrowserContext, Page } from '@playwright/test';

export async function waitForExtensionReady(context: BrowserContext): Promise<void> {
  if (context.serviceWorkers().length > 0) {
    return;
  }
  await context.waitForEvent('serviceworker');
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }
  return serviceWorker.url().split('/')[2];
}

export async function openPopup(
  context: BrowserContext,
  extensionId: string,
  options?: { activeTabUrl?: string }
): Promise<Page> {
  const page = await context.newPage();
  if (options?.activeTabUrl) {
    await page.addInitScript((url: string) => {
      chrome.tabs.query = async () => [{ id: 1, url } as chrome.tabs.Tab];
    }, options.activeTabUrl);
  }
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

export async function openWelcomePage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/welcome/welcome.html`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}
