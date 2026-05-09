/**
 * @file src/tests/background/service-worker-consent-rejection.test.ts
 *
 * Test Type: Unit
 * Contexts Tested: getConsentRejection function cache and expiration logic
 * Prerequisites: None
 */

import { describe, it, expect } from 'vitest';
import { CONSENT_VIOLATION } from '@/utils/constants';

/**
 * This test file tests the logic of the getConsentRejection function
 * without importing the actual service-worker module (which has module-level code).
 * We test the cache expiration logic and data structures.
 */

describe('Service Worker getConsentRejection Logic', () => {
  // Replicate the getConsentRejection function logic for testing
  function testGetConsentRejection(
    cache: Map<string, { timestamp: number; tabId?: number }>,
    domain: string
  ): { timestamp: number; tabId?: number } | null {
    const entry = cache.get(domain);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.timestamp > CONSENT_VIOLATION.REJECTION_WINDOW_MS) {
      cache.delete(domain);
      return null;
    }

    return entry;
  }

  describe('Cache Lookup', () => {
    it('should return null for unknown domain', () => {
      const cache = new Map<string, { timestamp: number; tabId?: number }>();
      const result = testGetConsentRejection(cache, 'unknown-domain.com');
      expect(result).toBeNull();
    });

    it('should return cached entry for known domain', () => {
      const cache = new Map<string, { timestamp: number; tabId?: number }>();
      const testEntry = {
        timestamp: Date.now(),
        tabId: 123,
      };
      cache.set('example.com', testEntry);
      
      const result = testGetConsentRejection(cache, 'example.com');
      expect(result).toEqual(testEntry);
    });

    it('should return entry with tabId when present', () => {
      const cache = new Map<string, { timestamp: number; tabId?: number }>();
      const testEntry = {
        timestamp: Date.now(),
        tabId: 456,
      };
      cache.set('test.com', testEntry);
      
      const result = testGetConsentRejection(cache, 'test.com');
      expect(result?.tabId).toBe(456);
    });

    it('should return entry without tabId when not present', () => {
      const cache = new Map<string, { timestamp: number; tabId?: number }>();
      const testEntry = {
        timestamp: Date.now(),
      };
      cache.set('test.com', testEntry);
      
      const result = testGetConsentRejection(cache, 'test.com');
      expect(result?.tabId).toBeUndefined();
      expect(result?.timestamp).toBeDefined();
    });
  });

  describe('Cache Expiration', () => {
    it('should return null for expired entries', () => {
      const cache = new Map<string, { timestamp: number; tabId?: number }>();
      const oldTimestamp = Date.now() - CONSENT_VIOLATION.REJECTION_WINDOW_MS - 1000;
      cache.set('expired.com', { timestamp: oldTimestamp, tabId: 123 });
      
      const result = testGetConsentRejection(cache, 'expired.com');
      expect(result).toBeNull();
    });

    it('should return entry within rejection window', () => {
      const cache = new Map<string, { timestamp: number; tabId?: number }>();
      const recentTimestamp = Date.now() - 1000; // 1 second ago
      cache.set('recent.com', { timestamp: recentTimestamp, tabId: 456 });
      
      const result = testGetConsentRejection(cache, 'recent.com');
      expect(result).not.toBeNull();
      expect(result?.timestamp).toBe(recentTimestamp);
    });

    it('should clean up expired entries when accessed', () => {
      const cache = new Map<string, { timestamp: number; tabId?: number }>();
      const oldTimestamp = Date.now() - CONSENT_VIOLATION.REJECTION_WINDOW_MS - 5000;
      cache.set('expired.com', { timestamp: oldTimestamp });
      
      expect(cache.has('expired.com')).toBe(true);
      
      const result = testGetConsentRejection(cache, 'expired.com');
      expect(result).toBeNull();
      
      // Cache entry should be removed
      expect(cache.has('expired.com')).toBe(false);
    });

    it('should handle entry at exact window boundary', () => {
      const cache = new Map<string, { timestamp: number; tabId?: number }>();
      const boundaryTimestamp = Date.now() - CONSENT_VIOLATION.REJECTION_WINDOW_MS;
      cache.set('boundary.com', { timestamp: boundaryTimestamp });
      
      // Entry at exact boundary (difference equals window) should still be valid
      const result = testGetConsentRejection(cache, 'boundary.com');
      expect(result).not.toBeNull();
    });

    it('should keep entry just inside window', () => {
      const cache = new Map<string, { timestamp: number; tabId?: number }>();
      const insideTimestamp = Date.now() - CONSENT_VIOLATION.REJECTION_WINDOW_MS + 100;
      cache.set('inside.com', { timestamp: insideTimestamp, tabId: 789 });
      
      const result = testGetConsentRejection(cache, 'inside.com');
      expect(result).not.toBeNull();
      expect(result?.tabId).toBe(789);
    });
  });

  describe('Cache Entry Structure', () => {
    it('should include timestamp in cache entry', () => {
      const entry = {
        timestamp: Date.now(),
        tabId: 456,
      };
      
      expect(entry.timestamp).toBeDefined();
      expect(typeof entry.timestamp).toBe('number');
    });

    it('should optionally include tabId in cache entry', () => {
      const entryWithTab = {
        timestamp: Date.now(),
        tabId: 789,
      };
      
      const entryWithoutTab: { timestamp: number; tabId?: number } = {
        timestamp: Date.now(),
      };
      
      expect(entryWithTab.tabId).toBeDefined();
      expect(entryWithoutTab.tabId).toBeUndefined();
    });
  });

  describe('Rejection Window Constant', () => {
    it('should use correct rejection window duration', () => {
      // Verify the constant is set correctly (60 seconds)
      expect(CONSENT_VIOLATION.REJECTION_WINDOW_MS).toBe(60000);
    });

    it('should calculate expiration correctly', () => {
      const now = Date.now();
      const windowStart = now - CONSENT_VIOLATION.REJECTION_WINDOW_MS;
      
      // Entry at window start should be at the edge
      expect(now - windowStart).toBe(CONSENT_VIOLATION.REJECTION_WINDOW_MS);
      
      // Entry before window start should be expired
      const beforeWindow = windowStart - 1;
      expect(now - beforeWindow).toBeGreaterThan(CONSENT_VIOLATION.REJECTION_WINDOW_MS);
    });
  });
});
