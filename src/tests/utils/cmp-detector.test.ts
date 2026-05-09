import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectCMP, hasValidPersistedConsent } from '@/utils/cmp-detector';
import type { CMPDetectionResult } from '@/types';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: loggerMock,
}));

describe('CMP detector', () => {
  const resetCookies = (): void => {
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: '',
    });
  };

  const clearCmpGlobals = (): void => {
    delete (window as { OneTrust?: unknown }).OneTrust;
    delete (window as { Cookiebot?: unknown }).Cookiebot;
    delete (window as { termly?: unknown }).termly;
    delete (window as { __tcfapi?: unknown }).__tcfapi;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetCookies();
    clearCmpGlobals();
  });

  afterEach(() => {
    clearCmpGlobals();
    resetCookies();
  });

  describe('CMP cookie detection', () => {
    it('detects OneTrust consent from cookies', async () => {
      document.cookie = 'OptanonConsent=groups=C0001%3A1%2CC0002%3A1';

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('onetrust');
      expect(result.detectionMethod).toBe('cookie');
      expect(result.cookieNames).toContain('OptanonConsent');
      expect(result.consentStatus).toBe('accepted');
    });

    it('detects Cookiebot acceptance from cookies', async () => {
      document.cookie = 'CookieConsent=necessary:true,preferences:true,statistics:true,marketing:true';

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('cookiebot');
      expect(result.detectionMethod).toBe('cookie');
      expect(result.cookieNames).toContain('CookieConsent');
      expect(result.consentStatus).toBe('accepted');
    });

    it('detects TCF consent presence from euconsent-v2 cookie', async () => {
      document.cookie = 'euconsent-v2=BOEFEAyOEFEAyAHABDENAI4AAAB9vABAASA';

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('quantcast');
      expect(result.detectionMethod).toBe('cookie');
      expect(result.cookieNames).toContain('euconsent-v2');
      expect(result.consentStatus).toBe('unknown');
    });

    it('handles empty Cookiebot cookie value as unknown consent', async () => {
      document.cookie = 'CookieConsent=';

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('cookiebot');
      expect(result.consentStatus).toBe('unknown');
      expect(result.confidenceScore).toBe(0.7);
    });

    it('handles malformed encoded cookie values safely', async () => {
      document.cookie = 'OptanonConsent=%E0%A4%A';

      const result = await detectCMP();

      expect(result.detected).toBe(false);
      expect(result.cmpType).toBe('unknown');
      expect(result.cookieNames).toHaveLength(0);
    });

    it('parses generic termly consent cookies case-insensitively', async () => {
      document.cookie = 'termly-consent=TRUE';

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('termly');
      expect(result.consentStatus).toBe('accepted');
      expect(result.detectionMethod).toBe('cookie');
    });

    it('handles malformed OneTrust groups payload as unknown consent', async () => {
      document.cookie = 'OptanonConsent=groups=';

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('onetrust');
      expect(result.consentStatus).toBe('unknown');
      expect(result.confidenceScore).toBe(0.7);
    });
  });

  describe('CMP API detection', () => {
    it('returns unknown when Cookiebot API is absent and no other signals exist', async () => {
      delete (window as { Cookiebot?: unknown }).Cookiebot;

      const result = await detectCMP();

      expect(result.detected).toBe(false);
      expect(result.cmpType).toBe('unknown');
    });

    it('detects TCF v2 CMP via __tcfapi (e.g. Didomi)', async () => {
      (window as { __tcfapi?: unknown }).__tcfapi = vi.fn(
        (_command: string, _version: number, callback: (data: unknown, success: boolean) => void) => {
          callback(
            {
              cmpId: 300,
              purpose: { consents: { 1: true, 2: false, 3: true } },
            },
            true
          );
        }
      );

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.detectionMethod).toBe('api');
      expect(result.cmpType).toBe('tcfv2-300');
      expect(result.consentStatus).toBe('partial');
      expect(result.cookieNames).toContain('euconsent-v2');
    });

    it('falls back to unknown when __tcfapi returns no data', async () => {
      (window as { __tcfapi?: unknown }).__tcfapi = vi.fn(
        (_command: string, _version: number, callback: (data: unknown, success: boolean) => void) => {
          callback(null, false);
        }
      );

      const result = await detectCMP();

      expect(result.detected).toBe(false);
      expect(result.cmpType).toBe('unknown');
      expect(result.cookieNames).toHaveLength(0);
    });

    it('detects OneTrust via window.OneTrust API', async () => {
      (window as { OneTrust?: unknown }).OneTrust = {
        GetDomainData: vi.fn().mockReturnValue({ ConsentModel: { Name: 'opt-in' } }),
        IsAlertBoxClosed: vi.fn().mockReturnValue(true),
      };

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('onetrust');
      expect(result.detectionMethod).toBe('api');
    });

    it('detects Cookiebot via window.Cookiebot API', async () => {
      (window as { Cookiebot?: unknown }).Cookiebot = {
        consent: {
          necessary: true,
          preferences: true,
          statistics: false,
          marketing: false,
        },
        consented: true,
      };

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('cookiebot');
      expect(result.detectionMethod).toBe('api');
      expect(result.consentStatus).toBe('partial');
    });

    it('detects Termly via window.termly API', async () => {
      (window as { termly?: unknown }).termly = {
        getConsent: vi.fn().mockReturnValue({ necessary: true, analytics: true }),
      };

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('termly');
      expect(result.detectionMethod).toBe('api');
    });

    it('handles __tcfapi timeout gracefully', async () => {
      (window as { __tcfapi?: unknown }).__tcfapi = vi.fn();

      const result = await detectCMP();

      expect(result.detected).toBe(false);
      expect(result.cmpType).toBe('unknown');
    });

    it('falls back to final TCF v2 detection pass when first call fails', async () => {
      let callCount = 0;
      (window as { __tcfapi?: unknown }).__tcfapi = vi.fn(
        (_command: string, _version: number, callback: (data: unknown, success: boolean) => void) => {
          callCount += 1;
          if (callCount === 1) {
            callback(null, false);
            return;
          }

          callback(
            {
              cmpId: 42,
              purpose: { consents: { 1: true, 2: true } },
            },
            true
          );
        }
      );

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('tcfv2-42');
      expect(result.detectionMethod).toBe('api');
      expect(loggerMock.info).toHaveBeenCalledWith(
        'CMPDetector',
        'CMP detected via TCF v2',
        { cmpType: 'tcfv2-42' }
      );
    });
  });

  describe('Consent status detection', () => {
    it('detects rejected consent from OneTrust cookie', async () => {
      document.cookie = 'OptanonConsent=groups=C0001%3A0%2CC0002%3A0';

      const result = await detectCMP();

      expect(result.consentStatus).toBe('rejected');
    });

    it('detects partial consent from Cookiebot', async () => {
      (window as { Cookiebot?: unknown }).Cookiebot = {
        consent: {
          necessary: true,
          preferences: false,
          statistics: false,
          marketing: false,
        },
        consented: true,
      };

      const result = await detectCMP();

      expect(result.consentStatus).toBe('partial');
    });

    it('detects full acceptance from Cookiebot', async () => {
      (window as { Cookiebot?: unknown }).Cookiebot = {
        consent: {
          necessary: true,
          preferences: true,
          statistics: true,
          marketing: true,
        },
        consented: true,
      };

      const result = await detectCMP();

      expect(result.consentStatus).toBe('accepted');
    });
  });

  describe('Confidence scoring', () => {
    it('returns high confidence when both API and cookie detected', async () => {
      document.cookie = 'OptanonConsent=groups=C0001%3A1';
      (window as { OneTrust?: unknown }).OneTrust = {
        GetDomainData: vi.fn().mockReturnValue({ ConsentModel: { Name: 'opt-in' } }),
      };

      const result = await detectCMP();

      expect(result.confidenceScore).toBeGreaterThan(0.8);
      expect(result.detectionMethod).toBe('api'); // API takes precedence
    });

    it('returns medium confidence for cookie-only detection', async () => {
      document.cookie = 'CookieConsent=necessary:true';

      const result = await detectCMP();

      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.5);
      expect(result.confidenceScore).toBeLessThanOrEqual(0.9);
    });

    it('returns hybrid detection when banner and cookie signals both exist', async () => {
      document.cookie = 'CookieControl=true';
      document.body.innerHTML = `
        <div data-cc-banner="true">
          <button>Reject</button>
          <button>Accept</button>
        </div>
      `;

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('cookiecontrol');
      expect(result.detectionMethod).toBe('hybrid');
      expect(result.confidenceScore).toBe(0.9);
    });

    it('detects banner-only CMP with localized reject action', async () => {
      document.body.innerHTML = `
        <section data-gdpr="true">
          <button aria-label="Reject all cookies">Reject all cookies</button>
        </section>
      `;

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('gdprcompliant');
      expect(result.detectionMethod).toBe('banner');
      expect(result.hasRejectButton).toBe(true);
      expect(result.cookieNames).toEqual([]);
    });

    it('continues banner detection when one selector throws', async () => {
      const originalQuerySelector = document.querySelector.bind(document);
      const querySelectorSpy = vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
        if (selector === '[data-gdpr]') {
          throw new Error('invalid selector in test');
        }
        return originalQuerySelector(selector);
      });

      document.body.innerHTML = `
        <div class="gdpr-banner">
          <button>Reject all</button>
        </div>
      `;

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('gdprcompliant');
      expect(result.detectionMethod).toBe('banner');
      querySelectorSpy.mockRestore();
    });

    it('handles parseGenericConsent parse errors and keeps consent unknown', async () => {
      const decodeSpy = vi.spyOn(global, 'decodeURIComponent').mockImplementationOnce(
        () => ({ malformed: true } as unknown as string)
      );
      document.cookie = 'termly-consent=TRUE';

      const result = await detectCMP();

      expect(result.detected).toBe(true);
      expect(result.cmpType).toBe('termly');
      expect(result.consentStatus).toBe('unknown');
      decodeSpy.mockRestore();
    });
  });

  describe('hasValidPersistedConsent', () => {
    const buildResult = (overrides: Partial<CMPDetectionResult> = {}): CMPDetectionResult => ({
      detected: true,
      cmpType: 'onetrust',
      detectionMethod: 'cookie',
      confidenceScore: 0.9,
      consentStatus: 'accepted',
      cookieNames: ['OptanonConsent'],
      ...overrides,
    });

    it('returns false when cmp is not detected', () => {
      const result = buildResult({ detected: false });

      expect(hasValidPersistedConsent(result)).toBe(false);
    });

    it('returns false when there are no cookie names', () => {
      const result = buildResult({ cookieNames: [] });

      expect(hasValidPersistedConsent(result)).toBe(false);
    });

    it('returns false when consent status is unknown', () => {
      const result = buildResult({ consentStatus: 'unknown' });

      expect(hasValidPersistedConsent(result)).toBe(false);
    });

    it('returns false when confidence score is below threshold', () => {
      const result = buildResult({ confidenceScore: 0.69 });

      expect(hasValidPersistedConsent(result)).toBe(false);
    });

    it('returns true when all persistence criteria pass', () => {
      const result = buildResult();

      expect(hasValidPersistedConsent(result)).toBe(true);
    });
  });
});
