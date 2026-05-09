/**
 * @file src/tests/contracts/alert-flow-integration.test.ts
 *
 * Test Type: Integration
 * Contexts Tested: Alert flow and false-positive reporting
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageType } from '@/types';
import { Storage } from '@/background/storage';
import { FirewallEngine } from '@/background/firewall-engine';
import { AllowlistManager } from '@/utils/allowlist-manager';
import { FalsePositiveService } from '@/background/false-positive-service';
import { feedbackTelemetryService } from '@/background/feedback-telemetry-service';
import { messageBus } from '@/utils/message-bus';

type Handler = (data?: unknown, sender?: chrome.runtime.MessageSender) => Promise<unknown>;

const messageHandlers = vi.hoisted(() => new Map<MessageType, Handler>());

const storageMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  addAlert: vi.fn().mockResolvedValue(undefined),
  getFresh: vi.fn().mockResolvedValue({
    alerts: [],
    reportedFalsePositives: {},
  }),
  getDomainOccurrence: vi.fn().mockResolvedValue(0),
  incrementDomainOccurrence: vi.fn().mockResolvedValue(1),
  clearAlerts: vi.fn().mockResolvedValue(undefined),
  getBurnerEmailEnabled: vi.fn().mockResolvedValue(true),
  getReportedFalsePositive: vi.fn().mockResolvedValue(null),
  setReportedFalsePositive: vi.fn().mockResolvedValue(undefined),
}));

const telemetryMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  getInstallationId: vi.fn().mockResolvedValue('install-123'),
}));

const burnerEmailMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
}));

const tabManagerMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  incrementBlockCount: vi.fn(),
  cleanup: vi.fn(),
  resetBlockCount: vi.fn(),
}));

const allowlistMock = vi.hoisted(() => ({
  addEntry: vi.fn().mockResolvedValue(undefined),
  removeEntry: vi.fn().mockResolvedValue(undefined),
  getEntries: vi.fn().mockResolvedValue([]),
}));

const falsePositiveMock = vi.hoisted(() => ({
  reportFalsePositive: vi.fn().mockResolvedValue({
    success: true,
    aggregation: {
      reportCount: 3,
      overrideThreshold: 86,
      shouldOverride: true,
    },
  }),
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
    get: vi.fn().mockResolvedValue({ url: 'https://site.example' }),
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
  actual.FirewallEngine.initialize = vi.fn().mockResolvedValue(undefined);
  actual.FirewallEngine.updateCurrentTabBadge = vi.fn().mockResolvedValue(undefined);
  actual.FirewallEngine.checkPageForTrackers = vi.fn().mockResolvedValue(undefined);
  actual.FirewallEngine.cleanup = vi.fn();
  actual.FirewallEngine.clearTabTimer = vi.fn();
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

vi.mock('@/utils/allowlist-manager', () => ({
  AllowlistManager: allowlistMock,
}));

vi.mock('@/background/false-positive-service', () => ({
  FalsePositiveService: falsePositiveMock,
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

describe('alert flow integration', () => {
  let clearAlertsHandler: Handler;
  let reportFalsePositiveHandler: Handler;

  beforeAll(async () => {
    await import('@/background/service-worker');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearAlertsHandler = getHandler('CLEAR_ALERTS');
    reportFalsePositiveHandler = getHandler('REPORT_FALSE_POSITIVE');
  });

  afterEach(() => {
    FirewallEngine.clearTabTimer(1);
    vi.useRealTimers();
  });

  it('creates tracker alerts and notifies popup', async () => {
    vi.useFakeTimers();

    await FirewallEngine.handleBlockedRequest('https://tracker.example/script.js', 1);

    expect(Storage.addAlert).toHaveBeenCalledTimes(1);
    const alertPayload = (Storage.addAlert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(alertPayload.message).toContain('Blocked');
    expect(alertPayload.domain).toBe('site.example');
    expect(messageBus.broadcast).toHaveBeenCalledWith('STATE_UPDATE');
  });

  it('clears alerts via message handler', async () => {
    const result = await clearAlertsHandler();
    expect(result).toEqual({ success: true });
    expect(Storage.clearAlerts).toHaveBeenCalledTimes(1);
  });

  it('reports false positives and adds to allowlist', async () => {
    const result = await reportFalsePositiveHandler({
      domain: 'example.com',
      url: 'https://example.com',
      detectedPatterns: ['forcedConsent'],
      reason: 'wrong_detection',
      timestamp: Date.now(),
      installationId: 'install-123',
      scanConfidence: 0.5,
    });

    expect(result).toEqual({
      success: true,
      reportCount: 3,
      alreadyOverridden: true,
    });
    expect(FalsePositiveService.reportFalsePositive).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'example.com' })
    );
    expect(AllowlistManager.addEntry).toHaveBeenCalledWith('example.com', 'user');
    expect(feedbackTelemetryService.getInstallationId).not.toHaveBeenCalled();
  });
});
