import { describe, it, expect } from 'vitest';
import { sanitizeUrl, sanitizeStackTrace } from '@/utils/sanitizer';

describe('sanitizer', () => {
  describe('sanitizeUrl', () => {
    it('should sanitize valid URLs by removing query params and hash', () => {
      const url = 'https://example.com/path?param=value#hash';
      const result = sanitizeUrl(url);
      expect(result).toBe('https://example.com/path');
    });

    it('should handle URLs without query params', () => {
      const url = 'https://example.com/path';
      const result = sanitizeUrl(url);
      expect(result).toBe('https://example.com/path');
    });

    it('should return undefined for undefined input', () => {
      const result = sanitizeUrl(undefined);
      expect(result).toBeUndefined();
    });

    it('should return null for null input', () => {
      const result = sanitizeUrl(null);
      expect(result).toBeNull();
    });

    it('should return placeholder for invalid URLs', () => {
      const result = sanitizeUrl('not-a-url');
      expect(result).toBe('[invalid-url]');
    });
  });

  describe('sanitizeStackTrace', () => {
    it('should remove Windows absolute paths', () => {
      const stack = 'Error at C:\\Users\\john\\project\\file.js:10:5';
      const result = sanitizeStackTrace(stack);
      expect(result).not.toContain('C:\\Users\\john');
      expect(result).toContain('file.js:10:5');
    });

    it('should remove Unix absolute paths', () => {
      const stack = 'Error at /home/john/project/file.js:10:5';
      const result = sanitizeStackTrace(stack);
      expect(result).not.toContain('/home/john');
      expect(result).toContain('file.js:10:5');
    });

    it('should return undefined for undefined input', () => {
      const result = sanitizeStackTrace(undefined);
      expect(result).toBeUndefined();
    });

    it('should handle empty strings', () => {
      const result = sanitizeStackTrace('');
      expect(result).toBeUndefined();
    });
  });
});
