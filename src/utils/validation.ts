import { sanitizeUrl } from './sanitizer';

/**
 * Shared validation utilities for the Privaseer extension.
 * These functions mirror the validation logic in supabase/functions/shared/input-validation.ts
 * to ensure consistency between client-side and server-side validation.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

/**
 * Validates an email address with comprehensive checks.
 * 
 * @param email - The email address to validate (can be unknown type for safety)
 * @returns ValidationResult with valid flag, optional error message, and sanitized email
 * 
 * @example
 * const result = validateEmail('User@Example.COM');
 * if (result.valid) {
 *   console.log(result.sanitized); // 'user@example.com'
 * } else {
 *   console.error(result.error);
 * }
 */
export function validateEmail(email: unknown): ValidationResult {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required and must be a string' };
  }

  const trimmed = email.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'Email cannot be empty' };
  }

  if (trimmed.length > 254) {
    return { valid: false, error: 'Email is too long (max 254 characters)' };
  }

  // Standard email regex that matches the server-side validation
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid email format' };
  }

  const [localPart, domain] = trimmed.split('@');

  if (localPart.length > 64) {
    return { valid: false, error: 'Email local part is too long (max 64 characters)' };
  }

  if (domain.length > 255) {
    return { valid: false, error: 'Email domain is too long (max 255 characters)' };
  }

  return { valid: true, sanitized: trimmed.toLowerCase() };
}

/**
 * Sanitizes a URL before sending it to the backend for burner email metadata.
 *
 * Behavior:
 * - Strips query string and hash fragment to avoid leaking tracking IDs or tokens
 * - Returns only protocol + '//' + hostname + pathname
 * - Returns null if the URL is invalid or cannot be parsed
 *
 * This mirrors the privacy-first behavior we want for all outbound URLs.
 */
export function sanitizeUrlForBurner(url: string | undefined | null): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
  } catch {
    // If the URL cannot be parsed, treat it as unusable metadata
    return null;
  }
}

const MAX_FEEDBACK_LENGTH = 5000;
const MAX_EVENT_TYPE_LENGTH = 100;
const MAX_EVENT_DATA_BYTES = 10 * 1024; // ~10KB
const MIN_COMPLIANCE_SCORE = 0;
const MAX_COMPLIANCE_SCORE = 100;

type PlainObject = Record<string, unknown>;

interface PayloadValidationResult<T> {
  valid: boolean;
  error?: string;
  sanitized?: T;
}

export type FeedbackValidationResult = PayloadValidationResult<{ feedbackText: string; url?: string; domain?: string }>;

export type EventValidationResult = PayloadValidationResult<{ eventType: string; eventData?: Record<string, unknown> }>;

export type ScoreValidationResult = PayloadValidationResult<{ score: number }>;

export function validateFeedbackPayload(data: unknown): FeedbackValidationResult {
  if (!isPlainObject(data)) {
    return { valid: false, error: 'Invalid payload: expected object' };
  }

  const { feedbackText, url, domain } = data as {
    feedbackText?: unknown;
    url?: unknown;
    domain?: unknown;
  };

  if (typeof feedbackText !== 'string') {
    return { valid: false, error: 'feedbackText must be a string' };
  }

  const trimmedFeedback = feedbackText.trim();
  if (!trimmedFeedback) {
    return { valid: false, error: 'feedbackText cannot be empty' };
  }

  if (trimmedFeedback.length > MAX_FEEDBACK_LENGTH) {
    return { valid: false, error: `feedbackText exceeds ${MAX_FEEDBACK_LENGTH} characters` };
  }

  let sanitizedUrl: string | undefined;
  if (url !== undefined) {
    if (typeof url !== 'string') {
      return { valid: false, error: 'url must be a string when provided' };
    }

    const result = sanitizeOptionalUrl(url);
    if (!result.valid) {
      return { valid: false, error: result.error };
    }
    sanitizedUrl = result.url;
  }

  let sanitizedDomain: string | undefined;
  if (domain !== undefined) {
    if (typeof domain !== 'string') {
      return { valid: false, error: 'domain must be a string when provided' };
    }
    sanitizedDomain = domain.trim().toLowerCase();
    if (!sanitizedDomain) {
      sanitizedDomain = undefined;
    }
  }

  return {
    valid: true,
    sanitized: {
      feedbackText: trimmedFeedback,
      ...(sanitizedUrl ? { url: sanitizedUrl } : {}),
      ...(sanitizedDomain ? { domain: sanitizedDomain } : {}),
    },
  };
}

export function validateEventPayload(data: unknown): EventValidationResult {
  if (!isPlainObject(data)) {
    return { valid: false, error: 'Invalid payload: expected object' };
  }

  const { eventType, eventData } = data as {
    eventType?: unknown;
    eventData?: unknown;
  };

  if (typeof eventType !== 'string') {
    return { valid: false, error: 'eventType must be a string' };
  }

  const trimmedType = eventType.trim();
  if (!trimmedType) {
    return { valid: false, error: 'eventType cannot be empty' };
  }

  if (trimmedType.length > MAX_EVENT_TYPE_LENGTH) {
    return { valid: false, error: `eventType exceeds ${MAX_EVENT_TYPE_LENGTH} characters` };
  }

  let sanitizedEventData: Record<string, unknown> | undefined;
  if (eventData !== undefined) {
    if (!isPlainObject(eventData)) {
      return { valid: false, error: 'eventData must be a plain object' };
    }

    try {
      const serialized = JSON.stringify(eventData);
      if (serialized.length > MAX_EVENT_DATA_BYTES) {
        return { valid: false, error: 'eventData exceeds 10KB limit' };
      }

      sanitizedEventData = JSON.parse(serialized) as Record<string, unknown>;
    } catch {
      return { valid: false, error: 'eventData must be serializable' };
    }
  }

  return {
    valid: true,
    sanitized: {
      eventType: trimmedType,
      ...(sanitizedEventData ? { eventData: sanitizedEventData } : {}),
    },
  };
}

export function validateComplianceScore(data: unknown): ScoreValidationResult {
  if (!isPlainObject(data)) {
    return { valid: false, error: 'Invalid payload: expected object' };
  }

  const { score } = data as { score?: unknown };
  if (typeof score !== 'number' || Number.isNaN(score) || !Number.isFinite(score)) {
    return { valid: false, error: 'score must be a finite number' };
  }

  if (score < MIN_COMPLIANCE_SCORE || score > MAX_COMPLIANCE_SCORE) {
    return { valid: false, error: `score must be between ${MIN_COMPLIANCE_SCORE} and ${MAX_COMPLIANCE_SCORE}` };
  }

  return {
    valid: true,
    sanitized: { score },
  };
}

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeOptionalUrl(value: string): { valid: true; url?: string } | { valid: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, error: 'url cannot be empty when provided' };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'url protocol must be http or https' };
    }
    const sanitized = sanitizeUrl(parsed.toString());
    if (!sanitized || sanitized === '[invalid-url]') {
      return { valid: false, error: 'url is invalid' };
    }
    return { valid: true, url: sanitized };
  } catch {
    return { valid: false, error: 'url is invalid' };
  }
}
