import { Storage } from '../background/storage';
import { logger } from './logger';
import type { LocalConsentState } from '../types';

export interface ConsentValidationResult {
  shouldPenalize: boolean;
  reason: string;
  consentState?: LocalConsentState;
}

const CONSENTED_TRACKER_CATEGORIES = ['analytics', 'beacons'];

const HIGH_RISK_CATEGORIES = ['fingerprinting', 'social'];

export async function shouldPenalizeTracker(
  domain: string,
  category: string,
  isHighRisk: boolean
): Promise<ConsentValidationResult> {
  try {
    const pageDomain = extractDomain(domain);
    const consentState = await Storage.getConsentState(pageDomain);

    if (!consentState) {
      return {
        shouldPenalize: true,
        reason: 'No consent state found',
      };
    }

    if (consentState.consentStatus === 'rejected') {
      return {
        shouldPenalize: true,
        reason: 'User explicitly rejected consent',
        consentState,
      };
    }

    if (consentState.consentStatus === 'dismissed') {
      return {
        shouldPenalize: true,
        reason: 'User dismissed consent without accepting',
        consentState,
      };
    }

    if (consentState.consentStatus === 'accepted' && consentState.choice === 'explicit') {
      if (isHighRisk || HIGH_RISK_CATEGORIES.includes(category)) {
        return {
          shouldPenalize: true,
          reason: 'High-risk tracker despite consent',
          consentState,
        };
      }

      if (CONSENTED_TRACKER_CATEGORIES.includes(category)) {
        return {
          shouldPenalize: false,
          reason: 'User explicitly consented to analytics/beacons',
          consentState,
        };
      }

      return {
        shouldPenalize: false,
        reason: 'User explicitly consented to all trackers',
        consentState,
      };
    }

    if (consentState.consentStatus === 'accepted' && consentState.choice === 'implied') {
      if (isHighRisk || HIGH_RISK_CATEGORIES.includes(category)) {
        return {
          shouldPenalize: true,
          reason: 'High-risk tracker with only implied consent',
          consentState,
        };
      }

      return {
        shouldPenalize: false,
        reason: 'Tracker allowed with implied consent',
        consentState,
      };
    }

    return {
      shouldPenalize: true,
      reason: 'Unknown consent status',
      consentState,
    };
  } catch (error) {
    logger.error('ConsentValidator', 'Error validating consent', error);
    return {
      shouldPenalize: true,
      reason: 'Error during consent validation',
    };
  }
}

export function extractDomain(url: string): string {
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return new URL(url).hostname;
    }

    const parts = url.split('.');
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }

    return url;
  } catch {
    return url;
  }
}

export function isConsentedTrackerCategory(category: string): boolean {
  return CONSENTED_TRACKER_CATEGORIES.includes(category.toLowerCase());
}

export function isHighRiskCategory(category: string): boolean {
  return HIGH_RISK_CATEGORIES.includes(category.toLowerCase());
}

export async function shouldBlockTracker(
  _trackerDomain: string,
  pageDomain: string,
  category: string,
  isHighRisk: boolean
): Promise<boolean> {
  try {
    const consentState = await Storage.getConsentState(pageDomain);

    if (!consentState) {
      return true;
    }

    if (consentState.consentStatus === 'rejected' || consentState.consentStatus === 'dismissed') {
      return true;
    }

    if (consentState.consentStatus === 'accepted' && consentState.choice === 'explicit') {
      if (isHighRisk || HIGH_RISK_CATEGORIES.includes(category)) {
        return true;
      }

      return false;
    }

    if (consentState.consentStatus === 'accepted' && consentState.choice === 'implied') {
      if (isHighRisk || HIGH_RISK_CATEGORIES.includes(category)) {
        return true;
      }

      return false;
    }

    return true;
  } catch (error) {
    logger.error('ConsentValidator', 'Error checking if tracker should be blocked', error);
    return true;
  }
}
