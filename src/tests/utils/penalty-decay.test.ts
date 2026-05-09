import { describe, it, expect } from 'vitest';
import { calculateDecayFactor, calculateDecayedPenalty, getDecayPercentage, MAX_DECAY_OCCURRENCES } from '@/utils/penalty-decay';

describe('Penalty Decay', () => {
  describe('calculateDecayFactor', () => {
    it('should return 1.0 for first occurrence (0 count)', () => {
      const factor = calculateDecayFactor(0);
      expect(factor).toBe(1.0);
    });

    it('should return 0.5 for second occurrence (1 count)', () => {
      const factor = calculateDecayFactor(1);
      expect(factor).toBe(0.5);
    });

    it('should return 0.25 for third occurrence (2 count)', () => {
      const factor = calculateDecayFactor(2);
      expect(factor).toBe(0.25);
    });

    it('should return 0.125 for fourth occurrence (3 count)', () => {
      const factor = calculateDecayFactor(3);
      expect(factor).toBe(0.125);
    });

    it('should return 0.0625 for fifth occurrence (4 count)', () => {
      const factor = calculateDecayFactor(4);
      expect(factor).toBe(0.0625);
    });

    it('should cap decay factor at 4 occurrences', () => {
      const factor4 = calculateDecayFactor(4);
      const factor5 = calculateDecayFactor(5);
      const factor10 = calculateDecayFactor(10);
      const factor100 = calculateDecayFactor(100);

      expect(factor4).toBe(factor5);
      expect(factor4).toBe(factor10);
      expect(factor4).toBe(factor100);
      expect(factor4).toBe(0.0625);
    });

    it('should follow exponential decay curve 0.5^n', () => {
      for (let i = 0; i <= 4; i++) {
        const expected = Math.pow(0.5, i);
        const actual = calculateDecayFactor(i);
        expect(actual).toBeCloseTo(expected, 10);
      }
    });

    it('should clamp negative and non-finite occurrences to first occurrence behavior', () => {
      expect(calculateDecayFactor(-1)).toBe(1);
      expect(calculateDecayFactor(Number.NaN)).toBe(1);
      expect(calculateDecayFactor(Number.POSITIVE_INFINITY)).toBe(1);
    });

    it('supports custom decay settings from remote config', () => {
      const factor = calculateDecayFactor(2, { base: 0.25, maxOccurrences: 3 });
      expect(factor).toBeCloseTo(0.0625, 10);
    });
  });

  describe('calculateDecayedPenalty', () => {
    it('should return full penalty on first occurrence', () => {
      const baseRiskWeight = 5.0;
      const penalty = calculateDecayedPenalty(baseRiskWeight, 0);
      expect(penalty).toBe(5.0);
    });

    it('should return half penalty on second occurrence', () => {
      const baseRiskWeight = 5.0;
      const penalty = calculateDecayedPenalty(baseRiskWeight, 1);
      expect(penalty).toBe(2.5);
    });

    it('should return quarter penalty on third occurrence', () => {
      const baseRiskWeight = 5.0;
      const penalty = calculateDecayedPenalty(baseRiskWeight, 2);
      expect(penalty).toBe(1.25);
    });

    it('should return eighth penalty on fourth occurrence', () => {
      const baseRiskWeight = 5.0;
      const penalty = calculateDecayedPenalty(baseRiskWeight, 3);
      expect(penalty).toBe(0.625);
    });

    it('should return sixteenth penalty on fifth occurrence', () => {
      const baseRiskWeight = 5.0;
      const penalty = calculateDecayedPenalty(baseRiskWeight, 4);
      expect(penalty).toBe(0.3125);
    });

    it('should work with analytics tracker (weight 1)', () => {
      expect(calculateDecayedPenalty(1.0, 0)).toBe(1.0);
      expect(calculateDecayedPenalty(1.0, 1)).toBe(0.5);
      expect(calculateDecayedPenalty(1.0, 2)).toBe(0.25);
      expect(calculateDecayedPenalty(1.0, 3)).toBe(0.125);
      expect(calculateDecayedPenalty(1.0, 4)).toBe(0.0625);
    });

    it('should work with advertising tracker (weight 2)', () => {
      expect(calculateDecayedPenalty(2.0, 0)).toBe(2.0);
      expect(calculateDecayedPenalty(2.0, 1)).toBe(1.0);
      expect(calculateDecayedPenalty(2.0, 2)).toBe(0.5);
      expect(calculateDecayedPenalty(2.0, 3)).toBe(0.25);
      expect(calculateDecayedPenalty(2.0, 4)).toBe(0.125);
    });

    it('should work with fingerprinting tracker (weight 5)', () => {
      expect(calculateDecayedPenalty(5.0, 0)).toBe(5.0);
      expect(calculateDecayedPenalty(5.0, 1)).toBe(2.5);
      expect(calculateDecayedPenalty(5.0, 2)).toBe(1.25);
      expect(calculateDecayedPenalty(5.0, 3)).toBe(0.625);
      expect(calculateDecayedPenalty(5.0, 4)).toBe(0.3125);
    });

    it('should never return zero penalty', () => {
      const baseRiskWeight = 1.0;
      const maxPenalty = calculateDecayedPenalty(baseRiskWeight, 100);
      expect(maxPenalty).toBeGreaterThan(0);
      expect(maxPenalty).toBe(0.0625);
    });

    it('should cap penalty reduction at 4 occurrences', () => {
      const baseRiskWeight = 10.0;
      const penalty4 = calculateDecayedPenalty(baseRiskWeight, 4);
      const penalty5 = calculateDecayedPenalty(baseRiskWeight, 5);
      const penalty10 = calculateDecayedPenalty(baseRiskWeight, 10);

      expect(penalty4).toBe(penalty5);
      expect(penalty4).toBe(penalty10);
      expect(penalty4).toBe(0.625);
    });

    it('should keep full penalty for negative occurrence counts', () => {
      expect(calculateDecayedPenalty(5.0, -2)).toBe(5.0);
    });
  });

  describe('getDecayPercentage', () => {
    it('should return 100% for first occurrence', () => {
      const percentage = getDecayPercentage(0);
      expect(percentage).toBe(100);
    });

    it('should return 50% for second occurrence', () => {
      const percentage = getDecayPercentage(1);
      expect(percentage).toBe(50);
    });

    it('should return 25% for third occurrence', () => {
      const percentage = getDecayPercentage(2);
      expect(percentage).toBe(25);
    });

    it('should return 12.5% for fourth occurrence', () => {
      const percentage = getDecayPercentage(3);
      expect(percentage).toBe(12.5);
    });

    it('should return 6.25% for fifth occurrence and beyond', () => {
      expect(getDecayPercentage(4)).toBe(6.25);
      expect(getDecayPercentage(5)).toBe(6.25);
      expect(getDecayPercentage(10)).toBe(6.25);
      expect(getDecayPercentage(100)).toBe(6.25);
    });

    it('should return 100% for invalid occurrence input', () => {
      expect(getDecayPercentage(-10)).toBe(100);
      expect(getDecayPercentage(Number.NaN)).toBe(100);
    });
  });

  describe('MAX_DECAY_OCCURRENCES', () => {
    it('should be set to 4', () => {
      expect(MAX_DECAY_OCCURRENCES).toBe(4);
    });
  });

  describe('Real-world scenarios', () => {
    it('should progressively reduce penalty for repeated site visits', () => {
      const baseWeight = 2.0;
      const visits = [0, 1, 2, 3, 4, 5];
      const penalties = visits.map(v => calculateDecayedPenalty(baseWeight, v));

      // First visit: full penalty
      expect(penalties[0]).toBe(2.0);
      // Second visit: half penalty
      expect(penalties[1]).toBe(1.0);
      // Third visit: quarter penalty
      expect(penalties[2]).toBe(0.5);
      // Fourth visit: eighth penalty
      expect(penalties[3]).toBe(0.25);
      // Fifth and beyond: sixteenth penalty (capped)
      expect(penalties[4]).toBe(0.125);
      expect(penalties[5]).toBe(0.125);
    });

    it('should ensure high-risk trackers always have meaningful penalty', () => {
      const fingerprintingWeight = 5.0;
      const maxOccurrences = 100;

      const minPenalty = calculateDecayedPenalty(fingerprintingWeight, maxOccurrences);

      expect(minPenalty).toBeGreaterThan(0);
      expect(minPenalty).toBe(0.3125);
    });

    it('should demonstrate decay curve for user with 10 visits', () => {
      const baseWeight = 1.0;
      const expectedDecay = [
        { visit: 1, factor: 1.0, penalty: 1.0 },
        { visit: 2, factor: 0.5, penalty: 0.5 },
        { visit: 3, factor: 0.25, penalty: 0.25 },
        { visit: 4, factor: 0.125, penalty: 0.125 },
        { visit: 5, factor: 0.0625, penalty: 0.0625 },
        { visit: 6, factor: 0.0625, penalty: 0.0625 },
        { visit: 7, factor: 0.0625, penalty: 0.0625 },
        { visit: 8, factor: 0.0625, penalty: 0.0625 },
        { visit: 9, factor: 0.0625, penalty: 0.0625 },
        { visit: 10, factor: 0.0625, penalty: 0.0625 },
      ];

      expectedDecay.forEach(({ visit, factor, penalty }) => {
        const occurrenceCount = visit - 1;
        expect(calculateDecayFactor(occurrenceCount)).toBeCloseTo(factor, 10);
        expect(calculateDecayedPenalty(baseWeight, occurrenceCount)).toBeCloseTo(penalty, 10);
      });
    });
  });
});
