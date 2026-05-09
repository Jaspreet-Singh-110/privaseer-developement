import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FirewallEngine } from '@/background/firewall-engine';
import type { TrackerLists } from '@/types';

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Hoisted mocks
const addAlertMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  settings: { protectionEnabled: true },
  alerts: [],
  trackers: {},
  privacyScore: {
    current: 100,
    daily: {
      trackersBlocked: 0,
      cleanSitesVisited: 0,
      nonCompliantSites: 0,
    },
    history: [],
  },
}));

vi.mock('@/background/storage', () => ({
  Storage: {
    addAlert: addAlertMock,
    get: getMock,
    getDomainOccurrence: vi.fn().mockResolvedValue(0),
    incrementDomainOccurrence: vi.fn().mockResolvedValue(1),
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

const incrementBlockCountMock = vi.hoisted(() => vi.fn());
const getBlockCountMock = vi.hoisted(() => vi.fn().mockReturnValue(5));

vi.mock('@/utils/tab-manager', () => ({
  tabManager: {
    incrementBlockCount: incrementBlockCountMock,
    getBlockCount: getBlockCountMock,
    resetBlockCount: vi.fn(),
    cleanup: vi.fn(),
  },
}));

// Mock tracker lists data
const mockTrackerLists: TrackerLists = {
  version: '2.0.0',
  lastUpdated: '2025-10-04',
  categories: {
    analytics: ['google-analytics.com', 'googletagmanager.com', 'mixpanel.com'],
    advertising: ['doubleclick.net', 'criteo.com', 'facebook.net', 'adnxs.com'],
    social: ['facebook.com/tr', 'platform.twitter.com'],
    fingerprinting: ['fingerprintjs.com', 'clientjs.org'],
    beacons: ['pixel.facebook.com', 'bat.bing.com'],
  },
  highRisk: ['doubleclick.net', 'facebook.net', 'fingerprintjs.com'],
};

describe('FirewallEngine - getRiskWeight()', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    emitMock.mockClear();
    addAlertMock.mockClear();

    // Mock fetch for tracker lists
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(mockTrackerLists),
    });

    // Mock chrome APIs
    global.chrome = {
      runtime: {
        getURL: vi.fn((path) => `chrome-extension://test/${path}`),
      },
      tabs: {
        get: vi.fn().mockResolvedValue({ url: 'https://example.com/page' }),
      },
      action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
      },
      declarativeNetRequest: {
        updateEnabledRulesets: vi.fn(),
      },
    } as unknown as typeof chrome;

    // Initialize FirewallEngine
    await FirewallEngine.initialize();
  });

  afterEach(() => {
    FirewallEngine.cleanup();
  });

  it('assigns risk weight of 10 for cryptomining domains', async () => {
    await FirewallEngine.handleBlockedRequest('https://coinhive.com/script.js', 123);

    const trackerBlockedCall = emitMock.mock.calls.find(
      (call) => call[0] === 'TRACKER_BLOCKED'
    );

    expect(trackerBlockedCall).toBeDefined();
    expect(trackerBlockedCall![1].riskWeight).toBe(10);
    expect(trackerBlockedCall![1].domain).toBe('coinhive.com');
  });

  it('assigns risk weight of 5 for fingerprinting services', async () => {
    await FirewallEngine.handleBlockedRequest('https://fingerprintjs.com/v3/abc', 123);

    const trackerBlockedCall = emitMock.mock.calls.find(
      (call) => call[0] === 'TRACKER_BLOCKED'
    );

    expect(trackerBlockedCall).toBeDefined();
    expect(trackerBlockedCall![1].riskWeight).toBe(5);
    expect(trackerBlockedCall![1].category).toBe('fingerprinting');
  });

  it('assigns risk weight of 2 for advertising category', async () => {
    await FirewallEngine.handleBlockedRequest('https://doubleclick.net/ad.js', 123);

    const trackerBlockedCall = emitMock.mock.calls.find(
      (call) => call[0] === 'TRACKER_BLOCKED'
    );

    expect(trackerBlockedCall).toBeDefined();
    expect(trackerBlockedCall![1].riskWeight).toBe(2);
    expect(trackerBlockedCall![1].category).toBe('advertising');
  });

  it('assigns risk weight of 1 for analytics category', async () => {
    await FirewallEngine.handleBlockedRequest('https://google-analytics.com/collect', 123);

    const trackerBlockedCall = emitMock.mock.calls.find(
      (call) => call[0] === 'TRACKER_BLOCKED'
    );

    expect(trackerBlockedCall).toBeDefined();
    expect(trackerBlockedCall![1].riskWeight).toBe(1);
    expect(trackerBlockedCall![1].category).toBe('analytics');
  });

  it('assigns risk weight of 1 for unknown trackers', async () => {
    await FirewallEngine.handleBlockedRequest('https://unknown-tracker.xyz/track.js', 123);

    const trackerBlockedCall = emitMock.mock.calls.find(
      (call) => call[0] === 'TRACKER_BLOCKED'
    );

    expect(trackerBlockedCall).toBeDefined();
    expect(trackerBlockedCall![1].riskWeight).toBe(1);
    expect(trackerBlockedCall![1].category).toBe('unknown');
  });
});

describe('FirewallEngine - scheduleTabBadgeUpdate()', () => {
  const setBadgeTextMock = vi.fn();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    emitMock.mockClear();
    addAlertMock.mockClear();
    setBadgeTextMock.mockClear();

    // Mock fetch for tracker lists
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(mockTrackerLists),
    });

    // Mock chrome APIs
    global.chrome = {
      runtime: {
        getURL: vi.fn((path) => `chrome-extension://test/${path}`),
      },
      tabs: {
        get: vi.fn().mockResolvedValue({ url: 'https://example.com/page' }),
      },
      action: {
        setBadgeText: setBadgeTextMock,
        setBadgeBackgroundColor: vi.fn(),
      },
      declarativeNetRequest: {
        updateEnabledRulesets: vi.fn(),
      },
    } as unknown as typeof chrome;

    // Initialize FirewallEngine
    await FirewallEngine.initialize();
  });

  afterEach(() => {
    vi.useRealTimers();
    FirewallEngine.cleanup();
  });

  it('debounces rapid badge updates to single call after 300ms', async () => {
    const tabId = 123;

    // Fire 5 rapid requests
    await FirewallEngine.handleBlockedRequest('https://tracker1.com/a.js', tabId);
    await FirewallEngine.handleBlockedRequest('https://tracker2.com/b.js', tabId);
    await FirewallEngine.handleBlockedRequest('https://tracker3.com/c.js', tabId);
    await FirewallEngine.handleBlockedRequest('https://tracker4.com/d.js', tabId);
    await FirewallEngine.handleBlockedRequest('https://tracker5.com/e.js', tabId);

    // Badge should not be updated yet
    expect(setBadgeTextMock).not.toHaveBeenCalled();

    // Advance timers by 300ms
    await vi.advanceTimersByTimeAsync(300);

    // Badge should be updated exactly once
    expect(setBadgeTextMock).toHaveBeenCalledTimes(1);
    expect(setBadgeTextMock).toHaveBeenCalledWith({
      text: '5',
      tabId,
    });
  });

  it('respects debounce delay - no update before 300ms', async () => {
    const tabId = 456;

    await FirewallEngine.handleBlockedRequest('https://tracker.com/script.js', tabId);

    // Advance 299ms - should not update yet
    await vi.advanceTimersByTimeAsync(299);
    expect(setBadgeTextMock).not.toHaveBeenCalled();

    // Advance 1 more ms (total 300ms) - should update now
    await vi.advanceTimersByTimeAsync(1);
    expect(setBadgeTextMock).toHaveBeenCalledTimes(1);
  });

  it('clears existing timer when new request arrives', async () => {
    const tabId = 789;

    // First request
    await FirewallEngine.handleBlockedRequest('https://tracker1.com/a.js', tabId);

    // Advance 200ms (not enough to trigger)
    await vi.advanceTimersByTimeAsync(200);
    expect(setBadgeTextMock).not.toHaveBeenCalled();

    // Second request - should reset the timer
    await FirewallEngine.handleBlockedRequest('https://tracker2.com/b.js', tabId);

    // Advance another 200ms (total 400ms from first, but only 200ms from second)
    await vi.advanceTimersByTimeAsync(200);
    expect(setBadgeTextMock).not.toHaveBeenCalled();

    // Advance 100ms more (300ms from second request)
    await vi.advanceTimersByTimeAsync(100);
    expect(setBadgeTextMock).toHaveBeenCalledTimes(1);
  });

  it('clearTabTimer() prevents scheduled badge update', async () => {
    const tabId = 999;

    await FirewallEngine.handleBlockedRequest('https://tracker.com/script.js', tabId);

    // Clear the timer before it fires
    FirewallEngine.clearTabTimer(tabId);

    // Advance past debounce delay
    await vi.advanceTimersByTimeAsync(400);

    // Badge should not be updated
    expect(setBadgeTextMock).not.toHaveBeenCalled();
  });
});

describe('FirewallEngine - getTrackerInfo()', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock fetch for tracker lists
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(mockTrackerLists),
    });

    // Mock chrome APIs
    global.chrome = {
      runtime: {
        getURL: vi.fn((path) => `chrome-extension://test/${path}`),
      },
      tabs: {
        get: vi.fn().mockResolvedValue({ url: 'https://example.com/page' }),
      },
      action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
      },
      declarativeNetRequest: {
        updateEnabledRulesets: vi.fn(),
      },
    } as unknown as typeof chrome;

    // Initialize FirewallEngine
    await FirewallEngine.initialize();
  });

  afterEach(() => {
    FirewallEngine.cleanup();
  });

  it('returns specific info for known tracker (google-analytics.com)', () => {
    const info = FirewallEngine.getTrackerInfo('google-analytics.com');

    expect(info).toBeDefined();
    expect(info?.description).toContain('Tracks user behavior');
    expect(info?.description).toContain('browsing data');
    expect(info?.alternative).toContain('Plausible');
    expect(info?.alternative).toContain('Simple Analytics');
  });

  it('returns category fallback for unknown domain in advertising category', () => {
    // Using a domain that's in the advertising category but not in the specific tracker info map
    const info = FirewallEngine.getTrackerInfo('adnxs.com');

    expect(info).toBeDefined();
    expect(info?.description).toBe('Tracks users across websites for targeted advertising');
    expect(info?.alternative).toBe('Support websites through direct subscriptions or contextual ads');
  });

  it('returns generic info for completely unknown tracker', () => {
    const info = FirewallEngine.getTrackerInfo('random-unknown.xyz');

    expect(info).toBeDefined();
    expect(info?.description).toContain('Tracking service');
    expect(info?.description).toContain('collects user data');
    expect(info?.alternative).toContain('privacy-focused alternatives');
  });
});

