/**
 * @file src/tests/background/service-worker-chrome-listeners.test.ts
 *
 * Test Type: Integration
 * Contexts Tested: Background service worker Chrome listener registration and callbacks
 * Chrome APIs Mocked: chrome.storage, chrome.tabs, chrome.runtime, chrome.declarativeNetRequest
 * Prerequisites: None
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/utils/logger';
import { feedbackTelemetryService } from '@/background/feedback-telemetry-service';
import { FirewallEngine } from '@/background/firewall-engine';
import { messageBus } from '@/utils/message-bus';

type StorageChangedListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];
type RuleMatchedListener = Parameters<typeof chrome.declarativeNetRequest.onRuleMatchedDebug.addListener>[0];
type InstalledListener = Parameters<typeof chrome.runtime.onInstalled.addListener>[0];

const storageChangedListeners = vi.hoisted(() => [] as StorageChangedListener[]);
const ruleMatchedListeners = vi.hoisted(() => [] as RuleMatchedListener[]);
const installedListeners = vi.hoisted(() => [] as InstalledListener[]);

const storageMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue({
    settings: { burnerEmailEnabled: false, telemetryEnabled: false, theme: 'system' },
    alerts: [],
    onboarding: { hasCompletedOnboarding: true },
  }),
  getFresh: vi.fn().mockResolvedValue({
    settings: { burnerEmailEnabled: false, telemetryEnabled: false, theme: 'system' },
    alerts: [],
  }),
  getBurnerEmailEnabled: vi.fn().mockResolvedValue(false),
  setBurnerEmailEnabled: vi.fn().mockResolvedValue(undefined),
  getTelemetryEnabled: vi.fn().mockResolvedValue(false),
  setTelemetryEnabled: vi.fn().mockResolvedValue(undefined),
  setTheme: vi.fn().mockResolvedValue(undefined),
  getRealEmail: vi.fn().mockResolvedValue(null),
  setRealEmail: vi.fn().mockResolvedValue(undefined),
  recordComplianceScore: vi.fn().mockResolvedValue(undefined),
  addAlert: vi.fn().mockResolvedValue(undefined),
  clearAlerts: vi.fn().mockResolvedValue(undefined),
  ensureSaved: vi.fn().mockResolvedValue(undefined),
  getOnboardingState: vi.fn().mockResolvedValue({ hasCompletedOnboarding: false, currentStep: 0 }),
  setOnboardingStep: vi.fn().mockResolvedValue({ hasCompletedOnboarding: false, currentStep: 1 }),
  completeOnboarding: vi.fn().mockResolvedValue({ hasCompletedOnboarding: true, currentStep: 5 }),
  skipOnboarding: vi.fn().mockResolvedValue({ hasCompletedOnboarding: false, currentStep: 2 }),
}));

const telemetryMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  submitFeedback: vi.fn().mockResolvedValue({ success: true }),
  getInstallationId: vi.fn().mockResolvedValue('install-123'),
}));

const messageBusMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  broadcast: vi.fn(),
  send: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/background/storage', () => ({
  Storage: storageMock,
}));

vi.mock('@/background/privacy-score', () => ({
  PrivacyScoreManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getCurrentCreditScore: vi.fn().mockResolvedValue(700),
  },
}));

vi.mock('@/background/burner-email-service', () => ({
  burnerEmailService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    generateEmail: vi.fn().mockResolvedValue('burner@privaseer.app'),
    getEmails: vi.fn().mockResolvedValue([]),
    deleteEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/feedback-telemetry-service', () => ({
  feedbackTelemetryService: telemetryMock,
}));

vi.mock('@/utils/tab-manager', () => ({
  tabManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
    resetBlockCount: vi.fn(),
  },
}));

vi.mock('@/background/event-emitter', () => ({
  backgroundEvents: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock('@/utils/allowlist-manager', () => ({
  AllowlistManager: {
    isAllowlisted: vi.fn().mockResolvedValue(false),
    addEntry: vi.fn().mockResolvedValue(undefined),
    removeEntry: vi.fn().mockResolvedValue(undefined),
    getEntries: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/background/false-positive-service', () => ({
  FalsePositiveService: {
    reportFalsePositive: vi.fn().mockResolvedValue({
      success: true,
      aggregation: { reportCount: 3, overrideThreshold: 86, shouldOverride: true },
    }),
  },
}));

vi.mock('@/background/firewall-engine', () => ({
  FirewallEngine: {
    initialize: vi.fn().mockResolvedValue(undefined),
    setConsentRejectionProvider: vi.fn(),
    toggleProtection: vi.fn().mockResolvedValue(true),
    getTrackerInfo: vi.fn().mockReturnValue({}),
    updateCurrentTabBadge: vi.fn().mockResolvedValue(undefined),
    checkPageForTrackers: vi.fn().mockResolvedValue(undefined),
    clearTabTimer: vi.fn(),
    handleBlockedRequest: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
  },
}));

vi.mock('@/utils/message-bus', () => ({
  messageBus: messageBusMock,
}));

const createChromeMock = () =>
  ({
    runtime: {
      sendMessage: vi.fn((_message: unknown, callback?: () => void) => callback?.()),
      onInstalled: {
        addListener: vi.fn((listener: InstalledListener) => {
          installedListeners.push(listener);
        }),
      },
      onStartup: { addListener: vi.fn() },
      onSuspend: { addListener: vi.fn() },
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      lastError: undefined,
      id: 'test-extension-id',
    },
    action: {
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      onClicked: { addListener: vi.fn() },
    },
    tabs: {
      query: vi.fn().mockImplementation((_queryInfo: unknown, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        const tabs = [
          { id: 1 } as chrome.tabs.Tab,
          { id: 2 } as chrome.tabs.Tab,
          {} as chrome.tabs.Tab,
        ];
        callback?.(tabs);
        return Promise.resolve(tabs);
      }),
      sendMessage: vi.fn().mockImplementation(
        (tabId: number, _message: unknown, callback?: () => void) => {
          if (tabId === 1) {
            const chromeWithError = global.chrome as typeof chrome;
            chromeWithError.runtime.lastError = { message: 'tab unavailable' } as chrome.runtime.LastError;
          }
          callback?.();
          const chromeWithoutError = global.chrome as typeof chrome;
          chromeWithoutError.runtime.lastError = undefined;
        }
      ),
      create: vi.fn(),
      onUpdated: { addListener: vi.fn() },
      onActivated: { addListener: vi.fn() },
    },
    storage: {
      onChanged: {
        addListener: vi.fn((listener: StorageChangedListener) => {
          storageChangedListeners.push(listener);
        }),
      },
      local: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
    declarativeNetRequest: {
      onRuleMatchedDebug: {
        addListener: vi.fn((listener: RuleMatchedListener) => {
          ruleMatchedListeners.push(listener);
        }),
      },
    },
  }) as unknown as typeof chrome;

describe('Service worker chrome listeners', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storageChangedListeners.length = 0;
    ruleMatchedListeners.length = 0;
    installedListeners.length = 0;

    storageMock.initialize.mockResolvedValue(undefined);
    storageMock.get.mockResolvedValue({
      settings: { burnerEmailEnabled: false, telemetryEnabled: false, theme: 'system' },
      alerts: [],
      onboarding: { hasCompletedOnboarding: true },
    });
    telemetryMock.initialize.mockResolvedValue(undefined);
    telemetryMock.trackEvent.mockResolvedValue(undefined);
    messageBusMock.initialize.mockResolvedValue(undefined);

    (globalThis as { chrome?: typeof chrome }).chrome = createChromeMock();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('ok'),
    }) as unknown as typeof fetch;
  });

  it('broadcasts storage-driven burner email setting changes to tabs and popup', async () => {
    await import('@/background/service-worker');

    const listener = storageChangedListeners[0];
    expect(listener).toBeDefined();

    listener?.(
      {
        privacyData: {
          oldValue: { settings: { burnerEmailEnabled: false } },
          newValue: { settings: { burnerEmailEnabled: true } },
        },
      } as Record<string, chrome.storage.StorageChange>,
      'local'
    );

    expect(chrome.tabs.query).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      {
        type: 'BURNER_EMAIL_SETTING_CHANGED',
        data: { enabled: true },
      },
      expect.any(Function)
    );
    expect(messageBus.broadcast).toHaveBeenCalledWith('STATE_UPDATE');
  });

  it('ignores non-local or unchanged storage updates', async () => {
    await import('@/background/service-worker');

    const listener = storageChangedListeners[0];
    expect(listener).toBeDefined();

    listener?.(
      {
        privacyData: {
          oldValue: { settings: { burnerEmailEnabled: true } },
          newValue: { settings: { burnerEmailEnabled: true } },
        },
      } as Record<string, chrome.storage.StorageChange>,
      'local'
    );
    listener?.(
      {
        privacyData: {
          oldValue: { settings: { burnerEmailEnabled: false } },
          newValue: { settings: { burnerEmailEnabled: true } },
        },
      } as Record<string, chrome.storage.StorageChange>,
      'sync'
    );

    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(messageBus.broadcast).not.toHaveBeenCalled();
  });

  it('tracks extension update event with previousVersion payload', async () => {
    await import('@/background/service-worker');

    const installed = installedListeners[0];
    expect(installed).toBeDefined();

    await installed?.({
      reason: 'update',
      previousVersion: '1.0.1',
    } as chrome.runtime.InstalledDetails);

    expect(feedbackTelemetryService.trackEvent).toHaveBeenCalledWith({
      eventType: 'extension_updated',
      eventData: { previousVersion: '1.0.1' },
    });
  });

  it('ignores onRuleMatchedDebug events with non-positive tab ids', async () => {
    await import('@/background/service-worker');

    const listener = ruleMatchedListeners[0];
    expect(listener).toBeDefined();

    await listener?.({
      request: { tabId: 0, url: 'https://tracker.example/script.js' },
    } as chrome.declarativeNetRequest.MatchedRuleInfoDebug);
    await listener?.({
      request: { tabId: -1, url: 'https://tracker.example/script.js' },
    } as chrome.declarativeNetRequest.MatchedRuleInfoDebug);

    expect(FirewallEngine.handleBlockedRequest).not.toHaveBeenCalled();
  });

  it('forwards onRuleMatchedDebug events with valid tab ids', async () => {
    await import('@/background/service-worker');

    const listener = ruleMatchedListeners[0];
    expect(listener).toBeDefined();

    await listener?.({
      request: { tabId: 9, url: 'https://tracker.example/script.js' },
    } as chrome.declarativeNetRequest.MatchedRuleInfoDebug);

    expect(FirewallEngine.handleBlockedRequest).toHaveBeenCalledWith(
      'https://tracker.example/script.js',
      9
    );
  });

  it('logs initial startup failure when initialization throws during module startup', async () => {
    messageBusMock.initialize.mockRejectedValueOnce(new Error('bootstrap failed'));

    await import('@/background/service-worker');

    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      'ServiceWorker',
      'Initial startup failed',
      expect.any(Error)
    );
  });
});
