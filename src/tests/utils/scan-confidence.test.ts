import { describe, it, expect } from 'vitest';
import { calculateConfidence } from '@/utils/scan-confidence';

const baseSignals = {
  bannerSignals: {
    hasKeywordMatch: false,
    hasButtons: false,
    isViewportEdge: false,
    isOverlay: false,
    matchesCmpSelector: false,
  },
  buttonSignals: {
    hasAccept: false,
    hasReject: false,
    hasPreferences: false,
    acceptRejectSimilar: false,
  },
  cmpSignals: {
    detected: false,
    detectionMethod: 'none' as const,
    confidenceScore: 0,
  },
  contextSignals: {
    firstVisit: false,
    isDialogRole: false,
    isModal: false,
    textDensity: 'high' as const,
  },
};

describe('scan-confidence', () => {
  it('returns high confidence when signals align', () => {
    const result = calculateConfidence({
      bannerSignals: {
        hasKeywordMatch: true,
        hasButtons: true,
        isViewportEdge: true,
        isOverlay: true,
        matchesCmpSelector: true,
      },
      buttonSignals: {
        hasAccept: true,
        hasReject: true,
        hasPreferences: false,
        acceptRejectSimilar: true,
      },
      cmpSignals: {
        detected: true,
        detectionMethod: 'api',
        confidenceScore: 1,
      },
      contextSignals: {
        firstVisit: true,
        isDialogRole: true,
        isModal: true,
        textDensity: 'low',
      },
    });

    expect(result.overall).toBeGreaterThanOrEqual(80);
    expect(result.shouldAlert).toBe(true);
  });

  it('returns low confidence when signals are weak', () => {
    const result = calculateConfidence({
      bannerSignals: {
        hasKeywordMatch: false,
        hasButtons: false,
        isViewportEdge: false,
        isOverlay: false,
        matchesCmpSelector: false,
      },
      buttonSignals: {
        hasAccept: false,
        hasReject: false,
        hasPreferences: false,
        acceptRejectSimilar: false,
      },
      cmpSignals: {
        detected: false,
        detectionMethod: 'none',
        confidenceScore: 0,
      },
      contextSignals: {
        firstVisit: false,
        isDialogRole: false,
        isModal: false,
        textDensity: 'high',
      },
    });

    expect(result.overall).toBeLessThan(60);
    expect(result.shouldAlert).toBe(false);
  });

  it('returns matched CMP selector banner score', () => {
    const result = calculateConfidence({
      ...baseSignals,
      bannerSignals: {
        ...baseSignals.bannerSignals,
        matchesCmpSelector: true,
      },
    });

    expect(result.bannerDetection.score).toBe(100);
    expect(result.bannerDetection.reasoning).toBe('Matched known CMP selector');
  });

  it('returns keyword+viewport banner score', () => {
    const result = calculateConfidence({
      ...baseSignals,
      bannerSignals: {
        ...baseSignals.bannerSignals,
        hasKeywordMatch: true,
        isViewportEdge: true,
      },
    });

    expect(result.bannerDetection.score).toBe(80);
    expect(result.bannerDetection.reasoning).toBe('Keyword match with viewport edge placement');
  });

  it('returns keyword-only banner score', () => {
    const result = calculateConfidence({
      ...baseSignals,
      bannerSignals: {
        ...baseSignals.bannerSignals,
        hasKeywordMatch: true,
      },
    });

    expect(result.bannerDetection.score).toBe(50);
    expect(result.bannerDetection.reasoning).toBe('Keyword match only');
  });

  it('returns overlay-with-buttons banner score', () => {
    const result = calculateConfidence({
      ...baseSignals,
      bannerSignals: {
        ...baseSignals.bannerSignals,
        hasButtons: true,
        isOverlay: true,
      },
    });

    expect(result.bannerDetection.score).toBe(40);
    expect(result.bannerDetection.reasoning).toBe('Interactive overlay without keywords');
  });

  it('returns weak banner score when no signals', () => {
    const result = calculateConfidence(baseSignals);

    expect(result.bannerDetection.score).toBe(20);
    expect(result.bannerDetection.reasoning).toBe('Weak banner signals');
  });

  it('returns button score for accept+reject with similar prominence', () => {
    const result = calculateConfidence({
      ...baseSignals,
      buttonSignals: {
        ...baseSignals.buttonSignals,
        hasAccept: true,
        hasReject: true,
        acceptRejectSimilar: true,
      },
    });

    expect(result.buttonDetection.score).toBe(100);
    expect(result.buttonDetection.reasoning).toBe(
      'Accept and reject buttons with similar prominence'
    );
  });

  it('returns button score for accept+reject without similar prominence', () => {
    const result = calculateConfidence({
      ...baseSignals,
      buttonSignals: {
        ...baseSignals.buttonSignals,
        hasAccept: true,
        hasReject: true,
        acceptRejectSimilar: false,
      },
    });

    expect(result.buttonDetection.score).toBe(85);
    expect(result.buttonDetection.reasoning).toBe('Accept and reject buttons detected');
  });

  it('returns button score for accept+preferences', () => {
    const result = calculateConfidence({
      ...baseSignals,
      buttonSignals: {
        ...baseSignals.buttonSignals,
        hasAccept: true,
        hasPreferences: true,
      },
    });

    expect(result.buttonDetection.score).toBe(75);
    expect(result.buttonDetection.reasoning).toBe('Accept and preferences buttons detected');
  });

  it('returns button score for accept only', () => {
    const result = calculateConfidence({
      ...baseSignals,
      buttonSignals: {
        ...baseSignals.buttonSignals,
        hasAccept: true,
      },
    });

    expect(result.buttonDetection.score).toBe(60);
    expect(result.buttonDetection.reasoning).toBe('Accept button only');
  });

  it('returns button score for reject only', () => {
    const result = calculateConfidence({
      ...baseSignals,
      buttonSignals: {
        ...baseSignals.buttonSignals,
        hasReject: true,
      },
    });

    expect(result.buttonDetection.score).toBe(50);
    expect(result.buttonDetection.reasoning).toBe('Reject button only');
  });

  it('returns low button score when no buttons detected', () => {
    const result = calculateConfidence(baseSignals);

    expect(result.buttonDetection.score).toBe(20);
    expect(result.buttonDetection.reasoning).toBe('No consent buttons detected');
  });

  it('returns CMP recognition score for API detection', () => {
    const result = calculateConfidence({
      ...baseSignals,
      cmpSignals: {
        detected: true,
        detectionMethod: 'api',
        confidenceScore: 0.9,
      },
    });

    expect(result.cmpRecognition.score).toBe(95);
    expect(result.cmpRecognition.reasoning).toBe('CMP detected via API');
  });

  it('returns CMP recognition score for hybrid detection', () => {
    const result = calculateConfidence({
      ...baseSignals,
      cmpSignals: {
        detected: true,
        detectionMethod: 'hybrid',
        confidenceScore: 0.9,
      },
    });

    expect(result.cmpRecognition.score).toBe(90);
    expect(result.cmpRecognition.reasoning).toBe('CMP detected via cookie and banner');
  });

  it('returns CMP recognition score for cookie detection', () => {
    const result = calculateConfidence({
      ...baseSignals,
      cmpSignals: {
        detected: true,
        detectionMethod: 'cookie',
        confidenceScore: 0.9,
      },
    });

    expect(result.cmpRecognition.score).toBe(87.5);
    expect(result.cmpRecognition.reasoning).toBe('CMP detected via cookie');
  });

  it('returns CMP recognition score for banner detection', () => {
    const result = calculateConfidence({
      ...baseSignals,
      cmpSignals: {
        detected: true,
        detectionMethod: 'banner',
        confidenceScore: 0.9,
      },
    });

    expect(result.cmpRecognition.score).toBe(80);
    expect(result.cmpRecognition.reasoning).toBe('CMP detected via banner');
  });

  it('returns CMP recognition score when no CMP detected', () => {
    const result = calculateConfidence({
      ...baseSignals,
      cmpSignals: {
        detected: false,
        detectionMethod: 'none',
        confidenceScore: 0,
      },
    });

    expect(result.cmpRecognition.score).toBe(20);
    expect(result.cmpRecognition.reasoning).toBe('No CMP detected');
  });

  it('returns contextual score for dialog role', () => {
    const result = calculateConfidence({
      ...baseSignals,
      contextSignals: {
        ...baseSignals.contextSignals,
        isDialogRole: true,
      },
    });

    expect(result.contextualAnalysis.score).toBe(90);
    expect(result.contextualAnalysis.reasoning).toBe('Dialog or modal banner detected');
  });

  it('returns contextual score for modal', () => {
    const result = calculateConfidence({
      ...baseSignals,
      contextSignals: {
        ...baseSignals.contextSignals,
        isModal: true,
      },
    });

    expect(result.contextualAnalysis.score).toBe(90);
    expect(result.contextualAnalysis.reasoning).toBe('Dialog or modal banner detected');
  });

  it('returns contextual score for first visit', () => {
    const result = calculateConfidence({
      ...baseSignals,
      contextSignals: {
        ...baseSignals.contextSignals,
        firstVisit: true,
      },
    });

    expect(result.contextualAnalysis.score).toBe(80);
    expect(result.contextualAnalysis.reasoning).toBe('First-visit banner context');
  });

  it('returns contextual score for low text density', () => {
    const result = calculateConfidence({
      ...baseSignals,
      contextSignals: {
        ...baseSignals.contextSignals,
        textDensity: 'low',
      },
    });

    expect(result.contextualAnalysis.score).toBe(70);
    expect(result.contextualAnalysis.reasoning).toBe('Low text density typical of banners');
  });

  it('returns contextual score when signals are limited', () => {
    const result = calculateConfidence(baseSignals);

    expect(result.contextualAnalysis.score).toBe(50);
    expect(result.contextualAnalysis.reasoning).toBe('Limited contextual signals');
  });

  it('does not alert when banner signal count is below minimum', () => {
    const result = calculateConfidence({
      ...baseSignals,
      bannerSignals: {
        hasKeywordMatch: true,
        hasButtons: true,
        isViewportEdge: false,
        isOverlay: false,
        matchesCmpSelector: false,
      },
      buttonSignals: {
        ...baseSignals.buttonSignals,
        hasAccept: true,
        hasReject: true,
        acceptRejectSimilar: true,
      },
      cmpSignals: {
        detected: true,
        detectionMethod: 'api',
        confidenceScore: 1,
      },
      contextSignals: {
        ...baseSignals.contextSignals,
        isDialogRole: true,
      },
    });

    expect(result.overall).toBeGreaterThanOrEqual(80);
    expect(result.shouldAlert).toBe(false);
  });

  it('alerts when banner signal count meets the minimum', () => {
    const result = calculateConfidence({
      ...baseSignals,
      bannerSignals: {
        hasKeywordMatch: true,
        hasButtons: true,
        isViewportEdge: true,
        isOverlay: false,
        matchesCmpSelector: false,
      },
      buttonSignals: {
        ...baseSignals.buttonSignals,
        hasAccept: true,
        hasReject: true,
        acceptRejectSimilar: true,
      },
      cmpSignals: {
        detected: true,
        detectionMethod: 'api',
        confidenceScore: 1,
      },
      contextSignals: {
        ...baseSignals.contextSignals,
        isDialogRole: true,
      },
    });

    expect(result.overall).toBeGreaterThanOrEqual(80);
    expect(result.shouldAlert).toBe(true);
  });

  it('clamps scores outside the 0-100 range', () => {
    const result = calculateConfidence({
      ...baseSignals,
      cmpSignals: {
        detected: true,
        detectionMethod: 'api',
        confidenceScore: 2,
      },
    });

    expect(result.cmpRecognition.score).toBe(100);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it('clamps negative CMP confidence scores to 0', () => {
    const result = calculateConfidence({
      ...baseSignals,
      cmpSignals: {
        detected: true,
        detectionMethod: 'api',
        confidenceScore: -0.4,
      },
      bannerSignals: {
        ...baseSignals.bannerSignals,
        hasKeywordMatch: true,
        hasButtons: true,
        isViewportEdge: true,
      },
    });

    expect(result.cmpRecognition.score).toBe(50);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it('does not alert exactly below threshold at strict boundary', () => {
    const result = calculateConfidence({
      ...baseSignals,
      bannerSignals: {
        hasKeywordMatch: true,
        hasButtons: true,
        isViewportEdge: false,
        isOverlay: false,
        matchesCmpSelector: false,
      },
      buttonSignals: {
        hasAccept: true,
        hasReject: true,
        hasPreferences: false,
        acceptRejectSimilar: false,
      },
      cmpSignals: {
        detected: true,
        detectionMethod: 'banner',
        confidenceScore: 0.7,
      },
      contextSignals: {
        firstVisit: true,
        isDialogRole: false,
        isModal: false,
        textDensity: 'medium',
      },
    });

    expect(result.overall).toBeLessThan(80);
    expect(result.shouldAlert).toBe(false);
  });
});
