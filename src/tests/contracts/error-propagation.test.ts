/**
 * @file src/tests/contracts/error-propagation.test.ts
 *
 * Test Type: Integration
 * Contexts Tested: Error propagation across handlers and message bus
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageType } from '@/types';
import { messageBus } from '@/utils/message-bus';

type Handler = (data?: unknown, sender?: chrome.runtime.MessageSender) => Promise<unknown>;

const storageMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  setTheme: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue({ settings: { theme: 'system', burnerEmailEnabled: true, telemetryEnabled: false }, realEmail: '' }),
  getFresh: vi.fn().mockResolvedValue({ settings: { protectionEnabled: true } }),
  getBurnerEmailEnabled: vi.fn().mockResolvedValue(true),
  setBurnerEmailEnabled: vi.fn().mockResolvedValue(undefined),
}));

const burnerEmailMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  generateEmail: vi.fn().mockResolvedValue('generated@burner.test'),
  getEmails: vi.fn().mockResolvedValue([]),
  deleteEmail: vi.fn().mockResolvedValue(undefined),
}));

const telemetryMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  submitFeedback: vi.fn().mockResolvedValue({ success: true }),
  getInstallationId: vi.fn().mockResolvedValue('install-123'),
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

vi.mock('@/background/burner-email-service', () => ({
  burnerEmailService: burnerEmailMock,
}));

vi.mock('@/background/feedback-telemetry-service', () => ({
  feedbackTelemetryService: telemetryMock,
}));

vi.mock('@/background/privacy-score', () => ({
  PrivacyScoreManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/firewall-engine', () => ({
  FirewallEngine: {
    initialize: vi.fn().mockResolvedValue(undefined),
    setConsentRejectionProvider: vi.fn(),
    toggleProtection: vi.fn().mockResolvedValue(true),
    updateCurrentTabBadge: vi.fn().mockResolvedValue(undefined),
    checkPageForTrackers: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
    clearTabTimer: vi.fn(),
  },
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
  },
}));

vi.mock('@/utils/allowlist-manager', () => ({
  AllowlistManager: {
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

const getHandler = (type: MessageType): Handler => {
  const handlers = (messageBus as unknown as { handlers: Map<MessageType, Handler[]> }).handlers;
  const handlerList = handlers.get(type);
  if (!handlerList || handlerList.length === 0) {
    throw new Error(`Handler for ${type} was not registered`);
  }
  return handlerList[handlerList.length - 1];
};

describe('error propagation flows', () => {
  let setThemeHandler: Handler;
  let setBurnerEmailHandler: Handler;
  let generateBurnerEmailHandler: Handler;
  let submitFeedbackHandler: Handler;

  beforeAll(async () => {
    await import('@/background/service-worker');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setThemeHandler = getHandler('SET_THEME');
    setBurnerEmailHandler = getHandler('SET_BURNER_EMAIL_SETTING');
    generateBurnerEmailHandler = getHandler('GENERATE_BURNER_EMAIL');
    submitFeedbackHandler = getHandler('SUBMIT_FEEDBACK');
  });

  it('returns errors when theme persistence fails', async () => {
    storageMock.setTheme.mockRejectedValueOnce(new Error('storage failed'));
    const result = await setThemeHandler({ theme: 'dark' });
    expect(result).toEqual({ success: false, error: 'Failed to set theme' });
  });

  it('returns errors when burner email setting update fails', async () => {
    storageMock.setBurnerEmailEnabled.mockRejectedValueOnce(new Error('storage failed'));
    const result = await setBurnerEmailHandler({ enabled: true });
    expect(result).toEqual({ success: false, error: 'Failed to set burner email setting' });
  });

  it('returns service errors for burner email generation failures', async () => {
    burnerEmailMock.generateEmail.mockRejectedValueOnce(new Error('service down'));
    const result = await generateBurnerEmailHandler({ domain: 'example.com' });
    expect(result).toEqual({ success: false, error: 'service down' });
  });

  it('returns errors when feedback submission fails', async () => {
    telemetryMock.submitFeedback.mockRejectedValueOnce(new Error('telemetry down'));
    const result = await submitFeedbackHandler({
      feedbackText: 'Love the product',
      url: 'https://example.com',
      domain: 'example.com',
    });
    expect(result).toEqual({ success: false, error: 'Failed to submit feedback' });
  });

  it('rejects when runtime errors occur during message send', async () => {
    (chrome.runtime as unknown as { sendMessage: unknown }).sendMessage = vi.fn((...args: unknown[]) => {
      chrome.runtime.lastError = { message: 'runtime failure' };
      const maybeCallback = args[args.length - 1];
      if (typeof maybeCallback === 'function') {
        maybeCallback({ success: true });
      }
    });

    await expect(messageBus.send('GET_STATE')).rejects.toThrow('runtime failure');
  });
});
