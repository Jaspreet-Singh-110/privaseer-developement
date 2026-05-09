/**
 * @file src/tests/contracts/settings-integration.test.ts
 *
 * Test Type: Integration
 * Contexts Tested: Popup → background → storage message flows
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageType, StorageData } from '@/types';
import { Storage } from '@/background/storage';
import { FirewallEngine } from '@/background/firewall-engine';
import { feedbackTelemetryService } from '@/background/feedback-telemetry-service';
import { messageBus } from '@/utils/message-bus';

type Handler = (data?: unknown, sender?: chrome.runtime.MessageSender) => Promise<unknown>;

const messageHandlers = vi.hoisted(() => new Map<MessageType, Handler>());

const baseStorageData = vi.hoisted<StorageData>(() => ({
  privacyScore: {
    current: 80,
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
  consentStates: {},
  domainOccurrences: {},
  dailySnapshots: [],
  onboarding: {
    hasCompletedOnboarding: true,
    currentStep: 0,
  },
  realEmail: '',
}));

const storageMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(baseStorageData),
  getFresh: vi.fn().mockResolvedValue(baseStorageData),
  setTheme: vi.fn().mockResolvedValue(undefined),
  setTelemetryEnabled: vi.fn().mockResolvedValue(undefined),
  getTelemetryEnabled: vi.fn().mockResolvedValue(false),
  getBurnerEmailEnabled: vi.fn().mockResolvedValue(false),
  setBurnerEmailEnabled: vi.fn().mockResolvedValue(undefined),
}));

const firewallMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  toggleProtection: vi.fn().mockResolvedValue(true),
  updateCurrentTabBadge: vi.fn().mockResolvedValue(undefined),
  checkPageForTrackers: vi.fn().mockResolvedValue(undefined),
  cleanup: vi.fn(),
  clearTabTimer: vi.fn(),
}));

const telemetryMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

const burnerEmailMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
}));

const tabManagerMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  cleanup: vi.fn(),
  resetBlockCount: vi.fn(),
}));

const chromeMock = {
  runtime: {
    sendMessage: vi.fn((_message: unknown, callback?: (response: unknown) => void) => {
      callback?.({ success: true });
      return Promise.resolve({ success: true });
    }),
    onMessage: {
      addListener: vi.fn(),
    },
    onInstalled: {
      addListener: vi.fn(),
    },
    onStartup: {
      addListener: vi.fn(),
    },
    onSuspend: {
      addListener: vi.fn(),
    },
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    lastError: undefined,
  },
  tabs: {
    query: vi.fn((_query: unknown, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
      callback?.([]);
      return Promise.resolve([]);
    }),
    sendMessage: vi.fn((_tabId: number, _message: unknown, callback?: (response: unknown) => void) => {
      callback?.({ success: true });
      return Promise.resolve({ success: true });
    }),
    onUpdated: {
      addListener: vi.fn(),
    },
    onActivated: {
      addListener: vi.fn(),
    },
  },
  storage: {
    onChanged: {
      addListener: vi.fn(),
    },
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
  declarativeNetRequest: {
    onRuleMatchedDebug: {
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
} as unknown as typeof chrome;

(globalThis as unknown as { chrome: typeof chrome }).chrome = chromeMock;

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

vi.mock('@/background/firewall-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/background/firewall-engine')>();
  actual.FirewallEngine.initialize = firewallMock.initialize;
  actual.FirewallEngine.toggleProtection = firewallMock.toggleProtection;
  actual.FirewallEngine.updateCurrentTabBadge = firewallMock.updateCurrentTabBadge;
  actual.FirewallEngine.checkPageForTrackers = firewallMock.checkPageForTrackers;
  actual.FirewallEngine.cleanup = firewallMock.cleanup;
  actual.FirewallEngine.clearTabTimer = firewallMock.clearTabTimer;
  return actual;
});

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
  backgroundEvents: {
    emit: vi.fn(),
  },
}));

vi.mock('@/utils/message-bus', () => ({
  messageBus: {
    initialize: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((type: MessageType, handler: Handler) => {
      messageHandlers.set(type, handler);
    }),
    broadcast: vi.fn(),
    send: vi.fn().mockResolvedValue({ success: true }),
    handlers: messageHandlers,
  },
}));

const getHandler = (type: MessageType): Handler => {
  const handler = ((messageBus as any).handlers as typeof messageHandlers).get(type);
  if (!handler) {
    throw new Error(`Handler for ${type} was not registered`);
  }
  return handler;
};

describe('settings integration flows', () => {
  let setThemeHandler: Handler;
  let setTelemetryHandler: Handler;
  let toggleProtectionHandler: Handler;
  let getAllSettingsHandler: Handler;
  let getStateHandler: Handler;

  beforeAll(async () => {
    await import('@/background/service-worker');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setThemeHandler = getHandler('SET_THEME');
    setTelemetryHandler = getHandler('SET_TELEMETRY_SETTING');
    toggleProtectionHandler = getHandler('TOGGLE_PROTECTION');
    getAllSettingsHandler = getHandler('GET_ALL_SETTINGS');
    getStateHandler = getHandler('GET_STATE');
  });

  it('completes theme round-trip and emits THEME_CHANGED', async () => {
    const result = await setThemeHandler({ theme: 'dark' });

    expect(result).toEqual({ success: true, theme: 'dark' });
    expect(Storage.setTheme).toHaveBeenCalledWith('dark');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'THEME_CHANGED', data: { theme: 'dark' } },
      expect.any(Function)
    );

    storageMock.get.mockResolvedValueOnce({
      ...baseStorageData,
      settings: { ...baseStorageData.settings, theme: 'dark' },
    });

    const settingsResult = await getAllSettingsHandler();
    expect(settingsResult).toEqual({
      success: true,
      settings: {
        theme: 'dark',
        burnerEmailEnabled: false,
        telemetryEnabled: false,
        realEmail: '',
      },
    });
  });

  it('completes telemetry round-trip and broadcasts STATE_UPDATE', async () => {
    const result = await setTelemetryHandler({ enabled: true });

    expect(result).toEqual({ success: true, enabled: true });
    expect(Storage.setTelemetryEnabled).toHaveBeenCalledWith(true);
    expect(messageBus.broadcast).toHaveBeenCalledWith('STATE_UPDATE');

    storageMock.get.mockResolvedValueOnce({
      ...baseStorageData,
      settings: { ...baseStorageData.settings, telemetryEnabled: true },
    });

    const settingsResult = await getAllSettingsHandler();
    expect(settingsResult).toEqual({
      success: true,
      settings: {
        theme: 'system',
        burnerEmailEnabled: false,
        telemetryEnabled: true,
        realEmail: '',
      },
    });
  });

  it('toggles protection and refreshes state data', async () => {
    const result = await toggleProtectionHandler();

    expect(result).toEqual({ success: true, enabled: true });
    expect(FirewallEngine.toggleProtection).toHaveBeenCalledTimes(1);
    expect(feedbackTelemetryService.trackEvent).toHaveBeenCalledWith({
      eventType: 'protection_toggled',
      eventData: { enabled: true },
    });

    storageMock.getFresh.mockResolvedValueOnce({
      ...baseStorageData,
      settings: { ...baseStorageData.settings, protectionEnabled: true },
    });

    const stateResult = await getStateHandler();
    expect(stateResult).toMatchObject({
      success: true,
      data: expect.objectContaining({
        settings: expect.objectContaining({ protectionEnabled: true }),
      }),
      falsePositiveStatuses: {},
    });
  });
});
