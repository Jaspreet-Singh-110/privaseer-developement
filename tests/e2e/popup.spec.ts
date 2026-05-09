import { test, expect } from './fixtures/extension';
import { openPopup, waitForExtensionReady } from './fixtures/helpers';

test.describe('Popup E2E', () => {
  test('loads popup and shows dashboard content', async ({ context, extensionId }) => {
    await waitForExtensionReady(context);
    const extensionPage = await openPopup(context, extensionId, { activeTabUrl: 'https://example.com' });
    const consoleErrors: string[] = [];
    extensionPage.on('console', message => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await expect(extensionPage).toHaveTitle(/Privaseer/i);
    await expect(extensionPage.locator('#root')).toBeVisible();
    await expect(extensionPage.getByRole('heading', { name: 'Privaseer' })).toBeVisible();
    await expect(extensionPage.getByTitle('Settings')).toBeVisible();
    await expect(extensionPage.getByTitle(/protection/i)).toBeVisible();
    await expect(extensionPage.getByText(/Score:\s*\d+\s*\/\s*850/i)).toBeVisible();
    await expect(extensionPage.getByText(/Excellent|Good|Fair|Poor|Very Poor/i).first()).toBeVisible();

    // Root should render application content
    await expect(extensionPage.locator('#root')).not.toBeEmpty();
    expect(consoleErrors).toEqual([]);
    await extensionPage.close();
  });
});

