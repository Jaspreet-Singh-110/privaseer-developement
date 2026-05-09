/**
 * @file src/tests/supabase/shared/input-validation.test.ts
 *
 * Test Type: Unit
 * Contexts Tested: Supabase edge function validation utilities
 * Prerequisites: None
 */

import { describe, expect, it } from 'vitest';
import {
  createValidationErrorResponse,
  sanitizeHtml,
  sanitizeSubject,
  validateBoolean,
  validateEmail,
  validateEmailPayload,
  validateGenerateEmailRequest,
  validateNumber,
  validateString,
  validateUUID,
} from '../../../../supabase/functions/shared/input-validation';

describe('input-validation utilities', () => {
  describe('validateEmail', () => {
    it('rejects invalid or empty values', () => {
      expect(validateEmail('')).toEqual({
        valid: false,
        error: 'Email is required and must be a string',
      });
      expect(validateEmail('   ')).toEqual({
        valid: false,
        error: 'Email cannot be empty',
      });
      expect(validateEmail('invalid-email')).toEqual({
        valid: false,
        error: 'Invalid email format',
      });
    });

    it('rejects too long local parts and overall length', () => {
      const localPart = `${'a'.repeat(65)}@example.com`;
      const longEmail = `${'a'.repeat(200)}@${'b'.repeat(60)}.com`;

      expect(validateEmail(localPart)).toEqual({
        valid: false,
        error: 'Email local part is too long (max 64 characters)',
      });
      expect(validateEmail(longEmail)).toEqual({
        valid: false,
        error: 'Email is too long (max 254 characters)',
      });
    });

    it('sanitizes valid emails to lower case', () => {
      expect(validateEmail('Test@Example.com')).toEqual({
        valid: true,
        sanitized: 'test@example.com',
      });
    });
  });

  describe('validateUUID', () => {
    it('rejects invalid UUIDs', () => {
      expect(validateUUID('not-a-uuid')).toEqual({
        valid: false,
        error: 'Invalid UUID format',
      });
    });

    it('sanitizes valid UUIDs to lower case', () => {
      expect(validateUUID('A1B2C3D4-E5F6-7890-ABCD-EF0123456789')).toEqual({
        valid: true,
        sanitized: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      });
    });
  });

  describe('validateString', () => {
    it('enforces required fields', () => {
      const result = validateString('', 'Name', { required: true });
      expect(result).toEqual({ valid: false, error: 'Name is required and must be a string' });
    });

    it('validates length and pattern', () => {
      expect(
        validateString('ab', 'Token', { minLength: 3 })
      ).toEqual({
        valid: false,
        error: 'Token must be at least 3 characters',
      });
      expect(
        validateString('abcde', 'Token', { maxLength: 3 })
      ).toEqual({
        valid: false,
        error: 'Token must be at most 3 characters',
      });
      expect(
        validateString('abc', 'Token', { pattern: /^[0-9]+$/ })
      ).toEqual({
        valid: false,
        error: 'Token has invalid format',
      });
    });

    it('returns trimmed sanitized values', () => {
      const result = validateString('  hello  ', 'Greeting', { required: true });
      expect(result).toEqual({ valid: true, sanitized: 'hello' });
    });
  });

  describe('validateNumber', () => {
    it('enforces required values and numeric types', () => {
      expect(validateNumber(undefined, 'Age', { required: true })).toEqual({
        valid: false,
        error: 'Age is required',
      });
      expect(validateNumber('abc', 'Age')).toEqual({
        valid: false,
        error: 'Age must be a valid number',
      });
    });

    it('validates integer, min, and max constraints', () => {
      expect(validateNumber(1.5, 'Count', { integer: true })).toEqual({
        valid: false,
        error: 'Count must be an integer',
      });
      expect(validateNumber(2, 'Count', { min: 3 })).toEqual({
        valid: false,
        error: 'Count must be at least 3',
      });
      expect(validateNumber(10, 'Count', { max: 5 })).toEqual({
        valid: false,
        error: 'Count must be at most 5',
      });
    });

    it('returns sanitized numbers', () => {
      expect(validateNumber('12', 'Count')).toEqual({
        valid: true,
        sanitized: 12,
      });
    });
  });

  describe('validateBoolean', () => {
    it('enforces required boolean values', () => {
      expect(validateBoolean(undefined, 'Flag', true)).toEqual({
        valid: false,
        error: 'Flag is required',
      });
    });

    it('coerces string boolean values', () => {
      expect(validateBoolean('true', 'Flag')).toEqual({ valid: true, sanitized: true });
      expect(validateBoolean('false', 'Flag')).toEqual({ valid: true, sanitized: false });
    });

    it('rejects invalid boolean values', () => {
      expect(validateBoolean('yes', 'Flag')).toEqual({
        valid: false,
        error: 'Flag must be a boolean',
      });
    });
  });

  describe('sanitizeHtml', () => {
    it('removes unsafe tags and javascript protocols', () => {
      const html = '<script>alert(1)</script><div onclick="alert(1)">Safe</div><a href="javascript:evil()">bad</a>';
      const sanitized = sanitizeHtml(html);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('javascript:');
      expect(sanitized).not.toContain('onclick=');
      expect(sanitized).toContain('Safe');
    });
  });

  describe('sanitizeSubject', () => {
    it('trims and normalizes whitespace', () => {
      const subject = '  Hello\r\nworld\t\t!';
      expect(sanitizeSubject(subject)).toBe('Hello world !');
    });

    it('limits subject length to 998 characters', () => {
      const longSubject = 'a'.repeat(1200);
      expect(sanitizeSubject(longSubject).length).toBe(998);
    });
  });

  describe('validateEmailPayload', () => {
    it('rejects non-object payloads', () => {
      expect(validateEmailPayload(null)).toEqual({
        valid: false,
        error: 'Payload must be an object',
      });
    });

    it('rejects invalid sender and recipient addresses', () => {
      expect(
        validateEmailPayload({ recipient: 'bad', sender: 'good@example.com' })
      ).toEqual({
        valid: false,
        error: 'Recipient: Invalid email format',
      });
      expect(
        validateEmailPayload({ recipient: 'good@example.com', sender: 'bad' })
      ).toEqual({
        valid: false,
        error: 'Sender: Invalid email format',
      });
    });

    it('sanitizes valid payloads', () => {
      const result = validateEmailPayload({
        recipient: 'Recipient@Example.com',
        sender: 'Sender@Example.com',
        subject: '  Hello ',
        bodyPlain: 'Test',
        bodyHtml: '<div onclick="bad()">Hello</div>',
      });

      expect(result.valid).toBe(true);
      expect(result.sanitized).toMatchObject({
        recipient: 'recipient@example.com',
        sender: 'sender@example.com',
        from: 'sender@example.com',
        subject: 'Hello',
        bodyPlain: 'Test',
      });
      expect(result.sanitized?.bodyHtml).not.toContain('onclick=');
      expect(result.sanitized?.timestamp).toEqual(expect.any(Number));
    });
  });

  describe('validateGenerateEmailRequest', () => {
    it('rejects invalid request bodies', () => {
      expect(validateGenerateEmailRequest(null)).toEqual({
        valid: false,
        error: 'Request body must be an object',
      });
      expect(
        validateGenerateEmailRequest({ installationId: 'bad', realEmail: 'a@b.com', domain: 'example.com' })
      ).toEqual({
        valid: false,
        error: 'Installation ID: Invalid UUID format',
      });
      expect(
        validateGenerateEmailRequest({ installationId: '11111111-1111-1111-1111-111111111111', realEmail: 'bad', domain: 'example.com' })
      ).toEqual({
        valid: false,
        error: 'Real email: Invalid email format',
      });
    });

    it('validates required domain and expiresInDays range', () => {
      expect(
        validateGenerateEmailRequest({ installationId: '11111111-1111-1111-1111-111111111111', realEmail: 'test@example.com' })
      ).toEqual({
        valid: false,
        error: 'Domain is required and must be a string',
      });
      expect(
        validateGenerateEmailRequest({
          installationId: '11111111-1111-1111-1111-111111111111',
          realEmail: 'test@example.com',
          domain: 'example.com',
          expiresInDays: 400,
        })
      ).toEqual({
        valid: false,
        error: 'Expires in days must be at most 365',
      });
    });

    it('sanitizes valid requests', () => {
      const result = validateGenerateEmailRequest({
        installationId: '11111111-1111-1111-1111-111111111111',
        realEmail: 'Test@Example.com',
        domain: 'example.com',
        url: 'https://example.com',
        label: 'Label',
        description: 'Desc',
        expiresInDays: 30,
      });

      expect(result).toEqual({
        valid: true,
        sanitized: {
          installationId: '11111111-1111-1111-1111-111111111111',
          realEmail: 'test@example.com',
          domain: 'example.com',
          url: 'https://example.com',
          label: 'Label',
          description: 'Desc',
          expiresInDays: 30,
        },
      });
    });
  });

  describe('createValidationErrorResponse', () => {
    it('creates a response with validation error payload', async () => {
      const response = createValidationErrorResponse('Missing data');
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body).toEqual({
        error: 'Validation error',
        message: 'Missing data',
      });
    });
  });
});
