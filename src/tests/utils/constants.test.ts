import { describe, expect, it } from 'vitest';
import {
  ALLOWLIST,
  CONFIDENCE,
  CREDIT_SCORE,
  DATA_EXPORT,
  FALSE_POSITIVE_FEEDBACK,
  LIMITS,
  ONBOARDING,
  PRIVACY_SCORE,
  STORAGE_RETRY,
  TIME,
} from '@/utils/constants';

describe('constants', () => {
  it('keeps privacy-safe default settings and limits', () => {
    expect(PRIVACY_SCORE.INITIAL).toBe(100);
    expect(LIMITS.MAX_ALERTS).toBe(100);
    expect(LIMITS.MAX_HISTORY_DAYS).toBe(30);
    expect(TIME.ONE_HOUR_MS).toBe(60 * 60 * 1000);
    expect(TIME.ONE_DAY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('defines stable credit-score boundaries', () => {
    expect(CREDIT_SCORE.MIN).toBe(300);
    expect(CREDIT_SCORE.BASE).toBe(550);
    expect(CREDIT_SCORE.MAX).toBe(850);
    expect(CREDIT_SCORE.LABELS.EXCELLENT).toBeGreaterThan(CREDIT_SCORE.LABELS.GOOD);
    expect(CREDIT_SCORE.LABELS.GOOD).toBeGreaterThan(CREDIT_SCORE.LABELS.FAIR);
    expect(CREDIT_SCORE.LABELS.FAIR).toBeGreaterThan(CREDIT_SCORE.LABELS.POOR);
  });

  it('keeps confidence and false-positive thresholds aligned', () => {
    expect(CONFIDENCE.ALERT_THRESHOLD).toBe(80);
    expect(FALSE_POSITIVE_FEEDBACK.BASE_THRESHOLD).toBe(CONFIDENCE.ALERT_THRESHOLD);
    expect(FALSE_POSITIVE_FEEDBACK.MIN_REPORTERS_FOR_OVERRIDE).toBe(3);
    expect(FALSE_POSITIVE_FEEDBACK.MAX_OVERRIDE_THRESHOLD).toBe(95);
    expect(FALSE_POSITIVE_FEEDBACK.OVERRIDES_ENDPOINT).toContain('/functions/v1/get-fp-overrides');
  });

  it('keeps weight and retry constants consistent', () => {
    const weightSum =
      CONFIDENCE.WEIGHTS.BANNER_DETECTION +
      CONFIDENCE.WEIGHTS.BUTTON_DETECTION +
      CONFIDENCE.WEIGHTS.CMP_RECOGNITION +
      CONFIDENCE.WEIGHTS.CONTEXTUAL;

    expect(weightSum).toBeCloseTo(1, 10);
    expect(STORAGE_RETRY.MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(STORAGE_RETRY.BACKOFF_MULTIPLIER).toBeGreaterThan(1);
  });

  it('keeps export/onboarding/allowlist constants unchanged', () => {
    expect(DATA_EXPORT.FORMAT).toBe('privaseer-data-export');
    expect(DATA_EXPORT.VERSION).toBe('2.0');
    expect(DATA_EXPORT.MAX_SNAPSHOT_DAYS).toBe(30);
    expect(DATA_EXPORT.GDPR.DATA_CATEGORIES.length).toBeGreaterThan(0);
    expect(ONBOARDING.TOTAL_STEPS).toBe(6);
    expect(ONBOARDING.WELCOME_PAGE_PATH).toContain('welcome.html');
    expect(ALLOWLIST.USER_ENTRY_EXPIRY_DAYS).toBe(90);
    expect(ALLOWLIST.VERIFIED_REFRESH_DAYS).toBe(7);
  });
});
