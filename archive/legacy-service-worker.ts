/**
 * ARCHIVED FILE
 * Original Author: Jaspreet
 * Reason: Replaced by new Privacy Advisor / Alternative Finder implementation
 * Date Archived: 2026-04-16
 * This file is preserved for historical reference and is not used in production.
 */

import { Storage } from './storage';
import { FirewallEngine } from './firewall-engine';
import { PrivacyScoreManager } from './privacy-score';
import { burnerEmailService } from './burner-email-service';
import { feedbackTelemetryService } from './feedback-telemetry-service';
import type {
  CMPSuggestion,
  ConsentScanResultV2,
  FalsePositiveStatus,
  FalsePositiveReport,
  MessageDataMap,
  RemoteCMPConfig,
  StorageData,
} from '../types';
import { logger } from '../utils/logger';
import { messageBus } from '../utils/message-bus';
import { tabManager } from '../utils/tab-manager';
import { backgroundEvents } from './event-emitter';
import { toError, isGetTrackerInfoData, isConsentScanResult } from '../utils/type-guards';
import { sanitizeUrl } from '../utils/sanitizer';
import {
  BADGE,
  TIME,
  CONSENT_VIOLATION,
  SUPABASE,
  ONBOARDING,
  FALSE_POSITIVE_FEEDBACK,
  SCORING_CONFIG,
  CMP_CONFIG,
} from '../utils/constants';
import { validateComplianceScore, validateEventPayload, validateFeedbackPayload } from '../utils/validation';
import { AllowlistManager } from '../utils/allowlist-manager';
import { FalsePositiveService } from './false-positive-service';
import { fetchScoringConfig, getScoringConfig } from './scoring-config';
import { MetricsAggregationService } from './metrics-aggregation';
import { DataExportService } from './data-export-service';

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;
const consentAlertCache = new Map<string, number>(); // Track consent alerts by domain
const consentRejectionCache = new Map<string, { timestamp: number; tabId?: number }>();
const fpOverridesCache = new Map<string, { threshold: number; reportCount: number; lastUpdated: string }>();

const CONSENT_PERSIST_ENDPOINT = `${SUPABASE.URL}/functions/v1/persist-consent-state`;
const FP_OVERRIDES_ENDPOINT = `${SUPABASE.URL}${FALSE_POSITIVE_FEEDBACK.OVERRIDES_ENDPOINT}`;
const CMP_CONFIG_ENDPOINT = `${SUPABASE.URL}${CMP_CONFIG.ENDPOINT}`;
const CMP_SUGGESTION_ENDPOINT = `${SUPABASE.URL}/functions/v1/suggest-cmp-pattern`;
const CMP_CONFIG_STORAGE_KEY = 'cmpConfigCache';

export function getConsentRejection(domain: string): { timestamp: number; tabId?: number } | null {
  const entry = consentRejectionCache.get(domain);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.timestamp > CONSENT_VIOLATION.REJECTION_WINDOW_MS) {
    consentRejectionCache.delete(domain);
    return null;
  }

  return entry;
}

FirewallEngine.setConsentRejectionProvider(getConsentRejection);

function normalizeDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase();
  return normalized.startsWith('www.') ? normalized.slice(4) : normalized;
}

function normalizeConfidenceScore(score: number | undefined): number | undefined {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return undefined;
  }
  // Support both normalized [0..1] and percentage [0..100] confidence scales.
  return score <= 1 ? score * 100 : score;
}

async function fetchFalsePositiveOverrides(): Promise<void> {
  try {
    const response = await fetch(FP_OVERRIDES_ENDPOINT, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE.ANON_KEY}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn('ServiceWorker', 'Failed to fetch false positive overrides', {
        status: response.status,
        error: errorText,
      });
      return;
    }

    const payload = (await response.json()) as {
      overrides?: Record<string, { threshold?: number; reportCount?: number; lastUpdated?: string }>;
    };

    const overrides = payload.overrides ?? {};
    fpOverridesCache.clear();

    for (const [domain, entry] of Object.entries(overrides)) {
      if (!entry || typeof entry.threshold !== 'number') {
        continue;
      }
      fpOverridesCache.set(normalizeDomain(domain), {
        threshold: entry.threshold,
        reportCount: typeof entry.reportCount === 'number' ? entry.reportCount : 0,
        lastUpdated: entry.lastUpdated ?? new Date().toISOString(),
      });
    }

    logger.debug('ServiceWorker', 'False positive overrides refreshed', {
      overrideCount: fpOverridesCache.size,
    });
  } catch (error) {
    logger.error('ServiceWorker', 'Error fetching false positive overrides', toError(error));
  }
}

function buildFalsePositiveStatuses(data: StorageData): Record<string, FalsePositiveStatus> {
  const statuses: Record<string, FalsePositiveStatus> = {};
  const reported = data.reportedFalsePositives ?? {};
  const domains = new Set<string>(Object.keys(reported));

  for (const alert of data.alerts) {
    if (alert.type !== 'non_compliant_site') {
      continue;
    }
    domains.add(normalizeDomain(alert.domain));
  }

  for (const domain of domains) {
    const override = fpOverridesCache.get(domain);
    const report = reported[domain];
    statuses[domain] = {
      threshold: override?.threshold ?? FALSE_POSITIVE_FEEDBACK.BASE_THRESHOLD,
      reportCount: override?.reportCount ?? 0,
      hasOverride: Boolean(override),
      userReported: Boolean(report),
      userReason: report?.reason,
      reportedAt: report?.timestamp,
    };
  }

  return statuses;
}

function isRemoteCmpConfig(value: unknown): value is RemoteCMPConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    Array.isArray((value as { cookiePatterns?: unknown }).cookiePatterns) &&
    Array.isArray((value as { bannerSelectors?: unknown }).bannerSelectors)
  );
}

async function fetchCmpConfig(): Promise<void> {
  try {
    const response = await fetch(CMP_CONFIG_ENDPOINT, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE.ANON_KEY}`,
      },
    });

    if (!response.ok) {
      logger.warn('ServiceWorker', 'Failed to fetch CMP config', {
        status: response.status,
      });
      return;
    }

    const payload = (await response.json()) as { configs?: unknown };
    const configs = Array.isArray(payload.configs) ? payload.configs.filter(isRemoteCmpConfig) : [];

    await new Promise<void>((resolve, reject) => {
      chrome.storage.local.set({ [CMP_CONFIG_STORAGE_KEY]: configs }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });

    logger.debug('ServiceWorker', 'CMP config refreshed', { configCount: configs.length });
  } catch (error) {
    logger.error('ServiceWorker', 'Error fetching CMP config', toError(error));
  }
}

async function submitCmpSuggestion(suggestion: CMPSuggestion): Promise<boolean> {
  try {
    const installationId = suggestion.installationId || await feedbackTelemetryService.getInstallationId();
    const response = await fetch(CMP_SUGGESTION_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE.ANON_KEY}`,
      },
      body: JSON.stringify({
        ...suggestion,
        installationId,
        pageUrl: sanitizeUrl(suggestion.pageUrl) || '',
      }),
    });

    return response.ok;
  } catch (error) {
    logger.error('ServiceWorker', 'Failed to submit CMP suggestion', toError(error), {
      domain: suggestion.domain,
      pageUrl: sanitizeUrl(suggestion.pageUrl),
    });
    return false;
  }
}

async function initializeExtension(): Promise<void> {
  // If already initialized, skip
  if (isInitialized) {
    return;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {

      // Initialize utilities first (logger auto-initializes on first use)
      await messageBus.initialize();
      await tabManager.initialize();

      // Initialize event-driven components (sets up event listeners)
      await PrivacyScoreManager.initialize();

      // Initialize core components
      await Storage.initialize();
      await FirewallEngine.initialize();
      await burnerEmailService.initialize();
      await feedbackTelemetryService.initialize();
      void fetchFalsePositiveOverrides();
      void fetchCmpConfig();
      void fetchScoringConfig();

      await chrome.action.setBadgeBackgroundColor({ color: BADGE.BACKGROUND_COLOR });

      setupMessageHandlers();
      setupStorageChangeListener();
      setupTabEventHandlers();
      setupCleanupInterval();
      isInitialized = true;
    } catch (error) {
      logger.error('ServiceWorker', 'Extension initialization failed', toError(error));
      initializationPromise = null; // Reset on error so retry is possible
      throw error;
    }
  })();

  return initializationPromise;
}

function setupMessageHandlers(): void {
  messageBus.on('GET_STATE', async () => {
    const data = await Storage.getFresh();
    const falsePositiveStatuses = buildFalsePositiveStatuses(data);
    return { success: true, data, falsePositiveStatuses };
  });

  messageBus.on('GET_CREDIT_SCORE', async () => {
    const creditScore = await PrivacyScoreManager.getCurrentCreditScore();
    return { success: true, creditScore };
  });

  messageBus.on('GET_SCORING_CONFIG', async () => {
    return { success: true, config: getScoringConfig() };
  });

  messageBus.on('TOGGLE_PROTECTION', async () => {
    const enabled = await FirewallEngine.toggleProtection();
    feedbackTelemetryService.trackEvent({
      eventType: 'protection_toggled',
      eventData: { enabled },
    // Stryker disable next-line all: logging only
    }).catch(err => logger.debug('ServiceWorker', 'Telemetry failed', err));
    return { success: true, enabled };
  });

  messageBus.on('CLEAR_ALERTS', async () => {
    await Storage.clearAlerts();
    return { success: true };
  });

  messageBus.on('GET_ALLOWLIST', async () => {
    const entries = await AllowlistManager.getEntries();
    return { success: true, entries };
  });

  messageBus.on('ADD_TO_ALLOWLIST', async (data: unknown) => {
    const payload = data as { domain: string; source?: 'user' };
    if (!payload?.domain) {
      return { success: false, error: 'Invalid allowlist domain' };
    }
    await AllowlistManager.addEntry(payload.domain, payload.source ?? 'user');
    return { success: true };
  });

  messageBus.on('REMOVE_FROM_ALLOWLIST', async (data: unknown) => {
    const payload = data as { domain: string };
    if (!payload?.domain) {
      return { success: false, error: 'Invalid allowlist domain' };
    }
    await AllowlistManager.removeEntry(payload.domain);
    return { success: true };
  });

  messageBus.on('REFRESH_CMP_CONFIG', async () => {
    await fetchCmpConfig();
    return { success: true };
  });

  messageBus.on('SUGGEST_CMP_PATTERN', async (data: unknown) => {
    const payload = data as CMPSuggestion;
    if (!payload?.domain || !payload?.pageUrl) {
      return { success: false, error: 'Invalid CMP suggestion payload' };
    }

    const success = await submitCmpSuggestion(payload);
    return success ? { success: true } : { success: false, error: 'Failed to submit CMP suggestion' };
  });

  messageBus.on('REPORT_FALSE_POSITIVE', async (data: unknown) => {
    const payload = data as FalsePositiveReport;
    try {
      const normalizedDomain = normalizeDomain(payload.domain);
      const existingReport = await Storage.getReportedFalsePositive(normalizedDomain);
      if (existingReport) {
        return {
          success: false,
          alreadyReported: true,
          reportCount: fpOverridesCache.get(normalizedDomain)?.reportCount ?? 0,
        };
      }

      const installationId = payload.installationId || await feedbackTelemetryService.getInstallationId();
      const report: FalsePositiveReport = {
        ...payload,
        domain: normalizedDomain,
        installationId,
      };
      const result = await FalsePositiveService.reportFalsePositive(report);
      if (!result.success) {
        return { success: false, error: 'Failed to report false positive' };
      }

      await Storage.setReportedFalsePositive(normalizedDomain, payload.reason);
      await AllowlistManager.addEntry(payload.domain, 'user');
      if (result.aggregation?.shouldOverride && typeof result.aggregation.overrideThreshold === 'number') {
        fpOverridesCache.set(normalizedDomain, {
          threshold: result.aggregation.overrideThreshold,
          reportCount: result.aggregation.reportCount,
          lastUpdated: new Date().toISOString(),
        });
      }

      return {
        success: true,
        reportCount: result.aggregation?.reportCount ?? (fpOverridesCache.get(normalizedDomain)?.reportCount ?? 0),
        alreadyOverridden: Boolean(
          result.aggregation?.shouldOverride || fpOverridesCache.get(normalizedDomain)
        ),
      };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to report false positive', toError(error));
      return { success: false, error: 'Failed to report false positive' };
    }
  });

  messageBus.on('GET_TRACKER_INFO', async (data: unknown) => {
    if (!isGetTrackerInfoData(data)) {
      return { success: false, error: 'Invalid data: domain not provided' };
    }
    const info = FirewallEngine.getTrackerInfo(data.domain);
    return { success: true, info };
  });

  messageBus.on('CONSENT_SCAN_RESULT', async (data: unknown, sender) => {
    if (!isConsentScanResult(data)) {
      return { success: false, error: 'Invalid consent scan result data' };
    }
    const result = data as ConsentScanResultV2;

    const urlObj = new URL(result.url);
    const domain = urlObj.hostname;

    if (result.cmpDetection?.consentStatus === 'rejected') {
      consentRejectionCache.set(domain, {
        timestamp: Date.now(),
        tabId: sender?.tab?.id ?? undefined,
      });
      logger.info('ServiceWorker', 'Consent rejection recorded', {
        domain,
        cmpType: result.cmpDetection?.cmpType,
        tabId: sender?.tab?.id,
      });
    }

    if (result.hasPersistedConsent) {
      logger.info('ServiceWorker', 'Site has valid persisted consent, skipping penalty', {
        domain,
        cmpType: result.cmpDetection?.cmpType,
        consentStatus: result.cmpDetection?.consentStatus,
      });
      return { success: true };
    }

    if (!result.isCompliant) {
      const isAllowlisted = await AllowlistManager.isAllowlisted(domain);
      if (isAllowlisted) {
        logger.info('ServiceWorker', 'Allowlisted domain skipped for alert', { domain });
      } else {
      const normalizedDomain = normalizeDomain(domain);
      const override = fpOverridesCache.get(normalizedDomain);
      const effectiveThreshold = override?.threshold ?? FALSE_POSITIVE_FEEDBACK.BASE_THRESHOLD;
      const scanConfidence = normalizeConfidenceScore(result.confidence?.overall);

      if (typeof scanConfidence === 'number' && scanConfidence < effectiveThreshold) {
        logger.info('ServiceWorker', 'Alert skipped due to domain confidence override', {
          domain: normalizedDomain,
          scanConfidence,
          threshold: effectiveThreshold,
          reportCount: override?.reportCount ?? 0,
        });
      } else {
        // Check if we've already alerted about this domain recently (within 5 minutes)
        const lastAlertTime = consentAlertCache.get(domain);
        const now = Date.now();

        // If we've alerted within 5 minutes, skip
        if (lastAlertTime && now - lastAlertTime < 300000) {
          return { success: true };
        }

        // Also check if there's already a recent alert in storage
        const storageData = await Storage.get();
        const messageText = `${domain} may not follow privacy best practices`;
        const recentAlert = storageData.alerts.find(
          a => a.domain === domain &&
          a.message.includes(messageText) &&
          now - a.timestamp < 300000 // 5 minutes
        );

        if (recentAlert) {
          // Update cache to prevent future checks
          consentAlertCache.set(domain, now);
          return { success: true };
        }

        // Set cache BEFORE creating alert to prevent race conditions
        consentAlertCache.set(domain, now);

        // Calculate severity based on deceptive patterns
        let severity: 'low' | 'medium' | 'high' = 'medium';
        let severityMultiplier = 1.0;

        if (result.deceptivePatterns && result.deceptivePatterns.length > 0) {
          if (result.deceptivePatterns.includes('forcedConsent')) {
            severity = 'high';
            severityMultiplier = 2.0;
          } else if (result.deceptivePatterns.includes('hiddenRejectButton')) {
            severity = 'high';
            severityMultiplier = 1.5;
          } else if (result.deceptivePatterns.includes('acceptButtonProminence')) {
            severity = 'medium';
            severityMultiplier = 1.0;
          }
        }

        // Emit non-compliant site event with severity multiplier
        backgroundEvents.emit('NON_COMPLIANT_SITE', {
          domain,
          url: result.url,
          deceptivePatterns: result.deceptivePatterns || [],
          severityMultiplier,
        });

        await Storage.addAlert({
          id: `${Date.now()}-${Math.random()}`,
          type: 'non_compliant_site',
          severity,
          message: messageText,
          domain,
          timestamp: Date.now(),
          url: result.url,
          deceptivePatterns: result.deceptivePatterns || [],
          scanConfidence,
        });

        messageBus.broadcast('STATE_UPDATE');
      }
      }
    }
    // Persist consent state to Supabase when we have meaningful consent data
    // Save when: (1) Known CMP detected, OR (2) Cookie banner found, OR (3) Has persisted consent
    if (
      result.cmpDetection?.detected ||      // Known CMP detected (OneTrust, Cookiebot, etc.)
      result.hasBanner ||                   // Cookie banner found (even if CMP unknown)
      result.hasPersistedConsent            // User already made consent choice
    ) {
      try {
        const installationId = await feedbackTelemetryService.getInstallationId();

        const response = await fetch(CONSENT_PERSIST_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE.ANON_KEY}`,
          },
          body: JSON.stringify({
            installationId,
            domain,
            cmpType: result.cmpDetection?.cmpType || 'unknown',
            consentStatus: result.cmpDetection?.consentStatus || 'unknown',
            hasRejectButton: result.hasRejectButton,
            isCompliant: result.isCompliant,
            cookieNames: result.cmpDetection?.cookieNames || [],
            tcfVersion: result.cmpDetection?.tcfVersion,
            detectionMethod: result.cmpDetection?.detectionMethod || 'banner',
            confidenceScore: result.cmpDetection?.confidenceScore || 0,
          }),
        });

        if (response.ok) {
          logger.info('ServiceWorker', 'Consent state persisted to Supabase', { domain, cmpType: result.cmpDetection?.cmpType || 'unknown' });
        } else {
          const errorText = await response.text();
          logger.warn('ServiceWorker', 'Failed to persist consent state', { domain, status: response.status, error: errorText });
        }
      } catch (error) {
        logger.error('ServiceWorker', 'Error persisting consent state', toError(error), { domain });
      }
    }

    return { success: true };
  });

  // Only new email generation is blocked when the feature is disabled.
  // Existing emails remain fully accessible - users can still view, copy, and delete
  // their previously generated burner emails even when generation is disabled.
  messageBus.on('GENERATE_BURNER_EMAIL', async (data: unknown) => {
      // Stryker disable next-line all: logging only
      logger.debug('ServiceWorker', 'GENERATE_BURNER_EMAIL received', { data });
    try {
      // Guard to ensure only generation is affected by the feature toggle; existing emails remain accessible
      const isEnabled = await Storage.getBurnerEmailEnabled();
      // Stryker disable next-line all: logging only
      logger.debug('ServiceWorker', 'Burner email feature enabled check', { isEnabled });

      if (!isEnabled) {
        const { domain } = data as { domain?: string };
        logger.info('ServiceWorker', 'Burner email generation blocked - feature is disabled', { domain: domain || 'unknown' });
        return { success: false, error: 'Burner email feature is disabled' };
      }

      const { domain, url, label } = data as { domain: string; url?: string; label?: string };
      // Stryker disable next-line all: logging only
      logger.debug('ServiceWorker', 'Generating email for', { domain, url, label });
      
      const email = await burnerEmailService.generateEmail(domain, url, label);
      logger.info('ServiceWorker', 'Email generated successfully', { email });
      
      feedbackTelemetryService.trackEvent({
        eventType: 'burner_email_generated',
        eventData: { domain },
      // Stryker disable next-line all: logging only
      }).catch(err => logger.debug('ServiceWorker', 'Telemetry failed', err));
      return { success: true, email };
    } catch (error) {
      const err = toError(error);
      logger.error('ServiceWorker', 'GENERATE_BURNER_EMAIL failed', err);
      return { success: false, error: err.message };
    }
  });

  // GET_BURNER_EMAILS intentionally has no feature check - existing emails remain accessible
  // even when generation is disabled, allowing users to view and manage previously created burner emails
  messageBus.on('GET_BURNER_EMAILS', async () => {
    try {
      const emails = await burnerEmailService.getEmails();
      return { success: true, emails };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to fetch burner emails', toError(error));
      return { success: false, error: 'Failed to fetch burner emails' };
    }
  });

  // DELETE_BURNER_EMAIL works regardless of feature state - users can delete emails even when generation is disabled
  messageBus.on('DELETE_BURNER_EMAIL', async (data: unknown) => {
    try {
      const { emailId } = data as { emailId: string };
      await burnerEmailService.deleteEmail(emailId);
      return { success: true };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to delete burner email', toError(error));
      return { success: false, error: 'Failed to delete burner email' };
    }
  });

  messageBus.on('SUBMIT_FEEDBACK', async (data: unknown) => {
    try {
      const validation = validateFeedbackPayload(data);
      if (!validation.valid || !validation.sanitized) {
        const errorMessage = validation.error ?? 'Invalid feedback payload';
        logger.warn('ServiceWorker', 'SUBMIT_FEEDBACK validation failed', { error: errorMessage });
        return { success: false, error: errorMessage };
      }

      const { feedbackText, url, domain } = validation.sanitized;
      const result = await feedbackTelemetryService.submitFeedback({ feedbackText, url, domain });
      return result;
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to submit feedback', toError(error));
      return { success: false, error: 'Failed to submit feedback' };
    }
  });

  /**
   * Handles burner email setting toggles originating from the popup UI.
   *
   * Behavior:
   * - Processes requests sequentially through the message bus, eliminating race conditions
   *   when multiple toggle requests occur back-to-back.
   * - Persists the new enabled state and returns the updated value to the caller.
   *
   * Validation:
   * - Ensures the incoming payload includes a boolean `enabled` flag.
   * - Rejects invalid payloads early with a descriptive error response.
   *
   * Broadcast:
   * - After persisting the new value, broadcasts `STATE_UPDATE` to all extension contexts
   *   so UI components (popup.tsx, burner-emails-section.tsx) can refresh their state.
   */
  messageBus.on('SET_BURNER_EMAIL_SETTING', async (data: unknown) => {
    try {
      const { enabled } = data as { enabled: boolean };
      logger.info('ServiceWorker', 'SET_BURNER_EMAIL_SETTING: Request received', { enabled, dataType: typeof enabled });
      if (typeof enabled !== 'boolean') {
        logger.error('ServiceWorker', 'SET_BURNER_EMAIL_SETTING: Invalid enabled value', { enabled, type: typeof enabled });
        return { success: false, error: 'Invalid enabled value' };
      }
      const previousValue = await Storage.getBurnerEmailEnabled();
      
      await Storage.setBurnerEmailEnabled(enabled);

      // Verify the setting was persisted correctly
      const verifiedValue = await Storage.getBurnerEmailEnabled();
      logger.info('ServiceWorker', 'SET_BURNER_EMAIL_SETTING: Verified after save', { requested: enabled, verified: verifiedValue, match: enabled === verifiedValue });

      // Broadcast BURNER_EMAIL_SETTING_CHANGED to all content scripts with verified value
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(
              tab.id,
              {
                type: 'BURNER_EMAIL_SETTING_CHANGED',
                data: { enabled: verifiedValue }
              },
              () => {
                if (chrome.runtime.lastError) {
                  logger.debug('ServiceWorker', 'Failed to send BURNER_EMAIL_SETTING_CHANGED', {
                    tabId: tab.id,
                    error: chrome.runtime.lastError.message,
                  });
                }
              }
            );
          }
        });
      });

      // Broadcast STATE_UPDATE to notify all UI components to refresh their state
      messageBus.broadcast('STATE_UPDATE');

      logger.info('ServiceWorker', 'Burner email setting updated and broadcasted', { previousValue, newValue: verifiedValue });
      // Return the verified value from storage to ensure single source of truth
      return { success: true, enabled: verifiedValue };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to set burner email setting', toError(error));
      return { success: false, error: 'Failed to set burner email setting' };
    }
  });

  messageBus.on('SET_THEME', async (data: unknown) => {
    try {
      const { theme } = data as { theme: 'light' | 'dark' | 'system' };
      if (!theme || !['light', 'dark', 'system'].includes(theme)) {
        return { success: false, error: 'Invalid theme value' };
      }
      await Storage.setTheme(theme);

      chrome.runtime.sendMessage(
        {
          type: 'THEME_CHANGED',
          data: { theme }
        },
        () => {
          if (chrome.runtime.lastError) {
            logger.debug('ServiceWorker', 'Failed to send THEME_CHANGED message', {
              error: chrome.runtime.lastError.message,
            });
          }
        }
      );

      return { success: true, theme };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to set theme', toError(error));
      return { success: false, error: 'Failed to set theme' };
    }
  });

  /**
   * Returns all user-facing settings in a single roundtrip to minimize UI latency.
   *
   * Payload: none
   * Response: { success, settings: { theme, burnerEmailEnabled, telemetryEnabled, realEmail } }
   */
  messageBus.on('GET_ALL_SETTINGS', async () => {
    try {
      const data = await Storage.get();
      const theme = data.settings.theme ?? 'system';
      const burnerEmailEnabled = data.settings.burnerEmailEnabled ?? false;
      const telemetryEnabled = data.settings.telemetryEnabled ?? false;
      const realEmail = data.realEmail ?? null;

      return {
        success: true,
        settings: {
          theme,
          burnerEmailEnabled,
          telemetryEnabled,
          realEmail,
        },
      };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to get all settings', toError(error));
      return { success: false, error: 'Failed to get settings' };
    }
  });

  /**
   * Responds to burner email setting queries from UI contexts.
   *
   * Behavior:
   * - Reads the latest persisted toggle state from Storage.
   * - Does not perform additional validation because no payload is expected.
   *
   * Returns:
   * - `{ success: true, enabled: boolean }` when retrieval succeeds.
   * - `{ success: false, error: string }` when an unexpected error occurs.
   */
  messageBus.on('GET_BURNER_EMAIL_SETTING', async () => {
    try {
      // Stryker disable next-line all: logging only
      logger.debug('ServiceWorker', 'GET_BURNER_EMAIL_SETTING: Request received');
      const enabled = await Storage.getBurnerEmailEnabled();
      logger.info('ServiceWorker', 'GET_BURNER_EMAIL_SETTING: Retrieved from storage', { enabled, type: typeof enabled });
      return { success: true, enabled };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to get burner email setting', toError(error));
      return { success: false, error: 'Failed to get burner email setting' };
    }
  });

  messageBus.on('SET_TELEMETRY_SETTING', async (data: unknown) => {
    try {
      const { enabled } = data as { enabled: boolean };
      // Stryker disable next-line all: logging only
      logger.debug('ServiceWorker', 'SET_TELEMETRY_SETTING request received', { enabled });
      if (typeof enabled !== 'boolean') {
        return { success: false, error: 'Invalid enabled value' };
      }
      const previousValue = await Storage.getTelemetryEnabled();
      await Storage.setTelemetryEnabled(enabled);

      // Broadcast STATE_UPDATE to notify all UI components to refresh their state
      messageBus.broadcast('STATE_UPDATE');

      logger.info('ServiceWorker', 'Telemetry setting updated and broadcasted', { previousValue, newValue: enabled });
      return { success: true, enabled };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to set telemetry setting', toError(error));
      return { success: false, error: 'Failed to set telemetry setting' };
    }
  });

  messageBus.on('GET_TELEMETRY_SETTING', async () => {
    try {
      const enabled = await Storage.getTelemetryEnabled();
      // Stryker disable next-line all: logging only
      logger.debug('ServiceWorker', 'Telemetry setting retrieved', { enabled });
      return { success: true, enabled };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to get telemetry setting', toError(error));
      return { success: false, error: 'Failed to get telemetry setting' };
    }
  });

  messageBus.on('GET_REAL_EMAIL', async () => {
    try {
      // Stryker disable next-line all: logging only
      logger.debug('ServiceWorker', 'GET_REAL_EMAIL: Request received');
      const email = await Storage.getRealEmail();
      logger.info('ServiceWorker', 'GET_REAL_EMAIL: Retrieved from storage', { hasEmail: !!email, emailLength: email?.length || 0 });
      return { success: true, email };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to get real email', toError(error));
      return { success: false, error: 'Failed to get real email' };
    }
  });

  messageBus.on('SET_REAL_EMAIL', async (data: unknown) => {
    try {
      const { email } = data as { email: string };
      logger.info('ServiceWorker', 'SET_REAL_EMAIL: Request received', { hasEmail: !!email, emailLength: email?.length || 0 });
      if (typeof email !== 'string' || !email.trim()) {
        logger.error('ServiceWorker', 'SET_REAL_EMAIL: Invalid email value', { email, type: typeof email });
        return { success: false, error: 'Invalid email value' };
      }

      // Check if burner email feature is enabled before allowing real email configuration
      const isEnabled = await Storage.getBurnerEmailEnabled();
      // Stryker disable next-line all: logging only
      logger.debug('ServiceWorker', 'SET_REAL_EMAIL: Checked burner email enabled state', { isEnabled });
      if (!isEnabled) {
        logger.warn('ServiceWorker', 'SET_REAL_EMAIL blocked - burner email feature is disabled');
        return { success: false, error: 'Burner email feature is disabled. Please enable it in settings to configure your forwarding email address.' };
      }

      await Storage.setRealEmail(email);
      // Stryker disable next-line all: logging only
      logger.debug('ServiceWorker', 'SET_REAL_EMAIL: Email saved to storage');

      // Broadcast STATE_UPDATE to notify all UI components to refresh their state
      // Stryker disable next-line all: logging only
      logger.debug('ServiceWorker', 'SET_REAL_EMAIL: Broadcasting STATE_UPDATE');
      messageBus.broadcast('STATE_UPDATE');

      logger.info('ServiceWorker', 'Real email updated and broadcasted');
      return { success: true };
    } catch (error) {
      const err = toError(error);
      logger.error('ServiceWorker', 'Failed to set real email', err);
      return { success: false, error: err.message };
    }
  });

  messageBus.on('GET_THEME', async () => {
    try {
      const data = await Storage.get();
      const theme = data.settings.theme;
      return { success: true, theme };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to get theme', toError(error));
      return { success: false, error: 'Failed to get theme' };
    }
  });

  messageBus.on('TRACK_EVENT', async (data: unknown) => {
    try {
      const validation = validateEventPayload(data);
      if (!validation.valid || !validation.sanitized) {
        const errorMessage = validation.error ?? 'Invalid event payload';
        logger.warn('ServiceWorker', 'TRACK_EVENT validation failed', { error: errorMessage });
        return { success: false, error: errorMessage };
      }

      const { eventType, eventData } = validation.sanitized;
      await feedbackTelemetryService.trackEvent({ eventType, eventData });
      return { success: true };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to track event', toError(error));
      return { success: false, error: 'Failed to track event' };
    }
  });

  messageBus.on('RECORD_COMPLIANCE_SCORE', async (data: unknown) => {
    try {
      const validation = validateComplianceScore(data);
      if (!validation.valid || !validation.sanitized) {
        const errorMessage = validation.error ?? 'Invalid compliance score payload';
        logger.warn('ServiceWorker', 'RECORD_COMPLIANCE_SCORE validation failed', { error: errorMessage });
        return { success: false, error: errorMessage };
      }

      const { score } = validation.sanitized;
      await Storage.recordComplianceScore(score);
      return { success: true };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to record compliance score', toError(error));
      return { success: false, error: 'Failed to record compliance score' };
    }
  });

  messageBus.on('GET_METRICS_AGGREGATION', async (data: unknown) => {
    try {
      const payload = (data ?? {}) as { period?: 'week' | 'month' | 'all-time' };
      const requestedPeriod = payload.period;
      const period =
        requestedPeriod === 'week' || requestedPeriod === 'month' || requestedPeriod === 'all-time'
          ? requestedPeriod
          : 'week';

      const aggregation = await MetricsAggregationService.aggregateMetrics(period);
      return { success: true, aggregation };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to get metrics aggregation', toError(error));
      return { success: false, error: 'Failed to get metrics aggregation' };
    }
  });

  messageBus.on('GET_PRIVACY_SCORE_TREND', async () => {
    try {
      const trend = await MetricsAggregationService.getPrivacyScoreTrend();
      return { success: true, trend };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to get privacy score trend', toError(error));
      return { success: false, error: 'Failed to get privacy score trend' };
    }
  });

  messageBus.on('EXPORT_USER_DATA', async (data: unknown) => {
    try {
      const payload = (data ?? {}) as MessageDataMap['EXPORT_USER_DATA'];
      const format = payload?.format === 'csv' ? 'csv' : 'json';
      const includeEmail = Boolean(payload?.includeEmail);
      const exportData = await DataExportService.exportData(format, includeEmail);

      logger.info('ServiceWorker', 'User data export prepared', {
        format,
        includeEmail,
      });

      return { success: true, exportData };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to export user data', toError(error));
      return { success: false, error: 'Failed to export user data' };
    }
  });

  messageBus.on('DELETE_ALL_DATA', async () => {
    try {
      await Storage.clear();
      logger.info('ServiceWorker', 'All local extension data cleared');
      messageBus.broadcast('STATE_UPDATE');
      return { success: true };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to delete local data', toError(error));
      return { success: false, error: 'Failed to delete local data' };
    }
  });

  messageBus.on('GET_ONBOARDING_STATE', async () => {
    try {
      const onboarding = await Storage.getOnboardingState();
      return { success: true, onboarding };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to get onboarding state', toError(error));
      return { success: false, error: 'Failed to get onboarding state' };
    }
  });

  messageBus.on('SET_ONBOARDING_STEP', async (data: unknown) => {
    try {
      const payload = data as MessageDataMap['SET_ONBOARDING_STEP'];
      const onboarding = await Storage.setOnboardingStep(payload.step, {
        stepId: payload.stepId,
        previousStepId: payload.previousStepId,
        enteredAt: payload.enteredAt,
        exitedAt: payload.exitedAt,
        durationMs: payload.durationMs,
      });

      if (payload.previousStepId) {
        feedbackTelemetryService.trackEvent({
          eventType: ONBOARDING.EVENTS.STEP_COMPLETED,
          eventData: {
            stepId: payload.previousStepId,
            durationMs: payload.durationMs ?? null,
          },
        }).catch(err => logger.debug('ServiceWorker', 'Onboarding telemetry failed', err));
      }

      feedbackTelemetryService.trackEvent({
        eventType: ONBOARDING.EVENTS.STEP_VIEWED,
        eventData: {
          stepIndex: payload.step,
          stepId: payload.stepId ?? `step-${payload.step + 1}`,
        },
      }).catch(err => logger.debug('ServiceWorker', 'Onboarding telemetry failed', err));
      return { success: true, onboarding };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to set onboarding step', toError(error));
      return { success: false, error: 'Failed to set onboarding step' };
    }
  });

  messageBus.on('COMPLETE_ONBOARDING', async (data: unknown) => {
    try {
      const { emailConfigured } = (data || {}) as { emailConfigured?: boolean };
      const onboarding = await Storage.completeOnboarding(emailConfigured);

      feedbackTelemetryService.trackEvent({
        eventType: ONBOARDING.EVENTS.COMPLETED,
        eventData: {
          completedAt: onboarding.completedAt ?? null,
          totalDurationMs:
            onboarding.startedAt && onboarding.completedAt
              ? Math.max(0, onboarding.completedAt - onboarding.startedAt)
              : null,
          stepsTracked: onboarding.stepTimings?.length ?? 0,
          emailConfigured: onboarding.emailConfigured ?? false,
        },
      }).catch(err => logger.debug('ServiceWorker', 'Onboarding telemetry failed', err));
      return { success: true, onboarding };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to complete onboarding', toError(error));
      return { success: false, error: 'Failed to complete onboarding' };
    }
  });

  messageBus.on('SKIP_ONBOARDING', async (data: unknown) => {
    try {
      const { atStep, reason } = data as MessageDataMap['SKIP_ONBOARDING'];
      const onboarding = await Storage.skipOnboarding(atStep);

      const telemetryEvent =
        reason === 'abandoned' ? ONBOARDING.EVENTS.ABANDONED : ONBOARDING.EVENTS.SKIPPED;
      const timestamp = onboarding.skippedAt ?? Date.now();

      feedbackTelemetryService.trackEvent({
        eventType: telemetryEvent,
        eventData: {
          atStep,
          reason: reason ?? 'skipped',
          totalDurationMs:
            onboarding.startedAt
              ? Math.max(0, timestamp - onboarding.startedAt)
              : null,
          stepsTracked: onboarding.stepTimings?.length ?? 0,
        },
      }).catch(err => logger.debug('ServiceWorker', 'Onboarding telemetry failed', err));
      return { success: true, onboarding };
    } catch (error) {
      logger.error('ServiceWorker', 'Failed to skip onboarding', toError(error));
      return { success: false, error: 'Failed to skip onboarding' };
    }
  });
}

function setupStorageChangeListener(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.privacyData) {
      const newData = changes.privacyData.newValue;
      const oldData = changes.privacyData.oldValue;
      
      if (newData?.settings?.burnerEmailEnabled !== oldData?.settings?.burnerEmailEnabled) {
        const enabled = newData.settings.burnerEmailEnabled ?? false;
        
        logger.debug('ServiceWorker', 'Burner email setting changed via storage', { enabled });
        
        // Broadcast to tabs
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            if (tab.id) {
              chrome.tabs.sendMessage(
                tab.id,
                {
                  type: 'BURNER_EMAIL_SETTING_CHANGED',
                  data: { enabled }
                },
                () => {
                  if (chrome.runtime.lastError) {
                    logger.debug('ServiceWorker', 'Failed to send storage-driven BURNER_EMAIL_SETTING_CHANGED', {
                      tabId: tab.id,
                      error: chrome.runtime.lastError.message,
                    });
                  }
                }
              );
            }
          });
        });
        
        // Broadcast to popup
        messageBus.broadcast('STATE_UPDATE');
      }
    }
  });
}

function setupTabEventHandlers(): void {
  // Tab events are now handled by tabManager, but we still need to handle specific logic
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url && !tab.url.startsWith('chrome://')) {
      tabManager.resetBlockCount(tabId);
      await FirewallEngine.updateCurrentTabBadge(tabId);
    }

    if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
      try {
        await FirewallEngine.checkPageForTrackers(tabId, tab.url);
      } catch (error) {
        logger.error('ServiceWorker', 'Error checking page', toError(error), { tabId, url: sanitizeUrl(tab.url) });
      }
    }
  });

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      await FirewallEngine.updateCurrentTabBadge(activeInfo.tabId);
    } catch (error) {
      logger.error('ServiceWorker', 'Error updating badge', toError(error), { tabId: activeInfo.tabId });
    }
  });

  // Listen for tab removal to clean up badge timers immediately
  messageBus.on('TAB_REMOVED', async (data: unknown) => {
    const tabId = (data as { tabId: number })?.tabId;
    if (typeof tabId === 'number') {
      FirewallEngine.clearTabTimer(tabId);
    }
  });
}

function setupCleanupInterval(): void {
  // Run cleanup every hour
  setInterval(() => {
    tabManager.cleanup();
    FirewallEngine.cleanup();
  }, TIME.ONE_HOUR_MS);

  setInterval(() => {
    void fetchFalsePositiveOverrides();
  }, FALSE_POSITIVE_FEEDBACK.OVERRIDE_REFRESH_INTERVAL_MS);

  setInterval(() => {
    void fetchScoringConfig();
  }, SCORING_CONFIG.REFRESH_INTERVAL_MS);

  setInterval(() => {
    void fetchCmpConfig();
  }, CMP_CONFIG.REFRESH_INTERVAL_MS);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await initializeExtension();
  if (details.reason === 'install') {
    feedbackTelemetryService.trackEvent({
      eventType: 'extension_installed',
    // Stryker disable next-line all: logging only
    }).catch(err => logger.debug('ServiceWorker', 'Telemetry failed', err));

    try {
      const data = await Storage.get();
      if (!data.onboarding?.hasCompletedOnboarding) {
        setTimeout(() => {
          chrome.tabs.create(
            {
              url: chrome.runtime.getURL(ONBOARDING.WELCOME_PAGE_PATH),
              active: true,
            },
            () => {
              if (chrome.runtime.lastError) {
                logger.warn('ServiceWorker', 'Failed to open welcome page', {
                  error: chrome.runtime.lastError.message,
                });
              }
            }
          );
        }, ONBOARDING.AUTO_OPEN_DELAY_MS);
      }
    } catch (error) {
      logger.warn('ServiceWorker', 'Unable to evaluate onboarding state on install', toError(error));
    }
  } else if (details.reason === 'update') {
    feedbackTelemetryService.trackEvent({
      eventType: 'extension_updated',
      eventData: { previousVersion: details.previousVersion },
    }).catch(err => logger.debug('ServiceWorker', 'Telemetry failed', err));
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeExtension();
});

chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (details) => {
  if (details.request.tabId > 0) {
    await FirewallEngine.handleBlockedRequest(
      details.request.url,
      details.request.tabId
    );
  }
});

chrome.action.onClicked.addListener(() => {
  // Extension icon clicked - popup will open automatically
});

chrome.runtime.onSuspend.addListener(async () => {
  await Storage.ensureSaved();
});

// Initialize extension when service worker starts/wakes up
// This ensures proper initialization even after suspension
initializeExtension().catch(error => {
  logger.error('ServiceWorker', 'Initial startup failed', toError(error));
});
