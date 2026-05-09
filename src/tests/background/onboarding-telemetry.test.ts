/**
 * @file src/tests/background/onboarding-telemetry.test.ts
 *
 * Test Type: Integration
 * Contexts Tested: Background service worker onboarding telemetry handlers
 * Chrome APIs Mocked: chrome.runtime, chrome.storage, chrome.tabs, chrome.action
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageType } from '@/types';
import { messageBus } from '@/utils/message-bus';

type Handler = (data: unknown, sender?: chrome.runtime.MessageSender) => Promise<unknown>;

const messageHandlers = vi.hoisted(() => new Map<MessageType, Handler>());

const storageMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue({
    settings: { theme: 'system', burnerEmailEnabled: false, telemetryEnabled: false },
    alerts: [],
  }),
  getFresh: vi.fn().mockResolvedValue({
    settings: { theme: 'system', burnerEmailEnabled: false, telemetryEnabled: false },
    alerts: [],
  }),
  setOnboardingStep: vi.fn().mockResolvedValue({
    hasCompletedOnboarding: false,
    currentStep: 1,
    startedAt: 1000,
    stepTimings: [],
  }),
  completeOnboarding: vi.fn().mockResolvedValue({
    hasCompletedOnboarding: true,
    currentStep: 5,
    startedAt: 1000,
    completedAt: 2500,
    emailConfigured: true,
    stepTimings: [{ stepId: 'welcome', stepIndex: 0, enteredAt: 1000, exitedAt: 1500, durationMs: 500 }],
  }),
  skipOnboarding: vi.fn().mockResolvedValue({
    hasCompletedOnboarding: true,
    currentStep: 2,
    startedAt: 1000,
    skippedAt: 2200,
    stepTimings: [{ stepId: 'welcome', stepIndex: 0, enteredAt: 1000, exitedAt: 1500, durationMs: 500 }],
  }),
  addAlert: vi.fn().mockResolvedValue(undefined),
  clearAlerts: vi.fn().mockResolvedValue(undefined),
  ensureSaved: vi.fn().mockResolvedValue(undefined),
  getTelemetryEnabled: vi.fn().mockResolvedValue(false),
  getBurnerEmailEnabled: vi.fn().mockResolvedValue(false),
  getRealEmail: vi.fn().mockResolvedValue(null),
  setTelemetryEnabled: vi.fn().mockResolvedValue(undefined),
  setBurnerEmailEnabled: vi.fn().mockResolvedValue(undefined),
  setRealEmail: vi.fn().mockResolvedValue(undefined),
  setTheme: vi.fn().mockResolvedValue(undefined),
  recordComplianceScore: vi.fn().mockResolvedValue(undefined),
  getOnboardingState: vi.fn().mockResolvedValue({ hasCompletedOnboarding: false, currentStep: 0 }),
}));

const telemetryMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  getInstallationId: vi.fn().mockResolvedValue('install-123'),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  submitFeedback: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/background/storage', () => ({ Storage: storageMock }));
vi.mock('@/background/feedback-telemetry-service', () => ({ feedbackTelemetryService: telemetryMock }));

vi.mock('@/background/privacy-score', () => ({
  PrivacyScoreManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getCurrentCreditScore: vi.fn().mockResolvedValue(700),
  },
}));

vi.mock('@/background/burner-email-service', () => ({
  burnerEmailService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    generateEmail: vi.fn().mockResolvedValue('burner@privaseer.app'),
    getEmails: vi.fn().mockResolvedValue([]),
    deleteEmail: vi.fn().mockResolvedValue(undefined),
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
    on: vi.fn(),
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

vi.mock('@/background/firewall-engine', () => ({
  FirewallEngine: {
    initialize: vi.fn().mockResolvedValue(undefined),
    setConsentRejectionProvider: vi.fn(),
    toggleProtection: vi.fn().mockResolvedValue(true),
    getTrackerInfo: vi.fn().mockReturnValue({}),
    updateCurrentTabBadge: vi.fn().mockResolvedValue(undefined),
    checkPageForTrackers: vi.fn().mockResolvedValue(undefined),
    clearTabTimer: vi.fn(),
    handleBlockedRequest: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
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
  const handler = (messageBus as unknown as { handlers: Map<MessageType, Handler> }).handlers.get(type);
  if (!handler) {
    throw new Error(`Handler ${type} not registered`);
  }
  return handler;
};

describe('Service worker onboarding telemetry', () => {
  beforeAll(async () => {
    messageHandlers.clear();
    (globalThis as { chrome?: typeof chrome }).chrome = {
      runtime: {
        sendMessage: vi.fn((_message: unknown, callback?: () => void) => callback?.()),
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
        query: vi.fn().mockImplementation((_queryInfo, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
          callback?.([]);
          return Promise.resolve([]);
        }),
        sendMessage: vi.fn(),
        create: vi.fn(),
        onUpdated: { addListener: vi.fn() },
        onActivated: { addListener: vi.fn() },
      },
      storage: {
        onChanged: { addListener: vi.fn() },
        local: {
          get: vi.fn(),
          set: vi.fn(),
        },
      },
      declarativeNetRequest: {
        onRuleMatchedDebug: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('ok'),
      json: vi.fn().mockResolvedValue({}),
    }) as unknown as typeof fetch;

    await import('@/background/service-worker');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tracks step viewed and step completed when onboarding step changes', async () => {
    const handler = getHandler('SET_ONBOARDING_STEP');
    const result = await handler({
      step: 1,
      stepId: 'protection',
      previousStepId: 'welcome',
      enteredAt: 1200,
      exitedAt: 1200,
      durationMs: 200,
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
      })
    );
    expect(storageMock.setOnboardingStep).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ stepId: 'protection', previousStepId: 'welcome', durationMs: 200 })
    );
    expect(telemetryMock.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'onboarding_step_completed',
      })
    );
    expect(telemetryMock.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'onboarding_step_viewed',
      })
    );
  });

  it('tracks onboarding completion with aggregate metadata', async () => {
    const handler = getHandler('COMPLETE_ONBOARDING');
    await handler({ emailConfigured: true });

    expect(telemetryMock.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'onboarding_completed',
        eventData: expect.objectContaining({
          totalDurationMs: 1500,
          emailConfigured: true,
        }),
      })
    );
  });

  it('tracks onboarding abandonment when skip reason is abandoned', async () => {
    const handler = getHandler('SKIP_ONBOARDING');
    await handler({ atStep: 2, reason: 'abandoned' });

    expect(telemetryMock.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'onboarding_abandoned',
        eventData: expect.objectContaining({
          atStep: 2,
          reason: 'abandoned',
          totalDurationMs: 1200,
        }),
      })
    );
  });

  it('rejects non-boolean telemetry enabled values', async () => {
    const handler = getHandler('SET_TELEMETRY_SETTING');
    const result = await handler({ enabled: 'yes' });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Invalid enabled value',
      })
    );
    expect(storageMock.setTelemetryEnabled).not.toHaveBeenCalled();
  });
});
