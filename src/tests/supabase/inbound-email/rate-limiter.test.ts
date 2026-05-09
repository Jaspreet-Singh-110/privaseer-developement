import { describe, it, expect } from 'vitest';
import { generateRateLimitResponse, shouldAutoNotify } from "../../../../supabase/functions/inbound-email/rate-limiter";

describe('rate-limiter', () => {
  it('generateRateLimitResponse - paused', () => {
    const result = {
      allowed: false,
      reason: "paused" as const,
    };

    const response = generateRateLimitResponse(result);

    expect(response.includes("paused")).toBe(true);
    expect(response.includes("suspicious activity")).toBe(true);
  });

  it('generateRateLimitResponse - rate limit', () => {
    const result = {
      allowed: false,
      reason: "rate_limit" as const,
      hourlyLimit: 50,
      emailsInLastHour: 52,
    };

    const response = generateRateLimitResponse(result);

    expect(response.includes("50")).toBe(true);
    expect(response.includes("52")).toBe(true);
    expect(response.includes("per hour")).toBe(true);
  });

  it('generateRateLimitResponse - generic', () => {
    const result = {
      allowed: false,
    };

    const response = generateRateLimitResponse(result);

    expect(response.includes("rate limiting")).toBe(true);
  });

  it('shouldAutoNotify - high 5min rate', () => {
    const spike = {
      isSpike: true,
      emailsLast5Min: 15,
      emailsLast15Min: 20,
      emailsLastHour: 30,
    };

    const shouldNotify = shouldAutoNotify(spike);

    expect(shouldNotify).toBe(true);
  });

  it('shouldAutoNotify - high 15min rate', () => {
    const spike = {
      isSpike: true,
      emailsLast5Min: 5,
      emailsLast15Min: 30,
      emailsLastHour: 40,
    };

    const shouldNotify = shouldAutoNotify(spike);

    expect(shouldNotify).toBe(true);
  });

  it('shouldAutoNotify - no spike', () => {
    const spike = {
      isSpike: false,
      emailsLast5Min: 2,
      emailsLast15Min: 8,
      emailsLastHour: 20,
    };

    const shouldNotify = shouldAutoNotify(spike);

    expect(shouldNotify).toBe(false);
  });

  it('shouldAutoNotify - spike but low rates', () => {
    const spike = {
      isSpike: true,
      emailsLast5Min: 5,
      emailsLast15Min: 12,
      emailsLastHour: 100,
    };

    const shouldNotify = shouldAutoNotify(spike);

    expect(shouldNotify).toBe(false);
  });
});
