/**
 * TEST FILE: Post Consent Violation Flow
 *
 * Test Type: Integration
 * Contexts Tested: Background Service Worker + Firewall Engine
 * Chrome APIs Mocked: runtime, tabs, action, declarativeNetRequest
 * Prerequisites:
 *   - Service worker dependencies (Storage, Telemetry, etc.) are mocked
 *
 * Coverage Target: Aggregation path from CONSENT_SCAN_RESULT → POST_CONSENT_VIOLATION alert
 */

import { beforeAll, beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ConsentScanResult } from '@/types';
import { CONSENT_VIOLATION } from '@/utils/constants';
import { FirewallEngine } from '@/background/firewall-engine';
import { messageBus } from '@/utils/message-bus';
import { Storage } from '@/background/storage';
import { backgroundEvents } from '@/background/event-emitter';

const storageData = vi.hoisted(() => ({
  settings: {
    protectionEnabled: true,
    showNotifications: true,
    theme: 'system' as const,
    burnerEmailEnabled: true,
    telemetryEnabled: false,
  },
  alerts: [] as any[],
  trackers: {},
  privacyScore: {
    current: 92,
    daily: {
      trackersBlocked: 0,
      cleanSitesVisited: 0,
      nonCompliantSites: 0,
    },
    history: [],
  },
  lastReset: Date.now(),
  consentStates: {},
  domainOccurrences: {},
}));

const mockChrome = () => {
  const tabsQuery = vi.fn((_query?: unknown, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
    const tabs = [{ id: 1, url: 'https://news.example/home' }] as chrome.tabs.Tab[];
    if (typeof callback === 'function') {
      callback(tabs);
      return;
    }
    return Promise.resolve(tabs);
  });

  return {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
      onMessage: {
        addListener: vi.fn(),
      },
      getURL: vi.fn().mockImplementation((path: string) => path),
      onInstalled: {
        addListener: vi.fn(),
      },
      onStartup: {
        addListener: vi.fn(),
      },
      onSuspend: {
        addListener: vi.fn(),
      },
    },
    tabs: {
      query: tabsQuery,
      get: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onUpdated: {
        addListener: vi.fn(),
      },
      onActivated: {
        addListener: vi.fn(),
      },
    },
    action: {
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      onClicked: {
        addListener: vi.fn(),
      },
    },
    declarativeNetRequest: {
      updateEnabledRulesets: vi.fn().mockResolvedValue(undefined),
      onRuleMatchedDebug: {
        addListener: vi.fn(),
      },
    },
    storage: {
      onChanged: {
        addListener: vi.fn(),
      },
    },
  };
};

const chromeMock = mockChrome();
(globalThis as any).chrome = chromeMock;

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  json: async () => ({
    categories: {
      analytics: [],
      advertising: [],
      social: [],
      fingerprinting: [],
      beacons: [],
    },
    highRisk: [],
  }),
}));

const messageHandlers = vi.hoisted(
  () => new Map<string, (data: unknown, sender: chrome.runtime.MessageSender) => unknown>()
);

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
    get: vi.fn().mockResolvedValue(storageData),
    getFresh: vi.fn().mockResolvedValue(storageData),
    addAlert: vi.fn().mockImplementation(async (alert: any) => {
      storageData.alerts.push(alert);
    }),
    getDomainOccurrence: vi.fn().mockResolvedValue(0),
    incrementDomainOccurrence: vi.fn().mockResolvedValue(1),
    clearAlerts: vi.fn().mockResolvedValue(undefined),
    toggleProtection: vi.fn().mockResolvedValue(true),
    getBurnerEmailEnabled: vi.fn().mockResolvedValue(storageData.settings.burnerEmailEnabled),
    setBurnerEmailEnabled: vi.fn().mockImplementation(async (enabled: boolean) => {
      storageData.settings.burnerEmailEnabled = enabled;
    }),
    setTelemetryEnabled: vi.fn().mockResolvedValue(undefined),
    getTelemetryEnabled: vi.fn().mockResolvedValue(storageData.settings.telemetryEnabled),
    setTheme: vi.fn().mockResolvedValue(undefined),
    getRealEmail: vi.fn().mockResolvedValue(''),
    setRealEmail: vi.fn().mockResolvedValue(undefined),
    recordComplianceScore: vi.fn().mockResolvedValue(undefined),
    ensureSaved: vi.fn().mockResolvedValue(undefined),
    getAllowlistEntries: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/background/privacy-score', () => ({
  PrivacyScoreManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/burner-email-service', () => ({
  burnerEmailService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    generateEmail: vi.fn().mockResolvedValue('generated@burner.test'),
    getEmails: vi.fn().mockResolvedValue([]),
    deleteEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/feedback-telemetry-service', () => ({
  feedbackTelemetryService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    trackEvent: vi.fn().mockResolvedValue(undefined),
    submitFeedback: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/utils/tab-manager', () => ({
  tabManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    resetBlockCount: vi.fn(),
    incrementBlockCount: vi.fn(),
    getBlockCount: vi.fn().mockReturnValue(0),
    cleanup: vi.fn(),
  },
}));

vi.mock('@/background/event-emitter', () => ({
  backgroundEvents: {
    emit: vi.fn(),
  },
}));

vi.mock('@/utils/message-bus', () => ({
  messageBus: {
    initialize: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((type: string, handler: (data: unknown, sender: chrome.runtime.MessageSender) => unknown) => {
      messageHandlers.set(type, handler);
    }),
    broadcast: vi.fn(),
    send: vi.fn().mockResolvedValue({ success: true }),
    handlers: messageHandlers,
  },
}));

vi.mock('@/background/firewall-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/background/firewall-engine')>();
  actual.FirewallEngine.initialize = vi.fn().mockResolvedValue(undefined);
  (actual.FirewallEngine as any).enableBlocking = vi.fn().mockResolvedValue(undefined);
  (actual.FirewallEngine as any).disableBlocking = vi.fn().mockResolvedValue(undefined);
  actual.FirewallEngine.updateCurrentTabBadge = vi.fn().mockResolvedValue(undefined);
  actual.FirewallEngine.clearTabTimer = vi.fn();
  actual.FirewallEngine.cleanup = vi.fn();
  return actual;
});

const getConsentScanHandler = () =>
  ((messageBus as any).handlers.get('CONSENT_SCAN_RESULT')) as
    | ((data: ConsentScanResult, sender: chrome.runtime.MessageSender) => Promise<unknown>)
    | undefined;

const buildConsentScanResult = (url: string): ConsentScanResult => ({
  url,
  hasBanner: true,
  hasRejectButton: true,
  isCompliant: false,
  deceptivePatterns: [],
  timestamp: Date.now(),
  cmpDetection: {
    detected: true,
    cmpType: 'TestCMP',
    detectionMethod: 'banner',
    confidenceScore: 0.95,
    consentStatus: 'rejected',
    cookieNames: [],
  },
});

describe('Post-consent violation aggregation flow', () => {
  let consentScanHandler:
    | ((data: ConsentScanResult, sender: chrome.runtime.MessageSender) => Promise<unknown>)
    | undefined;

  beforeAll(async () => {
    await import('@/background/service-worker');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    consentScanHandler = getConsentScanHandler();
    (chrome.tabs.get as Mock).mockResolvedValue({ url: 'https://news.example/home' });
  });

  afterEach(() => {
    vi.useRealTimers();
    storageData.alerts.length = 0;
  });

  it('creates a high severity alert when trackers load after a rejected consent scan', async () => {
    expect(consentScanHandler).toBeDefined();

    await consentScanHandler!(buildConsentScanResult('https://news.example/home'), {
      tab: { id: 42 },
    } as chrome.runtime.MessageSender);

    await FirewallEngine.handleBlockedRequest('https://tracker.alpha.com/script.js', 42);

    await vi.advanceTimersByTimeAsync(CONSENT_VIOLATION.AGGREGATION_DELAY_MS + 10);

    const addAlertMock = Storage.addAlert as unknown as Mock;
    const violationAlertCall = addAlertMock.mock.calls.find(
      ([alert]) => alert.type === 'post_consent_violation'
    );
    expect(violationAlertCall).toBeDefined();
    const alertPayload = violationAlertCall![0];

    expect(alertPayload.type).toBe('post_consent_violation');
    expect(alertPayload.domain).toBe('news.example');
    expect(alertPayload.trackerCount).toBe(1);
    expect(alertPayload.blockedTrackers).toEqual(['tracker.alpha.com']);
    expect(alertPayload.message).toContain('It loaded 1 tracker');

    expect(messageBus.broadcast).toHaveBeenCalledWith('STATE_UPDATE');
    expect(backgroundEvents.emit).toHaveBeenCalledWith('POST_CONSENT_VIOLATION', {
      domain: 'news.example',
      trackerCount: 1,
      trackers: new Set(['tracker.alpha.com']),
    });
  });

  it('aggregates multiple blocked trackers into a single violation alert', async () => {
    expect(consentScanHandler).toBeDefined();

    await consentScanHandler!(buildConsentScanResult('https://video.example/watch'), {
      tab: { id: 77 },
    } as chrome.runtime.MessageSender);

    await FirewallEngine.handleBlockedRequest('https://tracker.one.com/a.js', 77);
    await FirewallEngine.handleBlockedRequest('https://tracker.two.com/b.js', 77);

    await vi.advanceTimersByTimeAsync(CONSENT_VIOLATION.AGGREGATION_DELAY_MS + 10);

    const addAlertMock = Storage.addAlert as unknown as Mock;
    const violationAlertCall = addAlertMock.mock.calls.find(
      ([alert]) => alert.type === 'post_consent_violation'
    );
    expect(violationAlertCall).toBeDefined();

    const alertPayload = violationAlertCall![0];
    expect(alertPayload.trackerCount).toBe(2);
    expect(alertPayload.blockedTrackers).toEqual(
      expect.arrayContaining(['tracker.one.com', 'tracker.two.com']),
    );
    expect(alertPayload.message).toContain('It loaded 2 trackers');
  });
});
