import { Storage } from './storage';
import { logger } from '../utils/logger';
import { backgroundEvents } from './event-emitter';
import { toError } from '../utils/type-guards';
import { BADGE, CREDIT_SCORE, PRIVACY_SCORE } from '../utils/constants';
import { shouldPenalizeTracker } from '../utils/consent-validator';
import type { CreditScoreResult, DailyMetricsSnapshot, StorageData, TrackerData } from '../types';
import { PrivacyCreditEngine } from '../utils/privacy-credit-engine';
import { messageBus } from '../utils/message-bus';
import { getScoringConfig } from './scoring-config';
import { feedbackTelemetryService } from './feedback-telemetry-service';

export class PrivacyScoreManager {
  private static listenersSetup = false;
  private static readonly HISTORY_LIMIT = 30;
  private static readonly SNAPSHOT_LIMIT = 30;

  static async initialize(): Promise<void> {
    if (!this.listenersSetup) {
      this.setupEventListeners();
      this.listenersSetup = true;
    }
  }

  private static setupEventListeners(): void {
    // Listen to tracker blocked events
    backgroundEvents.on('TRACKER_BLOCKED', async (data) => {
      await this.handleTrackerBlocked(
        data.domain,
        data.riskWeight,
        data.category,
        data.isHighRisk,
        data.url
      );
    });

    // Listen to clean site detected events
    backgroundEvents.on('CLEAN_SITE_DETECTED', async () => {
      await this.handleCleanSite();
    });

    // Listen to non-compliant site events
    backgroundEvents.on('NON_COMPLIANT_SITE', async (data) => {
      await this.handleNonCompliantSite(data.domain, data.severityMultiplier || 1.0);
    });
  }

  static async handleTrackerBlocked(
    domain: string,
    riskWeight: number = 1,
    category: string = 'unknown',
    isHighRisk: boolean = false,
    pageUrl?: string
  ): Promise<number> {
    try {
      const validationResult = await shouldPenalizeTracker(
        pageUrl || domain,
        category,
        isHighRisk
      );

      if (!validationResult.shouldPenalize) {
        logger.info('PrivacyScore', 'Skipping penalty due to consent', {
          domain,
          reason: validationResult.reason,
          consentStatus: validationResult.consentState?.consentStatus,
        });
        return await this.getCurrentScore();
      }

      await Storage.recordTrackerForCredit(riskWeight, isHighRisk);
      backgroundEvents.emit('CREDIT_METRICS_UPDATED', {
        type: 'tracker',
        value: riskWeight,
      });

      return await this.updateCreditScore();
    } catch (error) {
      logger.error('PrivacyScore', 'Error handling tracker block', toError(error));
      return await this.getCurrentScore();
    }
  }

  static async handleCleanSite(): Promise<number> {
    try {
      await Storage.recordCleanSite();
      await Storage.recordCleanSiteForCredit();
      backgroundEvents.emit('CREDIT_METRICS_UPDATED', {
        type: 'clean_site',
        value: 1,
      });
      return await this.updateCreditScore();
    } catch (error) {
      logger.error('PrivacyScore', 'Error handling clean site', toError(error));
      return await this.getCurrentScore();
    }
  }

  static async handleNonCompliantSite(_domain: string, severityMultiplier: number = 1.0): Promise<number> {
    try {
      await Storage.recordNonCompliantSite();
      await Storage.recordViolationForCredit();
      backgroundEvents.emit('CREDIT_METRICS_UPDATED', {
        type: 'violation',
        value: severityMultiplier,
      });
      return await this.updateCreditScore();
    } catch (error) {
      logger.error('PrivacyScore', 'Error handling non-compliant site', toError(error));
      return await this.getCurrentScore();
    }
  }

  private static legacyFromCredit(creditScore: number): number {
    const normalized = (creditScore - CREDIT_SCORE.MIN) / (CREDIT_SCORE.MAX - CREDIT_SCORE.MIN);
    const scaled = normalized * PRIVACY_SCORE.MAX;
    return Math.max(PRIVACY_SCORE.MIN, Math.min(PRIVACY_SCORE.MAX, Math.round(scaled)));
  }

  static async updateCreditScore(): Promise<number> {
    const data = await Storage.get();
    const metrics = await Storage.getDailyCreditMetrics(CREDIT_SCORE.METRICS_RETENTION_DAYS);
    const previousScore = data.creditScore?.score;
    const scoringConfig = getScoringConfig();
    const creditScore = PrivacyCreditEngine.calculateScore(metrics, previousScore, scoringConfig);
    const legacyOld = data.privacyScore.current;
    const legacyNew = this.legacyFromCredit(creditScore.score);

    data.creditScore = creditScore;
    data.privacyScore.current = legacyNew;

    await Storage.save(data);

    backgroundEvents.emit('SCORE_UPDATED', {
      oldScore: legacyOld,
      newScore: legacyNew,
      reason: 'Credit score updated',
    });
    backgroundEvents.emit('SCORING_ANALYTICS', {
      formulaVersion: creditScore.formulaVersion,
      scoreDelta: creditScore.score - (previousScore ?? creditScore.score),
      factors: {
        protectionConsistencyImpact: creditScore.factors.protectionConsistency.impact,
        cleanBrowsingImpact: creditScore.factors.cleanBrowsing.impact,
        highRiskExposureImpact: creditScore.factors.highRiskExposure.impact,
        violationsImpact: creditScore.factors.violations.impact,
      },
    });
    void feedbackTelemetryService.trackEvent({
      eventType: 'scoring_analytics',
      eventData: {
        formulaVersion: creditScore.formulaVersion,
        score: creditScore.score,
        previousScore: previousScore ?? null,
        scoreDelta: creditScore.score - (previousScore ?? creditScore.score),
        protectionImpact: creditScore.factors.protectionConsistency.impact,
        cleanBrowsingImpact: creditScore.factors.cleanBrowsing.impact,
        highRiskImpact: creditScore.factors.highRiskExposure.impact,
        violationImpact: creditScore.factors.violations.impact,
      },
    });

    messageBus.broadcast('CREDIT_SCORE_UPDATED', { creditScore });
    messageBus.broadcast('STATE_UPDATE');

    return legacyNew;
  }

  static async getCurrentCreditScore(): Promise<CreditScoreResult | null> {
    try {
      const data = await Storage.get();
      return data.creditScore ?? null;
    } catch (error) {
      logger.error('PrivacyScore', 'Error getting credit score', toError(error));
      return null;
    }
  }

  static async getCurrentScore(): Promise<number> {
    try {
      const data = await Storage.get();
      if (data.creditScore) {
        return this.legacyFromCredit(data.creditScore.score);
      }
      return data.privacyScore.current;
    } catch (error) {
      logger.error('PrivacyScore', 'Error getting current score', toError(error));
      return 100;
    }
  }

  static getScoreColor(score: number): string {
    if (score >= 80) return '#10B981';
    if (score >= 60) return '#F59E0B';
    return BADGE.BACKGROUND_COLOR;
  }

  static getScoreLabel(score: number): string {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Poor';
  }

  static async addHistoryEntry(date: string, score: number, trackersBlocked: number): Promise<void> {
    const data = await Storage.get();
    const history = data.privacyScore.history || [];

    history.unshift({ date, score, trackersBlocked });
    data.privacyScore.history = history.slice(0, this.HISTORY_LIMIT);

    await Storage.save(data);
  }

  static async createDailySnapshot(): Promise<void> {
    const data = await Storage.get();
    const snapshot = this.buildDailySnapshot(data);

    if (!data.dailySnapshots) {
      data.dailySnapshots = [];
    }

    data.dailySnapshots.unshift(snapshot);
    data.dailySnapshots = data.dailySnapshots.slice(0, this.SNAPSHOT_LIMIT);

    await Storage.save(data);
  }

  private static buildDailySnapshot(data: StorageData): DailyMetricsSnapshot {
    const trackersByCategory: Record<string, number> = {};

    for (const tracker of Object.values(data.trackers || {})) {
      const { category, blockedCount } = tracker as TrackerData;
      trackersByCategory[category] = (trackersByCategory[category] || 0) + blockedCount;
    }

    const snapshotDate = new Date(data.lastReset || Date.now()).toISOString().split('T')[0];

    return {
      date: snapshotDate,
      privacyScore: data.privacyScore.current,
      trackersBlocked: data.privacyScore.daily.trackersBlocked,
      trackersByCategory,
      cleanSitesVisited: data.privacyScore.daily.cleanSitesVisited,
      nonCompliantSites: data.privacyScore.daily.nonCompliantSites,
      complianceScores: data.complianceScores || [],
      burnerEmailsGenerated: data.burnerEmailStats?.generated ?? 0,
      burnerEmailsForwarded: data.burnerEmailStats?.forwarded ?? 0,
    };
  }
}
