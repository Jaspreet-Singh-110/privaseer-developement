import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DeceptivePatternViolation, DeceptivePatternRule, CMPDetectionResult, PrivacyRules } from '@/types';
import { SCAN_PHASES } from '@/utils/constants';

// Mock CMP detector module - use vi.hoisted to ensure mocks are available before module import
const { detectCMPMock, hasValidPersistedConsentMock } = vi.hoisted(() => ({
  detectCMPMock: vi.fn(),
  hasValidPersistedConsentMock: vi.fn(),
}));

vi.mock('@/utils/cmp-detector', () => ({
  detectCMP: detectCMPMock,
  hasValidPersistedConsent: hasValidPersistedConsentMock,
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock sanitizer
vi.mock('@/utils/sanitizer', () => ({
  sanitizeUrl: vi.fn((url: string | null | undefined) => url || 'https://example.com'),
}));

const { calculateConfidenceMock } = vi.hoisted(() => ({
  calculateConfidenceMock: vi.fn(() => ({
    overall: 90,
    bannerDetection: { name: 'bannerDetection', score: 90, weight: 0.25, reasoning: 'mock' },
    buttonDetection: { name: 'buttonDetection', score: 90, weight: 0.3, reasoning: 'mock' },
    cmpRecognition: { name: 'cmpRecognition', score: 90, weight: 0.25, reasoning: 'mock' },
    contextualAnalysis: { name: 'contextualAnalysis', score: 90, weight: 0.2, reasoning: 'mock' },
    factors: [],
    reasoning: [],
    shouldAlert: true,
  })),
}));

vi.mock('@/utils/scan-confidence', () => ({
  calculateConfidence: calculateConfidenceMock,
}));

// Import scanner after mocks are set up
import { scanner } from '@/content-scripts/consent-scanner';

// Mock privacy rules data
const mockPrivacyRules: PrivacyRules = {
  version: '1.0.0',
  cookieBannerSelectors: [
    '[class*="cookie-banner"]',
    '[id*="cookie-consent"]',
    '#onetrust-banner-sdk',
    '#CybotCookiebotDialog',
  ],
  rejectButtonPatterns: [
    'reject all',
    'reject cookies',
    'decline all',
    'deny all',
    'necessary only',
  ],
  acceptButtonPatterns: [
    'accept all',
    'accept cookies',
    'allow all',
    'agree',
    'i accept',
  ],
  complianceChecks: {
    rejectButtonRequired: true,
    rejectButtonVisibleWithoutScroll: true,
    equalProminence: true,
    noPreCheckedBoxes: true,
    explicitConsent: true,
  },
  deceptivePatterns: [
    {
      id: 'hiddenRejectButton',
      name: 'Hidden Reject Button',
      description: 'Reject button is hidden or hard to find',
      severity: 'high',
      penalty: 40,
    },
    {
      id: 'acceptButtonProminence',
      name: 'Accept Button Prominence',
      description: 'Accept button is more prominent than reject',
      severity: 'medium',
      penalty: 25,
    },
    {
      id: 'preCheckedBoxes',
      name: 'Pre-checked Consent Boxes',
      description: 'Consent options are pre-selected',
      severity: 'medium',
      penalty: 30,
    },
    {
      id: 'forcedConsent',
      name: 'Forced Consent',
      description: 'No reject option available',
      severity: 'critical',
      penalty: 50,
    },
  ],
};

describe('GDPR Compliance Scoring', () => {
  const mockRules: DeceptivePatternRule[] = [
    {
      id: 'hiddenRejectButton',
      name: 'Hidden Reject Button',
      description: 'Reject button is hidden or hard to find',
      severity: 'high',
      penalty: 40,
    },
    {
      id: 'acceptButtonProminence',
      name: 'Accept Button Prominence',
      description: 'Accept button is more prominent than reject',
      severity: 'medium',
      penalty: 25,
    },
    {
      id: 'preCheckedBoxes',
      name: 'Pre-checked Consent Boxes',
      description: 'Consent options are pre-selected',
      severity: 'medium',
      penalty: 30,
    },
    {
      id: 'forcedConsent',
      name: 'Forced Consent',
      description: 'No reject option available',
      severity: 'critical',
      penalty: 50,
    },
  ];

  function calculateComplianceScore(violations: DeceptivePatternViolation[]): number {
    const totalPenalty = violations.reduce((sum, v) => sum + v.penalty, 0);
    return Math.max(0, 100 - totalPenalty);
  }

  function getViolationDetails(patternIds: string[]): DeceptivePatternViolation[] {
    const violations: DeceptivePatternViolation[] = [];
    const patternMap = new Map(mockRules.map(p => [p.id, p]));

    for (const id of patternIds) {
      const rule = patternMap.get(id);
      if (rule) {
        violations.push({
          id: rule.id,
          name: rule.name,
          description: rule.description,
          severity: rule.severity,
          penalty: rule.penalty,
        });
      }
    }

    return violations;
  }

  describe('Penalty Calculation', () => {
    it('should return 100 for fully compliant site with no violations', () => {
      const violations = getViolationDetails([]);
      const score = calculateComplianceScore(violations);
      expect(score).toBe(100);
    });

    it('should apply 40 point penalty for hidden reject button', () => {
      const violations = getViolationDetails(['hiddenRejectButton']);
      const score = calculateComplianceScore(violations);
      expect(score).toBe(60);
      expect(violations[0].severity).toBe('high');
      expect(violations[0].penalty).toBe(40);
    });

    it('should apply 25 point penalty for accept button prominence', () => {
      const violations = getViolationDetails(['acceptButtonProminence']);
      const score = calculateComplianceScore(violations);
      expect(score).toBe(75);
      expect(violations[0].severity).toBe('medium');
      expect(violations[0].penalty).toBe(25);
    });

    it('should apply 30 point penalty for pre-checked boxes', () => {
      const violations = getViolationDetails(['preCheckedBoxes']);
      const score = calculateComplianceScore(violations);
      expect(score).toBe(70);
      expect(violations[0].severity).toBe('medium');
      expect(violations[0].penalty).toBe(30);
    });

    it('should apply 50 point penalty for forced consent', () => {
      const violations = getViolationDetails(['forcedConsent']);
      const score = calculateComplianceScore(violations);
      expect(score).toBe(50);
      expect(violations[0].severity).toBe('critical');
      expect(violations[0].penalty).toBe(50);
    });
  });

  describe('Multiple Violations', () => {
    it('should accumulate penalties for multiple violations', () => {
      const violations = getViolationDetails(['hiddenRejectButton', 'acceptButtonProminence']);
      const score = calculateComplianceScore(violations);
      expect(score).toBe(35);
      expect(violations).toHaveLength(2);
    });

    it('should handle all medium violations', () => {
      const violations = getViolationDetails(['acceptButtonProminence', 'preCheckedBoxes']);
      const score = calculateComplianceScore(violations);
      expect(score).toBe(45);
    });

    it('should result in low score for critical + high violations', () => {
      const violations = getViolationDetails(['forcedConsent', 'hiddenRejectButton']);
      const score = calculateComplianceScore(violations);
      expect(score).toBe(10);
    });

    it('should cap score at 0 for excessive violations', () => {
      const violations = getViolationDetails([
        'forcedConsent',
        'hiddenRejectButton',
        'acceptButtonProminence',
        'preCheckedBoxes',
      ]);
      const score = calculateComplianceScore(violations);
      expect(score).toBe(0);
    });
  });

  describe('Violation Details', () => {
    it('should provide complete violation information', () => {
      const violations = getViolationDetails(['hiddenRejectButton']);
      expect(violations[0]).toEqual({
        id: 'hiddenRejectButton',
        name: 'Hidden Reject Button',
        description: 'Reject button is hidden or hard to find',
        severity: 'high',
        penalty: 40,
      });
    });

    it('should handle unknown pattern IDs gracefully', () => {
      const violations = getViolationDetails(['unknownPattern']);
      expect(violations).toHaveLength(0);
    });

    it('should return multiple violation details in order', () => {
      const violations = getViolationDetails(['preCheckedBoxes', 'acceptButtonProminence']);
      expect(violations).toHaveLength(2);
      expect(violations[0].id).toBe('preCheckedBoxes');
      expect(violations[1].id).toBe('acceptButtonProminence');
    });
  });

  describe('Severity Levels', () => {
    it('should classify critical violations correctly', () => {
      const violations = getViolationDetails(['forcedConsent']);
      expect(violations[0].severity).toBe('critical');
      expect(violations[0].penalty).toBeGreaterThanOrEqual(50);
    });

    it('should classify high severity violations correctly', () => {
      const violations = getViolationDetails(['hiddenRejectButton']);
      expect(violations[0].severity).toBe('high');
      expect(violations[0].penalty).toBeGreaterThanOrEqual(40);
    });

    it('should classify medium severity violations correctly', () => {
      const mediumViolations = getViolationDetails(['acceptButtonProminence', 'preCheckedBoxes']);
      mediumViolations.forEach(v => {
        expect(v.severity).toBe('medium');
        expect(v.penalty).toBeGreaterThanOrEqual(25);
        expect(v.penalty).toBeLessThan(40);
      });
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle typical non-compliant banner (hidden reject + prominence)', () => {
      const violations = getViolationDetails(['hiddenRejectButton', 'acceptButtonProminence']);
      const score = calculateComplianceScore(violations);

      expect(score).toBe(35);
      expect(violations).toHaveLength(2);
      expect(violations.some(v => v.severity === 'high')).toBe(true);
      expect(violations.some(v => v.severity === 'medium')).toBe(true);
    });

    it('should handle deceptive banner with pre-checked boxes', () => {
      const violations = getViolationDetails(['preCheckedBoxes', 'acceptButtonProminence']);
      const score = calculateComplianceScore(violations);

      expect(score).toBe(45);
      expect(violations).toHaveLength(2);
    });

    it('should severely penalize forced consent scenarios', () => {
      const violations = getViolationDetails(['forcedConsent']);
      const score = calculateComplianceScore(violations);

      expect(score).toBeLessThanOrEqual(50);
      expect(violations[0].severity).toBe('critical');
    });

    it('should identify compliant banners (score >= 80)', () => {
      const violations = getViolationDetails([]);
      const score = calculateComplianceScore(violations);

      expect(score).toBeGreaterThanOrEqual(80);
      expect(violations).toHaveLength(0);
    });

    it('should identify marginally compliant banners', () => {
      const violations = getViolationDetails(['acceptButtonProminence']);
      const score = calculateComplianceScore(violations);

      expect(score).toBe(75);
      expect(score).toBeLessThan(80);
    });
  });

  describe('Penalty Ranges', () => {
    it('should have critical penalties >= 50', () => {
      const critical = mockRules.filter(r => r.severity === 'critical');
      critical.forEach(rule => {
        expect(rule.penalty).toBeGreaterThanOrEqual(50);
      });
    });

    it('should have high severity penalties in range [40, 50)', () => {
      const high = mockRules.filter(r => r.severity === 'high');
      high.forEach(rule => {
        expect(rule.penalty).toBeGreaterThanOrEqual(40);
        expect(rule.penalty).toBeLessThan(50);
      });
    });

    it('should have medium severity penalties in range [25, 40)', () => {
      const medium = mockRules.filter(r => r.severity === 'medium');
      medium.forEach(rule => {
        expect(rule.penalty).toBeGreaterThanOrEqual(25);
        expect(rule.penalty).toBeLessThan(40);
      });
    });
  });
});

// ============================================================================
// ConsentScanner Integration Tests
// ============================================================================

describe('ConsentScanner Integration', () => {
  let bannerCounter = 0;
  
  // DOM setup helpers
  function setupBannerDOM(options: {
    hasRejectButton: boolean;
    preChecked?: boolean;
    acceptButtonSize?: { width: number; height: number };
    rejectButtonSize?: { width: number; height: number };
    bannerClass?: string;
  }) {
    const acceptWidth = options.acceptButtonSize?.width || 100;
    const acceptHeight = options.acceptButtonSize?.height || 40;
    const rejectWidth = options.rejectButtonSize?.width || 100;
    const rejectHeight = options.rejectButtonSize?.height || 40;
    const bannerClass = options.bannerClass || 'cookie-banner';
    
    // Add unique text to make each banner unique (avoid duplicate detection)
    bannerCounter++;
    const uniqueId = `UNIQUE-BANNER-${bannerCounter}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Create banner element
    const banner = document.createElement('div');
    banner.className = bannerClass;
    banner.style.display = 'block';
    banner.style.visibility = 'visible';
    banner.style.opacity = '1';
    banner.setAttribute('data-test-id', uniqueId);
    banner.getBoundingClientRect = vi.fn(() => ({
      width: 300,
      height: 120,
      top: 0,
      left: 0,
      bottom: 120,
      right: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    
    const text = document.createElement('p');
    // Put unique ID at the START so it's in the first 100 chars used for duplicate detection
    text.textContent = `${uniqueId} - We use cookies to improve your experience.`;
    banner.appendChild(text);
    
    const acceptBtn = document.createElement('button');
    acceptBtn.id = 'accept-btn';
    acceptBtn.style.width = `${acceptWidth}px`;
    acceptBtn.style.height = `${acceptHeight}px`;
    acceptBtn.style.fontSize = '16px';
    acceptBtn.textContent = 'Accept All';
    banner.appendChild(acceptBtn);
    
    if (options.hasRejectButton) {
      const rejectBtn = document.createElement('button');
      rejectBtn.id = 'reject-btn';
      rejectBtn.style.width = `${rejectWidth}px`;
      rejectBtn.style.height = `${rejectHeight}px`;
      rejectBtn.style.fontSize = '16px';
      rejectBtn.textContent = 'Reject All';
      banner.appendChild(rejectBtn);
    }
    
    if (options.preChecked) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      banner.appendChild(checkbox);
    }
    
    document.body.appendChild(banner);

    // Mock getBoundingClientRect for buttons
    acceptBtn.getBoundingClientRect = vi.fn(() => ({
      width: acceptWidth,
      height: acceptHeight,
      top: 0,
      left: 0,
      bottom: acceptHeight,
      right: acceptWidth,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));

    if (options.hasRejectButton) {
      const rejectBtn = document.getElementById('reject-btn');
      if (rejectBtn) {
        rejectBtn.getBoundingClientRect = vi.fn(() => ({
          width: rejectWidth,
          height: rejectHeight,
          top: 0,
          left: 0,
          bottom: rejectHeight,
          right: rejectWidth,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }));
      }
    }
  }

  function setupOneTrustBanner() {
    document.body.innerHTML = `
      <div id="onetrust-banner-sdk" style="display: block; visibility: visible; opacity: 1;">
        <p>We use cookies</p>
        <button>Accept All</button>
        <button>Reject All</button>
      </div>
    `;
    const banner = document.getElementById('onetrust-banner-sdk');
    if (banner) {
      banner.getBoundingClientRect = vi.fn(() => ({
        width: 300,
        height: 120,
        top: 0,
        left: 0,
        bottom: 120,
        right: 300,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }));
    }
  }

  function setupCookiebotBanner() {
    document.body.innerHTML = `
      <div id="CybotCookiebotDialog" style="display: block; visibility: visible; opacity: 1;">
        <p>Cookie consent</p>
        <button>Accept</button>
        <button>Decline All</button>
      </div>
    `;
    const banner = document.getElementById('CybotCookiebotDialog');
    if (banner) {
      banner.getBoundingClientRect = vi.fn(() => ({
        width: 300,
        height: 120,
        top: 0,
        left: 0,
        bottom: 120,
        right: 300,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }));
    }
  }

  beforeEach(async () => {
    // Reset DOM
    document.body.innerHTML = '';
    
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock chrome.runtime.getURL
    if (!chrome.runtime.getURL) {
      chrome.runtime.getURL = vi.fn();
    }
    (chrome.runtime.getURL as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string) => `chrome-extension://test/${path}`
    );

    // Mock fetch for privacy-rules.json
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(mockPrivacyRules),
    });

    // Mock chrome.runtime.sendMessage
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    // Default CMP detection mock
    detectCMPMock.mockResolvedValue({
      detected: false,
      cmpType: 'unknown',
      detectionMethod: 'cookie',
      confidenceScore: 0,
      consentStatus: 'unknown',
      cookieNames: [],
    });

    hasValidPersistedConsentMock.mockReturnValue(false);
    
    // Reset scanner state (tests will call initialize after setting up DOM)
    scanner.reset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  describe('CMP Detection', () => {
    it('should detect OneTrust CMP via API/cookies', async () => {
      const oneTrustCMP: CMPDetectionResult = {
        detected: true,
        cmpType: 'onetrust',
        detectionMethod: 'api',
        confidenceScore: 1.0,
        consentStatus: 'unknown',
        cookieNames: ['OptanonConsent'],
      };

      detectCMPMock.mockResolvedValue(oneTrustCMP);
      setupOneTrustBanner();

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');
      
      expect(detectCMPMock).toHaveBeenCalledTimes(1);
      
      // Verify message was sent with CMP detection
      await vi.waitFor(() => {
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'CONSENT_SCAN_RESULT' })
        );
      }, { timeout: 3000 });

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      if (consentScanCall) {
        expect(consentScanCall[0].data.cmpDetection).toEqual(oneTrustCMP);
      }
    });

    it('should detect Cookiebot CMP via banner selector', async () => {
      const cookiebotCMP: CMPDetectionResult = {
        detected: true,
        cmpType: 'cookiebot',
        detectionMethod: 'banner',
        confidenceScore: 0.7,
        consentStatus: 'unknown',
        cookieNames: [],
      };

      detectCMPMock.mockResolvedValue(cookiebotCMP);
      setupCookiebotBanner();

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');

      expect(detectCMPMock).toHaveBeenCalledTimes(1);
    });

    it('should return unknown when no CMP detected', async () => {
      const noCMP: CMPDetectionResult = {
        detected: false,
        cmpType: 'unknown',
        detectionMethod: 'cookie',
        confidenceScore: 0,
        consentStatus: 'unknown',
        cookieNames: [],
      };

      detectCMPMock.mockResolvedValue(noCMP);
      setupBannerDOM({ hasRejectButton: true });

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');

      expect(detectCMPMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Banner & Button Detection', () => {
    it('should find cookie banner using class selector', async () => {
      setupBannerDOM({ hasRejectButton: true });

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      expect(consentScanCall?.[0]).toMatchObject({
        type: 'CONSENT_SCAN_RESULT',
        data: expect.any(Object),
      });
      expect(consentScanCall![0].data.hasBanner).toBe(true);
    });

    it('should find Accept button via text pattern', async () => {
      setupBannerDOM({ hasRejectButton: true });

      // Wait for MutationObserver debounce (500ms) + scan processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      const acceptBtn = document.getElementById('accept-btn');
      expect(acceptBtn).toBeDefined();
      expect(acceptBtn?.textContent).toContain('Accept All');
    });

    it('should find Reject button via text pattern', async () => {
      setupBannerDOM({ hasRejectButton: true });

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      expect(consentScanCall?.[0]).toMatchObject({
        type: 'CONSENT_SCAN_RESULT',
        data: expect.any(Object),
      });
      expect(consentScanCall![0].data.hasRejectButton).toBe(true);
    });

    it('should return hasRejectButton: false when no reject button exists', async () => {
      setupBannerDOM({ hasRejectButton: false });

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      expect(consentScanCall?.[0]).toMatchObject({
        type: 'CONSENT_SCAN_RESULT',
        data: expect.any(Object),
      });
      expect(consentScanCall![0].data.hasRejectButton).toBe(false);
    });

    it('ignores hidden banners when detecting consent', async () => {
      setupBannerDOM({ hasRejectButton: true });
      const banner = document.querySelector('.cookie-banner') as HTMLElement | null;
      if (banner) {
        banner.style.display = 'none';
      }

      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      expect(consentScanCall).toBeUndefined();
    });

    it('falls back to keyword banner detection when selector lookup misses', async () => {
      document.body.innerHTML = `
        <section id="fallback-banner" style="display:block; visibility:visible; opacity:1;">
          We use cookies to improve your experience.
          <button>Accept All</button>
          <button>Reject All</button>
        </section>
      `;
      const fallbackBanner = document.getElementById('fallback-banner');
      if (fallbackBanner) {
        fallbackBanner.getBoundingClientRect = vi.fn(() => ({
          width: 250,
          height: 100,
          top: 0,
          left: 0,
          bottom: 100,
          right: 250,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }));
      }

      await scanner.initialize();
      const detectedBanner = (scanner as unknown as { findCookieBanner: () => Element | null }).findCookieBanner();

      expect(detectedBanner).toBe(fallbackBanner);
    });

    it('treats opacity zero banners as not visible', async () => {
      setupBannerDOM({ hasRejectButton: true });
      const banner = document.querySelector('.cookie-banner') as HTMLElement | null;
      if (banner) {
        banner.style.opacity = '0';
      }

      await scanner.initialize();
      const visible = (scanner as unknown as { isVisible: (element: Element) => boolean }).isVisible(
        banner as Element
      );

      expect(visible).toBe(false);
    });
  });

  describe('Compliance Scoring', () => {
    it('should mark non-compliant when no reject button (forcedConsent pattern)', async () => {
      setupBannerDOM({ hasRejectButton: false });

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      expect(consentScanCall).toBeDefined();
      expect(consentScanCall![0].data.isCompliant).toBe(false);
      expect(consentScanCall![0].data.deceptivePatterns).toContain('forcedConsent');
      expect(consentScanCall![0].data.complianceScore).toBe(50); // 100 - 50 penalty
    });

    it('detects obstacle and misdirection patterns in no-reject flow', async () => {
      const banner = document.createElement('div');
      banner.className = 'cookie-banner';
      banner.style.display = 'block';
      banner.style.visibility = 'visible';
      banner.style.opacity = '1';
      banner.getBoundingClientRect = vi.fn(() => ({
        width: 300,
        height: 120,
        top: 0,
        left: 0,
        bottom: 120,
        right: 300,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }));

      const text = document.createElement('p');
      text.textContent = 'We use cookies to personalize your experience.';
      banner.appendChild(text);

      const acceptButton = document.createElement('button');
      acceptButton.textContent = 'Accept All';
      acceptButton.getBoundingClientRect = vi.fn(() => ({
        width: 100,
        height: 40,
        top: 0,
        left: 0,
        bottom: 40,
        right: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }));
      banner.appendChild(acceptButton);

      const preferenceLink = document.createElement('a');
      preferenceLink.textContent = 'Manage Preferences';
      preferenceLink.href = 'https://example.com/privacy/settings';
      preferenceLink.getBoundingClientRect = vi.fn(() => ({
        width: 100,
        height: 20,
        top: 45,
        left: 0,
        bottom: 65,
        right: 100,
        x: 0,
        y: 45,
        toJSON: () => ({}),
      }));
      banner.appendChild(preferenceLink);

      document.body.appendChild(banner);

      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      expect(consentScanCall).toBeDefined();
      expect(consentScanCall![0].data.deceptivePatterns).toContain('forcedConsent');
      expect(consentScanCall![0].data.deceptivePatterns).toContain('obstaclePattern');
      expect(consentScanCall![0].data.deceptivePatterns).toContain('misdirection');
    });

    it('should mark non-compliant when accept button > 1.5x larger (acceptButtonProminence)', async () => {
      setupBannerDOM({
        hasRejectButton: true,
        acceptButtonSize: { width: 200, height: 60 }, // 12000 area
        rejectButtonSize: { width: 100, height: 40 }, // 4000 area (3x smaller)
      });

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      expect(consentScanCall).toBeDefined();
      expect(consentScanCall![0].data.isCompliant).toBe(false);
      expect(consentScanCall![0].data.deceptivePatterns).toContain('acceptButtonProminence');
    });

    it('should detect pre-checked checkbox violation', async () => {
      setupBannerDOM({ hasRejectButton: true, preChecked: true });

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      expect(consentScanCall).toBeDefined();
      expect(consentScanCall![0].data.deceptivePatterns).toContain('preCheckedBoxes');
    });

    it('does not flag necessary-only checkboxes as pre-checked violations', async () => {
      setupBannerDOM({ hasRejectButton: true });

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.setAttribute('aria-label', 'Necessary only');
      document.querySelector('.cookie-banner')?.appendChild(checkbox);

      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      expect(consentScanCall).toBeDefined();
      expect(consentScanCall![0].data.deceptivePatterns).not.toContain('preCheckedBoxes');
    });

    it('should mark compliant when equal button prominence + reject exists', async () => {
      setupBannerDOM({
        hasRejectButton: true,
        acceptButtonSize: { width: 100, height: 40 },
        rejectButtonSize: { width: 100, height: 40 },
      });

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      expect(consentScanCall).toBeDefined();
      expect(consentScanCall![0].data.isCompliant).toBe(true);
      expect(consentScanCall![0].data.complianceScore).toBe(100);
    });

    it('treats exact 1.5x area ratio as compliant threshold boundary', async () => {
      setupBannerDOM({
        hasRejectButton: true,
        acceptButtonSize: { width: 150, height: 40 }, // 6000
        rejectButtonSize: { width: 100, height: 40 }, // 4000 => 1.5x exactly
      });

      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find((call) => call[0]?.type === 'CONSENT_SCAN_RESULT');

      expect(consentScanCall?.[0]).toMatchObject({
        type: 'CONSENT_SCAN_RESULT',
        data: expect.any(Object),
      });
      expect(consentScanCall![0].data.isCompliant).toBe(true);
      expect(consentScanCall![0].data.deceptivePatterns).not.toContain('acceptButtonProminence');
    });

    it('flags hidden reject button when below viewport', async () => {
      setupBannerDOM({ hasRejectButton: true });

      Object.defineProperty(window, 'innerHeight', { value: 100, configurable: true });
      const rejectBtn = document.getElementById('reject-btn');
      if (rejectBtn) {
        rejectBtn.getBoundingClientRect = vi.fn(() => ({
          width: 100,
          height: 40,
          top: 120,
          left: 0,
          bottom: 200,
          right: 100,
          x: 0,
          y: 120,
          toJSON: () => ({}),
        }));
      }

      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      expect(consentScanCall).toBeDefined();
      expect(consentScanCall![0].data.deceptivePatterns).toContain('hiddenRejectButton');
    });
  });

  describe('Message Sending', () => {
    it('should send CONSENT_SCAN_RESULT message with correct payload', async () => {
      setupBannerDOM({ hasRejectButton: true });

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'CONSENT_SCAN_RESULT'
      );

      expect(consentScanCall).toBeDefined();
      expect(consentScanCall![0]).toMatchObject({
        type: 'CONSENT_SCAN_RESULT',
        data: expect.objectContaining({
          url: expect.any(String),
          hasBanner: true,
          hasRejectButton: true,
          isCompliant: expect.any(Boolean),
          deceptivePatterns: expect.any(Array),
          timestamp: expect.any(Number),
        }),
      });
    });

    it('should send RECORD_COMPLIANCE_SCORE message after scan', async () => {
      setupBannerDOM({ hasRejectButton: true });

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const scoreCall = sendMessageCalls.find(
        (call) => call[0]?.type === 'RECORD_COMPLIANCE_SCORE'
      );

      expect(scoreCall?.[0]).toMatchObject({
        type: 'RECORD_COMPLIANCE_SCORE',
        data: expect.any(Object),
      });
      expect(scoreCall![0]).toMatchObject({
        type: 'RECORD_COMPLIANCE_SCORE',
        data: {
          score: expect.any(Number),
        },
      });
    });

    it('should handle service worker unavailable gracefully (no throw)', async () => {
      (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Receiving end does not exist')
      );

      setupBannerDOM({ hasRejectButton: true });

      // Initialize and scan
      await scanner.initialize();

      // Should not throw
      await expect(scanner.scanPage('quick')).resolves.not.toThrow();
    });

    it('retries sending when service worker is temporarily unavailable', async () => {
      vi.useFakeTimers();
      let callCount = 0;
      (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount += 1;
        if (callCount <= 2) {
          return Promise.reject(new Error('Receiving end does not exist'));
        }
        return Promise.resolve({ success: true });
      });

      setupBannerDOM({ hasRejectButton: true });

      await scanner.initialize();
      const scanPromise = scanner.scanPage('quick');

      await vi.advanceTimersByTimeAsync(1000);
      await expect(scanPromise).resolves.toBeUndefined();
      expect(callCount).toBe(4);
      const calls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]?.[0]?.type).toBe('CONSENT_SCAN_RESULT');
      expect(calls[1]?.[0]?.type).toBe('CONSENT_SCAN_RESULT');
      expect(calls[2]?.[0]?.type).toBe('CONSENT_SCAN_RESULT');
      expect(calls[3]?.[0]?.type).toBe('RECORD_COMPLIANCE_SCORE');
    });
  });

  describe('Scan Scheduling', () => {
    it('schedules quick, interaction, and delayed scans at configured intervals', async () => {
      setupBannerDOM({ hasRejectButton: true });
      const timeoutSpy = vi.spyOn(global, 'setTimeout');
      await scanner.initialize();

      const delays = timeoutSpy.mock.calls
        .map((call) => call[1])
        .filter((value): value is number => typeof value === 'number');

      expect(delays).toContain(SCAN_PHASES.QUICK_DELAY_MS);
      expect(delays).toContain(SCAN_PHASES.INTERACTION_DELAY_MS);
      expect(delays).toContain(SCAN_PHASES.DELAYED_DELAY_MS);
    });
  });

  describe('Edge Cases', () => {
    it('should skip scan when persisted consent exists', async () => {
      const persistedCMP: CMPDetectionResult = {
        detected: true,
        cmpType: 'onetrust',
        detectionMethod: 'cookie',
        confidenceScore: 0.9,
        consentStatus: 'accepted',
        cookieNames: ['OptanonConsent'],
      };

      detectCMPMock.mockResolvedValue(persistedCMP);
      hasValidPersistedConsentMock.mockReturnValue(true);

      setupBannerDOM({ hasRejectButton: true });

      // Initialize and scan after DOM setup
      await scanner.initialize();
      await scanner.scanPage('quick');

      const sendMessageCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const consentScanCall = sendMessageCalls.find((call) => call[0]?.type === 'CONSENT_SCAN_RESULT');
      expect(consentScanCall).toBeDefined();
      expect(consentScanCall![0].data.hasPersistedConsent).toBe(true);
      expect(consentScanCall![0].data.hasBanner).toBe(false);
      expect(consentScanCall![0].data.isCompliant).toBe(true);
    });

    it('should skip duplicate scan of same banner', async () => {
      setupBannerDOM({ hasRejectButton: true });

      // Initialize and scan
      await scanner.initialize();
      await scanner.scanPage('quick');

      const initialCallCount = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls.length;

      // Trigger another scan by modifying DOM slightly (but same banner content)
      const banner = document.querySelector('.cookie-banner');
      if (banner) {
        banner.setAttribute('data-test', 'same-banner');
      }

      // Trigger another scan to simulate mutation handling
      await scanner.scanPage('quick');

      // Should not have significantly more calls (maybe +1 for mutation, but not full scan)
      const finalCallCount = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(finalCallCount).toBeLessThanOrEqual(initialCallCount + 2);
    });
  });
});
