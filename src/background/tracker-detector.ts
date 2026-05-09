import { logger } from '../utils/logger';
import { behavioralStorage } from './behavioral-storage';
import { backgroundEvents } from './event-emitter';
import type { BehavioralTrackerResult } from '../types';

/**
 * Intelligent Tracker Detection Engine
 * High-performance, isolated module designed to flag behavioral trackers securely.
 */
export class TrackerDetector {
  private static requestCache = new Map<string, number[]>(); // TabId:Domain -> Request Timestamps
  private static reportedCache = new Map<string, 'Low risk' | 'Medium risk' | 'High risk'>();
  private static getConsentRejectionForTab: ((tabId: number, domain: string) => number | null) | null = null;
  
  private static TRACKER_KEYWORDS = ['analytics', 'pixel', 'track', 'collect', 'telemetry', 'adsystem', 'metrics'];
  private static PII_REGEX = /(?:email=|uid=|user_id=|token=)([^&]+)/i;

  /**
   * Links the external consent-scanner rejection cache to cross-reference violations.
   */
  static setConsentRejectionProvider(provider: (tabId: number, domain: string) => number | null) {
    this.getConsentRejectionForTab = provider;
  }

  static initialize() {
    if (!chrome?.webRequest?.onBeforeRequest) {
      logger.warn('TrackerDetector', 'chrome.webRequest API not available, skipping tracker detection init (expected in tests)');
      return;
    }

    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        console.log('[TrackerDetector] Captured request:', details.url);
        void this.handleRequest(details);
      },
      { 
        urls: ['<all_urls>'],
        types: ['xmlhttprequest', 'script', 'image', 'ping', 'sub_frame', 'main_frame', 'other']
      },
      ['requestBody']
    );

    // Clean up memory isolation mappings when tabs are closed
    chrome.tabs.onRemoved.addListener((closedTabId) => {
      for (const key of this.requestCache.keys()) {
        if (key.startsWith(`${closedTabId}:`)) {
          this.requestCache.delete(key);
          this.reportedCache.delete(key);
        }
      }
    });

    logger.info('TrackerDetector', 'Intelligent Tracking Engine initialized successfully');
  }

  private static async handleRequest(details: chrome.webRequest.WebRequestBodyDetails) {
    // Allow tabId -1 (DevTools/non-tab requests) to pass through for PII inspection
    // Only skip completely internal extension requests (tabId === undefined can be skipped elsewhere)
    try {
      const url = new URL(details.url);
      const requestDomain = url.hostname;
      
      const initiator = details.initiator;
      let isThirdParty = false;
      let initiatorDomain = '';
      
      if (initiator) {
        try {
          const initUrl = new URL(initiator);
          initiatorDomain = initUrl.hostname;
          isThirdParty = initiatorDomain !== requestDomain && !requestDomain.endsWith(initiatorDomain);
        } catch {
          // Ignore invalid initiator parse errors
        }
      }

      let riskLevel: 'Low risk' | 'Medium risk' | 'High risk' | null = null;
      let reason = '';
      const detectionTypes: string[] = [];

      // 1. High Risk Safeguard: Active PII Leakage Detection (Prioritize URL params)
      let hasLeakage = false;
      if (this.PII_REGEX.test(details.url)) {
        hasLeakage = true;
      } else if (details.requestBody?.formData) {
        // Only inspect safely parsed formData; ignore raw/obfuscated binary blobs
        for (const val of Object.values(details.requestBody.formData)) {
          if (val.some(v => v.includes('@') || v.includes('token'))) {
             hasLeakage = true; 
             break;
          }
        }
      }

      if (hasLeakage) {
        riskLevel = 'High risk';
        reason = 'Structural PII Leakage Detected';
        detectionTypes.push('leakage');
      }

      // 2. Keyword matching analysis
      const hasKeyword = this.TRACKER_KEYWORDS.some(k => details.url.toLowerCase().includes(k));
      if (hasKeyword && isThirdParty) {
        detectionTypes.push('keyword');
        if (!riskLevel) {
          riskLevel = 'Low risk';
          reason = 'Suspicious third-party tracking keyword';
        }
      }

      // 3. Medium Risk Safeguard: High-frequency burst detection
      const cacheKey = `${details.tabId}:${requestDomain}`;
      const now = Date.now();
      
      const timestamps = this.requestCache.get(cacheKey) || [];
      const recentTimestamps = timestamps.filter(t => now - t < 5000); // 5 sec rolling window
      recentTimestamps.push(now);
      this.requestCache.set(cacheKey, recentTimestamps);

      // Only flag bursts if it is structurally a third party AND a keyword match
      if (recentTimestamps.length > 10 && isThirdParty && hasKeyword) {
        detectionTypes.push('burst');
        if (riskLevel !== 'High risk') {
          riskLevel = 'Medium risk';
          reason = 'High-frequency third-party tracking burst';
        }
      }

      // If we flagged something, evaluate Controlled Emission bounds
      if (riskLevel) {
        const previousRisk = this.reportedCache.get(cacheKey);
        
        // Only broadcast if the domain is entirely new OR its risk classification has escalated
        const riskWeights = { 'Low risk': 1, 'Medium risk': 2, 'High risk': 3 };
        const isEscalation = !previousRisk || riskWeights[riskLevel] > riskWeights[previousRisk];

        if (isEscalation) {
          // Log risk detection clearly to service worker console
          console.log(`[TrackerDetector] ${riskLevel} Detected`);
          console.log(`Reason: ${reason}`);
          console.log(`Domain: ${requestDomain} | Types: ${detectionTypes.join(', ')} | Tab: ${details.tabId}`);

          this.reportedCache.set(cacheKey, riskLevel);

          const result: BehavioralTrackerResult = {
            domain: requestDomain,
            detectionType: detectionTypes,
            riskLevel,
            reason,
            timestamp: now,
            tabUrl: initiator || '',
            tabId: details.tabId
          };

          // Validate against Consent Cache safely
          if (this.getConsentRejectionForTab && initiatorDomain) {
            const rejectionTimestamp = this.getConsentRejectionForTab(details.tabId, initiatorDomain);
            if (rejectionTimestamp && now > rejectionTimestamp) {
              const violation = {
                tracker: result,
                violationType: 'Tracking after rejection',
                timestamp: now
              };
              behavioralStorage.logViolation(violation);
              backgroundEvents.emit('COMPLIANCE_VIOLATION_DETECTED', { violation });
              return; // Short-circuit standard logging to avoid event floods
            }
          }

          // Otherwise, pass to abstraction layer immediately
          behavioralStorage.saveTrackerData(result);
          backgroundEvents.emit('BEHAVIORAL_TRACKER_DETECTED', { tracker: result });
        }
      }

    } catch (e) {
      logger.debug('TrackerDetector', 'Error during request inspection', e);
    }
  }
}
