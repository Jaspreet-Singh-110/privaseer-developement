import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Storage } from '@/background/storage';
import { STORAGE_RETRY } from '@/utils/constants';
import { logger } from '@/utils/logger';

const cloneData = async () => {
  const data = await Storage.get();
  return JSON.parse(JSON.stringify(data));
};

describe('Storage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await Storage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with default data', async () => {
    await Storage.initialize();
    const data = await Storage.get();

    expect(data).toHaveProperty('privacyScore');
    expect(data.privacyScore.current).toBeGreaterThanOrEqual(0);
    expect(data.privacyScore.current).toBeLessThanOrEqual(100);
    expect(data).toHaveProperty('alerts');
    expect(data).toHaveProperty('trackers');
    expect(data).toHaveProperty('settings');
  });

  it('should update privacy score', async () => {
    await Storage.updateScore(75);
    const data = await Storage.get();
    expect(data.privacyScore.current).toBe(75);
  });

  it('should clamp score to 0-100 range', async () => {
    await Storage.updateScore(-10);
    let data = await Storage.get();
    expect(data.privacyScore.current).toBe(0);

    await Storage.updateScore(150);
    data = await Storage.get();
    expect(data.privacyScore.current).toBe(100);
  });

  it('should add alerts', async () => {
    const initialData = await Storage.get();
    const initialCount = initialData.alerts.length;

    const alert = {
      id: `alert-${Date.now()}`,
      type: 'tracker_blocked' as const,
      severity: 'high' as const,
      domain: `tracker-${Date.now()}.com`,
      message: 'Tracker blocked',
      timestamp: Date.now(),
    };

    await Storage.addAlert(alert);
    const data = await Storage.get();

    expect(data.alerts.length).toBeGreaterThan(initialCount);
  });

  it('should clear all alerts', async () => {
    await Storage.clearAlerts();
    const data = await Storage.get();
    expect(data.alerts.length).toBe(0);
  });

  it('should toggle protection', async () => {
    const initialState = (await Storage.get()).settings.protectionEnabled;
    const newState = await Storage.toggleProtection();
    expect(newState).toBe(!initialState);
  });

  it('should default telemetry to disabled and allow toggling', async () => {
    const defaultState = await Storage.getTelemetryEnabled();
    expect(defaultState).toBe(false);

    await Storage.setTelemetryEnabled(true);
    expect(await Storage.getTelemetryEnabled()).toBe(true);

    await Storage.setTelemetryEnabled(false);
    expect(await Storage.getTelemetryEnabled()).toBe(false);
  });

  it('should handle storage get operation', async () => {
    await expect(Storage.get()).resolves.toBeDefined();
  });

  it('batches non-critical saves when adding alerts', async () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(chrome.storage.local, 'set').mockResolvedValue(undefined);

    await Storage.addAlert({
      id: 'alert-1',
      type: 'tracker_blocked',
      severity: 'low',
      domain: 'example.com',
      message: 'Alert 1',
      timestamp: Date.now(),
    });
    await Storage.addAlert({
      id: 'alert-2',
      type: 'tracker_blocked',
      severity: 'low',
      domain: 'example.com',
      message: 'Alert 2',
      timestamp: Date.now(),
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(setSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('enforces alert retention limits', async () => {
    const now = Date.now();
    for (let i = 0; i < 105; i += 1) {
      await Storage.addAlert({
        id: `alert-${i}`,
        type: 'tracker_blocked',
        severity: 'low',
        domain: 'example.com',
        message: `Alert ${i}`,
        timestamp: now + i,
      });
    }

    const data = await Storage.get();
    expect(data.alerts.length).toBe(100);
  });

  it('retries saving with exponential backoff', async () => {
    vi.useFakeTimers();
    const setSpy = vi
      .spyOn(chrome.storage.local, 'set')
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValueOnce(undefined);

    const data = await cloneData();
    const saveResultPromise = Storage.save(data)
      .then(() => ({ ok: true as const }))
      .catch((error: unknown) => ({ ok: false as const, error }));

    await vi.advanceTimersByTimeAsync(STORAGE_RETRY.INITIAL_DELAY_MS);
    await vi.advanceTimersByTimeAsync(
      STORAGE_RETRY.INITIAL_DELAY_MS * STORAGE_RETRY.BACKOFF_MULTIPLIER
    );
    const saveResult = await saveResultPromise;
    expect(saveResult.ok).toBe(true);

    expect(setSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('handles concurrent scheduled writes and flushes final state safely', async () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(chrome.storage.local, 'set').mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    await Promise.all([
      Storage.addAlert({
        id: 'alert-concurrent-1',
        type: 'tracker_blocked',
        severity: 'low',
        domain: 'concurrent.example',
        message: 'Concurrent alert 1',
        timestamp: Date.now(),
      }),
      Storage.addAlert({
        id: 'alert-concurrent-2',
        type: 'tracker_blocked',
        severity: 'medium',
        domain: 'concurrent.example',
        message: 'Concurrent alert 2',
        timestamp: Date.now() + 1,
      }),
      Storage.incrementTrackerBlock('tracker.concurrent', 'analytics', false),
    ]);

    await vi.advanceTimersByTimeAsync(1000);
    await Storage.ensureSaved();

    const data = await Storage.get();
    expect(data.alerts.some(a => a.id === 'alert-concurrent-1')).toBe(true);
    expect(data.alerts.some(a => a.id === 'alert-concurrent-2')).toBe(true);
    expect(data.trackers['tracker.concurrent']).toBeDefined();
    expect(setSpy).toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it('throws after max retries when storage quota is exceeded', async () => {
    vi.useFakeTimers();
    const quotaError = new Error('QUOTA_BYTES quota exceeded');
    const setSpy = vi
      .spyOn(chrome.storage.local, 'set')
      .mockRejectedValueOnce(quotaError)
      .mockRejectedValueOnce(quotaError)
      .mockRejectedValueOnce(quotaError)
      .mockResolvedValue(undefined);

    const data = await cloneData();
    const saveResultPromise = Storage.save(data)
      .then(() => ({ ok: true as const }))
      .catch((error: unknown) => ({ ok: false as const, error }));

    await vi.advanceTimersByTimeAsync(STORAGE_RETRY.INITIAL_DELAY_MS);
    await vi.advanceTimersByTimeAsync(
      STORAGE_RETRY.INITIAL_DELAY_MS * STORAGE_RETRY.BACKOFF_MULTIPLIER
    );
    const saveResult = await saveResultPromise;
    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect((saveResult.error as Error).message).toContain('QUOTA_BYTES quota exceeded');
    }
    expect(setSpy.mock.calls.length).toBeGreaterThanOrEqual(STORAGE_RETRY.MAX_ATTEMPTS);
    setSpy.mockRestore();
  });

  it('refreshes cache when fetching fresh data', async () => {
    const original = await cloneData();
    const updated = { ...original, settings: { ...original.settings, theme: 'dark' } };

    vi.spyOn(chrome.storage.local, 'get').mockImplementation(
      async () => ({ privacyData: updated }) as unknown as void
    );

    const fresh = await Storage.getFresh();
    expect(fresh.settings.theme).toBe('dark');
  });

  it('should get and set real email', async () => {
    await Storage.setRealEmail('test@example.com');
    const email = await Storage.getRealEmail();
    expect(email).toBe('test@example.com');
  });

  it('should get and set theme', async () => {
    await Storage.setTheme('dark');
    const data = await Storage.get();
    expect(data.settings.theme).toBe('dark');
  });

  it('should get onboarding state', async () => {
    const onboarding = await Storage.getOnboardingState();
    expect(onboarding).toHaveProperty('hasCompletedOnboarding');
    expect(onboarding).toHaveProperty('currentStep');
  });

  it('should set onboarding step', async () => {
    const result = await Storage.setOnboardingStep(2);
    expect(result.currentStep).toBe(2);
  });

  it('should complete onboarding', async () => {
    const result = await Storage.completeOnboarding(true);
    expect(result.hasCompletedOnboarding).toBe(true);
  });

  it('should skip onboarding', async () => {
    const result = await Storage.skipOnboarding(3);
    expect(result.hasCompletedOnboarding).toBe(true);
  });

  it('should record compliance scores', async () => {
    await Storage.recordComplianceScore(85);
    const data = await Storage.get();
    expect((data.complianceScores ?? []).length).toBeGreaterThan(0);
  });

  it('should get consent state for domain', async () => {
    const state = await Storage.getConsentState('example.com');
    expect(state).toBeNull();
  });

  it('should get allowlist entries', async () => {
    const entries = await Storage.getAllowlistEntries();
    expect(entries).toBeDefined();
  });

  it('should ensure saved flushes pending writes', async () => {
    vi.useFakeTimers();
    
    await Storage.addAlert({
      id: 'alert-pending',
      type: 'tracker_blocked',
      severity: 'low',
      domain: 'example.com',
      message: 'Pending alert',
      timestamp: Date.now(),
    });

    await Storage.ensureSaved();
    
    const data = await Storage.get();
    expect(data.alerts.some(a => a.id === 'alert-pending')).toBe(true);
  });

  it('should increment tracker blocks', async () => {
    await Storage.incrementTrackerBlock('tracker.com', 'analytics', false);
    const data = await Storage.get();
    expect(data.trackers['tracker.com']).toBeDefined();
  });

  it('should increment tracker blocks and verify data', async () => {
    await Storage.incrementTrackerBlock('tracker1.com', 'analytics', false);
    await Storage.incrementTrackerBlock('tracker2.com', 'advertising', true);
    
    const data = await Storage.get();
    expect(data.trackers['tracker1.com']).toBeDefined();
    expect(data.trackers['tracker2.com']).toBeDefined();
  });

  it('should check daily reset', async () => {
    const data = await Storage.get();
    data.lastReset = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
    await Storage.save(data);

    await (Storage as unknown as { checkDailyReset: () => Promise<void> }).checkDailyReset();

    const resetData = await Storage.get();
    expect(resetData.privacyScore.daily.trackersBlocked).toBe(0);
  });

  it('increments blockedCount when same tracker domain is seen twice', async () => {
    await Storage.incrementTrackerBlock('repeat-tracker.com', 'analytics', false);
    await Storage.incrementTrackerBlock('repeat-tracker.com', 'analytics', false);

    const data = await Storage.get();
    expect(data.trackers['repeat-tracker.com']?.blockedCount).toBe(2);
  });

  it('records post-consent violations in daily credit metrics', async () => {
    await Storage.recordViolationForCredit();
    const metrics = await Storage.getDailyCreditMetrics(1);

    expect(metrics[0]).toBeDefined();
    expect(metrics[0]?.postConsentViolations).toBe(1);
  });

  it('records burner email generated and forwarded counters', async () => {
    await Storage.recordBurnerEmailGenerated();
    await Storage.recordBurnerEmailForwarded();

    const data = await Storage.get();
    expect(data.burnerEmailStats?.generated).toBe(1);
    expect(data.burnerEmailStats?.forwarded).toBe(1);
  });

  it('returns theme via getTheme and delegates updateTheme to setTheme', async () => {
    await Storage.setTheme('dark');
    expect(await Storage.getTheme()).toBe('dark');

    const setThemeSpy = vi.spyOn(Storage, 'setTheme').mockResolvedValue(undefined);
    await Storage.updateTheme('light');
    expect(setThemeSpy).toHaveBeenCalledWith('light');
    setThemeSpy.mockRestore();
  });

  it('clears expired consent states and logs cleared count', async () => {
    const loggerInfoSpy = vi.spyOn(logger, 'info');
    const now = Date.now();
    const expired = now - 1000;
    const valid = now + 60000;
    const data = await Storage.get();
    data.consentStates = {
      'expired.example': {
        domain: 'expired.example',
        consentStatus: 'accepted',
        cmpId: 'test-cmp',
        timestamp: now - 5000,
        choice: 'explicit',
        expiresAt: expired,
      },
      'valid.example': {
        domain: 'valid.example',
        consentStatus: 'rejected',
        cmpId: 'test-cmp',
        timestamp: now - 5000,
        choice: 'explicit',
        expiresAt: valid,
      },
    };
    await Storage.save(data);

    await Storage.clearExpiredConsentStates();

    const updated = await Storage.get();
    expect(updated.consentStates['expired.example']).toBeUndefined();
    expect(updated.consentStates['valid.example']).toBeDefined();
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      'Storage',
      'Expired consent states cleared',
      { count: 1 }
    );
    loggerInfoSpy.mockRestore();
  });

  it('daily reset recreates burner stats and fresh daily metrics entry', async () => {
    const now = Date.now();
    const previousDay = now - (26 * 60 * 60 * 1000);
    const data = await Storage.get();
    data.lastReset = previousDay;
    data.burnerEmailStats = { generated: 7, forwarded: 4 };
    data.complianceScores = [90, 82];
    data.dailyCreditMetrics = [];
    data.privacyScore.daily = {
      trackersBlocked: 5,
      cleanSitesVisited: 3,
      nonCompliantSites: 2,
    };
    await Storage.save(data);

    await (Storage as unknown as { checkDailyReset: () => Promise<void> }).checkDailyReset();

    const updated = await Storage.get();
    expect(updated.burnerEmailStats).toEqual({ generated: 0, forwarded: 0 });
    expect(updated.complianceScores).toEqual([]);
    expect((updated.dailyCreditMetrics ?? []).length).toBeGreaterThan(0);
    expect(updated.dailyCreditMetrics?.[0]?.date).toBe(new Date().toISOString().split('T')[0]);
  });

  it('initialize creates default onboarding state when missing', async () => {
    const data = await Storage.get();
    delete (data as Partial<typeof data>).onboarding;

    vi.spyOn(chrome.storage.local, 'get').mockImplementationOnce(
      async () => ({ privacyData: data }) as unknown as void
    );
    vi.spyOn(chrome.storage.local, 'set').mockResolvedValue(undefined);

    await Storage.initialize();
    const updated = await Storage.get();
    expect(updated.onboarding).toEqual(expect.objectContaining({
      hasCompletedOnboarding: false,
      currentStep: 0,
    }));
  });
});
