/**
 * TEST FILE: Service Worker Message Validation Integration
 *
 * Test Type: Integration
 * Contexts Tested: Background Service Worker message bus
 * Chrome APIs Mocked: runtime, tabs, storage, action, declarativeNetRequest
 * Prerequisites:
 *   - service-worker.ts dependencies mocked (Storage, Telemetry, FirewallEngine, etc.)
 *
 * Coverage Target: SUBMIT_FEEDBACK, TRACK_EVENT, RECORD_COMPLIANCE_SCORE handlers
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageType } from '@/types';
import { Storage } from '@/background/storage';
import { feedbackTelemetryService } from '@/background/feedback-telemetry-service';
import { messageBus } from '@/utils/message-bus';

type Handler = (data: unknown, sender?: chrome.runtime.MessageSender) => Promise<unknown>;

const messageHandlers = vi.hoisted(
  () => new Map<MessageType, Handler>()
);

const storageData = vi.hoisted(() => ({
  settings: {
    protectionEnabled: true,
    showNotifications: true,
    theme: 'system' as const,
    burnerEmailEnabled: true,
    telemetryEnabled: false,
  },
  alerts: [],
  trackers: {},
  privacyScore: {
    current: 95,
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

const storageMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(storageData),
  getFresh: vi.fn().mockResolvedValue(storageData),
  addAlert: vi.fn().mockResolvedValue(undefined),
  clearAlerts: vi.fn().mockResolvedValue(undefined),
  toggleProtection: vi.fn().mockResolvedValue(true),
  getBurnerEmailEnabled: vi.fn().mockResolvedValue(true),
  setBurnerEmailEnabled: vi.fn().mockResolvedValue(undefined),
  setTelemetryEnabled: vi.fn().mockResolvedValue(undefined),
  getTelemetryEnabled: vi.fn().mockResolvedValue(storageData.settings.telemetryEnabled),
  setTheme: vi.fn().mockResolvedValue(undefined),
  getRealEmail: vi.fn().mockResolvedValue(''),
  setRealEmail: vi.fn().mockResolvedValue(undefined),
  recordComplianceScore: vi.fn().mockResolvedValue(undefined),
  ensureSaved: vi.fn().mockResolvedValue(undefined),
  setTelemetryOptIn: vi.fn().mockResolvedValue(undefined),
}));

const telemetryMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  submitFeedback: vi.fn().mockResolvedValue({ success: true }),
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

const chromeMock = {
  runtime: {
    sendMessage: vi
      .fn()
      .mockImplementation((...args: unknown[]) => {
        const callback = typeof args[1] === 'function' ? (args[1] as (resp: unknown) => void) : undefined;
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
    getURL: vi.fn(),
    lastError: undefined,
  },
  tabs: {
    query: vi.fn().mockImplementation((_query: unknown, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
      callback?.([]);
      return Promise.resolve([]);
    }),
    sendMessage: vi
      .fn()
      .mockImplementation(
        (_tabId: number, _message: unknown, callback?: (response: unknown) => void) => {
          callback?.({ success: true });
          return Promise.resolve({ success: true });
        }
      ),
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

vi.mock('@/background/firewall-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/background/firewall-engine')>();
  actual.FirewallEngine.initialize = vi.fn().mockResolvedValue(undefined);
  actual.FirewallEngine.toggleProtection = vi.fn().mockResolvedValue(true);
  actual.FirewallEngine.updateCurrentTabBadge = vi.fn().mockResolvedValue(undefined);
  actual.FirewallEngine.checkPageForTrackers = vi.fn().mockResolvedValue(undefined);
  actual.FirewallEngine.handleBlockedRequest = vi.fn().mockResolvedValue(undefined);
  actual.FirewallEngine.cleanup = vi.fn();
  actual.FirewallEngine.clearTabTimer = vi.fn();
  return actual;
});

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

describe('Service worker message validation handlers', () => {
  let submitFeedbackHandler: Handler;
  let trackEventHandler: Handler;
  let recordComplianceHandler: Handler;

  beforeAll(async () => {
    await import('@/background/service-worker');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    submitFeedbackHandler = getHandler('SUBMIT_FEEDBACK');
    trackEventHandler = getHandler('TRACK_EVENT');
    recordComplianceHandler = getHandler('RECORD_COMPLIANCE_SCORE');
  });

  describe('SUBMIT_FEEDBACK handler', () => {
    it('accepts valid payloads and passes sanitized data to telemetry service', async () => {
      const result = await submitFeedbackHandler({
        feedbackText: '  Love the privacy insights ',
        url: 'https://example.com/profile?tracking=1#hash',
        domain: ' Example.com ',
      });

      expect(result).toEqual({ success: true });
      expect(feedbackTelemetryService.submitFeedback).toHaveBeenCalledWith({
        feedbackText: 'Love the privacy insights',
        url: 'https://example.com/profile',
        domain: 'example.com',
      });
    });

    it('rejects invalid payloads and surfaces validation errors', async () => {
      const result = await submitFeedbackHandler({ feedbackText: '   ' });

      expect(result).toEqual({
        success: false,
        error: 'feedbackText cannot be empty',
      });
      expect(feedbackTelemetryService.submitFeedback).not.toHaveBeenCalled();
    });
  });

  describe('TRACK_EVENT handler', () => {
    it('accepts valid events and forwards sanitized payloads', async () => {
      const result = await trackEventHandler({
        eventType: '  click  ',
        eventData: { nested: { value: 1 } },
      });

      expect(result).toEqual({ success: true });
      expect(feedbackTelemetryService.trackEvent).toHaveBeenCalledWith({
        eventType: 'click',
        eventData: { nested: { value: 1 } },
      });
    });

    it('fails gracefully when payload validation fails', async () => {
      const result = await trackEventHandler({
        eventType: 'test',
        eventData: 'invalid-data',
      });

      expect(result).toEqual({
        success: false,
        error: 'eventData must be a plain object',
      });
      expect(feedbackTelemetryService.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe('RECORD_COMPLIANCE_SCORE handler', () => {
    it('persists valid scores', async () => {
      const result = await recordComplianceHandler({ score: 88 });

      expect(result).toEqual({ success: true });
      expect(Storage.recordComplianceScore).toHaveBeenCalledWith(88);
    });

    it('rejects scores outside the allowed range', async () => {
      const result = await recordComplianceHandler({ score: 150 });

      expect(result).toEqual({
        success: false,
        error: 'score must be between 0 and 100',
      });
      expect(Storage.recordComplianceScore).not.toHaveBeenCalled();
    });
  });
});
