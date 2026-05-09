import { CREDIT_SCORE, SCORING_CONFIG } from './constants';
import type {
  CreditScoreFactors,
  CreditScoreLabel,
  CreditScoreResult,
  DailyCreditMetrics,
  ScoringConfig,
  ScoreTrend,
} from '../types';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function log2scaled(value: number): number {
  if (value <= 0) return 0;
  return Math.log(value) / Math.log(2);
}

function getLabel(score: number): CreditScoreLabel {
  if (score >= CREDIT_SCORE.LABELS.EXCELLENT) return 'Excellent';
  if (score >= CREDIT_SCORE.LABELS.GOOD) return 'Good';
  if (score >= CREDIT_SCORE.LABELS.FAIR) return 'Fair';
  if (score >= CREDIT_SCORE.LABELS.POOR) return 'Poor';
  return 'Very Poor';
}

function getTrend(current: number, previous?: number): ScoreTrend {
  if (previous === undefined) return 'stable';
  const delta = current - previous;
  if (delta > 10) return 'improving';
  if (delta < -10) return 'declining';
  return 'stable';
}

/**
 * PrivacyCreditEngine calculates a stable credit-style privacy score (300-850).
 *
 * The score is based on four factors with logarithmic scaling and daily caps:
 * - Protection Consistency (up to +150)
 * - Clean Browsing Bonus (up to +100)
 * - High-Risk Exposure Penalty (down to -200, max -30 per day)
 * - Post-Consent Violation Penalty (down to -100)
 */
export class PrivacyCreditEngine {
  /**
   * Calculate credit score from daily metrics.
   * @param metrics Array of daily credit metrics (last 30 days)
   * @param previousScore Optional previous score for trend calculation
   */
  static calculateScore(
    metrics: DailyCreditMetrics[],
    previousScore?: number,
    config?: ScoringConfig
  ): CreditScoreResult {
    const resolvedConfig = config ?? {
      version: SCORING_CONFIG.DEFAULT_VERSION,
      riskWeights: { ...SCORING_CONFIG.DEFAULTS.riskWeights },
      creditFactors: { ...SCORING_CONFIG.DEFAULTS.creditFactors },
      decay: { ...SCORING_CONFIG.DEFAULTS.decay },
    };
    const factorsConfig = resolvedConfig.creditFactors;

    const ordered = [...metrics].sort((a, b) => (a.date > b.date ? -1 : 1));
    const windowed = ordered.slice(0, CREDIT_SCORE.METRICS_RETENTION_DAYS);

    const totals = windowed.reduce(
      (acc, day) => {
        acc.daysActive += day.protectionActiveMinutes > 0 ? 1 : 0;
        acc.cleanSites += day.cleanSitesVisited;
        acc.violations += day.postConsentViolations;

        const dailyHighRiskPenalty = day.highRiskScore * 2;
        acc.highRiskPenalty += dailyHighRiskPenalty;

        return acc;
      },
      {
        daysActive: 0,
        cleanSites: 0,
        violations: 0,
        highRiskPenalty: 0,
      }
    );

    const protectionImpact = clamp(
      factorsConfig.protectionMultiplier * log2scaled(totals.daysActive + 1),
      0,
      factorsConfig.protectionCap
    );

    const cleanBrowsingImpact = clamp(
      factorsConfig.cleanBrowsingMultiplier * log2scaled(totals.cleanSites + 1),
      0,
      factorsConfig.cleanBrowsingCap
    );

    const highRiskImpact = -totals.highRiskPenalty;

    const violationImpact = -clamp(
      totals.violations * factorsConfig.violationMultiplier,
      0,
      Math.abs(factorsConfig.violationCap)
    );

    const rawScore =
      CREDIT_SCORE.BASE +
      protectionImpact +
      cleanBrowsingImpact +
      highRiskImpact +
      violationImpact;

    const score = clamp(Math.round(rawScore), CREDIT_SCORE.MIN, CREDIT_SCORE.MAX);

    const factors: CreditScoreFactors = {
      protectionConsistency: { value: totals.daysActive, impact: Math.round(protectionImpact) },
      cleanBrowsing: { value: totals.cleanSites, impact: Math.round(cleanBrowsingImpact) },
      highRiskExposure: { value: totals.highRiskPenalty, impact: Math.round(highRiskImpact) },
      violations: { value: totals.violations, impact: Math.round(violationImpact) },
    };

    const trend = getTrend(score, previousScore);

    return {
      score,
      label: getLabel(score),
      trend,
      formulaVersion: resolvedConfig.version,
      factors,
      lastCalculated: Date.now(),
    };
  }

  static getScoreLabel(score: number): CreditScoreLabel {
    return getLabel(score);
  }

  static calculateTrend(current: number, previous: number): ScoreTrend {
    return getTrend(current, previous);
  }
}

