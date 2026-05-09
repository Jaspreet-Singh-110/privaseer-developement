import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Storage } from '@/background/storage';
import type { LocalConsentState, StorageData } from '@/types';

vi.mock('@/utils/logger');

const mockChrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
    },
  },
  runtime: {
    id: 'test-extension-id',
  },
};

global.chrome = mockChrome as any;

const createMockStorageData = (overrides: Partial<StorageData> = {}): { privacyData: StorageData } => ({
  privacyData: {
    privacyScore: { current: 100, daily: { trackersBlocked: 0, cleanSitesVisited: 0, nonCompliantSites: 0 }, history: [] },
    alerts: [],
    trackers: {},
    settings: { protectionEnabled: true, showNotifications: true, theme: 'system', burnerEmailEnabled: true, telemetryEnabled: false },
    lastReset: Date.now(),
    penalizedDomains: {},
    consentStates: {},
    domainOccurrences: {},
    onboarding: { hasCompletedOnboarding: false, currentStep: 0 },
    ...overrides,
  },
});

describe('Consent Persistence', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    (Storage as any).cache = null;
    mockChrome.storage.local.get.mockResolvedValue({});
    mockChrome.storage.local.set.mockResolvedValue(undefined);
  });

  describe('getConsentState', () => {
    it('should return null for non-existent domain', async () => {
      mockChrome.storage.local.get.mockResolvedValue(createMockStorageData());

      const state = await Storage.getConsentState('example.com');
      expect(state).toBeNull();
    });

    it('should return consent state for existing domain', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'rejected',
        cmpId: 'OneTrust',
        timestamp: Date.now(),
        choice: 'explicit',
      };

      mockChrome.storage.local.get.mockResolvedValue(createMockStorageData({
        consentStates: {
          'example.com': consentState,
        },
      }));

      const state = await Storage.getConsentState('example.com');
      expect(state).toEqual(consentState);
    });
  });

  describe('setConsentState', () => {
    it('should save consent state for a domain', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'Cookiebot',
        timestamp: Date.now(),
        choice: 'explicit',
        expiresAt: Date.now() + 86400000,
      };

      mockChrome.storage.local.get.mockResolvedValue(createMockStorageData());

      await Storage.setConsentState('example.com', consentState);
      await Storage.ensureSaved();

      expect(mockChrome.storage.local.set).toHaveBeenCalled();
    });

    it('should update existing consent state', async () => {
      const oldState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'unknown',
        cmpId: 'Unknown',
        timestamp: Date.now() - 1000,
        choice: 'none',
      };

      const newState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'rejected',
        cmpId: 'OneTrust',
        timestamp: Date.now(),
        choice: 'explicit',
      };

      mockChrome.storage.local.get.mockResolvedValue(createMockStorageData({
        consentStates: {
          'example.com': oldState,
        },
      }));

      await Storage.setConsentState('example.com', newState);
      await Storage.ensureSaved();

      expect(mockChrome.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('incrementDomainOccurrence', () => {
    it('should initialize occurrence count to 1 for new domain', async () => {
      mockChrome.storage.local.get.mockResolvedValue(createMockStorageData());

      const count = await Storage.incrementDomainOccurrence('example.com');
      expect(count).toBe(1);
    });

    it('should increment existing occurrence count', async () => {
      mockChrome.storage.local.get.mockResolvedValue(createMockStorageData({
        domainOccurrences: {
          'example.com': 5,
        },
      }));

      const count = await Storage.incrementDomainOccurrence('example.com');
      expect(count).toBe(6);
    });
  });

  describe('getDomainOccurrence', () => {
    it('should return 0 for non-existent domain', async () => {
      mockChrome.storage.local.get.mockResolvedValue(createMockStorageData());

      const count = await Storage.getDomainOccurrence('example.com');
      expect(count).toBe(0);
    });

    it('should return correct occurrence count', async () => {
      mockChrome.storage.local.get.mockResolvedValue(createMockStorageData({
        domainOccurrences: {
          'example.com': 10,
        },
      }));

      const count = await Storage.getDomainOccurrence('example.com');
      expect(count).toBe(10);
    });
  });

  describe('clearExpiredConsentStates', () => {
    it('should remove expired consent states', async () => {
      const now = Date.now();
      const expiredState: LocalConsentState = {
        domain: 'expired.com',
        consentStatus: 'accepted',
        cmpId: 'OneTrust',
        timestamp: now - 100000,
        choice: 'explicit',
        expiresAt: now - 1000,
      };

      const validState: LocalConsentState = {
        domain: 'valid.com',
        consentStatus: 'rejected',
        cmpId: 'Cookiebot',
        timestamp: now,
        choice: 'explicit',
        expiresAt: now + 86400000,
      };

      mockChrome.storage.local.get.mockResolvedValue(createMockStorageData({
        consentStates: {
          'expired.com': expiredState,
          'valid.com': validState,
        },
      }));

      await Storage.clearExpiredConsentStates();

      expect(mockChrome.storage.local.set).toHaveBeenCalled();
    });

    it('should not save if no expired states found', async () => {
      const now = Date.now();
      const validState: LocalConsentState = {
        domain: 'valid.com',
        consentStatus: 'rejected',
        cmpId: 'Cookiebot',
        timestamp: now,
        choice: 'explicit',
        expiresAt: now + 86400000,
      };

      mockChrome.storage.local.get.mockResolvedValue(createMockStorageData({
        consentStates: {
          'valid.com': validState,
        },
      }));

      await Storage.clearExpiredConsentStates();

      expect(mockChrome.storage.local.set).not.toHaveBeenCalled();
    });
  });
});
