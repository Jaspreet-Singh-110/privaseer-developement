import type {
  StorageData,
  Alert,
  LocalConsentState,
  DailyMetricsSnapshot,
  OnboardingState,
  OnboardingStepTiming,
  DailyCreditMetrics,
  AllowlistEntry,
  ReportedFalsePositive,
  FalsePositiveReason,
} from '../types';
import { logger } from '../utils/logger';
import { backgroundEvents } from './event-emitter';
import { toError } from '../utils/type-guards';
import {
  TIME,
  DAILY_RECOVERY,
  STORAGE_RETRY,
  ONBOARDING,
  CREDIT_SCORE,
  SCORING_CONFIG,
  FALSE_POSITIVE_FEEDBACK,
  DATA_EXPORT,
} from '../utils/constants';

const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  hasCompletedOnboarding: false,
  currentStep: 0,
  startedAt: undefined,
  stepTimings: [],
};

const DEFAULT_STORAGE_DATA: StorageData = {
  privacyScore: {
    current: 100,
    daily: {
      trackersBlocked: 0,
      cleanSitesVisited: 0,
      nonCompliantSites: 0,
    },
    history: [],
  },
  creditScore: {
    score: CREDIT_SCORE.BASE,
    label: 'Fair',
    trend: 'stable',
    formulaVersion: SCORING_CONFIG.DEFAULT_VERSION,
    factors: {
      protectionConsistency: { value: 0, impact: 0 },
      cleanBrowsing: { value: 0, impact: 0 },
      highRiskExposure: { value: 0, impact: 0 },
      violations: { value: 0, impact: 0 },
    },
    lastCalculated: Date.now(),
  },
  dailyCreditMetrics: [],
  alerts: [],
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
  dailySnapshots: [],
  burnerEmailStats: {
    generated: 0,
    forwarded: 0,
  },
  complianceScores: [],
  onboarding: { ...DEFAULT_ONBOARDING_STATE },
};

export class Storage {
  private static cache: StorageData | null = null;
  private static listenersSetup = false;
  private static isDirty = false;
  private static saveTimer: ReturnType<typeof setTimeout> | null = null;
  private static isSaving = false;
  private static readonly SAVE_DELAY = 500; // ms

  static async initialize(): Promise<void> {
    try {
      const data = await chrome.storage.local.get('privacyData');

      if (!data || !data.privacyData) {
        // Use deep copy to avoid mutating the DEFAULT_STORAGE_DATA constant
        const defaultData = JSON.parse(JSON.stringify(DEFAULT_STORAGE_DATA));
        this.ensureOnboardingState(defaultData);
        this.ensureCreditDefaults(defaultData);
        await this.save(defaultData);
        this.cache = defaultData;
      } else {
        this.cache = data.privacyData;
        if (this.cache) {
          this.ensureOnboardingState(this.cache);
          this.ensureCreditDefaults(this.cache);
        }
        await this.checkDailyReset();
      }

      // Setup event listeners once
      if (!this.listenersSetup) {
        this.setupEventListeners();
        this.listenersSetup = true;
      }
    } catch (error) {
      logger.error('Storage', 'Storage initialization failed', toError(error));
      // Use deep copy to avoid mutating the DEFAULT_STORAGE_DATA constant
      this.cache = JSON.parse(JSON.stringify(DEFAULT_STORAGE_DATA));
    }
  }

  private static setupEventListeners(): void {
    // Listen to tracker blocked events
    backgroundEvents.on('TRACKER_INCREMENT', async (data) => {
      await this.incrementTrackerBlock(data.domain, data.category, data.isHighRisk);
    });

    // Listen to score updates
    backgroundEvents.on('SCORE_UPDATED', async (data) => {
      await this.updateScore(data.newScore);
    });
  }

  static async get(): Promise<StorageData> {
    if (!this.cache) {
      await this.initialize();
    }
    return this.cache!;
  }

  static async getFresh(): Promise<StorageData> {
    const data = await chrome.storage.local.get('privacyData');
    if (data.privacyData) {
      this.cache = data.privacyData;
      return data.privacyData;
    }
    return await this.get();
  }

  static async save(data: StorageData): Promise<void> {
    await this.saveWithRetry(data);
  }

  static async savePenalizedDomains(penalizedDomains: Record<string, number>): Promise<void> {
    try {
      const data = await this.get();
      data.penalizedDomains = penalizedDomains;
      await this.save(data);
    } catch (error) {
      logger.error('Storage', 'Failed to save penalized domains', toError(error));
      throw error;
    }
  }

  private static async saveWithRetry(data: StorageData, attempt: number = 1): Promise<void> {
    try {
      await chrome.storage.local.set({ privacyData: data });
      this.cache = data;
    } catch (error) {
      const err = toError(error);
      
      if (attempt < STORAGE_RETRY.MAX_ATTEMPTS) {
        const delay = STORAGE_RETRY.INITIAL_DELAY_MS * Math.pow(STORAGE_RETRY.BACKOFF_MULTIPLIER, attempt - 1);
        logger.warn('Storage', `Storage save failed (attempt ${attempt}/${STORAGE_RETRY.MAX_ATTEMPTS}), retrying in ${delay}ms`, err);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.saveWithRetry(data, attempt + 1);
      } else {
        logger.error('Storage', `Storage save failed after ${STORAGE_RETRY.MAX_ATTEMPTS} attempts`, err);
        throw error;
      }
    }
  }

  private static scheduleSave(): void {
    this.isDirty = true;
    
    if (this.saveTimer) {
      clearTimeout(this.saveTimer as unknown as number);
    }
    
    this.saveTimer = setTimeout(() => this.flushToDisk(), this.SAVE_DELAY);
  }

  private static async flushToDisk(): Promise<void> {
    if (!this.isDirty || this.isSaving || !this.cache) return;
    
    this.isSaving = true;
    this.isDirty = false;
    
    try {
      await this.saveWithRetry(this.cache);
    } catch (error) {
      logger.error('Storage', 'Storage flush failed', toError(error));
      this.isDirty = true; // Retry on next operation
    } finally {
      this.isSaving = false;
    }
  }

  static async ensureSaved(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.flushToDisk();
  }

  static async updateScore(newScore: number): Promise<void> {
    const data = await this.get();
    data.privacyScore.current = Math.max(0, Math.min(100, newScore));
    // Critical operation: save immediately to prevent data loss
    await this.save(data);
  }

  static async addAlert(alert: Alert): Promise<void> {
    const data = await this.get();

    const isDuplicate = data.alerts.some(
      existing =>
        existing.domain === alert.domain &&
        existing.type === alert.type &&
        existing.message === alert.message &&
        Math.abs(existing.timestamp - alert.timestamp) < 60000
    );

    if (isDuplicate) {
      return;
    }

    data.alerts.unshift(alert);

    if (data.alerts.length > 100) {
      data.alerts = data.alerts.slice(0, 100);
    }

    this.scheduleSave();
  }

  static async incrementTrackerBlock(domain: string, category: string, isHighRisk: boolean): Promise<void> {
    const data = await this.get();

    if (!data.trackers[domain]) {
      data.trackers[domain] = {
        domain,
        category,
        isHighRisk,
        blockedCount: 0,
        lastBlocked: Date.now(),
      };
    }

    data.trackers[domain].blockedCount++;
    data.trackers[domain].lastBlocked = Date.now();
    data.privacyScore.daily.trackersBlocked++;

    this.scheduleSave();
  }

  static async recordCleanSite(): Promise<void> {
    const data = await this.get();
    data.privacyScore.daily.cleanSitesVisited++;
    this.scheduleSave();
  }

  static async recordNonCompliantSite(): Promise<void> {
    const data = await this.get();
    data.privacyScore.daily.nonCompliantSites++;
    this.scheduleSave();
  }

  private static getTodayCreditMetrics(data: StorageData): DailyCreditMetrics {
    const today = new Date().toISOString().split('T')[0];
    if (!data.dailyCreditMetrics) {
      data.dailyCreditMetrics = [];
    }

    let todayEntry = data.dailyCreditMetrics.find(entry => entry.date === today);

    if (!todayEntry) {
      todayEntry = {
        date: today,
        trackersBlocked: 0,
        cleanSitesVisited: 0,
        highRiskScore: 0,
        postConsentViolations: 0,
        protectionActiveMinutes: data.settings.protectionEnabled ? 24 * 60 : 0,
      };
      data.dailyCreditMetrics.unshift(todayEntry);
      data.dailyCreditMetrics = data.dailyCreditMetrics.slice(0, CREDIT_SCORE.METRICS_RETENTION_DAYS);
    }

    return todayEntry;
  }

  static async recordTrackerForCredit(riskWeight: number, isHighRisk: boolean): Promise<void> {
    const data = await this.get();
    const today = this.getTodayCreditMetrics(data);
    today.trackersBlocked += 1;
    const riskContribution = riskWeight * (isHighRisk ? 2 : 1);
    today.highRiskScore += riskContribution;
    this.scheduleSave();
  }

  static async recordCleanSiteForCredit(): Promise<void> {
    const data = await this.get();
    const today = this.getTodayCreditMetrics(data);
    today.cleanSitesVisited += 1;
    this.scheduleSave();
  }

  static async recordViolationForCredit(): Promise<void> {
    const data = await this.get();
    const today = this.getTodayCreditMetrics(data);
    today.postConsentViolations += 1;
    this.scheduleSave();
  }

  static async recordProtectionActive(minutes: number): Promise<void> {
    const data = await this.get();
    const today = this.getTodayCreditMetrics(data);
    today.protectionActiveMinutes += minutes;
    this.scheduleSave();
  }

  static async getDailyCreditMetrics(days: number = CREDIT_SCORE.METRICS_RETENTION_DAYS): Promise<DailyCreditMetrics[]> {
    const data = await this.get();
    return (data.dailyCreditMetrics ?? []).slice(0, days);
  }

  static async rotateDailyMetrics(): Promise<void> {
    const data = await this.get();
    this.getTodayCreditMetrics(data);
    data.dailyCreditMetrics = (data.dailyCreditMetrics ?? []).slice(0, CREDIT_SCORE.METRICS_RETENTION_DAYS);
    await this.save(data);
  }

  static async toggleProtection(): Promise<boolean> {
    const data = await this.get();
    data.settings.protectionEnabled = !data.settings.protectionEnabled;
    await this.save(data);
    return data.settings.protectionEnabled;
  }

  static async clearAlerts(): Promise<void> {
    const data = await this.get();
    data.alerts = [];
    await this.save(data);
  }

  private static async checkDailyReset(): Promise<void> {
    const data = await this.get();
    const now = Date.now();
    const lastReset = data.lastReset;

    if (now - lastReset >= TIME.ONE_DAY_MS) {
      const historyEntry = {
        date: new Date(lastReset).toISOString().split('T')[0],
        score: data.privacyScore.current,
        trackersBlocked: data.privacyScore.daily.trackersBlocked,
      };

      data.privacyScore.history.unshift(historyEntry);

      if (data.privacyScore.history.length > 30) {
        data.privacyScore.history = data.privacyScore.history.slice(0, 30);
      }

      // Create daily metrics snapshot before reset
      await this.createDailySnapshot(data);

      // Daily Recovery Mechanism: Reward clean browsing days
      // If user had a good day (fewer than threshold trackers), give recovery points
      // This encourages long-term engagement and allows recovery from bad days
      const hadCleanDay = data.privacyScore.daily.trackersBlocked < DAILY_RECOVERY.CLEAN_DAY_THRESHOLD;
      const hadVeryCleanDay = data.privacyScore.daily.trackersBlocked < DAILY_RECOVERY.VERY_CLEAN_DAY_THRESHOLD;

      if (hadVeryCleanDay) {
        // Very clean day: reward points
        data.privacyScore.current = Math.min(100, data.privacyScore.current + DAILY_RECOVERY.VERY_CLEAN_DAY_REWARD);
      } else if (hadCleanDay) {
        // Clean day: reward points
        data.privacyScore.current = Math.min(100, data.privacyScore.current + DAILY_RECOVERY.CLEAN_DAY_REWARD);
      }

      // Reset daily counters
      data.privacyScore.daily = {
        trackersBlocked: 0,
        cleanSitesVisited: 0,
        nonCompliantSites: 0,
      };
      data.burnerEmailStats = {
        generated: 0,
        forwarded: 0,
      };
      data.complianceScores = [];
      data.lastReset = now;

      // Ensure a fresh credit metrics entry exists for the new day
      this.ensureCreditDefaults(data);
      this.getTodayCreditMetrics(data);

      await this.save(data);
    }
  }

  private static ensureCreditDefaults(data: StorageData): void {
    if (!data.creditScore) {
      const now = Date.now();
      data.creditScore = {
        score: CREDIT_SCORE.BASE,
        label: 'Fair',
        trend: 'stable',
        formulaVersion: SCORING_CONFIG.DEFAULT_VERSION,
        factors: {
          protectionConsistency: { value: 0, impact: 0 },
          cleanBrowsing: { value: 0, impact: 0 },
          highRiskExposure: { value: 0, impact: 0 },
          violations: { value: 0, impact: 0 },
        },
        lastCalculated: now,
      };
    } else if (!data.creditScore.formulaVersion) {
      data.creditScore.formulaVersion = SCORING_CONFIG.DEFAULT_VERSION;
    }

    if (!data.dailyCreditMetrics) {
      data.dailyCreditMetrics = [];
    }
  }

  private static async createDailySnapshot(data: StorageData): Promise<void> {
    try {
      const trackersByCategory: Record<string, number> = {};

      for (const tracker of Object.values(data.trackers)) {
        trackersByCategory[tracker.category] = (trackersByCategory[tracker.category] || 0) + tracker.blockedCount;
      }

      const snapshot: DailyMetricsSnapshot = {
        date: new Date(data.lastReset).toISOString().split('T')[0],
        privacyScore: data.privacyScore.current,
        trackersBlocked: data.privacyScore.daily.trackersBlocked,
        trackersByCategory,
        cleanSitesVisited: data.privacyScore.daily.cleanSitesVisited,
        nonCompliantSites: data.privacyScore.daily.nonCompliantSites,
        complianceScores: data.complianceScores || [],
        burnerEmailsGenerated: data.burnerEmailStats?.generated || 0,
        burnerEmailsForwarded: data.burnerEmailStats?.forwarded || 0,
      };

      if (!data.dailySnapshots) {
        data.dailySnapshots = [];
      }

      data.dailySnapshots.unshift(snapshot);

      // Keep last N days for portability/reporting consistency.
      if (data.dailySnapshots.length > DATA_EXPORT.MAX_SNAPSHOT_DAYS) {
        data.dailySnapshots = data.dailySnapshots.slice(0, DATA_EXPORT.MAX_SNAPSHOT_DAYS);
      }

      logger.info('Storage', 'Daily metrics snapshot created', {
        date: snapshot.date,
        trackersBlocked: snapshot.trackersBlocked,
        privacyScore: snapshot.privacyScore,
      });
    } catch (error) {
      logger.error('Storage', 'Failed to create daily snapshot', toError(error));
    }
  }

  static async clear(): Promise<void> {
    await chrome.storage.local.clear();
    this.cache = null;
    await this.initialize();
  }

  static async getConsentState(domain: string): Promise<LocalConsentState | null> {
    const data = await this.get();
    return data.consentStates[domain] || null;
  }

  static async setConsentState(domain: string, state: LocalConsentState): Promise<void> {
    const data = await this.get();
    data.consentStates[domain] = state;
    this.scheduleSave();
    logger.info('Storage', 'Consent state saved', { domain, status: state.consentStatus, cmpId: state.cmpId });
  }

  static async getAllowlistEntries(): Promise<Record<string, AllowlistEntry>> {
    const data = await this.get();
    return data.allowlist ?? {};
  }

  static async setAllowlistEntry(domain: string, entry: AllowlistEntry): Promise<void> {
    const data = await this.get();
    if (!data.allowlist) {
      data.allowlist = {};
    }
    data.allowlist[domain] = entry;
    await this.save(data);
  }

  static async removeAllowlistEntry(domain: string): Promise<void> {
    const data = await this.get();
    if (!data.allowlist) {
      return;
    }
    delete data.allowlist[domain];
    await this.save(data);
  }

  private static normalizeDomain(domain: string): string {
    const normalized = domain.trim().toLowerCase();
    return normalized.startsWith('www.') ? normalized.slice(4) : normalized;
  }

  private static pruneExpiredFalsePositiveReports(data: StorageData): boolean {
    if (!data.reportedFalsePositives) {
      data.reportedFalsePositives = {};
      return false;
    }

    const expiryMs = FALSE_POSITIVE_FEEDBACK.LOCAL_REPORT_EXPIRY_DAYS * TIME.ONE_DAY_MS;
    const now = Date.now();
    let changed = false;

    for (const [domain, entry] of Object.entries(data.reportedFalsePositives)) {
      if (now - entry.timestamp > expiryMs) {
        delete data.reportedFalsePositives[domain];
        changed = true;
      }
    }

    return changed;
  }

  static async getReportedFalsePositives(): Promise<Record<string, ReportedFalsePositive>> {
    const data = await this.get();
    const pruned = this.pruneExpiredFalsePositiveReports(data);
    if (pruned) {
      await this.save(data);
    }
    return data.reportedFalsePositives ?? {};
  }

  static async getReportedFalsePositive(domain: string): Promise<ReportedFalsePositive | null> {
    const normalized = this.normalizeDomain(domain);
    const entries = await this.getReportedFalsePositives();
    return entries[normalized] ?? null;
  }

  static async setReportedFalsePositive(domain: string, reason: FalsePositiveReason): Promise<void> {
    const data = await this.get();
    if (!data.reportedFalsePositives) {
      data.reportedFalsePositives = {};
    }

    const normalized = this.normalizeDomain(domain);
    data.reportedFalsePositives[normalized] = {
      timestamp: Date.now(),
      reason,
    };
    await this.save(data);
  }

  static async incrementDomainOccurrence(domain: string): Promise<number> {
    const data = await this.get();
    const currentCount = data.domainOccurrences[domain] || 0;
    const newCount = currentCount + 1;
    data.domainOccurrences[domain] = newCount;
    this.scheduleSave();
    return newCount;
  }

  static async getDomainOccurrence(domain: string): Promise<number> {
    const data = await this.get();
    return data.domainOccurrences[domain] || 0;
  }

  static async clearExpiredConsentStates(): Promise<void> {
    const data = await this.get();
    const now = Date.now();
    let clearedCount = 0;

    Object.keys(data.consentStates).forEach(domain => {
      const state = data.consentStates[domain];
      if (state.expiresAt && state.expiresAt < now) {
        delete data.consentStates[domain];
        clearedCount++;
      }
    });

    if (clearedCount > 0) {
      await this.save(data);
      logger.info('Storage', 'Expired consent states cleared', { count: clearedCount });
    }
  }

  static async recordComplianceScore(score: number): Promise<void> {
    const data = await this.get();
    if (!data.complianceScores) {
      data.complianceScores = [];
    }
    data.complianceScores.push(score);
    this.scheduleSave();
  }

  static async recordBurnerEmailGenerated(): Promise<void> {
    const data = await this.get();
    if (!data.burnerEmailStats) {
      data.burnerEmailStats = { generated: 0, forwarded: 0 };
    }
    data.burnerEmailStats.generated++;
    this.scheduleSave();
    logger.info('Storage', 'Burner email generated recorded', {
      total: data.burnerEmailStats.generated,
    });
  }

  static async recordBurnerEmailForwarded(): Promise<void> {
    const data = await this.get();
    if (!data.burnerEmailStats) {
      data.burnerEmailStats = { generated: 0, forwarded: 0 };
    }
    data.burnerEmailStats.forwarded++;
    this.scheduleSave();
    logger.info('Storage', 'Burner email forwarded recorded', {
      total: data.burnerEmailStats.forwarded,
    });
  }

  static async getDailySnapshots(days: number = 7): Promise<DailyMetricsSnapshot[]> {
    const data = await this.get();
    return (data.dailySnapshots || []).slice(0, days);
  }

  static async getTheme(): Promise<'light' | 'dark' | 'system'> {
    const data = await this.get();
    return data.settings.theme || 'system';
  }

  /**
   * Gets the current burner email feature enabled state.
   * 
   * @returns A promise that resolves to `true` if the feature is enabled, `false` if disabled.
   *          Defaults to `false` if the setting has never been explicitly set.
   * 
   * @remarks
   * The method uses the nullish coalescing operator (`??`) to return `false` as the default value
   * when the setting is `null` or `undefined`. This ensures the feature starts disabled for new
   * users or when the setting hasn't been persisted yet.
   */
  static async getBurnerEmailEnabled(): Promise<boolean> {
    const data = await this.get();
    const value = data.settings.burnerEmailEnabled;
    const result = typeof value === 'boolean' ? value : false;
    logger.debug('Storage', 'getBurnerEmailEnabled', { rawValue: value, result });
    return result;
  }

  /**
   * Sets the burner email feature enabled state.
   * 
   * @param enabled - The new enabled state: `true` to enable the feature, `false` to disable it.
   * 
   * @remarks
   * Side Effects:
   * - Updates the in-memory setting immediately
   * - Persists the change to storage immediately (awaited save operation)
   * - Logs an info message with both previous and new values for audit trail
   * 
   * Persistence:
   * - The save operation is immediate (awaited) to ensure the setting is persisted
   * - User-initiated setting changes are saved synchronously to prevent data loss
   * - The setting is persisted to `chrome.storage.local` immediately
   * 
   * @example
   * ```typescript
   * await Storage.setBurnerEmailEnabled(true);
   * ```
   */
  static async setBurnerEmailEnabled(enabled: boolean): Promise<void> {
    const data = await this.get();
    const previousValue = data.settings.burnerEmailEnabled ?? false;
    data.settings.burnerEmailEnabled = enabled;
    await this.save(data);
    logger.info('Storage', 'Burner email setting updated', { previousValue, newValue: enabled });
  }

  static async getTelemetryEnabled(): Promise<boolean> {
    const data = await this.get();
    const value = data.settings.telemetryEnabled;
    return typeof value === 'boolean' ? value : false;
  }

  /**
   * Sets the telemetry feature enabled state.
   * 
   * @param enabled - The new enabled state: `true` to enable the feature, `false` to disable it.
   * 
   * @remarks
   * Side Effects:
   * - Updates the in-memory setting immediately
   * - Persists the change to storage immediately (awaited save operation)
   * - Logs an info message with both previous and new values for audit trail
   * 
   * Persistence:
   * - The save operation is immediate (awaited) to ensure the setting is persisted
   * - User-initiated setting changes are saved synchronously to prevent data loss
   * - The setting is persisted to `chrome.storage.local` immediately
   * 
   * @example
   * ```typescript
   * await Storage.setTelemetryEnabled(true);
   * ```
   */
  static async setTelemetryEnabled(enabled: boolean): Promise<void> {
    const data = await this.get();
    const previousValue = data.settings.telemetryEnabled ?? false;
    data.settings.telemetryEnabled = enabled;
    await this.save(data);
    logger.info('Storage', 'Telemetry setting updated', { previousValue, newValue: enabled });
  }

  /**
   * Sets the theme preference.
   * 
   * @param theme - The theme preference: 'light', 'dark', or 'system'.
   * 
   * @remarks
   * Side Effects:
   * - Updates the in-memory theme setting immediately
   * - Persists the change to storage immediately (awaited save operation)
   * - Logs an info message with the new theme value
   * 
   * Persistence:
   * - The save operation is immediate (awaited) to ensure the theme is persisted
   * - User-initiated setting changes are saved synchronously to prevent data loss
   * - The setting is persisted to `chrome.storage.local` immediately
   * 
   * @example
   * ```typescript
   * await Storage.setTheme('dark');
   * ```
   */
  static async setTheme(theme: 'light' | 'dark' | 'system'): Promise<void> {
    const data = await this.get();
    data.settings.theme = theme;
    await this.save(data);
    logger.info('Storage', 'Theme preference updated', { theme });
  }

  static async updateTheme(theme: 'light' | 'dark' | 'system'): Promise<void> {
    await this.setTheme(theme);
  }

  /**
   * Gets the user's real email address for forwarding.
   * 
   * @returns A promise that resolves to the real email address, or `null` if not set.
   * 
   * @remarks
   * The real email is used to forward emails received at burner email addresses.
   * This email is stored locally in Chrome storage and is never shared with third parties.
   * 
   * @example
   * ```typescript
   * const realEmail = await Storage.getRealEmail();
   * if (realEmail) {
   *   console.log('Real email configured:', realEmail);
   * }
   * ```
   */
  static async getRealEmail(): Promise<string | null> {
    const data = await this.get();
    const result = data.realEmail || null;
    logger.debug('Storage', 'getRealEmail', { hasRealEmail: !!result });
    return result;
  }

  /**
   * Sets the user's real email address for forwarding.
   * 
   * @param email - The real email address to use for forwarding. Must be a valid email format.
   * 
   * @remarks
   * Side Effects:
   * - Updates the in-memory real email immediately
   * - Persists the change to storage immediately (awaited save operation)
   * - Logs an info message with the masked email for audit trail
   * 
   * Validation:
   * - The email is validated using a basic regex pattern
   * - Invalid emails will throw an error
   * 
   * Persistence:
   * - The save operation is immediate (awaited) to ensure the email is persisted
   * - User-initiated setting changes are saved synchronously to prevent data loss
   * - The email is persisted to `chrome.storage.local` immediately
   * 
   * Privacy:
   * - The email is stored locally and never transmitted except when generating burner emails
   * - Only the masked version (first character + domain) is logged
   * 
   * @example
   * ```typescript
   * await Storage.setRealEmail('user@example.com');
   * ```
   */
  static async setRealEmail(email: string): Promise<void> {
    // Basic email validation
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      throw new Error('Invalid email format');
    }

    const data = await this.get();
    const previousEmail = data.realEmail;
    data.realEmail = email.trim().toLowerCase();
    await this.save(data);
    
    // Mask email for logging (show first char + domain)
    const maskEmail = (email: string): string => {
      const [local, domain] = email.split('@');
      if (!domain) return '***';
      const maskedLocal = local.length > 0 ? local[0] + '***' : '***';
      return `${maskedLocal}@${domain}`;
    };
    
    logger.info('Storage', 'Real email updated', {
      previousEmail: previousEmail ? maskEmail(previousEmail) : null,
      newEmail: maskEmail(data.realEmail),
    });
  }

  static async getOnboardingState(): Promise<OnboardingState> {
    const data = await this.get();
    return { ...data.onboarding };
  }

  static async setOnboardingStep(
    step: number,
    timing?: {
      stepId?: string;
      previousStepId?: string;
      enteredAt?: number;
      exitedAt?: number;
      durationMs?: number;
    }
  ): Promise<OnboardingState> {
    const normalizedStep = Math.max(0, Math.min(ONBOARDING.TOTAL_STEPS - 1, step));
    const now = Date.now();
    const enteredAt = typeof timing?.enteredAt === 'number' ? timing.enteredAt : now;
    const stepId = typeof timing?.stepId === 'string' ? timing.stepId : `step-${normalizedStep + 1}`;
    const data = await this.get();
    const current = this.normalizeOnboardingState(data.onboarding);

    const stepTimings = this.closeOpenOnboardingStep(
      current.stepTimings ?? [],
      typeof timing?.exitedAt === 'number' ? timing.exitedAt : enteredAt,
      timing?.durationMs,
      timing?.previousStepId
    );
    stepTimings.push({ stepIndex: normalizedStep, stepId, enteredAt });

    const normalized = this.normalizeOnboardingState({
      ...current,
      currentStep: normalizedStep,
      hasCompletedOnboarding: false,
      completedAt: undefined,
      skippedAt: undefined,
      startedAt: current.startedAt ?? enteredAt,
      stepTimings,
    });
    data.onboarding = normalized;
    await this.save(data);
    return normalized;
  }

  static async completeOnboarding(emailConfigured?: boolean): Promise<OnboardingState> {
    const now = Date.now();
    const data = await this.get();
    const current = this.normalizeOnboardingState(data.onboarding);
    const stepTimings = this.closeOpenOnboardingStep(current.stepTimings ?? [], now);
    const normalized = this.normalizeOnboardingState({
      ...current,
      hasCompletedOnboarding: true,
      currentStep: ONBOARDING.TOTAL_STEPS - 1,
      completedAt: now,
      emailConfigured: emailConfigured ?? undefined,
      startedAt: current.startedAt ?? now,
      stepTimings,
    });
    data.onboarding = normalized;
    await this.save(data);
    return normalized;
  }

  static async skipOnboarding(atStep: number): Promise<OnboardingState> {
    const normalizedStep = Math.max(0, Math.min(ONBOARDING.TOTAL_STEPS - 1, atStep));
    const now = Date.now();
    const data = await this.get();
    const current = this.normalizeOnboardingState(data.onboarding);
    const stepTimings = this.closeOpenOnboardingStep(current.stepTimings ?? [], now);
    const normalized = this.normalizeOnboardingState({
      ...current,
      hasCompletedOnboarding: true,
      skippedAt: now,
      currentStep: normalizedStep,
      startedAt: current.startedAt ?? now,
      stepTimings,
    });
    data.onboarding = normalized;
    await this.save(data);
    return normalized;
  }

  private static ensureOnboardingState(data: StorageData): void {
    if (!data.onboarding) {
      data.onboarding = { ...DEFAULT_ONBOARDING_STATE };
      return;
    }

    data.onboarding = this.normalizeOnboardingState(data.onboarding);
  }

  private static normalizeOnboardingState(state: Partial<OnboardingState>): OnboardingState {
    const normalizedStep =
      typeof state.currentStep === 'number'
        ? Math.max(0, Math.min(ONBOARDING.TOTAL_STEPS - 1, state.currentStep))
        : 0;
    const stepTimings = Array.isArray(state.stepTimings)
      ? state.stepTimings
          .filter((timing): timing is OnboardingStepTiming =>
            typeof timing?.stepIndex === 'number' &&
            typeof timing?.stepId === 'string' &&
            typeof timing?.enteredAt === 'number'
          )
          .map((timing) => ({
            stepIndex: Math.max(0, Math.min(ONBOARDING.TOTAL_STEPS - 1, timing.stepIndex)),
            stepId: timing.stepId,
            enteredAt: timing.enteredAt,
            exitedAt: typeof timing.exitedAt === 'number' ? timing.exitedAt : undefined,
            durationMs: typeof timing.durationMs === 'number' ? timing.durationMs : undefined,
          }))
      : [];

    return {
      hasCompletedOnboarding: Boolean(state.hasCompletedOnboarding),
      currentStep: normalizedStep,
      completedAt: typeof state.completedAt === 'number' ? state.completedAt : undefined,
      skippedAt: typeof state.skippedAt === 'number' ? state.skippedAt : undefined,
      emailConfigured:
        typeof state.emailConfigured === 'boolean' ? state.emailConfigured : undefined,
      startedAt: typeof state.startedAt === 'number' ? state.startedAt : undefined,
      stepTimings,
    };
  }

  private static closeOpenOnboardingStep(
    timings: OnboardingStepTiming[],
    exitedAt: number,
    durationMs?: number,
    previousStepId?: string
  ): OnboardingStepTiming[] {
    const nextTimings = [...timings];
    let openIndex = -1;

    for (let idx = nextTimings.length - 1; idx >= 0; idx -= 1) {
      const timing = nextTimings[idx];
      if (timing.exitedAt !== undefined) {
        continue;
      }
      if (previousStepId && timing.stepId !== previousStepId) {
        continue;
      }
      openIndex = idx;
      break;
    }

    if (openIndex === -1) {
      return nextTimings;
    }

    const target = nextTimings[openIndex];
    const safeExitedAt = Math.max(target.enteredAt, exitedAt);
    const computedDuration =
      typeof durationMs === 'number' && durationMs >= 0
        ? durationMs
        : Math.max(0, safeExitedAt - target.enteredAt);

    nextTimings[openIndex] = {
      ...target,
      exitedAt: safeExitedAt,
      durationMs: computedDuration,
    };
    return nextTimings;
  }
}
