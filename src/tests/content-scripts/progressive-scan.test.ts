import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/cmp-detector', () => ({
  detectCMP: vi.fn().mockResolvedValue({
    detected: false,
    cmpType: 'unknown',
    detectionMethod: 'cookie',
    confidenceScore: 0,
    consentStatus: 'unknown',
    cookieNames: [],
  }),
  hasValidPersistedConsent: vi.fn().mockReturnValue(false),
}));

const { calculateConfidenceMock } = vi.hoisted(() => ({
  calculateConfidenceMock: vi.fn(),
}));

vi.mock('@/utils/scan-confidence', () => ({
  calculateConfidence: calculateConfidenceMock,
}));

describe('ConsentScanner progressive scans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ success: true }),
        getURL: vi.fn((path: string) => path),
      },
    } as unknown as typeof chrome;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        cookieBannerSelectors: ['#cookie-banner'],
        rejectButtonPatterns: ['reject'],
        acceptButtonPatterns: ['accept'],
        complianceChecks: {
          rejectButtonRequired: true,
          rejectButtonVisibleWithoutScroll: true,
          equalProminence: true,
          noPreCheckedBoxes: true,
          explicitConsent: true,
        },
        deceptivePatterns: [],
      }),
    }));

    calculateConfidenceMock.mockReturnValue({
      overall: 90,
      bannerDetection: { name: 'bannerDetection', score: 90, weight: 0.25, reasoning: 'mock' },
      buttonDetection: { name: 'buttonDetection', score: 90, weight: 0.3, reasoning: 'mock' },
      cmpRecognition: { name: 'cmpRecognition', score: 90, weight: 0.25, reasoning: 'mock' },
      contextualAnalysis: { name: 'contextualAnalysis', score: 90, weight: 0.2, reasoning: 'mock' },
      factors: [],
      reasoning: [],
      shouldAlert: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends consent scan result when confidence is high', async () => {
    document.body.innerHTML = `
      <div id="cookie-banner" style="position: fixed; top: 0; left: 0; z-index: 2000;">
        We use cookies to improve your experience.
        <button id="accept">Accept</button>
        <button id="reject">Reject</button>
      </div>
    `;

    const banner = document.getElementById('cookie-banner')!;
    const accept = document.getElementById('accept')!;
    const reject = document.getElementById('reject')!;
    const rect = { width: 300, height: 80, top: 0, bottom: 80, left: 0, right: 300 } as DOMRect;
    banner.getBoundingClientRect = () => rect;
    accept.getBoundingClientRect = () => ({ ...rect, width: 120, height: 40 } as DOMRect);
    reject.getBoundingClientRect = () => ({ ...rect, width: 120, height: 40 } as DOMRect);

    const module = await import('@/content-scripts/consent-scanner');
    const { scanner } = module;

    await scanner.initialize();
    await scanner.scanPage('quick');

    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    scanner.reset();
  });

  it('skips sending when confidence is low', async () => {
    calculateConfidenceMock.mockReturnValue({
      overall: 40,
      bannerDetection: { name: 'bannerDetection', score: 40, weight: 0.25, reasoning: 'mock' },
      buttonDetection: { name: 'buttonDetection', score: 40, weight: 0.3, reasoning: 'mock' },
      cmpRecognition: { name: 'cmpRecognition', score: 40, weight: 0.25, reasoning: 'mock' },
      contextualAnalysis: { name: 'contextualAnalysis', score: 40, weight: 0.2, reasoning: 'mock' },
      factors: [],
      reasoning: [],
      shouldAlert: false,
    });
    document.body.innerHTML = `
      <div id="cookie-banner">We use cookies to improve your experience.</div>
    `;

    const banner = document.getElementById('cookie-banner')!;
    banner.getBoundingClientRect = () => ({ width: 300, height: 80, top: 200, bottom: 280, left: 0, right: 300 } as DOMRect);

    const module = await import('@/content-scripts/consent-scanner');
    const { scanner } = module;

    await scanner.initialize();
    await scanner.scanPage('quick');

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    scanner.reset();
  });
});
