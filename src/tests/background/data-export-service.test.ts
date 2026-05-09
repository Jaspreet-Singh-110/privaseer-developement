/**
 * @file src/tests/background/data-export-service.test.ts
 *
 * Test Type: Unit
 * Contexts Tested: Background export formatting and sanitization
 * Chrome APIs Mocked: None
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataExportService } from '@/background/data-export-service';
import type { StorageData } from '@/types';

const aggregateMetricsMock = vi.hoisted(() => vi.fn());

vi.mock('@/background/metrics-aggregation', () => ({
  MetricsAggregationService: {
    aggregateMetrics: aggregateMetricsMock,
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

function createStorageData(overrides: Partial<StorageData> = {}): StorageData {
  return {
    privacyScore: {
      current: 90,
      daily: { trackersBlocked: 2, cleanSitesVisited: 1, nonCompliantSites: 0 },
      history: [],
    },
    creditScore: {
      score: 650,
      label: 'Good',
      trend: 'stable',
      formulaVersion: '1.0',
      factors: {
        protectionConsistency: { value: 0.8, impact: 60 },
        cleanBrowsing: { value: 0.7, impact: 40 },
        highRiskExposure: { value: 0.2, impact: -20 },
        violations: { value: 0.1, impact: -10 },
      },
      lastCalculated: 0,
    },
    dailyCreditMetrics: [],
    alerts: [
      {
        id: 'a-1',
        type: 'non_compliant_site',
        severity: 'medium',
        message: 'Example alert',
        domain: 'example.com',
        timestamp: 1,
        url: 'https://example.com/path?utm_source=test#fragment',
      },
    ],
    trackers: {},
    settings: {
      protectionEnabled: true,
      showNotifications: true,
      theme: 'system',
      burnerEmailEnabled: false,
      telemetryEnabled: false,
    },
    lastReset: Date.now(),
    penalizedDomains: {},
    consentStates: {},
    allowlist: {},
    reportedFalsePositives: {},
    domainOccurrences: {},
    dailySnapshots: [
      {
        date: '2026-03-01',
        privacyScore: 90,
        trackersBlocked: 2,
        trackersByCategory: { advertising: 2 },
        cleanSitesVisited: 1,
        nonCompliantSites: 0,
        complianceScores: [95],
        burnerEmailsGenerated: 0,
        burnerEmailsForwarded: 0,
      },
    ],
    burnerEmailStats: {
      generated: 0,
      forwarded: 0,
    },
    complianceScores: [95],
    realEmail: 'person@example.com',
    onboarding: {
      hasCompletedOnboarding: true,
      currentStep: 5,
    },
    ...overrides,
  };
}

const aggregationResponse = {
  period: 'week' as const,
  totalTrackersBlocked: 10,
  trackersByCategory: { advertising: 5, analytics: 5 },
  averagePrivacyScore: 88,
  averageComplianceScore: 90,
  cleanSitesVisited: 4,
  nonCompliantSites: 1,
  burnerEmailsGenerated: 2,
  burnerEmailsForwarded: 1,
  topBlockedDomains: [{ domain: 'tracker.com', count: 5 }],
};

describe('DataExportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggregateMetricsMock.mockResolvedValue(aggregationResponse);
  });

  it('builds GDPR-enhanced JSON export and excludes email by default', async () => {
    const result = await DataExportService.buildExport(createStorageData(), 'json', false);
    const payload = JSON.parse(result.content) as {
      gdpr: { legalBasis: string };
      data: { realEmail?: string; alerts: Array<{ url?: string }> };
      version: string;
    };

    expect(result.format).toBe('json');
    expect(result.mimeType).toBe('application/json');
    expect(result.filename.endsWith('.json')).toBe(true);
    expect(payload.version).toBe('2.0');
    expect(payload.gdpr.legalBasis).toContain('GDPR');
    expect(payload.data.realEmail).toBeUndefined();
    expect(payload.data.alerts[0]?.url).toBe('https://example.com/path');
  });

  it('includes email only when explicitly requested', async () => {
    const result = await DataExportService.buildExport(createStorageData(), 'json', true);
    const payload = JSON.parse(result.content) as {
      data: { realEmail?: string | null };
    };

    expect(payload.data.realEmail).toBe('person@example.com');
  });

  it('builds CSV metrics export with aggregation rows', async () => {
    const result = await DataExportService.buildExport(createStorageData(), 'csv', false);

    expect(result.format).toBe('csv');
    expect(result.mimeType).toContain('text/csv');
    expect(result.filename.endsWith('.csv')).toBe(true);
    expect(result.content).toContain('section,metric,value');
    expect(result.content).toContain('"aggregation_week","totalTrackersBlocked","10"');
    expect(result.content).toContain('date,privacyScore,trackersBlocked');
    expect(result.content).not.toContain('"summary","forwardingEmail","person@example.com"');
    expect(aggregateMetricsMock).toHaveBeenCalledTimes(3);
  });

  it('includes forwarding email in CSV summary only when requested', async () => {
    const result = await DataExportService.buildExport(createStorageData(), 'csv', true);

    expect(result.content).toContain('"summary","forwardingEmail","person@example.com"');
  });
});
