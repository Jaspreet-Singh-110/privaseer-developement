import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { messageBus } from '@/utils/message-bus';
import { Storage } from '@/background/storage';
import { AllowlistManager } from '@/utils/allowlist-manager';
import { backgroundEvents } from '@/background/event-emitter';

type ConsentHandler = (
  data: unknown,
  sender?: chrome.runtime.MessageSender
) => Promise<unknown>;

const messageHandlers = vi.hoisted(() => new Map<string, ConsentHandler>());

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/background/storage', () => ({
  Storage: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getFresh: vi.fn().mockResolvedValue({ alerts: [], settings: { telemetryEnabled: false } }),
    get: vi.fn().mockResolvedValue({ alerts: [], settings: { telemetryEnabled: false } }),
    addAlert: vi.fn().mockResolvedValue(undefined),
    clearAlerts: vi.fn().mockResolvedValue(undefined),
    getBurnerEmailEnabled: vi.fn().mockResolvedValue(true),
    setBurnerEmailEnabled: vi.fn().mockResolvedValue(undefined),
    getTelemetryEnabled: vi.fn().mockResolvedValue(false),
    setTelemetryEnabled: vi.fn().mockResolvedValue(undefined),
    setTheme: vi.fn().mockResolvedValue(undefined),
    getRealEmail: vi.fn().mockResolvedValue(null),
    setRealEmail: vi.fn().mockResolvedValue(undefined),
    recordComplianceScore: vi.fn().mockResolvedValue(undefined),
    getOnboardingState: vi.fn().mockResolvedValue({ hasCompletedOnboarding: false }),
    setOnboardingStep: vi.fn().mockResolvedValue({}),
    completeOnboarding: vi.fn().mockResolvedValue({}),
    skipOnboarding: vi.fn().mockResolvedValue({}),
    ensureSaved: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/firewall-engine', () => ({
  FirewallEngine: {
    initialize: vi.fn().mockResolvedValue(undefined),
    setConsentRejectionProvider: vi.fn(),
    toggleProtection: vi.fn().mockResolvedValue(true),
    getTrackerInfo: vi.fn(),
    updateCurrentTabBadge: vi.fn().mockResolvedValue(undefined),
    checkPageForTrackers: vi.fn().mockResolvedValue(undefined),
    clearTabTimer: vi.fn(),
    handleBlockedRequest: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
  },
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
    generateEmail: vi.fn().mockResolvedValue('generated@burner.privaseer.app'),
    getEmails: vi.fn().mockResolvedValue([]),
    deleteEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/feedback-telemetry-service', () => ({
  feedbackTelemetryService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getInstallationId: vi.fn().mockResolvedValue('install-123'),
    trackEvent: vi.fn().mockResolvedValue(undefined),
    submitFeedback: vi.fn().mockResolvedValue({ success: true }),
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

vi.mock('@/background/event-emitter', () => ({
  backgroundEvents: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock('@/utils/tab-manager', () => ({
  tabManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
    resetBlockCount: vi.fn(),
  },
}));

vi.mock('@/utils/message-bus', () => ({
  messageBus: {
    initialize: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((type: string, handler: ConsentHandler) => {
      messageHandlers.set(type, handler);
    }),
    broadcast: vi.fn(),
    send: vi.fn().mockResolvedValue({ success: true }),
    handlers: messageHandlers,
  },
}));

const getConsentHandler = (): ConsentHandler => {
  const handler = (messageBus as unknown as { handlers: Map<string, ConsentHandler> }).handlers.get(
    'CONSENT_SCAN_RESULT'
  );
  if (!handler) {
    throw new Error('CONSENT_SCAN_RESULT handler not registered');
  }
  return handler;
};

const buildScan = (
  url: string,
  deceptivePatterns: string[] = ['forcedConsent']
): Record<string, unknown> => ({
  url,
  hasBanner: true,
  hasRejectButton: false,
  isCompliant: false,
  deceptivePatterns,
  timestamp: Date.now(),
  hasPersistedConsent: false,
  cmpDetection: {
    detected: true,
    cmpType: 'onetrust',
    detectionMethod: 'cookie',
    confidenceScore: 0.9,
    consentStatus: 'rejected',
    cookieNames: ['OptanonConsent'],
  },
});

describe('Service Worker CONSENT_SCAN_RESULT integration', () => {
  beforeAll(async () => {
    (globalThis as { chrome?: typeof chrome }).chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onInstalled: { addListener: vi.fn() },
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
        query: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn(),
        create: vi.fn(),
        onUpdated: { addListener: vi.fn() },
        onActivated: { addListener: vi.fn() },
      },
      storage: {
        onChanged: { addListener: vi.fn() },
      },
      declarativeNetRequest: {
        onRuleMatchedDebug: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('ok'),
    }) as unknown as typeof fetch;

    await import('@/background/service-worker');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Storage.get).mockResolvedValue({ alerts: [], settings: { telemetryEnabled: false } } as never);
    vi.mocked(AllowlistManager.isAllowlisted).mockResolvedValue(false);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('ok'),
    }) as unknown as typeof fetch;
  });

  it('deduplicates repeated non-compliant alerts within 5 minutes', async () => {
    const handler = getConsentHandler();
    const payload = buildScan('https://dedupe.example.com/path');

    await handler(payload, { tab: { id: 1 } as chrome.tabs.Tab } as chrome.runtime.MessageSender);
    await handler(payload, { tab: { id: 1 } as chrome.tabs.Tab } as chrome.runtime.MessageSender);

    expect(Storage.addAlert).toHaveBeenCalledTimes(1);
  });

  it('skips alert generation for allowlisted domains', async () => {
    const handler = getConsentHandler();
    vi.mocked(AllowlistManager.isAllowlisted).mockResolvedValue(true);

    const response = await handler(
      buildScan('https://allowlisted.example.com/home'),
      { tab: { id: 2 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );

    expect(response).toEqual({ success: true });
    expect(Storage.addAlert).not.toHaveBeenCalled();
    expect(backgroundEvents.emit).not.toHaveBeenCalledWith(
      'NON_COMPLIANT_SITE',
      expect.anything()
    );
  });

  it('emits NON_COMPLIANT_SITE with forcedConsent severity multiplier', async () => {
    const handler = getConsentHandler();

    await handler(
      buildScan('https://severity.example.com/page', ['forcedConsent']),
      { tab: { id: 3 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );

    expect(backgroundEvents.emit).toHaveBeenCalledWith(
      'NON_COMPLIANT_SITE',
      expect.objectContaining({
        domain: 'severity.example.com',
        severityMultiplier: 2,
      })
    );
    expect(Storage.addAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'non_compliant_site',
        severity: 'high',
        domain: 'severity.example.com',
      })
    );
  });
});
