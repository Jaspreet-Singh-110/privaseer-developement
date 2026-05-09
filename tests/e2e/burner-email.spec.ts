import { test, expect } from './fixtures/extension';
import { openPopup, waitForExtensionReady } from './fixtures/helpers';

test.describe('Burner Email Content Script E2E', () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await waitForExtensionReady(context);
    const popup = await openPopup(context, extensionId, { activeTabUrl: 'https://example.com' });
    await popup.evaluate(async () => {
      await chrome.storage.local.clear();
    });
    await popup.close();
  });

  test('shows burner email button on focused email input when feature is enabled', async ({
    context,
    extensionId,
  }) => {
    const popupPage = await openPopup(context, extensionId, { activeTabUrl: 'https://example.com' });
    await popupPage.getByTitle('Settings').click();
    await expect(popupPage.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await popupPage.getByRole('button', { name: 'Burner Email Services' }).click();

    const burnerToggle = popupPage.getByRole('button', { name: 'Toggle burner email protection' });
    await burnerToggle.click();
    await expect(popupPage.locator('#real-email-input')).toBeEnabled();
    await popupPage.close();

    const page = await context.newPage();
    await page.goto('http://localhost:3333/email-form.html');
    await page.waitForLoadState('domcontentloaded');

    const emailInput = page.locator('#user-email');
    await expect(emailInput).toBeVisible();
    await emailInput.click();

    const burnerButton = page.locator('#privaseer-burner-email-btn');
    await expect(burnerButton).toBeVisible();
    await expect(burnerButton).toContainText('Generate Burner Email');

    await page.getByRole('heading', { name: 'Burner Email Test Form' }).click();
    await expect(burnerButton).toBeHidden();

    await page.close();
  });
});
