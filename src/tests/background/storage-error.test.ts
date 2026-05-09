/**
 * @file src/tests/background/storage-error.test.ts
 *
 * Test Type: Unit
 * Contexts Tested: Background service worker storage error handling
 * Chrome APIs Mocked: chrome.storage.local (get, set), chrome.runtime.lastError
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Storage } from '@/background/storage';
import { STORAGE_RETRY } from '@/utils/constants';
import type { StorageData } from '@/types';

const loggerErrorMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerDebugMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/logger', () => ({
  logger: {
    info: loggerInfoMock,
    error: loggerErrorMock,
    warn: loggerWarnMock,
    debug: loggerDebugMock,
  },
}));

// Helper to create a minimal valid StorageData snapshot
const createMockData = (): StorageData => ({
  privacyScore: {
    current: 100,
    daily: { trackersBlocked: 0, cleanSitesVisited: 0, nonCompliantSites: 0 },
    history: [],
  },
  alerts: [],
  trackers: {},
  settings: {
    protectionEnabled: true,
    showNotifications: true,
    theme: 'system',
    burnerEmailEnabled: false,
    telemetryEnabled: false,
  },
  lastReset: Date.now(),
  penalizedDomains: {},
  consentStates: {},
  domainOccurrences: {},
  dailySnapshots: [],
  burnerEmailStats: { generated: 0, forwarded: 0 },
  complianceScores: [],
  onboarding: { hasCompletedOnboarding: false, currentStep: 0 },
});

describe('Storage Error Handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    global.chrome = {
      runtime: {
        lastError: undefined,
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('chrome.runtime.lastError + set failures', () => {
    it('retries up to max attempts and then throws', async () => {
      const data = createMockData();

      const setMock = vi
        .fn()
        .mockImplementation(() => {
          (chrome.runtime as any).lastError = new Error('runtime failure');
          return Promise.reject(new Error('runtime failure'));
        });

      chrome.storage.local.set = setMock;

      const savePromise = Storage.save(data);
      const handled = savePromise.catch((err) => err);
      await vi.runAllTimersAsync();

      const err = await handled;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('runtime failure');
      expect(setMock).toHaveBeenCalledTimes(STORAGE_RETRY.MAX_ATTEMPTS);
      expect(loggerWarnMock).toHaveBeenCalled();
      expect(loggerErrorMock).toHaveBeenCalled();
    });

    it('recovers after transient failures and updates cache', async () => {
      const data = createMockData();

      const setMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('quota exceeded'))
        .mockRejectedValueOnce(new Error('quota exceeded'))
        .mockResolvedValueOnce(undefined);

      chrome.storage.local.set = setMock;

      const savePromise = Storage.save(data);
      await vi.runAllTimersAsync();
      await expect(savePromise).resolves.toBeUndefined();

      expect(setMock).toHaveBeenCalledTimes(3);
      // cache should point to last saved data
      const cached = await Storage.get();
      expect(cached.privacyScore.current).toBe(data.privacyScore.current);
      expect(loggerWarnMock).toHaveBeenCalled(); // retries logged
    });
  });

  describe('get failures with fallback', () => {
    it('falls back to default data when get rejects', async () => {
      const getMock = vi.fn().mockRejectedValue(new Error('get failed'));
      chrome.storage.local.get = getMock;

      await Storage.initialize();
      const data = await Storage.get();

      expect(data.privacyScore.current).toBeGreaterThanOrEqual(0);
      expect(loggerErrorMock).toHaveBeenCalled();
    });
  });

  describe('saveWithRetry recovery path', () => {
    it('does not mutate cache when final save fails', async () => {
      const data = createMockData();
      data.privacyScore.current = 42;

      const setMock = vi.fn().mockRejectedValue(new Error('final failure'));
      chrome.storage.local.set = setMock;

      const savePromise = Storage.save(data);
      const handled = savePromise.catch((err) => err);
      await vi.runAllTimersAsync();

      const err = await handled;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('final failure');

      // cache should remain unchanged (not updated to failing data)
      const cached = await Storage.get();
      expect(cached.privacyScore.current).toBe(100);
    });
  });

  describe('savePenalizedDomains error handling', () => {
    it('logs and rethrows when save fails', async () => {
      await Storage.initialize();

      const saveSpy = vi.spyOn(Storage, 'save').mockRejectedValueOnce(new Error('save failed'));

      await expect(Storage.savePenalizedDomains({ 'example.com': 5 })).rejects.toThrow('save failed');
      expect(loggerErrorMock).toHaveBeenCalledWith(
        'Storage',
        'Failed to save penalized domains',
        expect.any(Error)
      );

      saveSpy.mockRestore();
    });
  });
});

