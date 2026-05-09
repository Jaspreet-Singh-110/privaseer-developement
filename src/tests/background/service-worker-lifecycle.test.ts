/**
 * @file src/tests/background/service-worker-lifecycle.test.ts
 *
 * Test Type: Integration
 * Contexts Tested: Background Service Worker lifecycle events
 * Chrome APIs Mocked: runtime.onStartup, runtime.onInstalled, runtime.onSuspend, tabs, storage, action
 * Prerequisites: None
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MessageType } from '@/types';
import { TIME, ONBOARDING, SCORING_CONFIG } from '@/utils/constants';
import { logger } from '@/utils/logger';

type Handler = (data: unknown, sender?: chrome.runtime.MessageSender) => Promise<unknown>;
type TabUpdatedListener = Parameters<typeof chrome.tabs.onUpdated.addListener>[0];
type TabActivatedListener = Parameters<typeof chrome.tabs.onActivated.addListener>[0];
type RuleMatchedListener = Parameters<typeof chrome.declarativeNetRequest.onRuleMatchedDebug.addListener>[0];

const messageHandlers = vi.hoisted(() => new Map<MessageType, Handler>());
const startupListeners = vi.hoisted(() => [] as Array<() => void | Promise<void>>);
const installedListeners = vi.hoisted(() => [] as Array<(details: chrome.runtime.InstalledDetails) => void | Promise<void>>);
const suspendListeners = vi.hoisted(() => [] as Array<() => void | Promise<void>>);
const tabUpdatedListeners = vi.hoisted(() => [] as TabUpdatedListener[]);
const tabActivatedListeners = vi.hoisted(() => [] as TabActivatedListener[]);
const ruleMatchedListeners = vi.hoisted(() => [] as RuleMatchedListener[]);

const storageMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue({
    settings: { burnerEmailEnabled: true, telemetryEnabled: false, theme: 'system' as const },
    alerts: [],
    onboarding: { hasCompletedOnboarding: false },
  }),
  getFresh: vi.fn().mockResolvedValue({
    settings: { burnerEmailEnabled: true, telemetryEnabled: false, theme: 'system' as const },
    alerts: [],
  }),
  setBurnerEmailEnabled: vi.fn().mockResolvedValue(undefined),
  getBurnerEmailEnabled: vi.fn().mockResolvedValue(true),
  setTelemetryEnabled: vi.fn().mockResolvedValue(undefined),
  getTelemetryEnabled: vi.fn().mockResolvedValue(false),
  setTheme: vi.fn().mockResolvedValue(undefined),
  setRealEmail: vi.fn().mockResolvedValue(undefined),
  getRealEmail: vi.fn().mockResolvedValue(''),
  addAlert: vi.fn().mockResolvedValue(undefined),
  clearAlerts: vi.fn().mockResolvedValue(undefined),
  getReportedFalsePositive: vi.fn().mockResolvedValue(null),
  setReportedFalsePositive: vi.fn().mockResolvedValue(undefined),
  recordComplianceScore: vi.fn().mockResolvedValue(undefined),
  ensureSaved: vi.fn().mockResolvedValue(undefined),
  setOnboardingStep: vi.fn().mockResolvedValue({}),
  completeOnboarding: vi.fn().mockResolvedValue({}),
  skipOnboarding: vi.fn().mockResolvedValue({}),
  save: vi.fn().mockResolvedValue(undefined),
}));

const telemetryMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  submitFeedback: vi.fn().mockResolvedValue({ success: true }),
  getInstallationId: vi.fn().mockResolvedValue('install-123'),
}));

const burnerEmailMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  generateEmail: vi.fn().mockResolvedValue('generated@burner.test'),
  getEmails: vi.fn().mockResolvedValue([]),
  deleteEmail: vi.fn().mockResolvedValue(undefined),
}));

const tabManagerMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  cleanup: vi.fn(),
  resetBlockCount: vi.fn(),
}));

const firewallMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  toggleProtection: vi.fn().mockResolvedValue(true),
  updateCurrentTabBadge: vi.fn().mockResolvedValue(undefined),
  checkPageForTrackers: vi.fn().mockResolvedValue(undefined),
  handleBlockedRequest: vi.fn().mockResolvedValue(undefined),
  cleanup: vi.fn(),
  clearTabTimer: vi.fn(),
  setConsentRejectionProvider: vi.fn(),
}));

const actionMock = vi.hoisted(() => ({
  setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
  setBadgeText: vi.fn().mockResolvedValue(undefined),
  onClicked: { addListener: vi.fn() },
}));

const tabsCreateMock = vi.hoisted(() => vi.fn((_createProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
  callback?.({ id: 1 } as chrome.tabs.Tab);
  return Promise.resolve({ id: 1 } as chrome.tabs.Tab);
}));

const messageBusMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  on: vi.fn((type: MessageType, handler: Handler) => {
    messageHandlers.set(type, handler);
  }),
  broadcast: vi.fn(),
  send: vi.fn().mockResolvedValue({ success: true }),
}));

const backgroundEventsMock = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
}));

const allowlistMock = vi.hoisted(() => ({
  isAllowlisted: vi.fn().mockResolvedValue(false),
  addEntry: vi.fn().mockResolvedValue(undefined),
}));

const falsePositiveServiceMock = vi.hoisted(() => ({
  reportFalsePositive: vi.fn().mockResolvedValue({
    success: true,
    aggregation: {
      reportCount: 3,
      overrideThreshold: 86,
      shouldOverride: true,
    },
  }),
}));

const chromeMockFactory = () =>
  ({
    runtime: {
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
      onInstalled: {
        addListener: vi.fn((listener: (details: chrome.runtime.InstalledDetails) => void) => {
          installedListeners.push(listener);
        }),
      },
      onStartup: {
        addListener: vi.fn((listener: () => void | Promise<void>) => {
          startupListeners.push(listener);
        }),
      },
      onSuspend: {
        addListener: vi.fn((listener: () => void | Promise<void>) => {
          suspendListeners.push(listener);
        }),
      },
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      lastError: undefined,
      id: 'test-extension-id',
    },
    tabs: {
      query: vi.fn().mockImplementation((_query: unknown, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        callback?.([]);
        return Promise.resolve([]);
      }),
      sendMessage: vi.fn().mockImplementation(
        (_tabId: number, _message: unknown, callback?: (response: unknown) => void) => {
          callback?.({ success: true });
          return Promise.resolve({ success: true });
        }
      ),
      onUpdated: {
        addListener: vi.fn((listener: TabUpdatedListener) => {
          tabUpdatedListeners.push(listener);
        }),
      },
      onActivated: {
        addListener: vi.fn((listener: TabActivatedListener) => {
          tabActivatedListeners.push(listener);
        }),
      },
      onRemoved: { addListener: vi.fn() },
      create: tabsCreateMock,
    },
    storage: {
      onChanged: { addListener: vi.fn() },
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
    action: actionMock,
  }) as unknown as typeof chrome;

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/background/storage', () => ({
  Storage: storageMock,
}));

vi.mock('@/background/privacy-score', () => ({
  PrivacyScoreManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/burner-email-service', () => ({
  burnerEmailService: burnerEmailMock,
}));

vi.mock('@/background/feedback-telemetry-service', () => ({
  feedbackTelemetryService: telemetryMock,
}));

vi.mock('@/utils/tab-manager', () => ({
  tabManager: tabManagerMock,
}));

vi.mock('@/background/event-emitter', () => ({
  backgroundEvents: backgroundEventsMock,
}));

vi.mock('@/utils/allowlist-manager', () => ({
  AllowlistManager: allowlistMock,
}));

vi.mock('@/background/false-positive-service', () => ({
  FalsePositiveService: falsePositiveServiceMock,
}));

vi.mock('@/background/firewall-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/background/firewall-engine')>();
  return {
    ...actual,
    FirewallEngine: {
      ...actual.FirewallEngine,
      initialize: firewallMock.initialize,
      toggleProtection: firewallMock.toggleProtection,
      updateCurrentTabBadge: firewallMock.updateCurrentTabBadge,
      checkPageForTrackers: firewallMock.checkPageForTrackers,
      handleBlockedRequest: firewallMock.handleBlockedRequest,
      cleanup: firewallMock.cleanup,
      clearTabTimer: firewallMock.clearTabTimer,
      setConsentRejectionProvider: firewallMock.setConsentRejectionProvider,
    },
  };
});

vi.mock('@/utils/message-bus', () => ({
  messageBus: {
    initialize: messageBusMock.initialize,
    on: messageBusMock.on,
    broadcast: messageBusMock.broadcast,
    send: messageBusMock.send,
    handlers: messageHandlers,
  },
}));

const resetHoistedState = () => {
  messageHandlers.clear();
  startupListeners.length = 0;
  installedListeners.length = 0;
  suspendListeners.length = 0;
  tabUpdatedListeners.length = 0;
  tabActivatedListeners.length = 0;
  ruleMatchedListeners.length = 0;
  Object.values(storageMock).forEach(fn => typeof fn === 'function' && fn.mockReset());
  Object.values(telemetryMock).forEach(fn => typeof fn === 'function' && fn.mockReset());
  Object.values(burnerEmailMock).forEach(fn => typeof fn === 'function' && fn.mockReset());
  Object.values(tabManagerMock).forEach(fn => typeof fn === 'function' && fn.mockReset());
  Object.values(firewallMock).forEach(fn => typeof fn === 'function' && fn.mockReset());
  Object.values(actionMock).forEach(fn => typeof fn === 'function' && fn.mockReset?.());
  Object.values(allowlistMock).forEach(fn => typeof fn === 'function' && fn.mockReset());
  Object.values(falsePositiveServiceMock).forEach(fn => typeof fn === 'function' && fn.mockReset());

  storageMock.get.mockResolvedValue({
    settings: { burnerEmailEnabled: true, telemetryEnabled: false, theme: 'system' as const },
    alerts: [],
    onboarding: { hasCompletedOnboarding: false },
  });
  storageMock.getFresh.mockResolvedValue({
    settings: { burnerEmailEnabled: true, telemetryEnabled: false, theme: 'system' as const },
    alerts: [],
  });
  storageMock.getBurnerEmailEnabled.mockResolvedValue(true);
  storageMock.getTelemetryEnabled.mockResolvedValue(false);
  telemetryMock.trackEvent.mockResolvedValue(undefined);
  telemetryMock.submitFeedback.mockResolvedValue({ success: true });
  telemetryMock.getInstallationId.mockResolvedValue('install-123');
  burnerEmailMock.generateEmail.mockResolvedValue('generated@burner.test');
  burnerEmailMock.getEmails.mockResolvedValue([]);
  burnerEmailMock.deleteEmail.mockResolvedValue(undefined);
  tabManagerMock.initialize.mockResolvedValue(undefined);
  tabManagerMock.cleanup.mockClear();
  firewallMock.initialize.mockResolvedValue(undefined);
  firewallMock.cleanup.mockClear();
  allowlistMock.isAllowlisted.mockResolvedValue(false);
  allowlistMock.addEntry.mockResolvedValue(undefined);
  falsePositiveServiceMock.reportFalsePositive.mockResolvedValue({
    success: true,
    aggregation: {
      reportCount: 3,
      overrideThreshold: 86,
      shouldOverride: true,
    },
  });
  messageBusMock.initialize.mockResolvedValue(undefined);
};

const loadServiceWorker = async () => {
  await import('@/background/service-worker');
};

const getOverrideFetchCalls = (): Array<unknown[]> =>
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([url]) => typeof url === 'string' && url.includes('/functions/v1/get-fp-overrides')
  );

const getScoringFetchCalls = (): Array<unknown[]> =>
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([url]) => typeof url === 'string' && url.includes(SCORING_CONFIG.ENDPOINT)
  );

describe('Service Worker Lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    resetHoistedState();
    global.chrome = chromeMockFactory();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(''),
      json: vi.fn().mockResolvedValue({ success: true, overrides: {}, config: {} }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-attaches listeners on new startup instance', async () => {
    await loadServiceWorker();
    expect(startupListeners).toHaveLength(1);
    expect(tabUpdatedListeners).toHaveLength(1);
    expect(tabActivatedListeners).toHaveLength(1);
    expect(ruleMatchedListeners).toHaveLength(1);

    vi.resetModules();
    resetHoistedState();
    global.chrome = chromeMockFactory();
    await loadServiceWorker();

    expect(startupListeners).toHaveLength(1);
    expect(tabUpdatedListeners).toHaveLength(1);
    expect(tabActivatedListeners).toHaveLength(1);
    expect(ruleMatchedListeners).toHaveLength(1);
  });

  it('initializes safely when waking from sleep using shared promise (fake timers)', async () => {
    vi.useFakeTimers();
    messageBusMock.initialize.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(undefined), 50)));

    await loadServiceWorker();
    const startup = startupListeners[0];
    expect(typeof startup).toBe('function');

    const initialCalls = messageBusMock.initialize.mock.calls.length;
    const firstCall = startup();
    const secondCall = startup();

    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([firstCall, secondCall]);

    const newCalls = messageBusMock.initialize.mock.calls.length - initialCalls;
    expect(newCalls).toBe(0);
    expect(messageHandlers.size).toBeGreaterThan(0);
  });

  it('guards against double initialization of handlers', async () => {
    await loadServiceWorker();
    const initialHandlerCount = messageHandlers.size;
    const initialOnCalls = messageBusMock.on.mock.calls.length;

    const startup = startupListeners[0];
    await startup();

    expect(messageHandlers.size).toBe(initialHandlerCount);
    expect(messageBusMock.on.mock.calls.length).toBe(initialOnCalls);
  });

  it('fires periodic cleanup interval with fake timers', async () => {
    vi.useFakeTimers();
    await loadServiceWorker();
    const initialOverrideFetchCalls = getOverrideFetchCalls().length;
    const initialScoringFetchCalls = getScoringFetchCalls().length;

    await vi.advanceTimersByTimeAsync(TIME.ONE_HOUR_MS + 10);

    expect(tabManagerMock.cleanup).toHaveBeenCalledTimes(1);
    expect(firewallMock.cleanup).toHaveBeenCalledTimes(1);
    expect(getOverrideFetchCalls().length).toBeGreaterThan(initialOverrideFetchCalls);
    expect(getScoringFetchCalls().length).toBeGreaterThan(initialScoringFetchCalls);
  });

  it('registers GET_SCORING_CONFIG handler and returns scoring config payload', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes(SCORING_CONFIG.ENDPOINT)) {
        return Promise.resolve({
          ok: true,
          text: vi.fn().mockResolvedValue(''),
          json: vi.fn().mockResolvedValue({
            success: true,
            config: {
              version: '2.0-test',
              riskWeights: {
                analytics: 1,
                advertising: 2,
                social: 2,
                fingerprinting: 6,
                beacons: 2,
                cryptomining: 10,
                malware: 20,
                unknown: 1,
              },
              creditFactors: {
                protectionMultiplier: 50,
                protectionCap: 150,
                cleanBrowsingMultiplier: 10,
                cleanBrowsingCap: 100,
                highRiskCap: -200,
                violationMultiplier: 25,
                violationCap: -100,
                dailyHighRiskCap: 30,
              },
              decay: {
                enabled: true,
                base: 0.5,
                maxOccurrences: 4,
              },
            },
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        text: vi.fn().mockResolvedValue(''),
        json: vi.fn().mockResolvedValue({ success: true, overrides: {} }),
      });
    });

    await loadServiceWorker();

    const handler = messageHandlers.get('GET_SCORING_CONFIG');
    expect(typeof handler).toBe('function');

    const response = await handler?.(undefined);
    expect(response).toEqual(
      expect.objectContaining({
        success: true,
        config: expect.objectContaining({
          version: '2.0-test',
        }),
      })
    );
  });

  it('ensures data is persisted on suspend', async () => {
    await loadServiceWorker();
    expect(suspendListeners).toHaveLength(1);

    await suspendListeners[0]();

    expect(storageMock.ensureSaved).toHaveBeenCalledTimes(1);
  });

  it('handles onInstalled for fresh install and update separately', async () => {
    vi.useFakeTimers();
    await loadServiceWorker();
    expect(installedListeners).toHaveLength(1);
    const listener = installedListeners[0];

    // Fresh install should trigger telemetry and welcome tab
    storageMock.get.mockResolvedValueOnce({
      settings: { burnerEmailEnabled: true, telemetryEnabled: false, theme: 'system' as const },
      onboarding: { hasCompletedOnboarding: false },
      alerts: [],
    });

    await listener({ reason: 'install' as chrome.runtime.OnInstalledReason });
    await vi.advanceTimersByTimeAsync(ONBOARDING.AUTO_OPEN_DELAY_MS + 10);

    expect(telemetryMock.trackEvent).toHaveBeenCalledWith({ eventType: 'extension_installed' });
    expect(tabsCreateMock).toHaveBeenCalledTimes(1);

    // Update should not open welcome tab
    storageMock.get.mockResolvedValueOnce({
      settings: { burnerEmailEnabled: true, telemetryEnabled: false, theme: 'system' as const },
      onboarding: { hasCompletedOnboarding: true },
      alerts: [],
    });

    await listener({ reason: 'update' as chrome.runtime.OnInstalledReason, previousVersion: '0.9.0' });
    expect(telemetryMock.trackEvent).toHaveBeenCalledWith({
      eventType: 'extension_updated',
      eventData: { previousVersion: '0.9.0' },
    });
    expect(tabsCreateMock).toHaveBeenCalledTimes(1);
  });

  it('handles Storage.get failure during install onboarding check', async () => {
    vi.useFakeTimers();
    await loadServiceWorker();
    const listener = installedListeners[0];
    const initialTabCreateCalls = tabsCreateMock.mock.calls.length;
    storageMock.get.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(listener({ reason: 'install' as chrome.runtime.OnInstalledReason })).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      'ServiceWorker',
      'Unable to evaluate onboarding state on install',
      expect.any(Error)
    );
    expect(tabsCreateMock.mock.calls.length).toBe(initialTabCreateCalls);
  });

  it('logs warning when welcome page tab creation reports runtime error', async () => {
    vi.useFakeTimers();
    await loadServiceWorker();
    const listener = installedListeners[0];
    const initialTabCreateCalls = tabsCreateMock.mock.calls.length;

    tabsCreateMock.mockImplementationOnce((_props, callback?: (tab: chrome.tabs.Tab) => void) => {
      const chromeWithLastError = global.chrome as typeof chrome;
      chromeWithLastError.runtime.lastError = { message: 'cannot open tab' } as chrome.runtime.LastError;
      callback?.({ id: 99 } as chrome.tabs.Tab);
      chromeWithLastError.runtime.lastError = undefined;
      return Promise.resolve({ id: 99 } as chrome.tabs.Tab);
    });

    await listener({ reason: 'install' as chrome.runtime.OnInstalledReason });
    await vi.advanceTimersByTimeAsync(ONBOARDING.AUTO_OPEN_DELAY_MS + 10);

    expect(tabsCreateMock.mock.calls.length).toBe(initialTabCreateCalls + 1);
    expect(logger.warn).toHaveBeenCalledWith(
      'ServiceWorker',
      'Failed to open welcome page',
      expect.objectContaining({ error: 'cannot open tab' })
    );
  });

  it('skips welcome page auto-open when onboarding is already completed', async () => {
    vi.useFakeTimers();
    await loadServiceWorker();
    const listener = installedListeners[0];
    const initialTabCreateCalls = tabsCreateMock.mock.calls.length;

    storageMock.get.mockResolvedValueOnce({
      settings: { burnerEmailEnabled: true, telemetryEnabled: false, theme: 'system' as const },
      onboarding: { hasCompletedOnboarding: true },
      alerts: [],
    });

    await listener({ reason: 'install' as chrome.runtime.OnInstalledReason });
    await vi.advanceTimersByTimeAsync(ONBOARDING.AUTO_OPEN_DELAY_MS + 10);

    expect(tabsCreateMock.mock.calls.length).toBe(initialTabCreateCalls);
  });

  it('registers and executes REPORT_FALSE_POSITIVE handler', async () => {
    await loadServiceWorker();
    const reportHandler = messageHandlers.get('REPORT_FALSE_POSITIVE');
    expect(typeof reportHandler).toBe('function');
    const initialOverrideFetchCalls = getOverrideFetchCalls().length;

    const response = await reportHandler?.({
      domain: 'example.com',
      url: 'https://example.com/path?utm=1',
      detectedPatterns: ['forcedConsent'],
      reason: 'wrong_detection',
      timestamp: Date.now(),
      installationId: '',
      scanConfidence: 0.91,
    });

    expect(telemetryMock.getInstallationId).toHaveBeenCalledTimes(1);
    expect(falsePositiveServiceMock.reportFalsePositive).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'example.com',
        installationId: 'install-123',
      })
    );
    expect(allowlistMock.addEntry).toHaveBeenCalledWith('example.com', 'user');
    expect(getOverrideFetchCalls().length).toBe(initialOverrideFetchCalls);
    expect(response).toEqual({
      success: true,
      reportCount: 3,
      alreadyOverridden: true,
    });
  });

  it('skips alert creation when confidence is below fetched override threshold', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/functions/v1/get-fp-overrides')) {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            overrides: {
              'consent.example.com': {
                threshold: 95,
                reportCount: 3,
                lastUpdated: new Date().toISOString(),
              },
            },
          }),
          text: vi.fn().mockResolvedValue(''),
        });
      }

      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn().mockResolvedValue(''),
      });
    });

    await loadServiceWorker();
    falsePositiveServiceMock.reportFalsePositive.mockResolvedValueOnce({
      success: true,
      aggregation: {
        reportCount: 3,
        overrideThreshold: 95,
        shouldOverride: true,
      },
    });
    const reportHandler = messageHandlers.get('REPORT_FALSE_POSITIVE');
    const consentHandler = messageHandlers.get('CONSENT_SCAN_RESULT');

    await reportHandler?.({
      domain: 'consent.example.com',
      url: 'https://consent.example.com/path?utm=1',
      detectedPatterns: ['forcedConsent'],
      reason: 'wrong_detection',
      timestamp: Date.now(),
      installationId: '',
      scanConfidence: 0.9,
    });

    const now = Date.now();
    const response = await consentHandler?.(
      {
        url: 'https://consent.example.com/page?x=1',
        hasBanner: true,
        hasRejectButton: false,
        isCompliant: false,
        deceptivePatterns: ['forcedConsent'],
        timestamp: now,
        hasPersistedConsent: false,
        cmpDetection: {
          detected: true,
          cmpType: 'onetrust',
          detectionMethod: 'api',
          confidenceScore: 0.95,
          consentStatus: 'rejected',
          cookieNames: ['OptanonConsent'],
        },
        confidence: {
          overall: 0.9,
          bannerDetection: { name: 'banner', score: 0.8, weight: 1, reasoning: 'banner detected' },
          buttonDetection: { name: 'button', score: 0.7, weight: 1, reasoning: 'button detected' },
          cmpRecognition: { name: 'cmp', score: 1.0, weight: 1, reasoning: 'cmp recognized' },
          contextualAnalysis: { name: 'context', score: 0.9, weight: 1, reasoning: 'context signals' },
          factors: [{ name: 'combined', score: 0.9, weight: 1, reasoning: 'combined signals' }],
          reasoning: ['high confidence'],
          shouldAlert: true,
        },
        scanPhase: 'delayed',
      },
      { tab: { id: 22 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );

    expect(response).toEqual({ success: true });
    expect(storageMock.addAlert).not.toHaveBeenCalled();
    expect(backgroundEventsMock.emit).not.toHaveBeenCalledWith(
      'NON_COMPLIANT_SITE',
      expect.objectContaining({ domain: 'consent.example.com' })
    );
  });

  it('persists consent state from CONSENT_SCAN_RESULT when meaningful data exists', async () => {
    await loadServiceWorker();
    const consentHandler = messageHandlers.get('CONSENT_SCAN_RESULT');
    expect(typeof consentHandler).toBe('function');

    const now = Date.now();
    const response = await consentHandler?.(
      {
        url: 'https://consent.example.com/page?x=1',
        hasBanner: true,
        hasRejectButton: false,
        isCompliant: false,
        deceptivePatterns: ['forcedConsent'],
        timestamp: now,
        hasPersistedConsent: false,
        cmpDetection: {
          detected: true,
          cmpType: 'onetrust',
          detectionMethod: 'api',
          confidenceScore: 0.95,
          consentStatus: 'rejected',
          cookieNames: ['OptanonConsent'],
        },
        confidence: {
          overall: 0.9,
          bannerDetection: { name: 'banner', score: 0.8, weight: 1, reasoning: 'banner detected' },
          buttonDetection: { name: 'button', score: 0.7, weight: 1, reasoning: 'button detected' },
          cmpRecognition: { name: 'cmp', score: 1.0, weight: 1, reasoning: 'cmp recognized' },
          contextualAnalysis: { name: 'context', score: 0.9, weight: 1, reasoning: 'context signals' },
          factors: [{ name: 'combined', score: 0.9, weight: 1, reasoning: 'combined signals' }],
          reasoning: ['high confidence'],
          shouldAlert: true,
        },
        scanPhase: 'delayed',
      },
      { tab: { id: 22 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );

    expect(response).toEqual({ success: true });
    expect(storageMock.addAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'non_compliant_site',
        domain: 'consent.example.com',
        severity: 'high',
      })
    );
    expect(backgroundEventsMock.emit).toHaveBeenCalledWith(
      'NON_COMPLIANT_SITE',
      expect.objectContaining({
        domain: 'consent.example.com',
        severityMultiplier: 2,
      })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/persist-consent-state'),
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('creates alert when confidence equals base threshold boundary', async () => {
    await loadServiceWorker();
    const consentHandler = messageHandlers.get('CONSENT_SCAN_RESULT');

    const response = await consentHandler?.(
      {
        url: 'https://boundary.example.com/page',
        hasBanner: true,
        hasRejectButton: false,
        isCompliant: false,
        deceptivePatterns: ['forcedConsent'],
        timestamp: Date.now(),
        hasPersistedConsent: false,
        cmpDetection: {
          detected: true,
          cmpType: 'onetrust',
          detectionMethod: 'api',
          confidenceScore: 0.95,
          consentStatus: 'rejected',
          cookieNames: ['OptanonConsent'],
        },
        confidence: {
          overall: 0.8,
          bannerDetection: { name: 'banner', score: 0.8, weight: 1, reasoning: 'banner detected' },
          buttonDetection: { name: 'button', score: 0.7, weight: 1, reasoning: 'button detected' },
          cmpRecognition: { name: 'cmp', score: 1.0, weight: 1, reasoning: 'cmp recognized' },
          contextualAnalysis: { name: 'context', score: 0.9, weight: 1, reasoning: 'context signals' },
          factors: [{ name: 'combined', score: 0.8, weight: 1, reasoning: 'combined signals' }],
          reasoning: ['threshold boundary'],
          shouldAlert: true,
        },
        scanPhase: 'quick',
      },
      { tab: { id: 33 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );

    expect(response).toEqual({ success: true });
    expect(storageMock.addAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'boundary.example.com',
        scanConfidence: 80,
      })
    );
  });

  it('skips alert side effects when scan result has persisted consent', async () => {
    await loadServiceWorker();
    const consentHandler = messageHandlers.get('CONSENT_SCAN_RESULT');
    const initialAlertCalls = storageMock.addAlert.mock.calls.length;
    const initialEmitCalls = backgroundEventsMock.emit.mock.calls.length;

    const response = await consentHandler?.(
      {
        url: 'https://persisted.example.com/page',
        hasBanner: true,
        hasRejectButton: false,
        isCompliant: false,
        deceptivePatterns: ['forcedConsent'],
        timestamp: Date.now(),
        hasPersistedConsent: true,
        cmpDetection: {
          detected: true,
          cmpType: 'onetrust',
          detectionMethod: 'api',
          confidenceScore: 0.9,
          consentStatus: 'accepted',
          cookieNames: ['OptanonConsent'],
        },
        confidence: {
          overall: 0.95,
          bannerDetection: { name: 'banner', score: 0.8, weight: 1, reasoning: 'banner detected' },
          buttonDetection: { name: 'button', score: 0.7, weight: 1, reasoning: 'button detected' },
          cmpRecognition: { name: 'cmp', score: 1.0, weight: 1, reasoning: 'cmp recognized' },
          contextualAnalysis: { name: 'context', score: 0.9, weight: 1, reasoning: 'context signals' },
          factors: [{ name: 'combined', score: 0.95, weight: 1, reasoning: 'combined signals' }],
          reasoning: ['persisted consent'],
          shouldAlert: true,
        },
        scanPhase: 'interaction',
      },
      { tab: { id: 44 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );

    expect(response).toEqual({ success: true });
    expect(storageMock.addAlert.mock.calls.length).toBe(initialAlertCalls);
    expect(backgroundEventsMock.emit.mock.calls.length).toBe(initialEmitCalls);
  });

  it('uses tab listeners to reset count and trigger tracker scans', async () => {
    await loadServiceWorker();
    expect(tabUpdatedListeners).toHaveLength(1);
    expect(tabActivatedListeners).toHaveLength(1);

    await tabUpdatedListeners[0]?.(
      42,
      { status: 'loading' } as chrome.tabs.TabChangeInfo,
      {
        id: 42,
        url: 'https://tab.example/start',
        active: true,
      } as chrome.tabs.Tab
    );
    expect(tabManagerMock.resetBlockCount).toHaveBeenCalledWith(42);
    expect(firewallMock.updateCurrentTabBadge).toHaveBeenCalledWith(42);

    await tabUpdatedListeners[0]?.(
      42,
      { status: 'complete' } as chrome.tabs.TabChangeInfo,
      {
        id: 42,
        url: 'https://tab.example/complete',
        active: true,
      } as chrome.tabs.Tab
    );
    expect(firewallMock.checkPageForTrackers).toHaveBeenCalledWith(
      42,
      'https://tab.example/complete'
    );

    await tabActivatedListeners[0]?.({ tabId: 42, windowId: 1 } as chrome.tabs.TabActiveInfo);
    expect(firewallMock.updateCurrentTabBadge).toHaveBeenCalledWith(42);
  });
});

