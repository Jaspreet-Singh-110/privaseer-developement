/**
 * @file src/tests/background/scoring-config.test.ts
 *
 * Test Type: Unit
 * Contexts Tested: Background scoring config cache
 * Chrome APIs Mocked: None
 * Prerequisites: None
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchScoringConfig, getScoringConfig, resetScoringConfigCache } from '@/background/scoring-config';

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('scoring-config cache', () => {
  beforeEach(() => {
    resetScoringConfigCache();
    vi.clearAllMocks();
  });

  it('returns defaults when cache is empty', () => {
    const config = getScoringConfig();
    expect(config.version).toBe('1.0');
    expect(config.riskWeights.fingerprinting).toBe(5);
    expect(config.creditFactors.protectionMultiplier).toBe(50);
  });

  it('fetches and caches remote config payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        config: {
          version: '2.0',
          riskWeights: { fingerprinting: 9 },
          creditFactors: { protectionMultiplier: 75 },
          decay: { enabled: false },
        },
      }),
    }) as unknown as typeof fetch;

    await fetchScoringConfig();
    const config = getScoringConfig();

    expect(config.version).toBe('2.0');
    expect(config.riskWeights.fingerprinting).toBe(9);
    expect(config.creditFactors.protectionMultiplier).toBe(75);
    expect(config.decay.enabled).toBe(false);
    expect(config.riskWeights.analytics).toBe(1);
  });
});
