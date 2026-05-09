import type {
  Alert,
  ExportFormat,
  GdprExportMetadata,
  GdprExportPayload,
  MetricsAggregation,
  SanitizedExportData,
  StorageData,
} from '../types';
import { DATA_EXPORT } from '../utils/constants';
import { logger } from '../utils/logger';
import { sanitizeUrl } from '../utils/sanitizer';
import { toError } from '../utils/type-guards';
import { MetricsAggregationService } from './metrics-aggregation';
import { Storage } from './storage';

export interface DataExportResult {
  format: ExportFormat;
  filename: string;
  mimeType: string;
  content: string;
}

export class DataExportService {
  static async exportData(format: ExportFormat = 'json', includeEmail = false): Promise<DataExportResult> {
    const data = await Storage.getFresh();
    return this.buildExport(data, format, includeEmail);
  }

  static async buildExport(
    data: StorageData,
    format: ExportFormat = 'json',
    includeEmail = false
  ): Promise<DataExportResult> {
    try {
      const sanitizedData = this.sanitizeStorageData(data, includeEmail);
      const exportedAt = new Date().toISOString();
      const timestamp = exportedAt.split('T')[0];
      const filename = `privaseer-data-export-${timestamp}.${format === 'csv' ? 'csv' : 'json'}`;

      if (format === 'csv') {
        const content = await this.buildCsvContent(exportedAt, sanitizedData);
        return {
          format: 'csv',
          filename,
          mimeType: 'text/csv;charset=utf-8',
          content,
        };
      }

      const payload: GdprExportPayload = {
        format: DATA_EXPORT.FORMAT,
        version: DATA_EXPORT.VERSION,
        exportedAt,
        gdpr: this.getGdprMetadata(),
        data: sanitizedData,
      };

      return {
        format: 'json',
        filename,
        mimeType: 'application/json',
        content: JSON.stringify(payload, null, 2),
      };
    } catch (error) {
      logger.error('DataExportService', 'Failed to build export package', toError(error), {
        format,
        includeEmail,
      });
      throw error;
    }
  }

  private static sanitizeStorageData(data: StorageData, includeEmail: boolean): SanitizedExportData {
    const { realEmail, alerts, ...rest } = data;
    const sanitizedAlerts: Alert[] = alerts.map((alert) => ({
      ...alert,
      url: (sanitizeUrl(alert.url) ?? undefined) || undefined,
    }));

    const baseData: SanitizedExportData = {
      ...rest,
      alerts: sanitizedAlerts,
    };

    if (includeEmail) {
      baseData.realEmail = realEmail ?? null;
    }

    return baseData;
  }

  private static getGdprMetadata(): GdprExportMetadata {
    return {
      dataController: DATA_EXPORT.GDPR.DATA_CONTROLLER,
      purpose: DATA_EXPORT.GDPR.PURPOSE,
      legalBasis: DATA_EXPORT.GDPR.LEGAL_BASIS,
      retentionPolicy: DATA_EXPORT.GDPR.RETENTION_POLICY,
      dataCategories: [...DATA_EXPORT.GDPR.DATA_CATEGORIES],
    };
  }

  private static async buildCsvContent(exportedAt: string, data: SanitizedExportData): Promise<string> {
    const weekly = await MetricsAggregationService.aggregateMetrics('week');
    const monthly = await MetricsAggregationService.aggregateMetrics('month');
    const allTime = await MetricsAggregationService.aggregateMetrics('all-time');

    const lines: string[] = [];
    lines.push('section,metric,value');
    lines.push(this.toCsvRow('summary', 'exportedAt', exportedAt));
    lines.push(this.toCsvRow('summary', 'format', DATA_EXPORT.FORMAT));
    lines.push(this.toCsvRow('summary', 'version', DATA_EXPORT.VERSION));
    if (data.realEmail) {
      lines.push(this.toCsvRow('summary', 'forwardingEmail', data.realEmail));
    }
    lines.push(this.toCsvRow('summary', 'snapshotCount', String(data.dailySnapshots?.length ?? 0)));

    this.appendAggregationRows(lines, 'week', weekly);
    this.appendAggregationRows(lines, 'month', monthly);
    this.appendAggregationRows(lines, 'all-time', allTime);

    lines.push('');
    lines.push(
      'date,privacyScore,trackersBlocked,cleanSitesVisited,nonCompliantSites,burnerEmailsGenerated,burnerEmailsForwarded,trackersByCategory,complianceScores'
    );

    for (const snapshot of data.dailySnapshots ?? []) {
      lines.push(
        [
          snapshot.date,
          String(snapshot.privacyScore),
          String(snapshot.trackersBlocked),
          String(snapshot.cleanSitesVisited),
          String(snapshot.nonCompliantSites),
          String(snapshot.burnerEmailsGenerated),
          String(snapshot.burnerEmailsForwarded),
          JSON.stringify(snapshot.trackersByCategory),
          JSON.stringify(snapshot.complianceScores),
        ]
          .map((value) => this.escapeCsv(value))
          .join(',')
      );
    }

    return lines.join('\n');
  }

  private static appendAggregationRows(lines: string[], period: string, aggregation: MetricsAggregation): void {
    lines.push(this.toCsvRow(`aggregation_${period}`, 'totalTrackersBlocked', String(aggregation.totalTrackersBlocked)));
    lines.push(this.toCsvRow(`aggregation_${period}`, 'averagePrivacyScore', String(aggregation.averagePrivacyScore)));
    lines.push(this.toCsvRow(`aggregation_${period}`, 'averageComplianceScore', String(aggregation.averageComplianceScore)));
    lines.push(this.toCsvRow(`aggregation_${period}`, 'cleanSitesVisited', String(aggregation.cleanSitesVisited)));
    lines.push(this.toCsvRow(`aggregation_${period}`, 'nonCompliantSites', String(aggregation.nonCompliantSites)));
    lines.push(this.toCsvRow(`aggregation_${period}`, 'burnerEmailsGenerated', String(aggregation.burnerEmailsGenerated)));
    lines.push(this.toCsvRow(`aggregation_${period}`, 'burnerEmailsForwarded', String(aggregation.burnerEmailsForwarded)));
    lines.push(this.toCsvRow(`aggregation_${period}`, 'trackersByCategory', JSON.stringify(aggregation.trackersByCategory)));
    lines.push(this.toCsvRow(`aggregation_${period}`, 'topBlockedDomains', JSON.stringify(aggregation.topBlockedDomains)));
  }

  private static toCsvRow(section: string, metric: string, value: string): string {
    return [section, metric, value].map((entry) => this.escapeCsv(entry)).join(',');
  }

  private static escapeCsv(value: string): string {
    const normalized = value.replace(/"/g, '""');
    return `"${normalized}"`;
  }
}
