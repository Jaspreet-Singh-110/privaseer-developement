import { test, expect } from './fixtures/extension';
import type { BrowserContext, Page } from '@playwright/test';
import { openPopup, waitForExtensionReady } from './fixtures/helpers';

type Alert = {
  message: string;
  domain: string;
  type: string;
  deceptivePatterns?: string[];
};

async function getAlerts(page: Page): Promise<Alert[]> {
  return page.evaluate(async () => {
    const data = await chrome.storage.local.get('privacyData');
    return (data.privacyData?.alerts ?? []) as Alert[];
  });
}

async function openPopupWithActiveTab(
  context: BrowserContext,
  extensionId: string,
  url: string
): Promise<Page> {
  return openPopup(context, extensionId, { activeTabUrl: url });
}

test.describe('Consent Banner Detection E2E', () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await waitForExtensionReady(context);
    const popup = await openPopup(context, extensionId, { activeTabUrl: 'https://example.com' });
    await popup.evaluate(async () => {
      await chrome.storage.local.clear();
    });
    await popup.close();
  });

  test('detects non-compliant banner and creates alert', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto('http://localhost:3333/consent-banner.html');
    await page.waitForLoadState('domcontentloaded');

    const popupPage = await openPopupWithActiveTab(
      context,
      extensionId,
      'http://localhost:3333/consent-banner.html'
    );

    await expect.poll(async () => {
      const alerts = await getAlerts(popupPage);
      return alerts.find(alert => alert.domain === 'localhost' && alert.type === 'non_compliant_site');
    }, { timeout: 15000 }).not.toBeUndefined();

    await popupPage.reload();
    await expect(popupPage.getByText('localhost may not follow privacy best practices')).toBeVisible();

    await page.close();
    await popupPage.close();
  });

  test('detects deceptive patterns in banner', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto('http://localhost:3333/consent-banner.html');
    await page.waitForLoadState('domcontentloaded');

    const popupPage = await openPopupWithActiveTab(
      context,
      extensionId,
      'http://localhost:3333/consent-banner.html'
    );

    await expect.poll(async () => {
      const alerts = await getAlerts(popupPage);
      return alerts.find(alert => alert.domain === 'localhost' && alert.type === 'non_compliant_site');
    }, { timeout: 15000 }).not.toBeUndefined();

    await popupPage.reload();
    await popupPage.getByText('localhost may not follow privacy best practices').click();
    await expect(popupPage.getByText('Reject option may require scrolling')).toBeVisible();

    await page.close();
    await popupPage.close();
  });

  test('does not create alerts on clean page', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto('http://localhost:3333/clean-page.html');
    await page.waitForLoadState('domcontentloaded');

    await page.waitForTimeout(11000);

    const popupPage = await openPopupWithActiveTab(
      context,
      extensionId,
      'http://localhost:3333/clean-page.html'
    );
    const alerts = await getAlerts(popupPage);
    expect(alerts.filter(alert => alert.type === 'non_compliant_site')).toHaveLength(0);

    await page.close();
    await popupPage.close();
  });
});
