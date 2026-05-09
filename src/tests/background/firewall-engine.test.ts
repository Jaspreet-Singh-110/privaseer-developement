import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FirewallEngine } from '@/background/firewall-engine';
import { CONSENT_VIOLATION } from '@/utils/constants';
import { tabManager } from '@/utils/tab-manager';
import { Storage } from '@/background/storage';
import type { StorageData } from '@/types';

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const addAlertMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/background/storage', () => ({
  Storage: {
    addAlert: addAlertMock,
    getDomainOccurrence: vi.fn().mockResolvedValue(0),
    incrementDomainOccurrence: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue({
      settings: {
        protectionEnabled: true,
        showNotifications: true,
        theme: 'system',
        burnerEmailEnabled: false,
        telemetryEnabled: false,
      },
    }),
    toggleProtection: vi.fn(),
  },
}));

const broadcastMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/message-bus', () => ({
  messageBus: {
    broadcast: broadcastMock,
  },
}));

const emitMock = vi.hoisted(() => vi.fn());

vi.mock('@/background/event-emitter', () => ({
  backgroundEvents: {
    emit: emitMock,
  },
}));

vi.mock('@/utils/tab-manager', () => ({
  tabManager: {
    incrementBlockCount: vi.fn(),
    getBlockCount: vi.fn().mockReturnValue(0),
    resetBlockCount: vi.fn(),
    cleanup: vi.fn(),
  },
}));

describe('FirewallEngine post consent violation detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    addAlertMock.mockClear();
    broadcastMock.mockClear();
    emitMock.mockClear();

    global.chrome = {
      tabs: {
        get: vi.fn().mockResolvedValue({ url: 'https://example.com/page' }),
      },
      action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
      },
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    vi.useRealTimers();
    FirewallEngine.setConsentRejectionProvider(null);
    FirewallEngine.cleanup();
  });

  it('creates a post consent violation alert when tracker loads after rejection', async () => {
    FirewallEngine.setConsentRejectionProvider(() => ({
      timestamp: Date.now(),
      tabId: 321,
    }));

    await FirewallEngine.handleBlockedRequest('https://tracker.example/script.js', 123);

    await vi.advanceTimersByTimeAsync(CONSENT_VIOLATION.AGGREGATION_DELAY_MS + 10);

    expect(addAlertMock).toHaveBeenCalledTimes(1);
    const alertPayload = addAlertMock.mock.calls[0][0];
    expect(alertPayload.type).toBe('post_consent_violation');
    expect(alertPayload.trackerCount).toBe(1);
    expect(alertPayload.blockedTrackers).toEqual(['tracker.example']);
    expect(broadcastMock).toHaveBeenCalledWith('STATE_UPDATE');
    expect(emitMock).toHaveBeenCalledWith('POST_CONSENT_VIOLATION', {
      domain: 'example.com',
      trackerCount: 1,
      trackers: new Set(['tracker.example']),
    });
  });

  it('aggregates multiple trackers into a single violation alert', async () => {
    FirewallEngine.setConsentRejectionProvider(() => ({
      timestamp: Date.now(),
      tabId: 999,
    }));

    await FirewallEngine.handleBlockedRequest('https://tracker-one.com/a.js', 1);
    await FirewallEngine.handleBlockedRequest('https://tracker-two.com/b.js', 1);

    await vi.advanceTimersByTimeAsync(CONSENT_VIOLATION.AGGREGATION_DELAY_MS + 10);

    expect(addAlertMock).toHaveBeenCalledTimes(1);
    const alertPayload = addAlertMock.mock.calls[0][0];
    expect(alertPayload.trackerCount).toBe(2);
    expect(alertPayload.blockedTrackers).toEqual(expect.arrayContaining(['tracker-one.com', 'tracker-two.com']));
  });
});

describe('FirewallEngine tracker handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    addAlertMock.mockClear();
    broadcastMock.mockClear();
    emitMock.mockClear();

    (FirewallEngine as unknown as { trackerLists: unknown }).trackerLists = {
      categories: {
        analytics: ['analytics.example'],
        advertising: ['ads.example'],
        fingerprinting: ['fingerprint.example'],
      },
      highRisk: ['highrisk.example'],
    };

    global.chrome = {
      tabs: {
        get: vi.fn().mockResolvedValue({ url: 'https://site.example/page' }),
      },
      action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
      },
    } as unknown as typeof chrome;

    (tabManager.getBlockCount as unknown as { mockReturnValue: (value: number) => void })
      .mockReturnValue(2);
  });

  afterEach(() => {
    vi.useRealTimers();
    FirewallEngine.cleanup();
  });

  it('emits tracker events with category and risk weight', async () => {
    await FirewallEngine.handleBlockedRequest('https://ads.example/script.js', 10);

    expect(emitMock).toHaveBeenCalledWith('TRACKER_INCREMENT', {
      domain: 'ads.example',
      category: 'advertising',
      isHighRisk: false,
    });
    expect(emitMock).toHaveBeenCalledWith(
      'TRACKER_BLOCKED',
      expect.objectContaining({
        domain: 'ads.example',
        category: 'advertising',
        riskWeight: 2,
        isHighRisk: false,
        tabId: 10,
      })
    );
  });

  it('applies decay to repeated tracker occurrences for scoring events', async () => {
    vi.mocked(Storage.getDomainOccurrence).mockResolvedValueOnce(2);
    await FirewallEngine.handleBlockedRequest('https://ads.example/script.js', 18);

    expect(emitMock).toHaveBeenCalledWith(
      'TRACKER_BLOCKED',
      expect.objectContaining({
        domain: 'ads.example',
        riskWeight: 0.5, // 2 * (0.5^2)
      })
    );
    expect(Storage.incrementDomainOccurrence).toHaveBeenCalledWith('ads.example');
  });

  it('treats known malicious domains as high risk weight', async () => {
    await FirewallEngine.handleBlockedRequest('https://coinhive.bad/script.js', 11);

    expect(emitMock).toHaveBeenCalledWith(
      'TRACKER_BLOCKED',
      expect.objectContaining({
        domain: 'coinhive.bad',
        riskWeight: 10,
      })
    );
    expect(addAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'high_risk',
        severity: 'high',
      })
    );
  });

  it('uses fingerprinting weight when fingerprinting category is detected', async () => {
    await FirewallEngine.handleBlockedRequest('https://fingerprint.example/script.js', 12);

    expect(emitMock).toHaveBeenCalledWith(
      'TRACKER_BLOCKED',
      expect.objectContaining({
        domain: 'fingerprint.example',
        category: 'fingerprinting',
        riskWeight: 5,
      })
    );
    expect(addAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'high',
      })
    );
  });

  it('uses high risk alert type when domain is flagged high risk', async () => {
    await FirewallEngine.handleBlockedRequest('https://highrisk.example/script.js', 13);

    expect(addAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'high_risk',
        severity: 'low',
      })
    );
  });

  it('handles invalid tracker URLs without throwing', async () => {
    await expect(FirewallEngine.handleBlockedRequest('not-a-url', 14)).resolves.toBeUndefined();
    expect(addAlertMock).not.toHaveBeenCalled();
  });

  it('handles tab lookup failures without throwing', async () => {
    chrome.tabs.get = vi.fn().mockRejectedValue(new Error('tab failed'));

    await expect(
      FirewallEngine.handleBlockedRequest('https://ads.example/script.js', 15)
    ).resolves.toBeUndefined();
  });

  it('debounces badge updates per tab', async () => {
    await FirewallEngine.handleBlockedRequest('https://ads.example/one.js', 20);
    await FirewallEngine.handleBlockedRequest('https://ads.example/two.js', 20);

    await vi.advanceTimersByTimeAsync(299);
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(chrome.action.setBadgeText).toHaveBeenCalledTimes(1);
  });

  it('clears scheduled badge updates for a tab', async () => {
    await FirewallEngine.handleBlockedRequest('https://ads.example/one.js', 30);

    FirewallEngine.clearTabTimer(30);
    await vi.advanceTimersByTimeAsync(400);

    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
  });

  it('deduplicates tracker alerts within one minute for same tracker and site', async () => {
    const trackerUrl = `https://ads-${Date.now()}.example/script.js`;
    await FirewallEngine.handleBlockedRequest(trackerUrl, 16);
    await FirewallEngine.handleBlockedRequest(trackerUrl, 16);

    expect(addAlertMock).toHaveBeenCalledTimes(1);
  });

  it('handles blocked request when tab URL is missing by using unknown site domain', async () => {
    chrome.tabs.get = vi.fn().mockResolvedValue({ url: undefined });

    await FirewallEngine.handleBlockedRequest('https://ads.example/script.js', 17);

    expect(addAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'unknown',
      })
    );
  });

  it('directly updates current tab badge via updateCurrentTabBadge()', async () => {
    await FirewallEngine.updateCurrentTabBadge(99);

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
      text: '2',
      tabId: 99,
    });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: expect.any(String),
      tabId: 99,
    });
  });
});

describe('FirewallEngine checkPageForTrackers and cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    addAlertMock.mockClear();
    emitMock.mockClear();
    broadcastMock.mockClear();

    global.chrome = {
      tabs: {
        get: vi.fn().mockResolvedValue({ url: 'https://site.example/page' }),
      },
      action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
      },
    } as unknown as typeof chrome;

    vi.mocked(Storage.get).mockResolvedValue({
      settings: {
        protectionEnabled: true,
        showNotifications: true,
        theme: 'system',
        burnerEmailEnabled: false,
        telemetryEnabled: false,
      },
      alerts: [],
      trackers: {},
      lastReset: Date.now(),
      consentStates: {},
      domainOccurrences: {},
      onboarding: {
        hasCompletedOnboarding: false,
        currentStep: 0,
      },
      privacyScore: {
        current: 100,
        daily: {
          trackersBlocked: 0,
          cleanSitesVisited: 0,
          nonCompliantSites: 0,
        },
        history: [],
      },
    } as StorageData);
  });

  afterEach(() => {
    vi.useRealTimers();
    FirewallEngine.setConsentRejectionProvider(null);
    FirewallEngine.cleanup();
  });

  it('returns early for non-http URLs in checkPageForTrackers', async () => {
    await FirewallEngine.checkPageForTrackers(3, 'chrome://extensions');

    expect(addAlertMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalledWith('CLEAN_SITE_DETECTED', expect.anything());
  });

  it('emits clean-site event and adds clean-site alert when no trackers are present', async () => {
    await FirewallEngine.checkPageForTrackers(4, 'https://clean.example/path?utm=1');

    expect(emitMock).toHaveBeenCalledWith('CLEAN_SITE_DETECTED', {
      domain: 'clean.example',
      tabId: 4,
      url: 'https://clean.example/path?utm=1',
    });
    expect(addAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'clean.example',
        message: 'clean.example has no trackers',
        url: 'https://clean.example/path',
      })
    );
    expect(broadcastMock).toHaveBeenCalledWith('STATE_UPDATE');
  });

  it('handles errors in checkPageForTrackers without throwing', async () => {
    vi.mocked(Storage.get).mockRejectedValueOnce(new Error('storage broken'));

    await expect(
      FirewallEngine.checkPageForTrackers(5, 'https://safe.example')
    ).resolves.toBeUndefined();
  });

  it('cleans up post-consent timers and cache entries', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    FirewallEngine.setConsentRejectionProvider(() => ({ timestamp: Date.now(), tabId: 10 }));

    await FirewallEngine.handleBlockedRequest('https://tracker-one.example/a.js', 10);
    await FirewallEngine.handleBlockedRequest('https://tracker-two.example/b.js', 10);

    FirewallEngine.cleanup();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('FirewallEngine performance benchmarks', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    addAlertMock.mockClear();
    broadcastMock.mockClear();
    emitMock.mockClear();

    global.chrome = {
      tabs: {
        get: vi.fn().mockResolvedValue({ url: 'https://example.com/page' }),
      },
      action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
      },
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    FirewallEngine.setConsentRejectionProvider(null);
    FirewallEngine.cleanup();
  });

  it('completes a single tracker handling in under 10ms', async () => {
    const start = performance.now();
    await FirewallEngine.handleBlockedRequest('https://tracker.example/script.js', 111);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(10);
  });

  it('processes 50 tracker URLs sequentially in under 500ms', async () => {
    const trackerUrls = Array.from(
      { length: 50 },
      (_, index) => `https://tracker-${index}.example.com/script.js`,
    );

    const start = performance.now();
    for (const url of trackerUrls) {
      await FirewallEngine.handleBlockedRequest(url, 222);
    }
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(500);
  });

  it.concurrent('handles 50 tracker URLs concurrently within 500ms', async () => {
    const trackerUrls = Array.from(
      { length: 50 },
      (_, index) => `https://concurrent-tracker-${index}.example.com/script.js`,
    );

    const start = performance.now();
    await Promise.all(
      trackerUrls.map(url => FirewallEngine.handleBlockedRequest(url, 333)),
    );
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(500);
  });
});
