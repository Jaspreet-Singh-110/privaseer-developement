import { describe, it, expect } from 'vitest';
import { PrivacyCreditEngine } from '@/utils/privacy-credit-engine';
import { CREDIT_SCORE } from '@/utils/constants';
import type { DailyCreditMetrics } from '@/types';

function createEmptyDay(date: string): DailyCreditMetrics {
  return {
    date,
    trackersBlocked: 0,
    cleanSitesVisited: 0,
    highRiskScore: 0,
    postConsentViolations: 0,
    protectionActiveMinutes: 0,
  };
}

function createActiveDay(
  date: string,
  overrides: Partial<DailyCreditMetrics> = {}
): DailyCreditMetrics {
  return {
    date,
    trackersBlocked: 10,
    cleanSitesVisited: 2,
    highRiskScore: 0,
    postConsentViolations: 0,
    protectionActiveMinutes: 60,
    ...overrides,
  };
}

describe('PrivacyCreditEngine', () => {
  describe('calculateScore', () => {
    it('returns base score and stable trend when metrics array is empty', () => {
      const result = PrivacyCreditEngine.calculateScore([]);

      expect(result.score).toBe(CREDIT_SCORE.BASE);
      expect(result.label).toBe('Fair');
      expect(result.trend).toBe('stable');
      expect(result.formulaVersion).toBe('1.0');
      expect(result.factors.protectionConsistency.value).toBe(0);
      expect(result.factors.cleanBrowsing.value).toBe(0);
    });

    it('returns base score when no activity', () => {
      const metrics = [createEmptyDay('2026-01-04')];
      const result = PrivacyCreditEngine.calculateScore(metrics);

      expect(result.score).toBe(CREDIT_SCORE.BASE);
      expect(result.label).toBe('Fair');
      expect(result.trend).toBe('stable');
    });

    it('increases score with protection consistency', () => {
      const metrics = Array.from({ length: 7 }, (_, i) =>
        createActiveDay(`2026-01-0${i + 1}`)
      );

      const result = PrivacyCreditEngine.calculateScore(metrics);

      expect(result.score).toBeGreaterThan(CREDIT_SCORE.BASE);
      expect(result.factors.protectionConsistency.impact).toBeGreaterThan(0);
    });

    it('increases score with clean sites visited', () => {
      const metrics = [
        createActiveDay('2026-01-04', { cleanSitesVisited: 20 }),
      ];

      const result = PrivacyCreditEngine.calculateScore(metrics);

      expect(result.factors.cleanBrowsing.impact).toBeGreaterThan(0);
    });

    it('decreases score with high-risk exposure', () => {
      const metrics = [
        createActiveDay('2026-01-04', { highRiskScore: 50 }),
      ];

      const result = PrivacyCreditEngine.calculateScore(metrics);

      expect(result.factors.highRiskExposure.impact).toBeLessThan(0);
      expect(result.score).toBeLessThan(CREDIT_SCORE.BASE + result.factors.protectionConsistency.impact + result.factors.cleanBrowsing.impact);
    });

    it('applies daily cap to high-risk penalty', () => {
      const metrics = [
        createActiveDay('2026-01-04', { highRiskScore: 1000 }),
      ];

      const result = PrivacyCreditEngine.calculateScore(metrics);

      // Daily cap is 30, so impact should be -30 max per day
      expect(Math.abs(result.factors.highRiskExposure.impact)).toBeLessThanOrEqual(CREDIT_SCORE.DAILY_HIGH_RISK_CAP);
    });

    it('decreases score with post-consent violations', () => {
      const metrics = [
        createActiveDay('2026-01-04', { postConsentViolations: 2 }),
      ];

      const result = PrivacyCreditEngine.calculateScore(metrics);

      expect(result.factors.violations.impact).toBeLessThan(0);
      // 2 violations * 25 = -50
      expect(result.factors.violations.impact).toBe(-50);
    });

    it('caps violation penalty at -100', () => {
      const metrics = [
        createActiveDay('2026-01-04', { postConsentViolations: 10 }),
      ];

      const result = PrivacyCreditEngine.calculateScore(metrics);

      // 10 * 25 = 250, but capped at 100
      expect(result.factors.violations.impact).toBe(-100);
    });

    it('clamps score to valid range', () => {
      // Extreme negative case
      const badMetrics = Array.from({ length: 30 }, (_, i) =>
        createActiveDay(`2026-01-${String(i + 1).padStart(2, '0')}`, {
          highRiskScore: 100,
          postConsentViolations: 5,
          protectionActiveMinutes: 0,
        })
      );

      const badResult = PrivacyCreditEngine.calculateScore(badMetrics);
      expect(badResult.score).toBeGreaterThanOrEqual(CREDIT_SCORE.MIN);
      expect(badResult.score).toBeLessThanOrEqual(CREDIT_SCORE.MAX);

      // Extreme positive case (many days of good behavior)
      const goodMetrics = Array.from({ length: 30 }, (_, i) =>
        createActiveDay(`2026-01-${String(i + 1).padStart(2, '0')}`, {
          cleanSitesVisited: 50,
          highRiskScore: 0,
          postConsentViolations: 0,
        })
      );

      const goodResult = PrivacyCreditEngine.calculateScore(goodMetrics);
      expect(goodResult.score).toBeGreaterThanOrEqual(CREDIT_SCORE.MIN);
      expect(goodResult.score).toBeLessThanOrEqual(CREDIT_SCORE.MAX);
    });

    it('uses only the latest retention window when metrics exceed retention days', () => {
      const metrics = Array.from({ length: 40 }, (_, i) =>
        createActiveDay(`2026-01-${String(i + 1).padStart(2, '0')}`, {
          cleanSitesVisited: i < 10 ? 0 : 25,
          highRiskScore: i < 10 ? 100 : 0,
          postConsentViolations: i < 10 ? 4 : 0,
          protectionActiveMinutes: i < 10 ? 0 : 60,
        })
      );

      const result = PrivacyCreditEngine.calculateScore(metrics);

      expect(result.score).toBeGreaterThan(CREDIT_SCORE.BASE);
      expect(result.factors.protectionConsistency.value).toBeLessThanOrEqual(CREDIT_SCORE.METRICS_RETENTION_DAYS);
      expect(result.factors.highRiskExposure.value).toBe(0);
    });

    it('calculates improving trend when score increases', () => {
      const metrics = [createActiveDay('2026-01-04')];
      const previousScore = CREDIT_SCORE.BASE - 20;

      const result = PrivacyCreditEngine.calculateScore(metrics, previousScore);

      expect(result.trend).toBe('improving');
    });

    it('calculates declining trend when score decreases', () => {
      const metrics = [
        createActiveDay('2026-01-04', { highRiskScore: 50, postConsentViolations: 2 }),
      ];
      const previousScore = CREDIT_SCORE.BASE + 50;

      const result = PrivacyCreditEngine.calculateScore(metrics, previousScore);

      expect(result.trend).toBe('declining');
    });

    it('calculates stable trend for small changes', () => {
      const metrics = [createActiveDay('2026-01-04')];
      const result = PrivacyCreditEngine.calculateScore(metrics);
      // Calculate again with a previous score close to current
      const resultWithPrevious = PrivacyCreditEngine.calculateScore(metrics, result.score - 5);

      expect(resultWithPrevious.trend).toBe('stable');
    });

    it('uses remote scoring config multipliers and version when provided', () => {
      const metrics = [createActiveDay('2026-01-04', { cleanSitesVisited: 2 })];
      const baseline = PrivacyCreditEngine.calculateScore(metrics);
      const configured = PrivacyCreditEngine.calculateScore(metrics, undefined, {
        version: '2.1-experiment',
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
          protectionMultiplier: 80,
          protectionCap: 200,
          cleanBrowsingMultiplier: 20,
          cleanBrowsingCap: 150,
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
      });

      expect(configured.formulaVersion).toBe('2.1-experiment');
      expect(configured.score).toBeGreaterThan(baseline.score);
    });
  });

  describe('getScoreLabel', () => {
    it('returns correct labels for score ranges', () => {
      expect(PrivacyCreditEngine.getScoreLabel(800)).toBe('Excellent');
      expect(PrivacyCreditEngine.getScoreLabel(700)).toBe('Good');
      expect(PrivacyCreditEngine.getScoreLabel(600)).toBe('Fair');
      expect(PrivacyCreditEngine.getScoreLabel(450)).toBe('Poor');
      expect(PrivacyCreditEngine.getScoreLabel(350)).toBe('Very Poor');
    });
  });

  describe('calculateTrend', () => {
    it('returns improving for significant increase', () => {
      expect(PrivacyCreditEngine.calculateTrend(600, 550)).toBe('improving');
    });

    it('returns declining for significant decrease', () => {
      expect(PrivacyCreditEngine.calculateTrend(500, 550)).toBe('declining');
    });

    it('returns stable for small changes', () => {
      expect(PrivacyCreditEngine.calculateTrend(555, 550)).toBe('stable');
      expect(PrivacyCreditEngine.calculateTrend(545, 550)).toBe('stable');
    });

    it('treats exact +/-10 deltas as stable boundaries', () => {
      expect(PrivacyCreditEngine.calculateTrend(560, 550)).toBe('stable');
      expect(PrivacyCreditEngine.calculateTrend(540, 550)).toBe('stable');
    });
  });
});

