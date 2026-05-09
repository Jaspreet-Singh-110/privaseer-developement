/**
 * @file src/tests/background/service-worker-settings-handlers.test.ts
 *
 * Test Type: Integration
 * Contexts Tested: Background service worker message handlers
 * Chrome APIs Mocked: chrome.runtime, chrome.storage, chrome.tabs, chrome.action
 * Prerequisites: None
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageType } from '@/types';
import { messageBus } from '@/utils/message-bus';
import { Storage } from '@/background/storage';

type Handler = (data: unknown, sender?: chrome.runtime.MessageSender) => Promise<unknown>;

const messageHandlers = vi.hoisted(() => new Map<MessageType, Handler>());

const storageMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue({
    settings: { theme: 'system', burnerEmailEnabled: false, telemetryEnabled: false },
    realEmail: null,
    alerts: [],
  }),
  getFresh: vi.fn().mockResolvedValue({
    settings: { theme: 'system', burnerEmailEnabled: false, telemetryEnabled: false },
    alerts: [],
  }),
  setTheme: vi.fn().mockResolvedValue(undefined),
  getBurnerEmailEnabled: vi.fn().mockResolvedValue(false),
  setBurnerEmailEnabled: vi.fn().mockResolvedValue(undefined),
  getTelemetryEnabled: vi.fn().mockResolvedValue(false),
  setTelemetryEnabled: vi.fn().mockResolvedValue(undefined),
  getRealEmail: vi.fn().mockResolvedValue(null),
  setRealEmail: vi.fn().mockResolvedValue(undefined),
  recordComplianceScore: vi.fn().mockResolvedValue(undefined),
  getOnboardingState: vi.fn().mockResolvedValue({ hasCompletedOnboarding: false, currentStep: 0 }),
  setOnboardingStep: vi.fn().mockResolvedValue({ hasCompletedOnboarding: false, currentStep: 2 }),
  completeOnboarding: vi.fn().mockResolvedValue({ hasCompletedOnboarding: true, currentStep: 5 }),
  skipOnboarding: vi.fn().mockResolvedValue({ hasCompletedOnboarding: false, currentStep: 3 }),
  addAlert: vi.fn().mockResolvedValue(undefined),
  clearAlerts: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  ensureSaved: vi.fn().mockResolvedValue(undefined),
}));

const telemetryMock = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  getInstallationId: vi.fn().mockResolvedValue('install-123'),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  submitFeedback: vi.fn().mockResolvedValue({ success: true }),
}));

const metricsAggregationMock = vi.hoisted(() => ({
  aggregateMetrics: vi.fn().mockResolvedValue({
    period: 'week',
    totalTrackersBlocked: 10,
    trackersByCategory: { advertising: 6, analytics: 4 },
    averagePrivacyScore: 88,
    averageComplianceScore: 91,
    cleanSitesVisited: 5,
    nonCompliantSites: 1,
    burnerEmailsGenerated: 2,
    burnerEmailsForwarded: 1,
    topBlockedDomains: [{ domain: 'tracker.com', count: 5 }],
  }),
  getPrivacyScoreTrend: vi.fn().mockResolvedValue([{ date: '2026-03-01', score: 88 }]),
}));

const dataExportMock = vi.hoisted(() => ({
  exportData: vi.fn().mockResolvedValue({
    format: 'json',
    filename: 'privaseer-data-export-2026-03-05.json',
    mimeType: 'application/json',
    content: '{"ok":true}',
  }),
}));

const resetHoistedMocks = (): void => {
  Object.values(storageMock).forEach(value => {
    if (typeof value === 'function' && 'mockReset' in value) {
      value.mockReset();
    }
  });
  Object.values(telemetryMock).forEach(value => {
    if (typeof value === 'function' && 'mockReset' in value) {
      value.mockReset();
    }
  });

  storageMock.initialize.mockResolvedValue(undefined);
  storageMock.get.mockResolvedValue({
    settings: { theme: 'system', burnerEmailEnabled: false, telemetryEnabled: false },
    realEmail: null,
    alerts: [],
  });
  storageMock.getFresh.mockResolvedValue({
    settings: { theme: 'system', burnerEmailEnabled: false, telemetryEnabled: false },
    alerts: [],
  });
  storageMock.setTheme.mockResolvedValue(undefined);
  storageMock.getBurnerEmailEnabled.mockResolvedValue(false);
  storageMock.setBurnerEmailEnabled.mockResolvedValue(undefined);
  storageMock.getTelemetryEnabled.mockResolvedValue(false);
  storageMock.setTelemetryEnabled.mockResolvedValue(undefined);
  storageMock.getRealEmail.mockResolvedValue(null);
  storageMock.setRealEmail.mockResolvedValue(undefined);
  storageMock.recordComplianceScore.mockResolvedValue(undefined);
  storageMock.getOnboardingState.mockResolvedValue({ hasCompletedOnboarding: false, currentStep: 0 });
  storageMock.setOnboardingStep.mockResolvedValue({ hasCompletedOnboarding: false, currentStep: 2 });
  storageMock.completeOnboarding.mockResolvedValue({ hasCompletedOnboarding: true, currentStep: 5 });
  storageMock.skipOnboarding.mockResolvedValue({ hasCompletedOnboarding: false, currentStep: 3 });
  storageMock.addAlert.mockResolvedValue(undefined);
  storageMock.clearAlerts.mockResolvedValue(undefined);
  storageMock.clear.mockResolvedValue(undefined);
  storageMock.ensureSaved.mockResolvedValue(undefined);

  telemetryMock.initialize.mockResolvedValue(undefined);
  telemetryMock.getInstallationId.mockResolvedValue('install-123');
  telemetryMock.trackEvent.mockResolvedValue(undefined);
  telemetryMock.submitFeedback.mockResolvedValue({ success: true });
  metricsAggregationMock.aggregateMetrics.mockResolvedValue({
    period: 'week',
    totalTrackersBlocked: 10,
    trackersByCategory: { advertising: 6, analytics: 4 },
    averagePrivacyScore: 88,
    averageComplianceScore: 91,
    cleanSitesVisited: 5,
    nonCompliantSites: 1,
    burnerEmailsGenerated: 2,
    burnerEmailsForwarded: 1,
    topBlockedDomains: [{ domain: 'tracker.com', count: 5 }],
  });
  metricsAggregationMock.getPrivacyScoreTrend.mockResolvedValue([{ date: '2026-03-01', score: 88 }]);
  dataExportMock.exportData.mockResolvedValue({
    format: 'json',
    filename: 'privaseer-data-export-2026-03-05.json',
    mimeType: 'application/json',
    content: '{"ok":true}',
  });
};

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/background/storage', () => ({
  Storage: storageMock,
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
    generateEmail: vi.fn().mockResolvedValue('burner@privaseer.app'),
    getEmails: vi.fn().mockResolvedValue([]),
    deleteEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/feedback-telemetry-service', () => ({
  feedbackTelemetryService: telemetryMock,
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

vi.mock('@/background/metrics-aggregation', () => ({
  MetricsAggregationService: metricsAggregationMock,
}));

vi.mock('@/background/data-export-service', () => ({
  DataExportService: dataExportMock,
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

describe('Service worker settings handlers', () => {
  beforeAll(async () => {
    messageHandlers.clear();
    (globalThis as { chrome?: typeof chrome }).chrome = {
      runtime: {
        sendMessage: vi.fn((_message: unknown, callback?: () => void) => {
          callback?.();
        }),
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
    }) as unknown as typeof fetch;

    await import('@/background/service-worker');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetHoistedMocks();
  });

  it('SET_THEME accepts valid theme and notifies runtime', async () => {
    const handler = getHandler('SET_THEME');
    const result = await handler({ theme: 'dark' });

    expect(result).toEqual({ success: true, theme: 'dark' });
    expect(Storage.setTheme).toHaveBeenCalledWith('dark');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'THEME_CHANGED',
        data: { theme: 'dark' },
      }),
      expect.any(Function)
    );
  });

  it('SET_THEME rejects invalid theme payload', async () => {
    const handler = getHandler('SET_THEME');
    const result = await handler({ theme: 'blue' });

    expect(result).toEqual({ success: false, error: 'Invalid theme value' });
    expect(Storage.setTheme).not.toHaveBeenCalled();
  });

  it('GET_ALL_SETTINGS returns failure when Storage.get throws', async () => {
    storageMock.get.mockRejectedValueOnce(new Error('storage read failure'));
    const handler = getHandler('GET_ALL_SETTINGS');
    const result = await handler({});

    expect(result).toEqual({ success: false, error: 'Failed to get settings' });
  });

  it('GET_BURNER_EMAIL_SETTING returns failure when read throws', async () => {
    storageMock.getBurnerEmailEnabled.mockRejectedValueOnce(new Error('read failed'));
    const handler = getHandler('GET_BURNER_EMAIL_SETTING');
    const result = await handler({});

    expect(result).toEqual({ success: false, error: 'Failed to get burner email setting' });
  });

  it('SET_TELEMETRY_SETTING broadcasts state update on success', async () => {
    const handler = getHandler('SET_TELEMETRY_SETTING');
    const result = await handler({ enabled: true });

    expect(result).toEqual({ success: true, enabled: true });
    expect(Storage.getTelemetryEnabled).toHaveBeenCalledTimes(1);
    expect(Storage.setTelemetryEnabled).toHaveBeenCalledWith(true);
    expect(messageBus.broadcast).toHaveBeenCalledWith('STATE_UPDATE');
  });

  it('SET_TELEMETRY_SETTING rejects non-boolean payload', async () => {
    const handler = getHandler('SET_TELEMETRY_SETTING');
    const result = await handler({ enabled: 'yes' });

    expect(result).toEqual({ success: false, error: 'Invalid enabled value' });
    expect(Storage.setTelemetryEnabled).not.toHaveBeenCalled();
  });

  it('GET_TELEMETRY_SETTING returns failure when read throws', async () => {
    storageMock.getTelemetryEnabled.mockRejectedValueOnce(new Error('telemetry read failed'));
    const handler = getHandler('GET_TELEMETRY_SETTING');
    const result = await handler({});

    expect(result).toEqual({ success: false, error: 'Failed to get telemetry setting' });
  });

  it('GET_REAL_EMAIL returns failure when read throws', async () => {
    storageMock.getRealEmail.mockRejectedValueOnce(new Error('real email read failed'));
    const handler = getHandler('GET_REAL_EMAIL');
    const result = await handler({});

    expect(result).toEqual({ success: false, error: 'Failed to get real email' });
  });

  it('SET_REAL_EMAIL rejects empty email value', async () => {
    const handler = getHandler('SET_REAL_EMAIL');
    const result = await handler({ email: '  ' });

    expect(result).toEqual({ success: false, error: 'Invalid email value' });
    expect(Storage.setRealEmail).not.toHaveBeenCalled();
  });

  it('SET_REAL_EMAIL returns thrown error message when save fails', async () => {
    storageMock.getBurnerEmailEnabled.mockResolvedValueOnce(true);
    storageMock.setRealEmail.mockRejectedValueOnce(new Error('save failed'));
    const handler = getHandler('SET_REAL_EMAIL');
    const result = await handler({ email: 'user@example.com' });

    expect(result).toEqual({ success: false, error: 'save failed' });
  });

  it('TRACK_EVENT returns failure when telemetry throws', async () => {
    telemetryMock.trackEvent.mockRejectedValueOnce(new Error('telemetry outage'));
    const handler = getHandler('TRACK_EVENT');
    const result = await handler({ eventType: 'popup_opened', eventData: { source: 'popup' } });

    expect(result).toEqual({ success: false, error: 'Failed to track event' });
  });

  it('RECORD_COMPLIANCE_SCORE stores score when payload is valid', async () => {
    const handler = getHandler('RECORD_COMPLIANCE_SCORE');
    const result = await handler({ score: 91 });

    expect(result).toEqual({ success: true });
    expect(Storage.recordComplianceScore).toHaveBeenCalledWith(91);
  });

  it('GET_ONBOARDING_STATE returns onboarding object', async () => {
    storageMock.getOnboardingState.mockResolvedValueOnce({ hasCompletedOnboarding: false, currentStep: 1 });
    const handler = getHandler('GET_ONBOARDING_STATE');
    const result = await handler({});

    expect(result).toEqual({
      success: true,
      onboarding: { hasCompletedOnboarding: false, currentStep: 1 },
    });
  });

  it('GET_METRICS_AGGREGATION returns aggregated data for a requested period', async () => {
    const handler = getHandler('GET_METRICS_AGGREGATION');
    const result = await handler({ period: 'month' });

    expect(result).toEqual({
      success: true,
      aggregation: expect.objectContaining({
        totalTrackersBlocked: 10,
      }),
    });
    expect(metricsAggregationMock.aggregateMetrics).toHaveBeenCalledWith('month');
  });

  it('GET_PRIVACY_SCORE_TREND returns trend points', async () => {
    const handler = getHandler('GET_PRIVACY_SCORE_TREND');
    const result = await handler({});

    expect(result).toEqual({
      success: true,
      trend: [{ date: '2026-03-01', score: 88 }],
    });
    expect(metricsAggregationMock.getPrivacyScoreTrend).toHaveBeenCalledTimes(1);
  });

  it('EXPORT_USER_DATA forwards requested format and includeEmail flag', async () => {
    const handler = getHandler('EXPORT_USER_DATA');
    const result = await handler({ format: 'csv', includeEmail: true });

    expect(dataExportMock.exportData).toHaveBeenCalledWith('csv', true);
    expect(result).toEqual({
      success: true,
      exportData: {
        format: 'json',
        filename: 'privaseer-data-export-2026-03-05.json',
        mimeType: 'application/json',
        content: '{"ok":true}',
      },
    });
  });

  it('DELETE_ALL_DATA clears storage and broadcasts state update', async () => {
    const handler = getHandler('DELETE_ALL_DATA');
    const result = await handler({});

    expect(result).toEqual({ success: true });
    expect(Storage.clear).toHaveBeenCalledTimes(1);
    expect(messageBus.broadcast).toHaveBeenCalledWith('STATE_UPDATE');
  });

  it('SET_ONBOARDING_STEP returns failure when storage write throws', async () => {
    storageMock.setOnboardingStep.mockRejectedValueOnce(new Error('write failed'));
    const handler = getHandler('SET_ONBOARDING_STEP');
    const result = await handler({ step: 2 });

    expect(result).toEqual({ success: false, error: 'Failed to set onboarding step' });
  });

  it('COMPLETE_ONBOARDING delegates optional emailConfigured value', async () => {
    const handler = getHandler('COMPLETE_ONBOARDING');
    const result = await handler({ emailConfigured: true });

    expect(result).toEqual({ success: true, onboarding: { hasCompletedOnboarding: true, currentStep: 5 } });
    expect(Storage.completeOnboarding).toHaveBeenCalledWith(true);
  });

  it('SKIP_ONBOARDING returns failure when storage write throws', async () => {
    storageMock.skipOnboarding.mockRejectedValueOnce(new Error('skip failed'));
    const handler = getHandler('SKIP_ONBOARDING');
    const result = await handler({ atStep: 3 });

    expect(result).toEqual({ success: false, error: 'Failed to skip onboarding' });
  });
});
