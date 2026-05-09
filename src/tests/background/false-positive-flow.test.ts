import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FalsePositiveReport } from '@/types';
import { FalsePositiveService } from '@/background/false-positive-service';
import { AllowlistManager } from '@/utils/allowlist-manager';
import { feedbackTelemetryService } from '@/background/feedback-telemetry-service';
import { logger } from '@/utils/logger';

const messageHandlers = vi.hoisted(
  () => new Map<string, (data: unknown) => Promise<unknown>>()
);

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/background/false-positive-service', () => ({
  FalsePositiveService: {
    reportFalsePositive: vi.fn().mockResolvedValue({
      success: true,
      aggregation: {
        reportCount: 3,
        overrideThreshold: 88,
        shouldOverride: true,
      },
    }),
  },
}));

vi.mock('@/utils/allowlist-manager', () => ({
  AllowlistManager: {
    addEntry: vi.fn().mockResolvedValue(undefined),
    getEntries: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/background/feedback-telemetry-service', () => ({
  feedbackTelemetryService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getInstallationId: vi.fn().mockResolvedValue('install-123'),
    trackEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/storage', () => ({
  Storage: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getFresh: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({ alerts: [], settings: { telemetryEnabled: false } }),
    clearAlerts: vi.fn().mockResolvedValue(undefined),
    getReportedFalsePositive: vi.fn().mockResolvedValue(null),
    setReportedFalsePositive: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/firewall-engine', () => ({
  FirewallEngine: {
    initialize: vi.fn().mockResolvedValue(undefined),
    setConsentRejectionProvider: vi.fn(),
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
  },
}));

vi.mock('@/utils/tab-manager', () => ({
  tabManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/utils/message-bus', () => ({
  messageBus: {
    initialize: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((type: string, handler: (data: unknown) => Promise<unknown>) => {
      messageHandlers.set(type, handler);
    }),
    broadcast: vi.fn(),
  },
}));

describe('False positive reporting flow', () => {
  beforeAll(async () => {
    (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onSuspend: { addListener: vi.fn() },
      },
      action: {
        setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
        onClicked: { addListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([]),
        onUpdated: { addListener: vi.fn() },
        onActivated: { addListener: vi.fn() },
        onRemoved: { addListener: vi.fn() },
      },
      declarativeNetRequest: {
        onRuleMatchedDebug: { addListener: vi.fn() },
      },
      storage: {
        onChanged: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome;

    await import('@/background/service-worker');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports false positives and adds allowlist entry', async () => {
    const handler = messageHandlers.get('REPORT_FALSE_POSITIVE');
    expect(handler).toBeDefined();

    const payload: FalsePositiveReport = {
      domain: 'example.com',
      url: 'https://example.com',
      detectedPatterns: ['forcedConsent'],
      reason: 'wrong_detection',
      timestamp: Date.now(),
      installationId: '',
      scanConfidence: 80,
    };

    const response = await handler!(payload);
    expect(response).toEqual({
      success: true,
      reportCount: 3,
      alreadyOverridden: true,
    });
    expect(FalsePositiveService.reportFalsePositive).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'example.com',
        installationId: 'install-123',
      })
    );
  });

  it('returns error when false positive report submission fails', async () => {
    vi.mocked(FalsePositiveService.reportFalsePositive).mockRejectedValueOnce(new Error('submit failed'));
    const handler = messageHandlers.get('REPORT_FALSE_POSITIVE');

    const response = await handler!({
      domain: 'example.com',
      url: 'https://example.com',
      detectedPatterns: ['forcedConsent'],
      reason: 'wrong_detection',
      timestamp: Date.now(),
      installationId: '',
      scanConfidence: 80,
    } satisfies FalsePositiveReport);

    expect(response).toEqual({ success: false, error: 'Failed to report false positive' });
    expect(logger.error).toHaveBeenCalledWith(
      'ServiceWorker',
      'Failed to report false positive',
      expect.any(Error)
    );
    expect(AllowlistManager.addEntry).not.toHaveBeenCalled();
  });

  it('returns error when allowlist update fails', async () => {
    vi.mocked(FalsePositiveService.reportFalsePositive).mockResolvedValueOnce({
      success: true,
      aggregation: {
        reportCount: 3,
        overrideThreshold: 88,
        shouldOverride: true,
      },
    });
    vi.mocked(AllowlistManager.addEntry).mockRejectedValueOnce(new Error('allowlist failed'));
    const handler = messageHandlers.get('REPORT_FALSE_POSITIVE');

    const response = await handler!({
      domain: 'example.com',
      url: 'https://example.com',
      detectedPatterns: ['forcedConsent'],
      reason: 'wrong_detection',
      timestamp: Date.now(),
      installationId: '',
      scanConfidence: 80,
    } satisfies FalsePositiveReport);

    expect(response).toEqual({ success: false, error: 'Failed to report false positive' });
    expect(FalsePositiveService.reportFalsePositive).toHaveBeenCalledTimes(1);
    expect(AllowlistManager.addEntry).toHaveBeenCalledWith('example.com', 'user');
    expect(logger.error).toHaveBeenCalledWith(
      'ServiceWorker',
      'Failed to report false positive',
      expect.any(Error)
    );
  });

  it('uses telemetry installation id fallback when payload installation id is missing', async () => {
    vi.mocked(feedbackTelemetryService.getInstallationId).mockResolvedValueOnce('install-fallback-42');
    const handler = messageHandlers.get('REPORT_FALSE_POSITIVE');

    await handler!({
      domain: 'example.com',
      url: 'https://example.com',
      detectedPatterns: ['forcedConsent'],
      reason: 'wrong_detection',
      timestamp: Date.now(),
      installationId: '',
      scanConfidence: 80,
    } satisfies FalsePositiveReport);

    expect(feedbackTelemetryService.getInstallationId).toHaveBeenCalledTimes(1);
    expect(FalsePositiveService.reportFalsePositive).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 'install-fallback-42',
      })
    );
  });

  it('short-circuits when domain was already reported locally', async () => {
    const { Storage } = await import('@/background/storage');
    vi.mocked(Storage.getReportedFalsePositive).mockResolvedValueOnce({
      timestamp: Date.now(),
      reason: 'wrong_detection',
    });

    const handler = messageHandlers.get('REPORT_FALSE_POSITIVE');
    const response = await handler!({
      domain: 'example.com',
      url: 'https://example.com',
      detectedPatterns: ['forcedConsent'],
      reason: 'wrong_detection',
      timestamp: Date.now(),
      installationId: '',
      scanConfidence: 80,
    } satisfies FalsePositiveReport);

    expect(response).toEqual({
      success: false,
      alreadyReported: true,
      reportCount: 3,
    });
    expect(FalsePositiveService.reportFalsePositive).not.toHaveBeenCalled();
    expect(AllowlistManager.addEntry).not.toHaveBeenCalled();
  });
});
