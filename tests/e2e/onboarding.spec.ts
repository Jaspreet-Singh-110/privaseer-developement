import { test, expect } from './fixtures/extension';
import type { Page } from '@playwright/test';
import { openPopup, openWelcomePage, waitForExtensionReady } from './fixtures/helpers';

type OnboardingState = {
  hasCompletedOnboarding: boolean;
  currentStep: number;
  completedAt?: number;
  skippedAt?: number;
};

const TOTAL_STEPS = 6;

async function getOnboardingState(page: Page): Promise<OnboardingState> {
  return page.evaluate(async () => {
    const data = await chrome.storage.local.get('privacyData');
    return data.privacyData?.onboarding as OnboardingState;
  });
}

async function goToStep(page: Page, targetStep: number): Promise<void> {
  for (let step = 0; step < targetStep; step++) {
    const primaryButton =
      step === 0
        ? page.getByRole('button', { name: /get started/i })
        : page.getByRole('button', { name: /continue/i });
    await primaryButton.click();
  }
}

test.describe('Onboarding E2E', () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await waitForExtensionReady(context);
    const popup = await openPopup(context, extensionId, { activeTabUrl: 'https://example.com' });
    await popup.evaluate(async () => {
      await chrome.storage.local.clear();
    });
    await popup.close();
  });

  test('completes the onboarding flow', async ({ context, extensionId }) => {
    const welcomePage = await openWelcomePage(context, extensionId);
    await expect(welcomePage.getByText(/step 1/i)).toBeVisible();

    for (let step = 0; step < TOTAL_STEPS - 1; step++) {
      const primaryButton =
        step === 0
          ? welcomePage.getByRole('button', { name: /get started/i })
          : welcomePage.getByRole('button', { name: /continue/i });
      await primaryButton.click();
      await expect(welcomePage.getByText(new RegExp(`step ${step + 2}`, 'i'))).toBeVisible();
    }

    await Promise.all([
      welcomePage.waitForEvent('close'),
      welcomePage.getByRole('button', { name: /finish/i }).click(),
    ]);

    const popupPage = await openPopup(context, extensionId, { activeTabUrl: 'https://example.com' });
    const onboarding = await getOnboardingState(popupPage);
    expect(onboarding.hasCompletedOnboarding).toBe(true);
    expect(onboarding.currentStep).toBe(TOTAL_STEPS - 1);
    expect(typeof onboarding.completedAt).toBe('number');
    await popupPage.close();
  });

  test('skips onboarding from the first step', async ({ context, extensionId }) => {
    const welcomePage = await openWelcomePage(context, extensionId);
    await expect(welcomePage.getByRole('button', { name: /skip tour/i })).toBeVisible();

    await Promise.all([
      welcomePage.waitForEvent('close'),
      welcomePage.getByRole('button', { name: /skip tour/i }).click(),
    ]);

    const popupPage = await openPopup(context, extensionId, { activeTabUrl: 'https://example.com' });
    const onboarding = await getOnboardingState(popupPage);
    expect(onboarding.hasCompletedOnboarding).toBe(true);
    expect(typeof onboarding.skippedAt).toBe('number');
    await popupPage.close();
  });

  test('navigates back and persists current step', async ({ context, extensionId }) => {
    const page = await openWelcomePage(context, extensionId);

    await goToStep(page, 2);
    await expect(page.getByText(/step 3/i)).toBeVisible();

    await page.getByRole('button', { name: /back/i }).click();
    await expect(page.getByText(/step 2/i)).toBeVisible();

    await page.close();

    const resumed = await context.newPage();
    await resumed.goto(`chrome-extension://${extensionId}/src/welcome/welcome.html`);
    await resumed.waitForLoadState('domcontentloaded');
    await expect(resumed.getByText(/step 2/i)).toBeVisible();
    await resumed.close();
  });
});
