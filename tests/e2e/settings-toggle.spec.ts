import { test, expect } from './fixtures/extension';
import type { Page } from '@playwright/test';
import { openPopup, waitForExtensionReady } from './fixtures/helpers';

type StorageSettings = {
  protectionEnabled: boolean;
  burnerEmailEnabled: boolean;
  telemetryEnabled: boolean;
  theme: 'light' | 'dark' | 'system';
};

async function getSettings(page: Page): Promise<StorageSettings> {
  return page.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    return response?.data?.settings as StorageSettings;
  });
}

test.describe('Settings and Protection E2E', () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await waitForExtensionReady(context);
    const popup = await openPopup(context, extensionId, { activeTabUrl: 'https://example.com' });
    await popup.evaluate(async () => {
      await chrome.storage.local.clear();
    });
    await popup.close();
  });

  test('toggles protection on/off from popup header', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId, { activeTabUrl: 'https://example.com' });

    const protectionButton = page.getByTitle(/protection/i);
    await expect(protectionButton).toBeVisible();

    await expect.poll(async () => (await getSettings(page))?.protectionEnabled).not.toBeUndefined();
    const before = await getSettings(page);
    await protectionButton.click();

    await expect(
      page.getByText(before.protectionEnabled ? 'Protection Paused' : 'Protection Enabled')
    ).toBeVisible();

    const after = await getSettings(page);
    expect(after.protectionEnabled).toBe(!before.protectionEnabled);

    await page.close();
  });

  test('toggles burner email setting and theme from settings page', async ({ context, extensionId }) => {
    const popupPage = await openPopup(context, extensionId, { activeTabUrl: 'https://example.com' });

    await popupPage.getByTitle('Settings').click();
    await expect(popupPage.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await popupPage.getByRole('button', { name: 'Theme' }).click();
    await expect(popupPage.getByRole('heading', { name: 'Theme' })).toBeVisible();

    await popupPage.getByRole('button', { name: 'Dark' }).click();
    await expect.poll(async () => (await getSettings(popupPage)).theme).toBe('dark');

    await popupPage.getByLabel('Back to menu').click();
    await popupPage.getByRole('button', { name: 'Burner Email Services' }).click();
    await expect(popupPage.getByRole('heading', { name: 'Burner Email Services' })).toBeVisible();

    const burnerToggle = popupPage.getByRole('button', { name: 'Toggle burner email protection' });
    await burnerToggle.click();

    await expect.poll(async () => (await getSettings(popupPage)).burnerEmailEnabled).toBe(true);
    await expect(popupPage.locator('#real-email-input')).toBeEnabled();
    await popupPage.close();
  });

  test('toggles telemetry setting on and off from settings page', async ({ context, extensionId }) => {
    const popupPage = await openPopup(context, extensionId, { activeTabUrl: 'https://example.com' });

    await popupPage.getByTitle('Settings').click();
    await expect(popupPage.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await popupPage.getByRole('button', { name: /Telemetry/i }).click();
    await expect(popupPage.getByRole('heading', { name: 'Telemetry & Improvements' })).toBeVisible();

    await expect.poll(async () => (await getSettings(popupPage)).telemetryEnabled).toBe(false);

    const telemetryToggle = popupPage.getByRole('button', { name: 'Toggle telemetry collection' });
    await telemetryToggle.click();
    await expect.poll(async () => (await getSettings(popupPage)).telemetryEnabled).toBe(true);

    await telemetryToggle.click();
    await expect.poll(async () => (await getSettings(popupPage)).telemetryEnabled).toBe(false);

    await popupPage.close();
  });
});
