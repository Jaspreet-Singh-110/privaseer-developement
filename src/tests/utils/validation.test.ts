/**
 * TEST FILE: Validation Utility Regression Tests
 *
 * Test Type: Unit
 * Contexts Tested: Background utility layer
 * Chrome APIs Mocked: None (pure functions)
 * Prerequisites:
 *   - None (relies on pure validation helpers)
 *
 * Coverage Target: `src/utils/validation.ts`
 */

import { describe, it, expect } from 'vitest';
import {
  validateFeedbackPayload,
  validateEventPayload,
  validateComplianceScore,
} from '@/utils/validation';

describe('validateFeedbackPayload', () => {
  it('accepts minimal valid feedback payload', () => {
    const result = validateFeedbackPayload({ feedbackText: '  Great job  ' });
    expect(result.valid).toBe(true);
    expect(result.sanitized).toEqual({ feedbackText: 'Great job' });
  });

  it('sanitizes optional url and domain when provided', () => {
    const result = validateFeedbackPayload({
      feedbackText: 'Needs work',
      url: 'https://example.com/path?tracking=1#section',
      domain: ' EXAMPLE.com ',
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized).toEqual({
      feedbackText: 'Needs work',
      url: 'https://example.com/path',
      domain: 'example.com',
    });
  });

  it('rejects non-object payloads', () => {
    const result = validateFeedbackPayload('invalid');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid payload: expected object');
  });

  it('rejects missing or invalid feedbackText', () => {
    expect(validateFeedbackPayload({})).toMatchObject({
      valid: false,
      error: 'feedbackText must be a string',
    });

    expect(validateFeedbackPayload({ feedbackText: '   ' })).toMatchObject({
      valid: false,
      error: 'feedbackText cannot be empty',
    });
  });

  it('rejects feedback that exceeds length limits', () => {
    const longText = 'a'.repeat(5001);
    const result = validateFeedbackPayload({ feedbackText: longText });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceeds 5000 characters');
  });

  it('rejects invalid url or domain types', () => {
    expect(
      validateFeedbackPayload({ feedbackText: 'ok', url: 123 })
    ).toMatchObject({
      valid: false,
      error: 'url must be a string when provided',
    });

    expect(
      validateFeedbackPayload({ feedbackText: 'ok', domain: 123 })
    ).toMatchObject({
      valid: false,
      error: 'domain must be a string when provided',
    });
  });

  it('rejects invalid urls that fail sanitization', () => {
    const result = validateFeedbackPayload({
      feedbackText: 'bad url',
      url: 'not-a-url',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('url is invalid');
  });

  it('drops empty domains after trimming', () => {
    const result = validateFeedbackPayload({
      feedbackText: 'test',
      domain: '   ',
    });
    expect(result.valid).toBe(true);
    expect(result.sanitized?.domain).toBeUndefined();
  });

  it('rejects unsafe url protocols for feedback payloads', () => {
    const result = validateFeedbackPayload({
      feedbackText: 'protocol test',
      url: 'javascript:alert(1)',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('url protocol must be http or https');
  });
});

describe('validateEventPayload', () => {
  it('accepts valid event payload with sanitized data', () => {
    const result = validateEventPayload({
      eventType: '  click  ',
      eventData: { key: 'value' },
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized).toEqual({
      eventType: 'click',
      eventData: { key: 'value' },
    });
  });

  it('rejects non-object payloads', () => {
    const result = validateEventPayload('invalid');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid payload: expected object');
  });

  it('rejects invalid eventType values', () => {
    expect(validateEventPayload({})).toMatchObject({
      valid: false,
      error: 'eventType must be a string',
    });

    expect(
      validateEventPayload({ eventType: '   ' })
    ).toMatchObject({
      valid: false,
      error: 'eventType cannot be empty',
    });

    const longType = 'a'.repeat(101);
    expect(
      validateEventPayload({ eventType: longType })
    ).toMatchObject({
      valid: false,
      error: 'eventType exceeds 100 characters',
    });
  });

  it('rejects non-object eventData', () => {
    const result = validateEventPayload({
      eventType: 'test',
      eventData: 'not-an-object',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('eventData must be a plain object');
  });

  it('rejects oversized eventData payloads', () => {
    const bigPayload = { data: 'x'.repeat(11 * 1024) };
    const result = validateEventPayload({
      eventType: 'big',
      eventData: bigPayload,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('eventData exceeds 10KB limit');
  });

  it('rejects non-serializable eventData', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = validateEventPayload({
      eventType: 'circular',
      eventData: circular,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('eventData must be serializable');
  });

  it('returns a deep-cloned serializable eventData payload', () => {
    const sourceData = { nested: { count: 1 }, tags: ['a', 'b'] };
    const result = validateEventPayload({
      eventType: 'clone_check',
      eventData: sourceData,
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized?.eventData).toEqual(sourceData);
    expect(result.sanitized?.eventData).not.toBe(sourceData);
  });
});

describe('validateComplianceScore', () => {
  it('accepts valid scores including boundaries', () => {
    expect(validateComplianceScore({ score: 0 })).toMatchObject({
      valid: true,
      sanitized: { score: 0 },
    });
    expect(validateComplianceScore({ score: 100 })).toMatchObject({
      valid: true,
      sanitized: { score: 100 },
    });
    expect(validateComplianceScore({ score: 42 })).toMatchObject({
      valid: true,
      sanitized: { score: 42 },
    });
  });

  it('rejects non-object payloads or missing scores', () => {
    expect(validateComplianceScore('invalid')).toMatchObject({
      valid: false,
      error: 'Invalid payload: expected object',
    });
    expect(validateComplianceScore({})).toMatchObject({
      valid: false,
      error: 'score must be a finite number',
    });
  });

  it('rejects non-number, NaN, or infinite scores', () => {
    expect(
      validateComplianceScore({ score: 'not-a-number' as unknown as number })
    ).toMatchObject({
      valid: false,
      error: 'score must be a finite number',
    });

    expect(validateComplianceScore({ score: Number.NaN })).toMatchObject({
      valid: false,
      error: 'score must be a finite number',
    });

    expect(validateComplianceScore({ score: Number.POSITIVE_INFINITY })).toMatchObject({
      valid: false,
      error: 'score must be a finite number',
    });
  });

  it('enforces score boundaries between 0 and 100', () => {
    expect(validateComplianceScore({ score: -1 })).toMatchObject({
      valid: false,
      error: 'score must be between 0 and 100',
    });
    expect(validateComplianceScore({ score: 101 })).toMatchObject({
      valid: false,
      error: 'score must be between 0 and 100',
    });
  });
});
