import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrivacyScoreManager } from '@/background/privacy-score';
import { TIME, CREDIT_SCORE } from '@/utils/constants';
import type { StorageData, DailyMetricsSnapshot, DailyCreditMetrics } from '@/types';

const emitMock = vi.hoisted(() => vi.fn());
const onMock = vi.hoisted(() => vi.fn());
const broadcastMock = vi.hoisted(() => vi.fn());

const shouldPenalizeMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ shouldPenalize: true, reason: 'allowed' })
);
const trackEventMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getScoringConfigMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    version: '1.0',
    riskWeights: {
      analytics: 1,
      advertising: 2,
      social: 2,
      fingerprinting: 5,
      beacons: 2,
      cryptomining: 10,
      malware: 20,
      unknown: 1,
    },
    creditFactors: {
      protectionMultiplier: 50,
      protectionCap: 150,
      cleanBrowsingMultiplier: 10,
      cleanBrowsingCap: 100,
      highRiskCap: -200,
      violationMultiplier: 25,
      violationCap: -100,
      dailyHighRiskCap: 30,
    },
    decay: {
      enabled: true,
      base: 0.5,
      maxOccurrences: 4,
    },
  })
);

let storageData: StorageData;
let creditMetrics: DailyCreditMetrics[] = [];

const getMock = vi.hoisted(() => vi.fn(async () => storageData));
const saveMock = vi.hoisted(() =>
  vi.fn(async (data: StorageData) => {
    storageData = data;
    return data;
  })
);
const recordCleanSiteMock = vi.hoisted(() => vi.fn());
const recordNonCompliantSiteMock = vi.hoisted(() => vi.fn());
const recordTrackerForCreditMock = vi.hoisted(() => vi.fn());
const recordCleanSiteForCreditMock = vi.hoisted(() => vi.fn());
const recordViolationForCreditMock = vi.hoisted(() => vi.fn());
const getDailyCreditMetricsMock = vi.hoisted(() => vi.fn(async () => creditMetrics));
const updateScoreMock = vi.hoisted(() =>
  vi.fn(async (score: number) => {
    storageData.privacyScore.current = Math.max(0, Math.min(100, score));
    return storageData.privacyScore.current;
  })
);

vi.mock('@/background/event-emitter', () => ({
  backgroundEvents: {
    emit: emitMock,
    on: onMock,
  },
}));

vi.mock('@/utils/message-bus', () => ({
  messageBus: {
    broadcast: broadcastMock,
  },
}));

vi.mock('@/utils/consent-validator', () => ({
  shouldPenalizeTracker: shouldPenalizeMock,
}));

vi.mock('@/background/feedback-telemetry-service', () => ({
  feedbackTelemetryService: {
    trackEvent: trackEventMock,
  },
}));

vi.mock('@/background/scoring-config', () => ({
  getScoringConfig: getScoringConfigMock,
}));

vi.mock('@/background/storage', () => ({
  Storage: {
    get: getMock,
    save: saveMock,
    recordCleanSite: recordCleanSiteMock,
    recordNonCompliantSite: recordNonCompliantSiteMock,
    recordTrackerForCredit: recordTrackerForCreditMock,
    recordCleanSiteForCredit: recordCleanSiteForCreditMock,
    recordViolationForCredit: recordViolationForCreditMock,
    getDailyCreditMetrics: getDailyCreditMetricsMock,
    updateScore: updateScoreMock,
  },
}));

function createStorageData(): StorageData {
  return {
    privacyScore: {
      current: 50, // Legacy score (mapped from credit)
      daily: {
        trackersBlocked: 0,
        cleanSitesVisited: 0,
        nonCompliantSites: 0,
      },
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
    lastReset: Date.now() - TIME.ONE_DAY_MS,
    penalizedDomains: {},
    consentStates: {},
    domainOccurrences: {},
    dailySnapshots: [],
    dailyCreditMetrics: [],
    creditScore: {
      score: CREDIT_SCORE.BASE,
      label: 'Fair',
      trend: 'stable',
      formulaVersion: '1.0',
      factors: {
        protectionConsistency: { value: 0, impact: 0 },
        cleanBrowsing: { value: 0, impact: 0 },
        highRiskExposure: { value: 0, impact: 0 },
        violations: { value: 0, impact: 0 },
      },
      lastCalculated: Date.now(),
    },
    burnerEmailStats: { generated: 0, forwarded: 0 },
    complianceScores: [],
    onboarding: { hasCompletedOnboarding: false, currentStep: 0 },
  };
}

function createEmptyDayMetrics(date: string): DailyCreditMetrics {
  return {
    date,
    trackersBlocked: 0,
    cleanSitesVisited: 0,
    highRiskScore: 0,
    postConsentViolations: 0,
    protectionActiveMinutes: 60, // Active protection
  };
}

describe('PrivacyScoreManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageData = createStorageData();
    creditMetrics = [createEmptyDayMetrics('2026-01-04')];
  });

  describe('handleTrackerBlocked', () => {
    it('records tracker for credit metrics when allowed', async () => {
      await PrivacyScoreManager.handleTrackerBlocked(
        'tracker.com',
        2,
        'advertising',
        false,
        'https://example.com'
      );

      expect(recordTrackerForCreditMock).toHaveBeenCalledWith(2, false);
      expect(emitMock).toHaveBeenCalledWith('CREDIT_METRICS_UPDATED', {
        type: 'tracker',
        value: 2,
      });
    });

    it('passes high risk flag to credit metrics', async () => {
      await PrivacyScoreManager.handleTrackerBlocked('tracker.com', 5, 'fingerprinting', true);

      expect(recordTrackerForCreditMock).toHaveBeenCalledWith(5, true);
    });

    it('skips recording when consent validation fails', async () => {
      shouldPenalizeMock.mockResolvedValueOnce({
        shouldPenalize: false,
        reason: 'user_consent',
      });

      await PrivacyScoreManager.handleTrackerBlocked(
        'tracker.com',
        1,
        'analytics',
        false
      );

      expect(recordTrackerForCreditMock).not.toHaveBeenCalled();
    });

    it('broadcasts credit score update after recording', async () => {
      await PrivacyScoreManager.handleTrackerBlocked('tracker.com', 1, 'analytics', false);

      expect(broadcastMock).toHaveBeenCalledWith('CREDIT_SCORE_UPDATED', expect.any(Object));
      expect(broadcastMock).toHaveBeenCalledWith('STATE_UPDATE');
    });
  });

  describe('handleCleanSite', () => {
    it('records clean site for both legacy and credit systems', async () => {
      await PrivacyScoreManager.handleCleanSite();

      expect(recordCleanSiteMock).toHaveBeenCalled();
      expect(recordCleanSiteForCreditMock).toHaveBeenCalled();
      expect(emitMock).toHaveBeenCalledWith('CREDIT_METRICS_UPDATED', {
        type: 'clean_site',
        value: 1,
      });
    });
  });

  describe('handleNonCompliantSite', () => {
    it('records violation for credit metrics', async () => {
      await PrivacyScoreManager.handleNonCompliantSite('bad-site.com', 1.5);

      expect(recordNonCompliantSiteMock).toHaveBeenCalled();
      expect(recordViolationForCreditMock).toHaveBeenCalled();
      expect(emitMock).toHaveBeenCalledWith('CREDIT_METRICS_UPDATED', {
        type: 'violation',
        value: 1.5,
      });
    });

    it('returns current score when non-compliant handling throws', async () => {
      recordNonCompliantSiteMock.mockRejectedValueOnce(new Error('storage write failed'));
      storageData.creditScore = undefined;
      storageData.privacyScore.current = 64;

      const result = await PrivacyScoreManager.handleNonCompliantSite('bad-site.com', 2);

      expect(result).toBe(64);
      expect(recordViolationForCreditMock).not.toHaveBeenCalled();
    });
  });

  describe('updateCreditScore', () => {
    it('calculates and saves credit score from metrics', async () => {
      creditMetrics = [
        {
          date: '2026-01-04',
          trackersBlocked: 10,
          cleanSitesVisited: 5,
          highRiskScore: 0,
          postConsentViolations: 0,
          protectionActiveMinutes: 120,
        },
      ];

      const legacyScore = await PrivacyScoreManager.updateCreditScore();

      expect(saveMock).toHaveBeenCalled();
      expect(typeof legacyScore).toBe('number');
      expect(legacyScore).toBeGreaterThanOrEqual(0);
      expect(legacyScore).toBeLessThanOrEqual(100);
    });

    it('broadcasts both credit score update and state update', async () => {
      await PrivacyScoreManager.updateCreditScore();

      expect(broadcastMock).toHaveBeenCalledWith('CREDIT_SCORE_UPDATED', expect.objectContaining({
        creditScore: expect.objectContaining({
          score: expect.any(Number),
          label: expect.any(String),
          formulaVersion: '1.0',
        }),
      }));
      expect(broadcastMock).toHaveBeenCalledWith('STATE_UPDATE');
    });

    it('emits SCORE_UPDATED event with legacy scores', async () => {
      await PrivacyScoreManager.updateCreditScore();

      expect(emitMock).toHaveBeenCalledWith('SCORE_UPDATED', expect.objectContaining({
        oldScore: expect.any(Number),
        newScore: expect.any(Number),
        reason: 'Credit score updated',
      }));
      expect(emitMock).toHaveBeenCalledWith('SCORING_ANALYTICS', expect.objectContaining({
        formulaVersion: '1.0',
        scoreDelta: expect.any(Number),
      }));
      expect(trackEventMock).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'scoring_analytics',
      }));
    });

    it('marks trend as improving when score increases significantly', async () => {
      storageData.creditScore!.score = 400;
      creditMetrics = [
        {
          date: '2026-01-05',
          trackersBlocked: 0,
          cleanSitesVisited: 50,
          highRiskScore: 0,
          postConsentViolations: 0,
          protectionActiveMinutes: 24 * 60,
        },
      ];

      await PrivacyScoreManager.updateCreditScore();

      expect(broadcastMock).toHaveBeenCalledWith(
        'CREDIT_SCORE_UPDATED',
        expect.objectContaining({
          creditScore: expect.objectContaining({ trend: 'improving' }),
        })
      );
    });

    it('marks trend as declining when score drops significantly', async () => {
      storageData.creditScore!.score = 700;
      creditMetrics = [
        {
          date: '2026-01-06',
          trackersBlocked: 0,
          cleanSitesVisited: 0,
          highRiskScore: 100,
          postConsentViolations: 10,
          protectionActiveMinutes: 0,
        },
      ];

      await PrivacyScoreManager.updateCreditScore();

      expect(broadcastMock).toHaveBeenCalledWith(
        'CREDIT_SCORE_UPDATED',
        expect.objectContaining({
          creditScore: expect.objectContaining({ trend: 'declining' }),
        })
      );
    });
  });

  describe('getCurrentCreditScore', () => {
    it('returns stored credit score', async () => {
      const creditScore = await PrivacyScoreManager.getCurrentCreditScore();

      expect(creditScore).not.toBeNull();
      expect(creditScore?.score).toBe(CREDIT_SCORE.BASE);
    });

    it('returns null when no credit score exists', async () => {
      storageData.creditScore = undefined;

      const creditScore = await PrivacyScoreManager.getCurrentCreditScore();

      expect(creditScore).toBeNull();
    });

    it('returns null when storage read throws', async () => {
      getMock.mockRejectedValueOnce(new Error('storage unavailable'));

      const creditScore = await PrivacyScoreManager.getCurrentCreditScore();

      expect(creditScore).toBeNull();
    });
  });

  describe('getCurrentScore', () => {
    it('returns legacy score derived from credit score', async () => {
      storageData.creditScore = {
        score: 700,
        label: 'Good',
        trend: 'stable',
        formulaVersion: '1.0',
        factors: {
          protectionConsistency: { value: 7, impact: 100 },
          cleanBrowsing: { value: 10, impact: 50 },
          highRiskExposure: { value: 0, impact: 0 },
          violations: { value: 0, impact: 0 },
        },
        lastCalculated: Date.now(),
      };

      const score = await PrivacyScoreManager.getCurrentScore();

      // 700 credit score should map to approximately 73 legacy score
      // (700 - 300) / (850 - 300) * 100 ≈ 72.7
      expect(score).toBeGreaterThan(70);
      expect(score).toBeLessThan(80);
    });

    it('maps minimum credit score to 0 legacy score', async () => {
      storageData.creditScore = {
        score: CREDIT_SCORE.MIN,
        label: 'Very Poor',
        trend: 'stable',
        formulaVersion: '1.0',
        factors: {
          protectionConsistency: { value: 0, impact: 0 },
          cleanBrowsing: { value: 0, impact: 0 },
          highRiskExposure: { value: 0, impact: 0 },
          violations: { value: 0, impact: 0 },
        },
        lastCalculated: Date.now(),
      };

      const score = await PrivacyScoreManager.getCurrentScore();
      expect(score).toBe(0);
    });

    it('maps maximum credit score to 100 legacy score', async () => {
      storageData.creditScore = {
        score: CREDIT_SCORE.MAX,
        label: 'Excellent',
        trend: 'stable',
        formulaVersion: '1.0',
        factors: {
          protectionConsistency: { value: 0, impact: 0 },
          cleanBrowsing: { value: 0, impact: 0 },
          highRiskExposure: { value: 0, impact: 0 },
          violations: { value: 0, impact: 0 },
        },
        lastCalculated: Date.now(),
      };

      const score = await PrivacyScoreManager.getCurrentScore();
      expect(score).toBe(100);
    });

    it('returns 100 fallback when storage read throws', async () => {
      getMock.mockRejectedValueOnce(new Error('storage unavailable'));

      const score = await PrivacyScoreManager.getCurrentScore();
      expect(score).toBe(100);
    });
  });

  describe('addHistoryEntry', () => {
    it('caps history at 30 entries', async () => {
      const totalEntries = 35;
      for (let i = 0; i < totalEntries; i++) {
        await PrivacyScoreManager.addHistoryEntry(
          `2024-01-${i.toString().padStart(2, '0')}`,
          100 - i,
          i
        );
      }

      expect(storageData.privacyScore.history).toHaveLength(30);
      expect(storageData.privacyScore.history[0].date).toBe('2024-01-34');
      expect(storageData.privacyScore.history[29].date).toBe('2024-01-05');
    });

    it('adds newest history entries to the front', async () => {
      await PrivacyScoreManager.addHistoryEntry('2024-02-01', 80, 2);
      await PrivacyScoreManager.addHistoryEntry('2024-02-02', 75, 3);

      expect(storageData.privacyScore.history[0]).toMatchObject({
        date: '2024-02-02',
        score: 75,
        trackersBlocked: 3,
      });
    });
  });

  describe('createDailySnapshot', () => {
    it('creates daily snapshot with category breakdown', async () => {
      storageData.trackers = {
        'ads.com': { domain: 'ads.com', category: 'ads', isHighRisk: false, blockedCount: 3, lastBlocked: Date.now() },
        'analytics.com': { domain: 'analytics.com', category: 'analytics', isHighRisk: false, blockedCount: 1, lastBlocked: Date.now() },
      };
      storageData.privacyScore.daily = { trackersBlocked: 4, cleanSitesVisited: 2, nonCompliantSites: 1 };
      storageData.lastReset = new Date('2024-05-20T00:00:00Z').getTime();

      await PrivacyScoreManager.createDailySnapshot();

      expect(storageData.dailySnapshots).toHaveLength(1);
      const snapshot = storageData.dailySnapshots![0];
      expect(snapshot.date).toBe('2024-05-20');
      expect(snapshot.trackersBlocked).toBe(4);
      expect(snapshot.trackersByCategory).toMatchObject({ ads: 3, analytics: 1 });
    });

    it('enforces 30 day limit on snapshots', async () => {
      storageData.dailySnapshots = Array.from({ length: 30 }, (_, idx) => ({
        date: `2024-01-${idx}`,
        privacyScore: 50,
        trackersBlocked: 0,
        trackersByCategory: {},
        cleanSitesVisited: 0,
        nonCompliantSites: 0,
        complianceScores: [],
        burnerEmailsGenerated: 0,
        burnerEmailsForwarded: 0,
      })) as DailyMetricsSnapshot[];

      await PrivacyScoreManager.createDailySnapshot();

      expect(storageData.dailySnapshots).toHaveLength(30);
    });

    it('initializes dailySnapshots when field is missing', async () => {
      storageData.dailySnapshots = undefined;

      await PrivacyScoreManager.createDailySnapshot();

      expect(storageData.dailySnapshots).toBeDefined();
      expect(storageData.dailySnapshots).toHaveLength(1);
    });
  });

  describe('getScoreLabel', () => {
    it('returns correct labels for legacy score ranges', () => {
      expect(PrivacyScoreManager.getScoreLabel(90)).toBe('Excellent');
      expect(PrivacyScoreManager.getScoreLabel(70)).toBe('Good');
      expect(PrivacyScoreManager.getScoreLabel(50)).toBe('Fair');
      expect(PrivacyScoreManager.getScoreLabel(30)).toBe('Poor');
    });
  });

  describe('getScoreColor', () => {
    it('returns correct colors for score ranges', () => {
      expect(PrivacyScoreManager.getScoreColor(90)).toBe('#10B981');
      expect(PrivacyScoreManager.getScoreColor(70)).toBe('#F59E0B');
      expect(PrivacyScoreManager.getScoreColor(40)).toBe('#DC2626');
    });
  });
});
