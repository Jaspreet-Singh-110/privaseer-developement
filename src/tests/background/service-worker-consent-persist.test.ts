import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsentScanResultV2 } from '@/types';
import { SUPABASE } from '@/utils/constants';
import { logger } from '@/utils/logger';
import { messageBus } from '@/utils/message-bus';
import { feedbackTelemetryService } from '@/background/feedback-telemetry-service';

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

const buildResult = (overrides: Partial<ConsentScanResultV2> = {}): ConsentScanResultV2 => ({
  url: 'https://example.com/path',
  hasBanner: true,
  hasRejectButton: true,
  isCompliant: true,
  deceptivePatterns: [],
  timestamp: Date.now(),
  confidence: {
    overall: 90,
    bannerDetection: {
      name: 'bannerDetection',
      score: 90,
      weight: 0.3,
      reasoning: 'Banner detected clearly',
    },
    buttonDetection: {
      name: 'buttonDetection',
      score: 90,
      weight: 0.3,
      reasoning: 'Buttons are present and visible',
    },
    cmpRecognition: {
      name: 'cmpRecognition',
      score: 90,
      weight: 0.2,
      reasoning: 'CMP successfully recognized',
    },
    contextualAnalysis: {
      name: 'contextualAnalysis',
      score: 90,
      weight: 0.2,
      reasoning: 'Context indicates valid signal',
    },
    factors: [],
    reasoning: ['High-confidence consent scan'],
    shouldAlert: false,
  },
  scanPhase: 'interaction',
  cmpDetection: {
    detected: true,
    cmpType: 'onetrust',
    detectionMethod: 'cookie',
    confidenceScore: 0.92,
    consentStatus: 'rejected',
    cookieNames: ['OptanonConsent'],
    tcfVersion: '2.0',
  },
  ...overrides,
});

const getConsentHandler = (): ConsentHandler => {
  const handler = (messageBus as unknown as { handlers: Map<string, ConsentHandler> }).handlers.get(
    'CONSENT_SCAN_RESULT'
  );
  if (!handler) {
    throw new Error('CONSENT_SCAN_RESULT handler not registered');
  }
  return handler;
};

describe('Service Worker consent persistence', () => {
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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('ok'),
    }) as unknown as typeof fetch;
    vi.mocked(feedbackTelemetryService.getInstallationId).mockResolvedValue('install-123');
  });

  it('skips persistence when no cmp, no banner, and no persisted consent', async () => {
    const handler = getConsentHandler();

    const response = await handler(
      buildResult({
        hasBanner: false,
        hasPersistedConsent: false,
        cmpDetection: { detected: false, cmpType: 'unknown', detectionMethod: 'banner', confidenceScore: 0, consentStatus: 'unknown', cookieNames: [] },
      })
    );

    expect(response).toEqual({ success: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('persists consent state with expected headers and body', async () => {
    const handler = getConsentHandler();

    const response = await handler(buildResult());

    expect(response).toEqual({ success: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain('/functions/v1/persist-consent-state');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE.ANON_KEY}`,
    });

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      installationId: 'install-123',
      domain: 'example.com',
      cmpType: 'onetrust',
      consentStatus: 'rejected',
      hasRejectButton: true,
      isCompliant: true,
      cookieNames: ['OptanonConsent'],
      tcfVersion: '2.0',
      detectionMethod: 'cookie',
      confidenceScore: 0.92,
    });
  });

  it('logs success when persistence request succeeds', async () => {
    const handler = getConsentHandler();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('ok'),
    } as unknown as Response);

    const response = await handler(buildResult());

    expect(response).toEqual({ success: true });
    expect(logger.info).toHaveBeenCalledWith(
      'ServiceWorker',
      'Consent state persisted to Supabase',
      expect.objectContaining({ domain: 'example.com', cmpType: 'onetrust' })
    );
  });

  it('logs warning for non-ok persistence response', async () => {
    const handler = getConsentHandler();
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('upstream failure'),
    } as unknown as Response);

    const response = await handler(buildResult());

    expect(response).toEqual({ success: true });
    expect(logger.warn).toHaveBeenCalledWith(
      'ServiceWorker',
      'Failed to persist consent state',
      expect.objectContaining({
        domain: 'example.com',
        status: 500,
        error: 'upstream failure',
      })
    );
  });

  it('handles network errors during persistence gracefully', async () => {
    const handler = getConsentHandler();
    vi.mocked(fetch).mockRejectedValue(new Error('network unavailable'));

    const response = await handler(buildResult());

    expect(response).toEqual({ success: true });
    expect(logger.error).toHaveBeenCalledWith(
      'ServiceWorker',
      'Error persisting consent state',
      expect.any(Error),
      expect.objectContaining({ domain: 'example.com' })
    );
  });
});
