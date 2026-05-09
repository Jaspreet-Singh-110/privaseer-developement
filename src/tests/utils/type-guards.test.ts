import { describe, it, expect } from 'vitest';
import {
  isError,
  toError,
  isMessageData,
  isObject,
  hasProperty,
  isGetTrackerInfoData,
  isConsentScanResult,
} from '@/utils/type-guards';

describe('type-guards', () => {
  describe('isError', () => {
    it('should return true for Error instances', () => {
      expect(isError(new Error('test'))).toBe(true);
      expect(isError(new TypeError('test'))).toBe(true);
      expect(isError(new RangeError('test'))).toBe(true);
    });

    it('should return false for non-Error values', () => {
      expect(isError('error')).toBe(false);
      expect(isError({ message: 'error' })).toBe(false);
      expect(isError(null)).toBe(false);
      expect(isError(undefined)).toBe(false);
      expect(isError(123)).toBe(false);
    });
  });

  describe('toError', () => {
    it('should return Error as-is', () => {
      const error = new Error('test');
      expect(toError(error)).toBe(error);
    });

    it('should convert string to Error', () => {
      const result = toError('error message');
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('error message');
    });

    it('should convert error-like object to Error', () => {
      const errorObj = { message: 'custom error' };
      const result = toError(errorObj);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('custom error');
    });

    it('should handle null and undefined', () => {
      expect(toError(null)).toBeInstanceOf(Error);
      expect(toError(undefined)).toBeInstanceOf(Error);
    });

    it('should convert unknown types to Error with string representation', () => {
      expect(toError(123).message).toBe('123');
      expect(toError(true).message).toBe('true');
      expect(toError({ foo: 'bar' }).message).toBe('[object Object]');
    });
  });

  describe('isMessageData', () => {
    it('should validate data using custom validator', () => {
      const validator = (data: unknown) => typeof data === 'string';
      expect(isMessageData('test', validator)).toBe(true);
      expect(isMessageData(123, validator)).toBe(false);
    });

    it('should work with complex validators', () => {
      const validator = (data: unknown) =>
        typeof data === 'object' &&
        data !== null &&
        'type' in data &&
        (data as any).type === 'message';

      expect(isMessageData({ type: 'message' }, validator)).toBe(true);
      expect(isMessageData({ type: 'other' }, validator)).toBe(false);
    });
  });

  describe('isObject', () => {
    it('should return true for objects', () => {
      expect(isObject({})).toBe(true);
      expect(isObject({ key: 'value' })).toBe(true);
      expect(isObject([])).toBe(true);
    });

    it('should return false for non-objects', () => {
      expect(isObject(null)).toBe(false);
      expect(isObject(undefined)).toBe(false);
      expect(isObject('string')).toBe(false);
      expect(isObject(123)).toBe(false);
      expect(isObject(true)).toBe(false);
    });
  });

  describe('hasProperty', () => {
    it('should return true when property exists', () => {
      const obj = { key: 'value', num: 123 };
      expect(hasProperty(obj, 'key')).toBe(true);
      expect(hasProperty(obj, 'num')).toBe(true);
    });

    it('should return false when property does not exist', () => {
      const obj = { key: 'value' };
      expect(hasProperty(obj, 'missing')).toBe(false);
    });

    it('should return false for non-objects', () => {
      expect(hasProperty(null, 'key')).toBe(false);
      expect(hasProperty(undefined, 'key')).toBe(false);
      expect(hasProperty('string', 'key')).toBe(false);
    });

    it('should handle inherited properties', () => {
      const obj = Object.create({ inherited: 'value' });
      obj.own = 'value';
      expect(hasProperty(obj, 'own')).toBe(true);
      expect(hasProperty(obj, 'inherited')).toBe(true);
    });
  });

  describe('isGetTrackerInfoData', () => {
    it('should validate correct tracker info data', () => {
      const validData = { domain: 'google-analytics.com' };
      expect(isGetTrackerInfoData(validData)).toBe(true);
    });

    it('should reject invalid tracker info data', () => {
      expect(isGetTrackerInfoData({})).toBe(false);
      expect(isGetTrackerInfoData({ domain: 123 })).toBe(false);
      expect(isGetTrackerInfoData({ other: 'value' })).toBe(false);
      expect(isGetTrackerInfoData(null)).toBe(false);
      expect(isGetTrackerInfoData('string')).toBe(false);
    });
  });

  describe('isConsentScanResult', () => {
    it('should validate complete consent scan result', () => {
      const validResult = {
        url: 'https://example.com',
        hasBanner: true,
        hasRejectButton: false,
        isCompliant: false,
        deceptivePatterns: ['missing-reject'],
        timestamp: Date.now(),
      };
      expect(isConsentScanResult(validResult)).toBe(true);
    });

    it('should reject incomplete data', () => {
      const incomplete = {
        url: 'https://example.com',
        hasBanner: true,
      };
      expect(isConsentScanResult(incomplete)).toBe(false);
    });

    it('should reject wrong types', () => {
      const wrongTypes = {
        url: 123,
        hasBanner: 'true',
        hasRejectButton: false,
        isCompliant: false,
        deceptivePatterns: ['test'],
        timestamp: Date.now(),
      };
      expect(isConsentScanResult(wrongTypes)).toBe(false);
    });

    it('should reject non-array deceptivePatterns', () => {
      const invalidPatterns = {
        url: 'https://example.com',
        hasBanner: true,
        hasRejectButton: false,
        isCompliant: false,
        deceptivePatterns: 'not-an-array',
        timestamp: Date.now(),
      };
      expect(isConsentScanResult(invalidPatterns)).toBe(false);
    });

    it('should handle empty deceptivePatterns array', () => {
      const validResult = {
        url: 'https://example.com',
        hasBanner: true,
        hasRejectButton: true,
        isCompliant: true,
        deceptivePatterns: [],
        timestamp: Date.now(),
      };
      expect(isConsentScanResult(validResult)).toBe(true);
    });
  });
});
