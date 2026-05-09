import { describe, it, expect, beforeAll } from 'vitest';
import { Storage } from '@/background/storage';
import { ONBOARDING } from '@/utils/constants';

describe('Onboarding storage', () => {
  beforeAll(async () => {
    await Storage.initialize();
  });

  it('clamps onboarding step within bounds', async () => {
    const state = await Storage.setOnboardingStep(ONBOARDING.TOTAL_STEPS + 5);
    expect(state.currentStep).toBe(ONBOARDING.TOTAL_STEPS - 1);
    expect(state.hasCompletedOnboarding).toBe(false);
    expect(state.startedAt).toBeTypeOf('number');
    expect(Array.isArray(state.stepTimings)).toBe(true);
  });

  it('marks onboarding as complete with metadata', async () => {
    const state = await Storage.completeOnboarding(true);
    expect(state.hasCompletedOnboarding).toBe(true);
    expect(state.emailConfigured).toBe(true);
    expect(state.completedAt).toBeTypeOf('number');
  });

  it('records skipped onboarding state', async () => {
    const state = await Storage.skipOnboarding(2);
    expect(state.hasCompletedOnboarding).toBe(true);
    expect(state.skippedAt).toBeTypeOf('number');
    expect(state.currentStep).toBe(2);
  });

  it('records per-step timing when moving between steps', async () => {
    await Storage.setOnboardingStep(0, {
      stepId: 'welcome',
      enteredAt: 1000,
      exitedAt: 1200,
    });
    const state = await Storage.setOnboardingStep(1, {
      stepId: 'protection',
      previousStepId: 'welcome',
      enteredAt: 1200,
      exitedAt: 1200,
      durationMs: 200,
    });

    expect(state.stepTimings?.length).toBeGreaterThanOrEqual(2);
    const previousStep = state.stepTimings?.find((entry) => entry.stepId === 'welcome');
    const currentStep = state.stepTimings?.find((entry) => entry.stepId === 'protection');
    expect(previousStep?.durationMs).toBe(200);
    expect(previousStep?.exitedAt).toBe(1200);
    expect(currentStep?.enteredAt).toBe(1200);
  });
});

