import type { ConfidenceFactor, ScanConfidence } from '../types';
import { CONFIDENCE } from './constants';

export interface BannerSignals {
  hasKeywordMatch: boolean;
  hasButtons: boolean;
  isViewportEdge: boolean;
  isOverlay: boolean;
  matchesCmpSelector: boolean;
}

export interface ButtonSignals {
  hasAccept: boolean;
  hasReject: boolean;
  hasPreferences: boolean;
  acceptRejectSimilar: boolean;
}

export interface CmpSignals {
  detected: boolean;
  detectionMethod: 'api' | 'cookie' | 'banner' | 'hybrid' | 'none';
  confidenceScore: number;
}

export interface ContextSignals {
  firstVisit: boolean;
  isDialogRole: boolean;
  isModal: boolean;
  textDensity: 'low' | 'medium' | 'high';
}

export interface ScanConfidenceInput {
  bannerSignals: BannerSignals;
  buttonSignals: ButtonSignals;
  cmpSignals: CmpSignals;
  contextSignals: ContextSignals;
}

const clampScore = (value: number): number => Math.max(0, Math.min(100, value));

const countBannerFactors = (signals: BannerSignals): number => {
  return [
    signals.hasKeywordMatch,
    signals.hasButtons,
    signals.isViewportEdge,
    signals.isOverlay,
    signals.matchesCmpSelector,
  ].filter(Boolean).length;
};

const buildFactor = (
  name: string,
  score: number,
  weight: number,
  reasoning: string
): ConfidenceFactor => ({
  name,
  score: clampScore(score),
  weight,
  reasoning,
});

const calculateBannerDetectionScore = (signals: BannerSignals): ConfidenceFactor => {
  let score = 20;
  let reasoning = 'Weak banner signals';

  if (signals.matchesCmpSelector) {
    score = 100;
    reasoning = 'Matched known CMP selector';
  } else if (signals.hasKeywordMatch && signals.isViewportEdge) {
    score = 80;
    reasoning = 'Keyword match with viewport edge placement';
  } else if (signals.hasKeywordMatch) {
    score = 50;
    reasoning = 'Keyword match only';
  } else if (signals.hasButtons && signals.isOverlay) {
    score = 40;
    reasoning = 'Interactive overlay without keywords';
  }

  return buildFactor('bannerDetection', score, CONFIDENCE.WEIGHTS.BANNER_DETECTION, reasoning);
};

const calculateButtonDetectionScore = (signals: ButtonSignals): ConfidenceFactor => {
  let score = 20;
  let reasoning = 'No consent buttons detected';

  if (signals.hasAccept && signals.hasReject) {
    score = signals.acceptRejectSimilar ? 100 : 85;
    reasoning = signals.acceptRejectSimilar
      ? 'Accept and reject buttons with similar prominence'
      : 'Accept and reject buttons detected';
  } else if (signals.hasAccept && signals.hasPreferences) {
    score = 75;
    reasoning = 'Accept and preferences buttons detected';
  } else if (signals.hasAccept) {
    score = 60;
    reasoning = 'Accept button only';
  } else if (signals.hasReject) {
    score = 50;
    reasoning = 'Reject button only';
  }

  return buildFactor('buttonDetection', score, CONFIDENCE.WEIGHTS.BUTTON_DETECTION, reasoning);
};

const calculateCmpRecognitionScore = (signals: CmpSignals): ConfidenceFactor => {
  let score = 40;
  let reasoning = 'No CMP detected';

  if (signals.detected) {
    switch (signals.detectionMethod) {
      case 'api':
        score = 100;
        reasoning = 'CMP detected via API';
        break;
      case 'hybrid':
        score = 90;
        reasoning = 'CMP detected via cookie and banner';
        break;
      case 'cookie':
        score = 85;
        reasoning = 'CMP detected via cookie';
        break;
      case 'banner':
        score = 70;
        reasoning = 'CMP detected via banner';
        break;
      default:
        break;
    }
  }

  const adjustedScore = clampScore((score + clampScore(signals.confidenceScore * 100)) / 2);
  return buildFactor('cmpRecognition', adjustedScore, CONFIDENCE.WEIGHTS.CMP_RECOGNITION, reasoning);
};

const calculateContextualScore = (signals: ContextSignals): ConfidenceFactor => {
  let score = 50;
  let reasoning = 'Limited contextual signals';

  if (signals.isDialogRole || signals.isModal) {
    score = 90;
    reasoning = 'Dialog or modal banner detected';
  } else if (signals.firstVisit) {
    score = 80;
    reasoning = 'First-visit banner context';
  } else if (signals.textDensity === 'low') {
    score = 70;
    reasoning = 'Low text density typical of banners';
  }

  return buildFactor('contextualAnalysis', score, CONFIDENCE.WEIGHTS.CONTEXTUAL, reasoning);
};

export const calculateConfidence = (input: ScanConfidenceInput): ScanConfidence => {
  const bannerDetection = calculateBannerDetectionScore(input.bannerSignals);
  const buttonDetection = calculateButtonDetectionScore(input.buttonSignals);
  const cmpRecognition = calculateCmpRecognitionScore(input.cmpSignals);
  const contextualAnalysis = calculateContextualScore(input.contextSignals);

  const factors = [bannerDetection, buttonDetection, cmpRecognition, contextualAnalysis];
  const weightedScore = factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0);
  const overall = clampScore(weightedScore);

  const bannerFactorCount = countBannerFactors(input.bannerSignals);
  const hasMinimumSignals = bannerFactorCount >= 3;
  const shouldAlert = overall >= CONFIDENCE.ALERT_THRESHOLD && hasMinimumSignals;

  const reasoning = [
    bannerDetection.reasoning,
    buttonDetection.reasoning,
    cmpRecognition.reasoning,
    contextualAnalysis.reasoning,
    `Banner signal count: ${bannerFactorCount}/5`,
    `Alert threshold: ${CONFIDENCE.ALERT_THRESHOLD}`,
  ];

  return {
    overall,
    bannerDetection,
    buttonDetection,
    cmpRecognition,
    contextualAnalysis,
    factors,
    reasoning,
    shouldAlert,
  };
};
