/**
 * @file src/tests/background/false-positive-service.test.ts
 *
 * Test Type: Unit
 * Contexts Tested: Background service worker false positive reporting
 * Chrome APIs Mocked: None (uses fetch)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FalsePositiveService } from '@/background/false-positive-service';
import { SUPABASE } from '@/utils/constants';
import type { FalsePositiveReport } from '@/types';

const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: loggerErrorMock,
    warn: loggerWarnMock,
    debug: vi.fn(),
  },
}));

describe('FalsePositiveService', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('reports false positives successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        success: true,
        aggregation: {
          reportCount: 4,
          overrideThreshold: 88,
          shouldOverride: true,
        },
      }),
    });

    const report: FalsePositiveReport = {
      domain: 'example.com',
      url: 'https://example.com/page',
      detectedPatterns: ['pattern1'],
      reason: 'wrong_detection',
      timestamp: Date.now(),
      installationId: 'install-123',
      scanConfidence: 0.8,
    };

    const result = await FalsePositiveService.reportFalsePositive(report);

    expect(result).toEqual({
      success: true,
      aggregation: {
        reportCount: 4,
        overrideThreshold: 88,
        shouldOverride: true,
      },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${SUPABASE.URL}/functions/v1/report-false-positive`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE.ANON_KEY}`,
        },
      })
    );
  });

  it('sanitizes URL before sending', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ success: true }),
    });

    const report: FalsePositiveReport = {
      domain: 'example.com',
      url: 'https://example.com/page?tracking=123#hash',
      detectedPatterns: [],
      reason: 'wrong_detection',
      timestamp: Date.now(),
      installationId: 'install-123',
      scanConfidence: 0.5,
    };

    await FalsePositiveService.reportFalsePositive(report);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.url).toBe('https://example.com/page');
  });

  it('returns false when API returns error status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Server error'),
    });

    const report: FalsePositiveReport = {
      domain: 'example.com',
      url: 'https://example.com',
      detectedPatterns: [],
      reason: 'wrong_detection',
      timestamp: Date.now(),
      installationId: 'install-123',
      scanConfidence: 0.5,
    };

    const result = await FalsePositiveService.reportFalsePositive(report);

    expect(result).toEqual({ success: false });
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'FalsePositiveService',
      'Failed to report false positive',
      expect.objectContaining({
        domain: 'example.com',
        status: 500,
      })
    );
  });

  it('returns false when network error occurs', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const report: FalsePositiveReport = {
      domain: 'example.com',
      url: 'https://example.com',
      detectedPatterns: [],
      reason: 'wrong_detection',
      timestamp: Date.now(),
      installationId: 'install-123',
      scanConfidence: 0.5,
    };

    const result = await FalsePositiveService.reportFalsePositive(report);

    expect(result).toEqual({ success: false });
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'FalsePositiveService',
      'Error reporting false positive',
      expect.any(Error)
    );
  });
});
