import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { messageBus } from '@/utils/message-bus';
import { FirewallEngine } from '@/background/firewall-engine';
import { tabManager } from '@/utils/tab-manager';

type TabUpdatedListener = Parameters<typeof chrome.tabs.onUpdated.addListener>[0];
type TabActivatedListener = Parameters<typeof chrome.tabs.onActivated.addListener>[0];
type Handler = (data: unknown) => Promise<unknown>;

const tabUpdatedListeners = vi.hoisted(() => [] as TabUpdatedListener[]);
const tabActivatedListeners = vi.hoisted(() => [] as TabActivatedListener[]);
const messageHandlers = vi.hoisted(() => new Map<string, Handler>());

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
    on: vi.fn((type: string, handler: Handler) => {
      messageHandlers.set(type, handler);
    }),
    broadcast: vi.fn(),
    send: vi.fn().mockResolvedValue({ success: true }),
    handlers: messageHandlers,
  },
}));

const getRegisteredCallbacks = (): {
  onUpdated: TabUpdatedListener;
  onActivated: TabActivatedListener;
  onTabRemoved: Handler;
} => {
  const onUpdated = tabUpdatedListeners[0];
  const onActivated = tabActivatedListeners[0];
  const onTabRemoved = (messageBus as unknown as { handlers: Map<string, Handler> }).handlers.get('TAB_REMOVED');

  if (!onUpdated || !onActivated || !onTabRemoved) {
    throw new Error('Expected tab listeners and TAB_REMOVED handler to be registered');
  }

  return { onUpdated, onActivated, onTabRemoved };
};

describe('Service Worker tab event handlers', () => {
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
  });

  it('resets block count and updates badge when tab enters loading state', async () => {
    const { onUpdated } = getRegisteredCallbacks();

    await onUpdated(12, { status: 'loading' }, { id: 12, url: 'https://example.com' } as chrome.tabs.Tab);

    expect(tabManager.resetBlockCount).toHaveBeenCalledWith(12);
    expect(FirewallEngine.updateCurrentTabBadge).toHaveBeenCalledWith(12);
  });

  it('checks page trackers when tab finishes loading', async () => {
    const { onUpdated } = getRegisteredCallbacks();

    await onUpdated(27, { status: 'complete' }, { id: 27, url: 'https://example.com/home' } as chrome.tabs.Tab);

    expect(FirewallEngine.checkPageForTrackers).toHaveBeenCalledWith(27, 'https://example.com/home');
  });

  it('skips tab callbacks for chrome:// URLs', async () => {
    const { onUpdated } = getRegisteredCallbacks();

    await onUpdated(8, { status: 'loading' }, { id: 8, url: 'chrome://extensions' } as chrome.tabs.Tab);
    await onUpdated(8, { status: 'complete' }, { id: 8, url: 'chrome://extensions' } as chrome.tabs.Tab);

    expect(tabManager.resetBlockCount).not.toHaveBeenCalled();
    expect(FirewallEngine.updateCurrentTabBadge).not.toHaveBeenCalled();
    expect(FirewallEngine.checkPageForTrackers).not.toHaveBeenCalled();
  });

  it('updates active tab badge on tab activation', async () => {
    const { onActivated } = getRegisteredCallbacks();

    await onActivated({ tabId: 99, windowId: 1 });

    expect(FirewallEngine.updateCurrentTabBadge).toHaveBeenCalledWith(99);
  });

  it('clears tab timer on TAB_REMOVED message', async () => {
    const { onTabRemoved } = getRegisteredCallbacks();

    await onTabRemoved({ tabId: 33 });
    await onTabRemoved({});

    expect(FirewallEngine.clearTabTimer).toHaveBeenCalledTimes(1);
    expect(FirewallEngine.clearTabTimer).toHaveBeenCalledWith(33);
  });
});
