import { logger } from './logger';
import { toError } from './type-guards';
import { detectPageLanguage, getLocalizedPatterns, matchesAnyPattern } from './i18n-patterns';
import type { CMPDetectionResult, RemoteCMPConfig } from '../types';

// Type definitions for CMP APIs on window object
interface OneTrustAPI {
  GetDomainData?: () => { Groups?: Array<{ Status: string }> };
}

interface CookiebotAPI {
  declined?: boolean;
  consent?: {
    necessary?: boolean;
    statistics?: boolean;
    marketing?: boolean;
  };
}

interface TCFData {
  cmpId?: string;
  purpose?: {
    consents?: Record<string, boolean>;
  };
}

interface WindowWithCMP extends Window {
  OneTrust?: OneTrustAPI;
  Cookiebot?: CookiebotAPI;
  termly?: unknown;
  __tcfapi?: (command: string, version: number, callback: (data: TCFData | null, success: boolean) => void) => void;
}

declare const window: WindowWithCMP;

interface CMPConfig {
  name: string;
  cookiePatterns: string[];
  bannerSelectors: string[];
  consentParsers: Record<string, 'generic' | 'onetrust' | 'cookiebot'>;
}

const CMP_CONFIG_STORAGE_KEY = 'cmpConfigCache';

const LOCAL_CMP_CONFIGS: Record<string, CMPConfig> = {
  onetrust: {
    name: 'OneTrust',
    cookiePatterns: ['OptanonConsent', 'OptanonAlertBoxClosed', 'eupubconsent-v2'],
    bannerSelectors: ['#onetrust-banner-sdk', '.onetrust-banner', '[data-onetrust]'],
    consentParsers: { OptanonConsent: 'onetrust', OptanonAlertBoxClosed: 'onetrust' },
  },
  cookiebot: {
    name: 'Cookiebot',
    cookiePatterns: ['CookieConsent', 'CookiebotConsent', 'CookieConsentBulkSetting'],
    bannerSelectors: ['#CybotCookiebotDialog', '[data-cookieconsent]'],
    consentParsers: { CookieConsent: 'cookiebot', CookiebotConsent: 'cookiebot' },
  },
  termly: {
    name: 'Termly',
    cookiePatterns: ['termly-consent', 't_privacy_consent', 't_cookie_consent'],
    bannerSelectors: ['[data-termly]', '#termly-code-snippet-support'],
    consentParsers: { 'termly-consent': 'generic' },
  },
  gdprcompliant: {
    name: 'GDPRCompliant',
    cookiePatterns: ['gdpr_consent', 'gdpr-consent'],
    bannerSelectors: ['[data-gdpr]', '.gdpr-banner'],
    consentParsers: { gdpr_consent: 'generic', 'gdpr-consent': 'generic' },
  },
  custom: {
    name: 'Custom',
    cookiePatterns: ['cookie_consent', 'consent_status', 'user_consent'],
    bannerSelectors: [],
    consentParsers: {},
  },
  cookiecontrol: {
    name: 'CookieControl',
    cookiePatterns: ['CookieControl'],
    bannerSelectors: ['[data-cc-banner]', '.ccc-widget'],
    consentParsers: { CookieControl: 'generic' },
  },
  quantcast: {
    name: 'Quantcast',
    cookiePatterns: ['__qca', 'euconsent-v2'],
    bannerSelectors: ['[data-qc-cmp]'],
    consentParsers: { 'euconsent-v2': 'generic' },
  },
};

const API_DETECTORS: Record<string, Array<() => Promise<CMPDetectionResult | null>>> = {
  onetrust: [detectOneTrustAPI],
  cookiebot: [detectCookiebotAPI],
  termly: [detectTermlyAPI],
  quantcast: [detectTCFv2API],
};

function isRemoteCmpConfig(value: unknown): value is RemoteCMPConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    Array.isArray((value as { cookiePatterns?: unknown }).cookiePatterns) &&
    Array.isArray((value as { bannerSelectors?: unknown }).bannerSelectors) &&
    typeof (value as { consentParsers?: unknown }).consentParsers === 'object'
  );
}

async function getRemoteCmpConfigs(): Promise<RemoteCMPConfig[]> {
  try {
    const raw = await new Promise<unknown>((resolve, reject) => {
      chrome.storage.local.get(CMP_CONFIG_STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve((result as Record<string, unknown>)[CMP_CONFIG_STORAGE_KEY]);
      });
    });
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter(isRemoteCmpConfig);
  } catch (error) {
    logger.debug('CMPDetector', 'Failed to load remote CMP configs, using defaults', {
      error: toError(error).message,
    });
    return [];
  }
}

async function getCmpConfigs(): Promise<Record<string, CMPConfig>> {
  const remoteConfigs = await getRemoteCmpConfigs();
  const merged: Record<string, CMPConfig> = { ...LOCAL_CMP_CONFIGS };

  for (const remote of remoteConfigs) {
    const key = remote.name.toLowerCase().trim();
    if (!key) {
      continue;
    }
    const existing = merged[key];
    merged[key] = {
      name: remote.name,
      cookiePatterns: remote.cookiePatterns.length > 0 ? remote.cookiePatterns : (existing?.cookiePatterns ?? []),
      bannerSelectors: remote.bannerSelectors.length > 0 ? remote.bannerSelectors : (existing?.bannerSelectors ?? []),
      consentParsers: Object.keys(remote.consentParsers ?? {}).length > 0
        ? remote.consentParsers
        : (existing?.consentParsers ?? {}),
    };
  }

  return merged;
}

async function detectOneTrustAPI(): Promise<CMPDetectionResult | null> {
  try {
    if (typeof window === 'undefined' || !window.OneTrust) {
      return null;
    }

    const OneTrust = window.OneTrust;
    const activeGroups = OneTrust.GetDomainData?.()?.Groups || [];

    let consentStatus: 'accepted' | 'rejected' | 'partial' | 'unknown' = 'unknown';
    const acceptedGroups = activeGroups.filter((g) => g.Status === 'active');

    if (acceptedGroups.length === 0) {
      consentStatus = 'rejected';
    } else if (acceptedGroups.length === activeGroups.length) {
      consentStatus = 'accepted';
    } else {
      consentStatus = 'partial';
    }

    return {
      detected: true,
      cmpType: 'onetrust',
      detectionMethod: 'api',
      confidenceScore: 1.0,
      consentStatus,
      cookieNames: getCookiesByPattern(LOCAL_CMP_CONFIGS.onetrust.cookiePatterns),
    };
  } catch (error) {
    logger.debug('CMPDetector', 'OneTrust API detection failed', { error: toError(error).message });
    return null;
  }
}

async function detectCookiebotAPI(): Promise<CMPDetectionResult | null> {
  try {
    if (typeof window === 'undefined' || !window.Cookiebot) {
      return null;
    }

    const Cookiebot = window.Cookiebot;
    let consentStatus: 'accepted' | 'rejected' | 'partial' | 'unknown' = 'unknown';

    if (Cookiebot.declined === true) {
      consentStatus = 'rejected';
    } else if (Cookiebot.consent?.statistics && Cookiebot.consent?.marketing) {
      consentStatus = 'accepted';
    } else if (Cookiebot.consent?.necessary) {
      consentStatus = 'partial';
    }

    return {
      detected: true,
      cmpType: 'cookiebot',
      detectionMethod: 'api',
      confidenceScore: 1.0,
      consentStatus,
      cookieNames: getCookiesByPattern(LOCAL_CMP_CONFIGS.cookiebot.cookiePatterns),
    };
  } catch (error) {
    logger.debug('CMPDetector', 'Cookiebot API detection failed', { error: toError(error).message });
    return null;
  }
}

async function detectTermlyAPI(): Promise<CMPDetectionResult | null> {
  try {
    if (typeof window === 'undefined' || !window.termly) {
      return null;
    }

    return {
      detected: true,
      cmpType: 'termly',
      detectionMethod: 'api',
      confidenceScore: 0.9,
      consentStatus: 'unknown',
      cookieNames: getCookiesByPattern(LOCAL_CMP_CONFIGS.termly.cookiePatterns),
    };
  } catch (error) {
    logger.debug('CMPDetector', 'Termly API detection failed', { error: toError(error).message });
    return null;
  }
}

async function detectTCFv2API(): Promise<CMPDetectionResult | null> {
  return new Promise((resolve) => {
    try {
      if (typeof window === 'undefined' || !window.__tcfapi) {
        resolve(null);
        return;
      }

      window.__tcfapi('getTCData', 2, (tcData: TCFData | null, success: boolean) => {
        if (!success || !tcData) {
          resolve(null);
          return;
        }

        let consentStatus: 'accepted' | 'rejected' | 'partial' | 'unknown' = 'unknown';

        if (tcData.purpose?.consents) {
          const consents = Object.values(tcData.purpose.consents);
          const totalConsents = consents.length;
          const acceptedConsents = consents.filter((c) => c === true).length;

          if (acceptedConsents === 0) {
            consentStatus = 'rejected';
          } else if (acceptedConsents === totalConsents) {
            consentStatus = 'accepted';
          } else {
            consentStatus = 'partial';
          }
        }

        resolve({
          detected: true,
          cmpType: tcData.cmpId ? `tcfv2-${tcData.cmpId}` : 'tcfv2',
          detectionMethod: 'api',
          confidenceScore: 1.0,
          consentStatus,
          cookieNames: ['euconsent-v2'],
          tcfVersion: '2.0',
        });
      });

      setTimeout(() => resolve(null), 1000);
    } catch (error) {
      logger.debug('CMPDetector', 'TCF v2 API detection failed', { error: toError(error).message });
      resolve(null);
    }
  });
}

function getCookiesByPattern(patterns: string[]): string[] {
  const cookies = document.cookie.split(';');
  const matchedCookies: string[] = [];

  for (const cookie of cookies) {
    const cookieName = cookie.trim().split('=')[0];
    for (const pattern of patterns) {
      if (cookieName.includes(pattern)) {
        matchedCookies.push(cookieName);
        break;
      }
    }
  }

  return matchedCookies;
}

function getCookieValue(name: string): string | null {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const cookieName = trimmed.slice(0, separatorIndex);
    const cookieValue = trimmed.slice(separatorIndex + 1);

    if (cookieName === name) {
      return decodeURIComponent(cookieValue);
    }
  }
  return null;
}

function parseOneTrustConsent(cookieValue: string): 'accepted' | 'rejected' | 'partial' | 'unknown' {
  try {
    if (cookieValue.includes('groups=')) {
      const groupsMatch = cookieValue.match(/groups=([^&]+)/);
      if (groupsMatch) {
        const groups = decodeURIComponent(groupsMatch[1]);
        const groupEntries = groups.split(',');
        const activeGroups = groupEntries.filter(g => g.includes(':1'));

        if (activeGroups.length === 0) {
          return 'rejected';
        }

        const hasRejected = groupEntries.some(g => g.includes(':0'));
        return hasRejected ? 'partial' : 'accepted';
      }
    }

    if (cookieValue.includes('isIABGlobal=false')) {
      return 'rejected';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function parseCookiebotConsent(cookieValue: string): 'accepted' | 'rejected' | 'partial' | 'unknown' {
  try {
    const decoded = decodeURIComponent(cookieValue);

    if (decoded.includes('necessary:true') && decoded.includes('preferences:false') && decoded.includes('statistics:false') && decoded.includes('marketing:false')) {
      return 'rejected';
    }

    if (decoded.includes('necessary:true') && decoded.includes('preferences:true') && decoded.includes('statistics:true') && decoded.includes('marketing:true')) {
      return 'accepted';
    }

    if (decoded.includes('necessary:true')) {
      return 'partial';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function parseGenericConsent(cookieValue: string): 'accepted' | 'rejected' | 'partial' | 'unknown' {
  try {
    const lower = cookieValue.toLowerCase();

    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'accepted' || lower === 'accept') {
      return 'accepted';
    }

    if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'rejected' || lower === 'reject' || lower === 'declined') {
      return 'rejected';
    }

    if (lower.includes('partial') || lower.includes('necessary')) {
      return 'partial';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function parseConsentByParser(
  parser: 'generic' | 'onetrust' | 'cookiebot',
  cookieValue: string
): 'accepted' | 'rejected' | 'partial' | 'unknown' {
  switch (parser) {
    case 'onetrust':
      return parseOneTrustConsent(cookieValue);
    case 'cookiebot':
      return parseCookiebotConsent(cookieValue);
    default:
      return parseGenericConsent(cookieValue);
  }
}

function detectCMPByBanner(cmpType: string, config: CMPConfig): CMPDetectionResult | null {
  const pageLanguage = detectPageLanguage();
  const localizedPatterns = getLocalizedPatterns(pageLanguage);

  for (const selector of config.bannerSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const hasRejectButton = hasRejectButtonInElement(element, localizedPatterns.reject);
        return {
          detected: true,
          cmpType,
          detectionMethod: 'banner',
          confidenceScore: 0.7,
          consentStatus: 'unknown',
          cookieNames: getCookiesByPattern(config.cookiePatterns),
          hasRejectButton,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function hasRejectButtonInElement(element: Element, patterns: string[]): boolean {
  const buttons = element.querySelectorAll('button, a, [role="button"]');
  for (const button of buttons) {
    const text = `${button.textContent || ''} ${button.getAttribute('aria-label') || ''}`.trim();
    if (matchesAnyPattern(text, patterns)) {
      return true;
    }
  }
  return false;
}

function detectCMPByCookie(cmpType: string, config: CMPConfig): CMPDetectionResult | null {
  const matchedCookies = getCookiesByPattern(config.cookiePatterns);

  if (matchedCookies.length > 0) {
    let consentStatus: 'accepted' | 'rejected' | 'partial' | 'unknown' = 'unknown';

    for (const cookieName of matchedCookies) {
      const cookieValue = getCookieValue(cookieName);
      if (!cookieValue) continue;

      const parserEntry = Object.entries(config.consentParsers).find(([cookiePattern]) =>
        cookieName.toLowerCase().includes(cookiePattern.toLowerCase())
      );
      const parser = parserEntry?.[1] ?? (cmpType === 'onetrust' ? 'onetrust' : cmpType === 'cookiebot' ? 'cookiebot' : 'generic');
      consentStatus = parseConsentByParser(parser, cookieValue);
      if (consentStatus !== 'unknown') {
        break;
      }
    }

    return {
      detected: true,
      cmpType,
      detectionMethod: 'cookie',
      confidenceScore: consentStatus !== 'unknown' ? 0.9 : 0.7,
      consentStatus,
      cookieNames: matchedCookies,
    };
  }

  return null;
}

export async function detectCMP(): Promise<CMPDetectionResult> {
  const defaultResult: CMPDetectionResult = {
    detected: false,
    cmpType: 'unknown',
    detectionMethod: 'cookie',
    confidenceScore: 0,
    consentStatus: 'unknown',
    cookieNames: [],
  };

  try {
    const cmpConfigs = await getCmpConfigs();
    for (const [cmpType, config] of Object.entries(cmpConfigs)) {
      for (const apiDetector of API_DETECTORS[cmpType] ?? []) {
        const apiResult = await apiDetector();
        if (apiResult) {
          logger.info('CMPDetector', 'CMP detected via API', { cmpType, confidenceScore: apiResult.confidenceScore });
          return apiResult;
        }
      }

      const cookieResult = detectCMPByCookie(cmpType, config);
      if (cookieResult) {
        const bannerResult = detectCMPByBanner(cmpType, config);
        if (bannerResult) {
          logger.info('CMPDetector', 'CMP detected via hybrid', { cmpType });
          return {
            ...cookieResult,
            detectionMethod: 'hybrid',
            confidenceScore: 0.9,
          };
        }
        logger.info('CMPDetector', 'CMP detected via cookie', { cmpType });
        return cookieResult;
      }

      const bannerResult = detectCMPByBanner(cmpType, config);
      if (bannerResult) {
        logger.info('CMPDetector', 'CMP detected via banner', { cmpType });
        return bannerResult;
      }
    }

    const tcfResult = await detectTCFv2API();
    if (tcfResult) {
      logger.info('CMPDetector', 'CMP detected via TCF v2', { cmpType: tcfResult.cmpType });
      return tcfResult;
    }

    logger.debug('CMPDetector', 'No CMP detected');
    return defaultResult;
  } catch (error) {
    logger.error('CMPDetector', 'Error during CMP detection', toError(error));
    return defaultResult;
  }
}

export function hasValidPersistedConsent(cmpResult: CMPDetectionResult): boolean {
  if (!cmpResult.detected) {
    return false;
  }

  if (cmpResult.cookieNames.length === 0) {
    return false;
  }

  if (cmpResult.consentStatus === 'unknown') {
    return false;
  }

  if (cmpResult.confidenceScore < 0.7) {
    return false;
  }

  return true;
}
