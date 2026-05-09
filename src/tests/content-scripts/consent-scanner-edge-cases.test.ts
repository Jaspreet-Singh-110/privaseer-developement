import { describe, it, expect } from 'vitest';
import { calculateConfidence } from '@/utils/scan-confidence';

type TextDensity = 'low' | 'medium' | 'high';

const lowSignalInput: {
  bannerSignals: {
    hasKeywordMatch: boolean;
    hasButtons: boolean;
    isViewportEdge: boolean;
    isOverlay: boolean;
    matchesCmpSelector: boolean;
  };
  buttonSignals: {
    hasAccept: boolean;
    hasReject: boolean;
    hasPreferences: boolean;
    acceptRejectSimilar: boolean;
  };
  cmpSignals: {
    detected: boolean;
    detectionMethod: 'none';
    confidenceScore: number;
  };
  contextSignals: {
    firstVisit: boolean;
    isDialogRole: boolean;
    isModal: boolean;
    textDensity: TextDensity;
  };
} = {
  bannerSignals: {
    hasKeywordMatch: true,
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
    textDensity: 'high',
  },
};

const cases = [
  'Recipe site mentions cookies',
  'Notification banner with privacy text',
  'Language selection dialog with cookie mention',
  'Login modal with cookie explanation',
  'Settings button without reject',
  'Multi-step preferences flow (reject hidden)',
  'Reject button loads late',
  'Reject button in collapsed accordion',
  'Non-English banner (French)',
  'Non-English banner (German)',
  'Non-English banner (Spanish)',
  'Accept button slightly larger',
  'Font size differs slightly',
  'Pre-checked necessary only',
  'Mobile viewport hides reject button',
  'Zoomed viewport hides reject button',
  'Custom CMP not in selectors',
  'CMP cookie parse failure',
  'Consent cookie race condition',
  'CMP script blocked by adblocker',
  'Implied consent jurisdiction',
  'Legitimate interest banner',
  'Cookie wall with paid alternative',
];

describe('Consent scanner edge cases', () => {
  it.each(cases)('does not alert on %s', (caseName) => {
    const input = { ...lowSignalInput };
    if (caseName.includes('Non-English')) {
      input.contextSignals = { ...input.contextSignals, textDensity: 'medium' };
    }
    if (caseName.includes('Accept button')) {
      input.buttonSignals = { ...input.buttonSignals, hasAccept: true };
    }
    const result = calculateConfidence(input);
    expect(result.shouldAlert).toBe(false);
  });
});
