import type { Alert, TrackerLists } from '../types';
import { Storage } from './storage';
import { logger } from '../utils/logger';
import { messageBus } from '../utils/message-bus';
import { tabManager } from '../utils/tab-manager';
import { backgroundEvents } from './event-emitter';
import { toError } from '../utils/type-guards';
import { sanitizeUrl } from '../utils/sanitizer';
import { BADGE, CONSENT_VIOLATION } from '../utils/constants';
import { calculateDecayedPenalty } from '../utils/penalty-decay';
import { getScoringConfig } from './scoring-config';

const RULESET_ID = 'tracker_blocklist';
const BADGE_UPDATE_DEBOUNCE_MS = 300;

export class FirewallEngine {
  private static trackerLists: TrackerLists | null = null;
  private static isInitialized = false;
  private static badgeUpdateTimers = new Map<number, number>();
  private static cleanSiteAlerts = new Map<string, number>(); // Track clean site alerts by domain
  private static trackerAlertCache = new Map<string, number>(); // Track tracker alerts by "tracker:site" key
  private static postConsentViolationCache = new Map<
    string,
    { count: number; trackers: string[]; timestamp: number; timeoutId?: number; url?: string }
  >();
  private static consentRejectionProvider?: (domain: string) => { timestamp: number; tabId?: number } | null;

  static async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const response = await fetch(chrome.runtime.getURL('data/tracker-lists.json'));
      this.trackerLists = await response.json();
      this.isInitialized = true;

      const data = await Storage.get();
      if (data.settings.protectionEnabled) {
        await this.enableBlocking();
      } else {
        await this.disableBlocking();
      }

      // Successfully initialized
    } catch (error) {
      logger.error('FirewallEngine', 'Failed to initialize firewall engine', toError(error));
      throw error;
    }
  }

  private static getTrackerCategory(domain: string): string {
    if (!this.trackerLists) return 'unknown';

    for (const [category, domains] of Object.entries(this.trackerLists.categories)) {
      if (domains.some(d => domain.includes(d))) {
        return category;
      }
    }

    return 'unknown';
  }

  private static isHighRisk(domain: string): boolean {
    if (!this.trackerLists) return false;
    return this.trackerLists.highRisk.some(d => domain.includes(d));
  }

  private static getRiskWeight(domain: string, category: string): number {
    const scoringConfig = getScoringConfig();
    const riskWeights = scoringConfig.riskWeights;

    // Check for known malicious/high-risk domains first
    const knownMalicious = ['coinhive', 'cryptoloot', 'coin-hive'];
    if (knownMalicious.some(m => domain.includes(m))) {
      return riskWeights.cryptomining;
    }

    // Check for fingerprinting services
    const fingerprintingServices = ['fingerprintjs', 'creepjs', 'canvas', 'clientjs'];
    if (fingerprintingServices.some(f => domain.includes(f)) || category === 'fingerprinting') {
      return riskWeights.fingerprinting;
    }

    // Use category-based weight
    const categoryWeight = riskWeights[category];
    return typeof categoryWeight === 'number' ? categoryWeight : riskWeights.unknown;
  }

  static setConsentRejectionProvider(
    provider: ((domain: string) => { timestamp: number; tabId?: number } | null) | null
  ): void {
    this.consentRejectionProvider = provider ?? undefined;
  }

  static async handleBlockedRequest(url: string, tabId: number): Promise<void> {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      const category = this.getTrackerCategory(domain);
      const isHighRisk = this.isHighRisk(domain);
      const riskWeight = this.getRiskWeight(domain, category);
      const occurrenceCount = await Storage.getDomainOccurrence(domain);
      await Storage.incrementDomainOccurrence(domain);
      const decayConfig = getScoringConfig().decay;
      const decayedRiskWeight = decayConfig.enabled
        ? calculateDecayedPenalty(riskWeight, occurrenceCount, {
            base: decayConfig.base,
            maxOccurrences: decayConfig.maxOccurrences,
          })
        : riskWeight;

      // Emit event for Storage to increment tracker count
      backgroundEvents.emit('TRACKER_INCREMENT', {
        domain,
        category,
        isHighRisk,
      });

      // Emit event for PrivacyScoreManager to handle scoring
      backgroundEvents.emit('TRACKER_BLOCKED', {
        domain,
        category,
        isHighRisk,
        riskWeight: decayedRiskWeight,
        tabId,
        url,
      });

      tabManager.incrementBlockCount(tabId);
      this.scheduleTabBadgeUpdate(tabId);

      const tab = await chrome.tabs.get(tabId);
      const siteDomain = tab.url ? new URL(tab.url).hostname : 'unknown';

      const consentRejection = this.consentRejectionProvider?.(siteDomain) ?? null;
      if (
        consentRejection &&
        Date.now() - consentRejection.timestamp <= CONSENT_VIOLATION.REJECTION_WINDOW_MS
      ) {
        this.recordPostConsentViolation(siteDomain, domain, tab.url);
        return;
      }

      // Check if we've already alerted about this tracker on this site recently (within 1 minute)
      const alertKey = `${domain}:${siteDomain}`;
      const lastAlertTime = this.trackerAlertCache.get(alertKey);
      const now = Date.now();

      if (!lastAlertTime || now - lastAlertTime > 60000) {
        this.trackerAlertCache.set(alertKey, now);

        // Adjust alert severity based on risk weight
        const getSeverity = (): 'low' | 'medium' | 'high' => {
          if (riskWeight >= 10) return 'high';
          if (riskWeight >= 5) return 'high';
          if (riskWeight >= 2) return 'medium';
          return 'low';
        };

        const getAlertType = (): 'tracker_blocked' | 'high_risk' | 'non_compliant_site' => {
          if (riskWeight >= 10) return 'high_risk';
          if (isHighRisk) return 'high_risk';
          return 'tracker_blocked';
        };

        const alert: Alert = {
          id: `${Date.now()}-${Math.random()}`,
          type: getAlertType(),
          severity: getSeverity(),
          message: `Blocked ${domain}${riskWeight > 1 ? ` (${category}, risk: ${riskWeight}x)` : ''}`,
          domain: siteDomain,
          timestamp: Date.now(),
          url: sanitizeUrl(tab.url) ?? undefined,
        };

        await Storage.addAlert(alert);
        this.notifyPopup();
      }
    } catch (error) {
      logger.error('FirewallEngine', 'Error handling blocked request', toError(error), { url: sanitizeUrl(url), tabId });
    }
  }

  static async checkPageForTrackers(tabId: number, url: string): Promise<void> {
    try {
      // Only check actual websites, not browser pages
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return;
      }

      const data = await Storage.get();
      const currentTrackersCount = data.privacyScore.daily.trackersBlocked;

      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      const hasTrackers = Object.keys(data.trackers).some(
        tracker => data.trackers[tracker].lastBlocked > Date.now() - 5000
      );

      if (!hasTrackers && currentTrackersCount === 0) {
        // Check if we've already alerted about this domain recently (within 24 hours)
        const lastAlertTime = this.cleanSiteAlerts.get(domain);
        const now = Date.now();

        // Also check if there's already a recent alert in storage
        const recentAlert = data.alerts.find(
          a => a.domain === domain &&
          a.message.includes('has no trackers') &&
          now - a.timestamp < 86400000 // 24 hours
        );

        if ((!lastAlertTime || now - lastAlertTime > 86400000) && !recentAlert) {
          this.cleanSiteAlerts.set(domain, now);

          // Emit clean site detected event
          backgroundEvents.emit('CLEAN_SITE_DETECTED', {
            domain,
            tabId,
            url,
          });

          const alert: Alert = {
            id: `${Date.now()}-${Math.random()}`,
            type: 'tracker_blocked',
            severity: 'low',
            message: `${domain} has no trackers`,
            domain,
            timestamp: Date.now(),
            url: sanitizeUrl(url) ?? undefined,
          };

          await Storage.addAlert(alert);
          this.notifyPopup();
        }
      }
    } catch (error) {
      logger.error('FirewallEngine', 'Error checking page for trackers', toError(error), { tabId, url: sanitizeUrl(url) });
    }
  }

  private static notifyPopup(): void {
    messageBus.broadcast('STATE_UPDATE');
  }

  private static recordPostConsentViolation(siteDomain: string, trackerDomain: string, pageUrl?: string | null): void {
    const existing = this.postConsentViolationCache.get(siteDomain);

    if (existing) {
      existing.count += 1;
      if (!existing.trackers.includes(trackerDomain)) {
        existing.trackers.push(trackerDomain);
      }
      existing.url = existing.url ?? pageUrl ?? undefined;
      if (existing.timeoutId) {
        clearTimeout(existing.timeoutId);
      }
    } else {
      this.postConsentViolationCache.set(siteDomain, {
        count: 1,
        trackers: [trackerDomain],
        timestamp: Date.now(),
        url: pageUrl ?? undefined,
      });
    }

    const entry = this.postConsentViolationCache.get(siteDomain)!;
    entry.timeoutId = setTimeout(() => {
      void this.flushPostConsentViolation(siteDomain);
    }, CONSENT_VIOLATION.AGGREGATION_DELAY_MS) as unknown as number;
  }

  private static async flushPostConsentViolation(siteDomain: string): Promise<void> {
    const entry = this.postConsentViolationCache.get(siteDomain);
    if (!entry) {
      return;
    }

    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    this.postConsentViolationCache.delete(siteDomain);

    const alert: Alert = {
      id: `pcv-${Date.now()}-${Math.random()}`,
      type: 'post_consent_violation',
      severity: 'high',
      message: `Alert: This site may be violating privacy laws. It loaded ${entry.count} tracker${
        entry.count > 1 ? 's' : ''
      } after you denied consent.`,
      domain: siteDomain,
      timestamp: Date.now(),
      url: entry.url ? sanitizeUrl(entry.url) ?? undefined : undefined,
      trackerCount: entry.count,
      blockedTrackers: [...entry.trackers],
    };

    await Storage.addAlert(alert);
    this.notifyPopup();

    backgroundEvents.emit('POST_CONSENT_VIOLATION', {
      domain: siteDomain,
      trackerCount: entry.count,
      trackers: new Set(entry.trackers),
    });
  }

  static async toggleProtection(): Promise<boolean> {
    const enabled = await Storage.toggleProtection();

    if (enabled) {
      await this.enableBlocking();
      // Update badge for current active tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        await this.updateCurrentTabBadge(tabs[0].id);
      }
    } else {
      await this.disableBlocking();
      // Clear all badges when protection is disabled
      await chrome.action.setBadgeText({ text: '' });
    }

    return enabled;
  }

  private static async enableBlocking(): Promise<void> {
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [RULESET_ID],
      });
    } catch (error) {
      logger.error('FirewallEngine', 'Failed to enable blocking', toError(error));
    }
  }

  private static async disableBlocking(): Promise<void> {
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: [RULESET_ID],
      });
    } catch (error) {
      logger.error('FirewallEngine', 'Failed to disable blocking', toError(error));
    }
  }

  private static async updateTabBadgeImmediate(tabId: number): Promise<void> {
    try {
      const count = tabManager.getBlockCount(tabId);
      const badgeText = count > 0 ? count.toString() : '';

      await chrome.action.setBadgeText({ text: badgeText, tabId });
      await chrome.action.setBadgeBackgroundColor({ color: BADGE.BACKGROUND_COLOR, tabId });
    } catch (error) {
      logger.error('FirewallEngine', 'Error updating tab badge', toError(error), { tabId });
    }
  }

  private static scheduleTabBadgeUpdate(tabId: number): void {
    // Clear any existing timer for this tab
    const existingTimer = this.badgeUpdateTimers.get(tabId);
    if (existingTimer) {
      clearTimeout(existingTimer as unknown as number);
    }

    // Schedule a new update after the debounce delay
    const timer = setTimeout(() => {
      this.updateTabBadgeImmediate(tabId);
      this.badgeUpdateTimers.delete(tabId);
    }, BADGE_UPDATE_DEBOUNCE_MS) as unknown as number;

    this.badgeUpdateTimers.set(tabId, timer);
  }

  static async updateCurrentTabBadge(tabId: number): Promise<void> {
    await this.updateTabBadgeImmediate(tabId);
  }

  static clearTabTimer(tabId: number): void {
    const timer = this.badgeUpdateTimers.get(tabId);
    if (timer) {
      clearTimeout(timer as unknown as number);
      this.badgeUpdateTimers.delete(tabId);
    }
  }

  static cleanup(): void {
    // Clear all pending badge update timers to prevent memory leaks
    for (const timer of this.badgeUpdateTimers.values()) {
      clearTimeout(timer as unknown as number);
    }
    this.badgeUpdateTimers.clear();

    for (const entry of this.postConsentViolationCache.values()) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId as unknown as number);
      }
    }
    this.postConsentViolationCache.clear();
  }

  static getTrackerInfo(domain: string): { description: string; alternative: string } | null {
    if (!this.trackerLists) return null;

    const category = this.getTrackerCategory(domain);

    const trackerInfo: Record<string, { description: string; alternative: string }> = {
      'google-analytics.com': {
        description: 'Tracks user behavior and collects browsing data for website analytics',
        alternative: 'Use privacy-focused analytics like Plausible or Simple Analytics'
      },
      'googletagmanager.com': {
        description: 'Manages marketing tags and tracks user interactions across websites',
        alternative: 'Self-host analytics or use server-side tracking solutions'
      },
      'doubleclick.net': {
        description: 'Ad network that tracks users across websites for targeted advertising',
        alternative: 'Support websites directly or use contextual ads like EthicalAds'
      },
      'facebook.net': {
        description: 'Tracks user activity for Facebook advertising and social features',
        alternative: 'Use privacy-focused social media like Mastodon or direct website subscriptions'
      },
      'connect.facebook.net': {
        description: 'Facebook SDK that monitors user behavior for ad targeting',
        alternative: 'Websites can use native share buttons instead of Facebook integration'
      },
      'mixpanel.com': {
        description: 'Product analytics that tracks detailed user interactions and behavior',
        alternative: 'Use open-source alternatives like PostHog or Matomo'
      },
      'hotjar.com': {
        description: 'Records user sessions, heatmaps, and tracks on-page behavior',
        alternative: 'Use privacy-respecting alternatives like Microsoft Clarity with anonymization'
      },
      'segment.com': {
        description: 'Collects and routes user data to multiple analytics and marketing tools',
        alternative: 'Implement direct server-side tracking or use RudderStack'
      },
      'criteo.com': {
        description: 'Retargeting platform that follows users across websites to show ads',
        alternative: 'Support content creators directly through subscriptions or donations'
      },
      'fingerprintjs.com': {
        description: 'Creates unique browser fingerprints to identify users without cookies',
        alternative: 'Websites should use consent-based authentication instead'
      },
    };

    for (const [key, info] of Object.entries(trackerInfo)) {
      if (domain.includes(key)) {
        return info;
      }
    }

    const categoryDescriptions: Record<string, { description: string; alternative: string }> = {
      analytics: {
        description: 'Collects data about how users interact with websites',
        alternative: 'Use privacy-focused analytics like Plausible or Fathom'
      },
      advertising: {
        description: 'Tracks users across websites for targeted advertising',
        alternative: 'Support websites through direct subscriptions or contextual ads'
      },
      social: {
        description: 'Monitors user activity for social media platforms',
        alternative: 'Use native sharing features or privacy-focused social networks'
      },
      fingerprinting: {
        description: 'Identifies users by their unique browser characteristics',
        alternative: 'Clear browsing data regularly and use privacy-focused browsers'
      },
      beacons: {
        description: 'Tracks user behavior and conversions for advertisers',
        alternative: 'Support creators directly instead of relying on ad revenue'
      },
    };

    return categoryDescriptions[category] || {
      description: 'Tracking service that collects user data',
      alternative: 'Use privacy-focused alternatives or disable third-party tracking'
    };
  }
}
