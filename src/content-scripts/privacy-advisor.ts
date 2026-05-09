import { showToast, isToastVisible, dismissToast } from './toast-ui';
import type { PrivacyAlternative, RiskLevel, PrivacyDataType } from '../types';
import { logger } from '../utils/logger';
import { toError } from '../utils/type-guards';

const TOAST_COOLDOWN_MS = 30000; // 30 seconds between toasts
const TRACKER_DEBOUNCE_MS = 3000; // Aggregate tracker events within 3s
const EMAIL_SCAN_DEBOUNCE_MS = 5000;

let lastToastTime = 0;
let pendingTrackers: Array<{ domain: string; category: string }> = [];
let trackerDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let emailScanTimer: ReturnType<typeof setTimeout> | null = null;
let emailFieldsDetected = false;

class PrivacyAdvisor {
  private initialized = false;
  private mutationObserver: MutationObserver | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.setupMessageListener();
      this.setupEmailFieldDetection();
      this.scanForExistingEmailFields();
      this.checkCurrentSite();
      this.initialized = true;
      console.log('🛡️ [Privaseer] Privacy Advisor successfully initialized on:', window.location.hostname);
      logger.debug('PrivacyAdvisor', 'Initialized', { url: window.location.href });
    } catch (error) {
      logger.error('PrivacyAdvisor', 'Failed to initialize', toError(error));
    }
  }

  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'PRIVACY_ADVISOR_ALERT') {
        const data = message.data as {
          trackerDomain: string;
          category: string;
          siteDomain: string;
        };
        this.handleTrackerDetected(data.trackerDomain, data.category);
      }
    });
  }

  private handleTrackerDetected(trackerDomain: string, category: string): void {
    pendingTrackers.push({ domain: trackerDomain, category });

    // Debounce: wait for more trackers before showing toast
    if (trackerDebounceTimer) {
      clearTimeout(trackerDebounceTimer);
    }

    trackerDebounceTimer = setTimeout(() => {
      void this.showTrackerToast();
    }, TRACKER_DEBOUNCE_MS);
  }

  private async showTrackerToast(): Promise<void> {
    if (pendingTrackers.length === 0) return;

    // Rate limit
    if (!this.canShowToast()) {
      pendingTrackers = [];
      return;
    }

    // Pick the highest-risk tracker from pending
    const trackers = [...pendingTrackers];
    pendingTrackers = [];

    // Sort by risk priority: fingerprinting > advertising > social > analytics
    const riskOrder: Record<string, number> = {
      fingerprinting: 0, cryptomining: 0, malware: 0,
      advertising: 1, social: 1, beacons: 1,
      analytics: 2, unknown: 3,
    };
    trackers.sort((a, b) => (riskOrder[a.category] ?? 3) - (riskOrder[b.category] ?? 3));

    const topTracker = trackers[0];

    try {
      // Request risk classification and alternatives from background
      const response = await this.sendMessageWithRetry({
        type: 'CLASSIFY_RISK',
        data: {
          domain: topTracker.domain,
          category: topTracker.category,
          trackerCount: trackers.length,
        },
      }) as {
        success: boolean;
        riskLevel?: RiskLevel;
        dataType?: PrivacyDataType;
        alternatives?: PrivacyAlternative[];
      };

      if (!response?.success) return;

      const hasEmailFields = this.pageHasEmailFields();

      showToast({
        collectorName: topTracker.domain,
        dataType: response.dataType ?? 'unknown',
        riskLevel: response.riskLevel ?? 'low',
        domain: window.location.hostname,
        category: topTracker.category,
        alternatives: response.alternatives ?? [],
        showBurnerEmail: hasEmailFields,
      });

      lastToastTime = Date.now();
    } catch (error) {
      logger.error('PrivacyAdvisor', 'Failed to show tracker toast', toError(error));
    }
  }

  private async checkCurrentSite(): Promise<void> {
    try {
      const hostname = window.location.hostname;
      console.log('🛡️ [Privaseer] checkCurrentSite — hostname:', hostname);

      // Request alternatives for the current site
      console.log('🛡️ [Privaseer] Sending GET_ALTERNATIVES message...');
      const response = await this.sendMessageWithRetry({
        type: 'GET_ALTERNATIVES',
        data: { domain: hostname },
      }) as {
        success: boolean;
        alternatives?: PrivacyAlternative[];
        riskLevel?: RiskLevel;
      };

      console.log('🛡️ [Privaseer] GET_ALTERNATIVES response:', JSON.stringify(response));

      if (
        response?.success &&
        response.alternatives &&
        response.alternatives.length > 0 &&
        this.canShowToast()
      ) {
        const riskLevel = response.riskLevel ?? 'low';
        console.log('🛡️ [Privaseer] Showing toast! Risk:', riskLevel, 'Alternatives:', response.alternatives.length);
        showToast({
          collectorName: hostname,
          dataType: 'behavioral',
          riskLevel: riskLevel === 'low' ? 'medium' : riskLevel,
          domain: hostname,
          category: 'site',
          alternatives: response.alternatives,
          showBurnerEmail: this.pageHasEmailFields(),
        });
        lastToastTime = Date.now();
      } else {
        console.log('🛡️ [Privaseer] Toast NOT shown. success:', response?.success,
          'alternatives count:', response?.alternatives?.length ?? 0,
          'canShowToast:', this.canShowToast());
      }
    } catch (err) {
      console.error('🛡️ [Privaseer] checkCurrentSite ERROR:', err);
      logger.debug('PrivacyAdvisor', 'Site check skipped — background not ready');
    }
  }

  private setupEmailFieldDetection(): void {
    this.mutationObserver = new MutationObserver(() => {
      if (emailScanTimer) clearTimeout(emailScanTimer);
      emailScanTimer = setTimeout(() => {
        this.scanForNewEmailFields();
      }, EMAIL_SCAN_DEBOUNCE_MS);
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private scanForExistingEmailFields(): void {
    const emailInputs = document.querySelectorAll(
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="email"]'
    );

    if (emailInputs.length > 0 && !emailFieldsDetected) {
      emailFieldsDetected = true;
      // Don't show toast immediately on page load for email fields
      // — the existing email-autofill.ts handles the focus event.
      // We only show the toast after a delay if the user hasn't interacted.
    }
  }

  private scanForNewEmailFields(): void {
    if (emailFieldsDetected) return;

    const emailInputs = document.querySelectorAll(
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="email"]'
    );

    if (emailInputs.length > 0) {
      emailFieldsDetected = true;

      if (this.canShowToast() && !isToastVisible()) {
        this.showEmailFieldToast();
      }
    }
  }

  private async showEmailFieldToast(): Promise<void> {
    if (!this.canShowToast()) return;

    try {
      const hostname = window.location.hostname;

      // Get alternatives for context
      let alternatives: PrivacyAlternative[] = [];
      try {
        const response = await this.sendMessageWithRetry({
          type: 'GET_ALTERNATIVES',
          data: { domain: hostname },
        }) as { success: boolean; alternatives?: PrivacyAlternative[] };

        if (response?.success && response.alternatives) {
          alternatives = response.alternatives;
        }
      } catch {
        // Continue without alternatives
      }

      showToast({
        collectorName: hostname,
        dataType: 'email',
        riskLevel: 'medium',
        domain: hostname,
        category: 'email-collection',
        alternatives,
        showBurnerEmail: true,
      });

      lastToastTime = Date.now();
    } catch (error) {
      logger.error('PrivacyAdvisor', 'Failed to show email field toast', toError(error));
    }
  }

  private canShowToast(): boolean {
    return Date.now() - lastToastTime >= TOAST_COOLDOWN_MS;
  }

  private pageHasEmailFields(): boolean {
    return document.querySelectorAll(
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="email"]'
    ).length > 0;
  }

  private async sendMessageWithRetry<T>(
    message: { type: string; data?: unknown },
    maxRetries = 2
  ): Promise<T> {
    let retries = 0;

    while (retries <= maxRetries) {
      try {
        const response = await chrome.runtime.sendMessage(message);
        return response as T;
      } catch (err) {
        const error = toError(err);
        if (error.message.includes('Receiving end does not exist') && retries < maxRetries) {
          retries += 1;
          await new Promise((resolve) => setTimeout(resolve, 500));
        } else {
          throw error;
        }
      }
    }

    throw new Error('Failed to send message after max retries');
  }

  cleanup(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (trackerDebounceTimer) {
      clearTimeout(trackerDebounceTimer);
      trackerDebounceTimer = null;
    }
    if (emailScanTimer) {
      clearTimeout(emailScanTimer);
      emailScanTimer = null;
    }
    dismissToast();
  }
}

export const privacyAdvisor = new PrivacyAdvisor();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => privacyAdvisor.initialize());
} else {
  privacyAdvisor.initialize();
}
