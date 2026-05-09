import { describe, it, expect, beforeEach, vi } from 'vitest';
import { shouldPenalizeTracker, extractDomain, isConsentedTrackerCategory, isHighRiskCategory } from '@/utils/consent-validator';
import { Storage } from '@/background/storage';
import type { LocalConsentState } from '@/types';

vi.mock('@/utils/logger');
vi.mock('@/background/storage');

describe('Consent Validator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldPenalizeTracker', () => {
    it('should penalize when no consent state exists', async () => {
      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(null);

      const result = await shouldPenalizeTracker('example.com', 'analytics', false);

      expect(result.shouldPenalize).toBe(true);
      expect(result.reason).toBe('No consent state found');
    });

    it('should penalize when consent was rejected', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'rejected',
        cmpId: 'OneTrust',
        timestamp: Date.now(),
        choice: 'explicit',
      };

      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(consentState);

      const result = await shouldPenalizeTracker('example.com', 'analytics', false);

      expect(result.shouldPenalize).toBe(true);
      expect(result.reason).toBe('User explicitly rejected consent');
      expect(result.consentState).toEqual(consentState);
    });

    it('should penalize when consent was dismissed', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'dismissed',
        cmpId: 'OneTrust',
        timestamp: Date.now(),
        choice: 'none',
      };

      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(consentState);

      const result = await shouldPenalizeTracker('example.com', 'analytics', false);

      expect(result.shouldPenalize).toBe(true);
      expect(result.reason).toBe('User dismissed consent without accepting');
    });

    it('should not penalize analytics trackers with explicit consent', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'OneTrust',
        timestamp: Date.now(),
        choice: 'explicit',
      };

      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(consentState);

      const result = await shouldPenalizeTracker('example.com', 'analytics', false);

      expect(result.shouldPenalize).toBe(false);
      expect(result.reason).toBe('User explicitly consented to analytics/beacons');
    });

    it('should not penalize beacons with explicit consent', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'Cookiebot',
        timestamp: Date.now(),
        choice: 'explicit',
      };

      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(consentState);

      const result = await shouldPenalizeTracker('example.com', 'beacons', false);

      expect(result.shouldPenalize).toBe(false);
      expect(result.reason).toBe('User explicitly consented to analytics/beacons');
    });

    it('should penalize high-risk trackers despite explicit consent', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'OneTrust',
        timestamp: Date.now(),
        choice: 'explicit',
      };

      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(consentState);

      const result = await shouldPenalizeTracker('example.com', 'fingerprinting', true);

      expect(result.shouldPenalize).toBe(true);
      expect(result.reason).toBe('High-risk tracker despite consent');
    });

    it('should penalize fingerprinting category despite explicit consent', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'OneTrust',
        timestamp: Date.now(),
        choice: 'explicit',
      };

      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(consentState);

      const result = await shouldPenalizeTracker('example.com', 'fingerprinting', false);

      expect(result.shouldPenalize).toBe(true);
      expect(result.reason).toBe('High-risk tracker despite consent');
    });

    it('should penalize social trackers despite explicit consent', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'OneTrust',
        timestamp: Date.now(),
        choice: 'explicit',
      };

      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(consentState);

      const result = await shouldPenalizeTracker('example.com', 'social', false);

      expect(result.shouldPenalize).toBe(true);
      expect(result.reason).toBe('High-risk tracker despite consent');
    });

    it('should not penalize advertising trackers with explicit consent', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'OneTrust',
        timestamp: Date.now(),
        choice: 'explicit',
      };

      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(consentState);

      const result = await shouldPenalizeTracker('example.com', 'advertising', false);

      expect(result.shouldPenalize).toBe(false);
      expect(result.reason).toBe('User explicitly consented to all trackers');
    });

    it('should not penalize low-risk trackers with implied consent', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'Custom',
        timestamp: Date.now(),
        choice: 'implied',
      };

      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(consentState);

      const result = await shouldPenalizeTracker('example.com', 'analytics', false);

      expect(result.shouldPenalize).toBe(false);
      expect(result.reason).toBe('Tracker allowed with implied consent');
    });

    it('should penalize high-risk trackers with only implied consent', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'Custom',
        timestamp: Date.now(),
        choice: 'implied',
      };

      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(consentState);

      const result = await shouldPenalizeTracker('example.com', 'fingerprinting', true);

      expect(result.shouldPenalize).toBe(true);
      expect(result.reason).toBe('High-risk tracker with only implied consent');
    });

    it('should penalize when consent status is unknown', async () => {
      const consentState: LocalConsentState = {
        domain: 'example.com',
        consentStatus: 'unknown',
        cmpId: 'Unknown',
        timestamp: Date.now(),
        choice: 'none',
      };

      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(consentState);

      const result = await shouldPenalizeTracker('example.com', 'analytics', false);

      expect(result.shouldPenalize).toBe(true);
      expect(result.reason).toBe('Unknown consent status');
    });

    it('should default to penalize when consent lookup throws', async () => {
      vi.spyOn(Storage, 'getConsentState').mockRejectedValueOnce(new Error('storage failure'));

      const result = await shouldPenalizeTracker('example.com', 'analytics', false);

      expect(result.shouldPenalize).toBe(true);
      expect(result.reason).toBe('Error during consent validation');
    });
  });

  describe('extractDomain', () => {
    it('should extract domain from http URL', () => {
      const domain = extractDomain('http://example.com/path');
      expect(domain).toBe('example.com');
    });

    it('should extract domain from https URL', () => {
      const domain = extractDomain('https://example.com/path');
      expect(domain).toBe('example.com');
    });

    it('should handle subdomain URLs', () => {
      const domain = extractDomain('https://sub.example.com/path');
      expect(domain).toBe('sub.example.com');
    });

    it('should extract root domain from plain domain string', () => {
      const domain = extractDomain('sub.example.com');
      expect(domain).toBe('example.com');
    });

    it('should return input if not a valid URL', () => {
      const domain = extractDomain('invalid');
      expect(domain).toBe('invalid');
    });

    it('should return original input when URL parsing throws', () => {
      const malformed = 'https://%';
      const domain = extractDomain(malformed);
      expect(domain).toBe(malformed);
    });
  });

  describe('isConsentedTrackerCategory', () => {
    it('should return true for analytics', () => {
      expect(isConsentedTrackerCategory('analytics')).toBe(true);
    });

    it('should return true for beacons', () => {
      expect(isConsentedTrackerCategory('beacons')).toBe(true);
    });

    it('should return false for advertising', () => {
      expect(isConsentedTrackerCategory('advertising')).toBe(false);
    });

    it('should return false for social', () => {
      expect(isConsentedTrackerCategory('social')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isConsentedTrackerCategory('ANALYTICS')).toBe(true);
      expect(isConsentedTrackerCategory('Beacons')).toBe(true);
    });
  });

  describe('isHighRiskCategory', () => {
    it('should return true for fingerprinting', () => {
      expect(isHighRiskCategory('fingerprinting')).toBe(true);
    });

    it('should return true for social', () => {
      expect(isHighRiskCategory('social')).toBe(true);
    });

    it('should return false for analytics', () => {
      expect(isHighRiskCategory('analytics')).toBe(false);
    });

    it('should return false for advertising', () => {
      expect(isHighRiskCategory('advertising')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isHighRiskCategory('FINGERPRINTING')).toBe(true);
      expect(isHighRiskCategory('Social')).toBe(true);
    });
  });

  describe('shouldBlockTracker', () => {
    it('should block when no consent state exists', async () => {
      const { shouldBlockTracker } = await import('@/utils/consent-validator');
      vi.spyOn(Storage, 'getConsentState').mockResolvedValue(null);

      const result = await shouldBlockTracker('tracker.com', 'example.com', 'analytics', false);

      expect(result).toBe(true);
    });

    it('should block when consent was rejected', async () => {
      const { shouldBlockTracker } = await import('@/utils/consent-validator');
      vi.spyOn(Storage, 'getConsentState').mockResolvedValue({
        domain: 'example.com',
        consentStatus: 'rejected',
        cmpId: 'OneTrust',
        timestamp: Date.now(),
        choice: 'explicit',
      });

      const result = await shouldBlockTracker('tracker.com', 'example.com', 'analytics', false);

      expect(result).toBe(true);
    });

    it('should not block consented categories with explicit consent', async () => {
      const { shouldBlockTracker } = await import('@/utils/consent-validator');
      vi.spyOn(Storage, 'getConsentState').mockResolvedValue({
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'OneTrust',
        timestamp: Date.now(),
        choice: 'explicit',
      });

      const result = await shouldBlockTracker('tracker.com', 'example.com', 'analytics', false);

      expect(result).toBe(false);
    });

    it('should block high-risk trackers despite consent', async () => {
      const { shouldBlockTracker } = await import('@/utils/consent-validator');
      vi.spyOn(Storage, 'getConsentState').mockResolvedValue({
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'OneTrust',
        timestamp: Date.now(),
        choice: 'explicit',
      });

      const result = await shouldBlockTracker('tracker.com', 'example.com', 'fingerprinting', true);

      expect(result).toBe(true);
    });

    it('should handle errors and default to blocking', async () => {
      const { shouldBlockTracker } = await import('@/utils/consent-validator');
      vi.spyOn(Storage, 'getConsentState').mockRejectedValue(new Error('Storage error'));

      const result = await shouldBlockTracker('tracker.com', 'example.com', 'analytics', false);

      expect(result).toBe(true);
    });

    it('should allow low-risk trackers with implied consent', async () => {
      const { shouldBlockTracker } = await import('@/utils/consent-validator');
      vi.spyOn(Storage, 'getConsentState').mockResolvedValue({
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'Custom',
        timestamp: Date.now(),
        choice: 'implied',
      });

      const result = await shouldBlockTracker('tracker.com', 'example.com', 'analytics', false);

      expect(result).toBe(false);
    });

    it('should block high-risk categories with implied consent', async () => {
      const { shouldBlockTracker } = await import('@/utils/consent-validator');
      vi.spyOn(Storage, 'getConsentState').mockResolvedValue({
        domain: 'example.com',
        consentStatus: 'accepted',
        cmpId: 'Custom',
        timestamp: Date.now(),
        choice: 'implied',
      });

      const result = await shouldBlockTracker('tracker.com', 'example.com', 'social', false);

      expect(result).toBe(true);
    });
  });
});
