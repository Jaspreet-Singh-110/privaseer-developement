import type { MetricsAggregation, DailyMetricsSnapshot, TrackerData } from '../types';
import { Storage } from './storage';
import { logger } from '../utils/logger';
import { toError } from '../utils/type-guards';

export class MetricsAggregationService {
  static async aggregateMetrics(period: 'week' | 'month' | 'all-time'): Promise<MetricsAggregation> {
    try {
      const data = await Storage.get();
      const snapshots = data.dailySnapshots || [];

      // Create a snapshot for the current, uncompleted day
      const currentDaySnapshot: DailyMetricsSnapshot = {
        date: new Date().toISOString().split('T')[0],
        privacyScore: data.privacyScore.current,
        trackersBlocked: data.privacyScore.daily.trackersBlocked,
        trackersByCategory: {}, // We don't use this for summing anymore
        cleanSitesVisited: data.privacyScore.daily.cleanSitesVisited,
        nonCompliantSites: data.privacyScore.daily.nonCompliantSites,
        complianceScores: data.complianceScores || [],
        burnerEmailsGenerated: data.burnerEmailStats?.generated ?? 0,
        burnerEmailsForwarded: data.burnerEmailStats?.forwarded ?? 0,
      };

      const allSnapshots = [currentDaySnapshot, ...snapshots];
      let relevantSnapshots: DailyMetricsSnapshot[] = [];

      switch (period) {
        case 'week':
          relevantSnapshots = allSnapshots.slice(0, 7);
          break;
        case 'month':
          relevantSnapshots = allSnapshots.slice(0, 30);
          break;
        case 'all-time':
          relevantSnapshots = allSnapshots;
          break;
      }

      if (relevantSnapshots.length === 0) {
        return this.getEmptyAggregation(period);
      }

      const totalTrackersBlocked = relevantSnapshots.reduce((sum, s) => sum + s.trackersBlocked, 0);
      const cleanSitesVisited = relevantSnapshots.reduce((sum, s) => sum + s.cleanSitesVisited, 0);
      const nonCompliantSites = relevantSnapshots.reduce((sum, s) => sum + s.nonCompliantSites, 0);
      const burnerEmailsGenerated = relevantSnapshots.reduce((sum, s) => sum + s.burnerEmailsGenerated, 0);
      const burnerEmailsForwarded = relevantSnapshots.reduce((sum, s) => sum + s.burnerEmailsForwarded, 0);

      const totalPrivacyScore = relevantSnapshots.reduce((sum, s) => sum + s.privacyScore, 0);
      const averagePrivacyScore = Math.round(totalPrivacyScore / relevantSnapshots.length);

      const allComplianceScores = relevantSnapshots.flatMap(s => s.complianceScores);
      const averageComplianceScore = allComplianceScores.length > 0
        ? Math.round(allComplianceScores.reduce((sum, score) => sum + score, 0) / allComplianceScores.length)
        : 100;

      // trackersByCategory in data.trackers is already all-time totals, so just use it directly
      // rather than double counting it across snapshots.
      const trackersByCategory: Record<string, number> = {};
      for (const tracker of Object.values(data.trackers || {})) {
        trackersByCategory[tracker.category] = (trackersByCategory[tracker.category] || 0) + tracker.blockedCount;
      }

      const topBlockedDomains = this.calculateTopBlockedDomains(data.trackers);

      const aggregation: MetricsAggregation = {
        period,
        totalTrackersBlocked,
        trackersByCategory,
        averagePrivacyScore,
        averageComplianceScore,
        cleanSitesVisited,
        nonCompliantSites,
        burnerEmailsGenerated,
        burnerEmailsForwarded,
        topBlockedDomains,
      };

      logger.info('MetricsAggregation', 'Metrics aggregated', {
        period,
        totalTrackersBlocked,
        averagePrivacyScore,
      });

      return aggregation;
    } catch (error) {
      logger.error('MetricsAggregation', 'Failed to aggregate metrics', toError(error));
      return this.getEmptyAggregation(period);
    }
  }

  private static getEmptyAggregation(period: 'week' | 'month' | 'all-time'): MetricsAggregation {
    return {
      period,
      totalTrackersBlocked: 0,
      trackersByCategory: {},
      averagePrivacyScore: 100,
      averageComplianceScore: 100,
      cleanSitesVisited: 0,
      nonCompliantSites: 0,
      burnerEmailsGenerated: 0,
      burnerEmailsForwarded: 0,
      topBlockedDomains: [],
    };
  }

  private static calculateTopBlockedDomains(trackers: Record<string, TrackerData>): Array<{ domain: string; count: number }> {
    const domainCounts: Record<string, number> = {};

    for (const tracker of Object.values(trackers)) {
      domainCounts[tracker.domain] = tracker.blockedCount;
    }

    return Object.entries(domainCounts)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  static async getPrivacyScoreTrend(days: number = 7): Promise<Array<{ date: string; score: number }>> {
    try {
      const snapshots = await Storage.getDailySnapshots(days);
      return snapshots.map(s => ({
        date: s.date,
        score: s.privacyScore,
      }));
    } catch (error) {
      logger.error('MetricsAggregation', 'Failed to get privacy score trend', toError(error));
      return [];
    }
  }

  static async getComplianceScoreDistribution(): Promise<Record<string, number>> {
    try {
      const data = await Storage.get();
      const snapshots = data.dailySnapshots || [];

      const distribution: Record<string, number> = {
        excellent: 0,
        good: 0,
        fair: 0,
        poor: 0,
      };

      for (const snapshot of snapshots) {
        for (const score of snapshot.complianceScores) {
          if (score >= 90) {
            distribution.excellent++;
          } else if (score >= 70) {
            distribution.good++;
          } else if (score >= 50) {
            distribution.fair++;
          } else {
            distribution.poor++;
          }
        }
      }

      return distribution;
    } catch (error) {
      logger.error('MetricsAggregation', 'Failed to get compliance score distribution', toError(error));
      return { excellent: 0, good: 0, fair: 0, poor: 0 };
    }
  }

  static async getTrackerCategoryBreakdown(): Promise<Array<{ category: string; count: number; percentage: number }>> {
    try {
      const data = await Storage.get();
      const total = Object.values(data.trackers).reduce((sum, t) => sum + t.blockedCount, 0);

      if (total === 0) {
        return [];
      }

      const categoryTotals: Record<string, number> = {};

      for (const tracker of Object.values(data.trackers)) {
        categoryTotals[tracker.category] = (categoryTotals[tracker.category] || 0) + tracker.blockedCount;
      }

      return Object.entries(categoryTotals)
        .map(([category, count]) => ({
          category,
          count,
          percentage: Math.round((count / total) * 100),
        }))
        .sort((a, b) => b.count - a.count);
    } catch (error) {
      logger.error('MetricsAggregation', 'Failed to get tracker category breakdown', toError(error));
      return [];
    }
  }
}
