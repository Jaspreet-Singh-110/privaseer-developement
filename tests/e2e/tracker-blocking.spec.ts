import { test, expect } from './fixtures/extension';
import type { BrowserContext, Page } from '@playwright/test';
import { openPopup, waitForExtensionReady } from './fixtures/helpers';

type TrackerSnapshot = {
  blockedToday: number;
  trackerDomainCount: number;
};

async function getTrackerSnapshot(page: Page): Promise<TrackerSnapshot> {
  return page.evaluate(async () => {
    const data = await chrome.storage.local.get('privacyData');
    const privacyData = data.privacyData as
      | {
          privacyScore?: { daily?: { trackersBlocked?: number } };
          trackers?: Record<string, unknown>;
        }
      | undefined;

    return {
      blockedToday: privacyData?.privacyScore?.daily?.trackersBlocked ?? 0,
      trackerDomainCount: Object.keys(privacyData?.trackers ?? {}).length,
    };
  });
}

async function getTrackerTabId(context: BrowserContext, url: string): Promise<number | null> {
  const [worker] = context.serviceWorkers();
  if (!worker) {
    return null;
  }

  return worker.evaluate(async targetUrl => {
    const tabs = await chrome.tabs.query({ url: targetUrl });
    return tabs[0]?.id ?? null;
  }, url);
}

async function getBadgeText(context: BrowserContext, tabId: number): Promise<string> {
  const [worker] = context.serviceWorkers();
  if (!worker) {
    return '';
  }

  return worker.evaluate(async id => {
    return new Promise<string>(resolve => {
      chrome.action.getBadgeText({ tabId: id }, text => {
        resolve(text ?? '');
      });
    });
  }, tabId);
}

test.describe('Tracker Blocking E2E', () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await waitForExtensionReady(context);
    const popup = await openPopup(context, extensionId, { activeTabUrl: 'https://example.com' });
    await popup.evaluate(async () => {
      await chrome.storage.local.clear();
    });
    await popup.close();
  });

  test('blocks known tracker requests and increments badge', async ({ context, extensionId }) => {
    const trackerPageUrl = 'http://localhost:3333/tracker-page.html';
    const page = await context.newPage();
    await page.goto(trackerPageUrl);
    await page.waitForLoadState('domcontentloaded');

    const popupPage = await openPopup(context, extensionId, { activeTabUrl: trackerPageUrl });

    await expect
      .poll(async () => {
        const snapshot = await getTrackerSnapshot(popupPage);
        return snapshot.blockedToday;
      }, { timeout: 15_000 })
      .toBeGreaterThan(0);

    const snapshot = await getTrackerSnapshot(popupPage);
    expect(snapshot.trackerDomainCount).toBeGreaterThan(0);

    const trackerTabId = await getTrackerTabId(context, trackerPageUrl);
    expect(trackerTabId).not.toBeNull();

    await expect
      .poll(async () => {
        const badgeText = await getBadgeText(context, trackerTabId!);
        return Number.parseInt(badgeText || '0', 10);
      }, { timeout: 15_000 })
      .toBeGreaterThan(0);

    await expect(popupPage.getByText(/blocked today/i)).toBeVisible();

    await popupPage.close();
    await page.close();
  });
});
