import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feedbackTelemetryService } from '@/background/feedback-telemetry-service';
import { SUPABASE } from '@/utils/constants';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

const getTelemetryEnabledMock = vi.hoisted(() => vi.fn().mockResolvedValue(false));

vi.mock('@/utils/logger', () => ({
  logger: loggerMock,
}));

vi.mock('@/background/storage', () => ({
  Storage: {
    getTelemetryEnabled: getTelemetryEnabledMock,
  },
}));

describe('FeedbackTelemetryService', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let storedInstallationId: string | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    storedInstallationId = null;

    mockFetch = vi.fn();
    global.fetch = mockFetch as any;

    global.chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => {
            if (key === 'installationId' && storedInstallationId) {
              return { installationId: storedInstallationId };
            }
            return {};
          }),
          set: vi.fn(async (data: Record<string, unknown>) => {
            if (data.installationId) {
              storedInstallationId = data.installationId as string;
            }
          }),
        },
      } as unknown as typeof chrome.storage,
      runtime: {
        getManifest: vi.fn(() => ({ version: '1.0.0' })),
        getPlatformInfo: vi.fn().mockResolvedValue({ os: 'mac' }),
      } as unknown as typeof chrome.runtime,
    } as unknown as typeof chrome;

    // Reset service state
    const service = feedbackTelemetryService as unknown as {
      installationId: string | null;
      browserVersion: string | null;
    };
    service.installationId = null;
    service.browserVersion = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Installation ID management', () => {
    it('generates new installation ID on first run', async () => {
      const id = await feedbackTelemetryService.getInstallationId();

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        installationId: id,
      });
    });

    it('persists installation ID across calls', async () => {
      const firstId = await feedbackTelemetryService.getInstallationId();
      const secondId = await feedbackTelemetryService.getInstallationId();

      expect(firstId).toBe(secondId);
      expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    });

    it('retrieves existing installation ID from storage', async () => {
      storedInstallationId = 'existing-uuid-1234';

      const id = await feedbackTelemetryService.getInstallationId();

      expect(id).toBe('existing-uuid-1234');
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('Initialization', () => {
    it('initializes with installation ID and browser version', async () => {
      await feedbackTelemetryService.initialize();

      expect(loggerMock.info).toHaveBeenCalledWith(
        'FeedbackTelemetryService',
        'Initialized',
        expect.objectContaining({
          installationId: expect.stringContaining('...'),
        })
      );
    });

    it('handles initialization errors gracefully', async () => {
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Storage unavailable')
      );

      await feedbackTelemetryService.initialize();

      expect(loggerMock.error).toHaveBeenCalledWith(
        'FeedbackTelemetryService',
        'Failed to initialize',
        expect.any(Error)
      );
    });
  });

  describe('Feedback submission', () => {
    it('submits feedback successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ success: true })),
      });

      const result = await feedbackTelemetryService.submitFeedback({
        feedbackText: 'Great extension!',
        url: 'https://example.com',
        domain: 'example.com',
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${SUPABASE.URL}/functions/v1/submit-feedback/feedback`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE.ANON_KEY}`,
          }),
          body: expect.stringContaining('Great extension!'),
        })
      );
      expect(loggerMock.info).toHaveBeenCalledWith(
        'FeedbackTelemetryService',
        'Feedback submitted successfully'
      );
    });

    it('handles network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await feedbackTelemetryService.submitFeedback({
        feedbackText: 'Test feedback',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(loggerMock.error).toHaveBeenCalledWith(
        'FeedbackTelemetryService',
        'Failed to submit feedback',
        expect.any(Error)
      );
    });

    it('handles HTTP error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue(JSON.stringify({ error: 'Server error' })),
      });

      const result = await feedbackTelemetryService.submitFeedback({
        feedbackText: 'Test feedback',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Server error');
    });

    it('handles invalid JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('Invalid JSON'),
      });

      const result = await feedbackTelemetryService.submitFeedback({
        feedbackText: 'Test feedback',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid response from server');
    });

    it('handles API success=false responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ success: false, error: 'Validation failed' })),
      });

      const result = await feedbackTelemetryService.submitFeedback({
        feedbackText: 'Test feedback',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Validation failed');
    });
  });

  describe('Telemetry event tracking', () => {
    it('skips tracking when telemetry is disabled', async () => {
      getTelemetryEnabledMock.mockResolvedValueOnce(false);

      await feedbackTelemetryService.trackEvent({
        eventType: 'test_event',
        eventData: { key: 'value' },
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(loggerMock.debug).toHaveBeenCalledWith(
        'FeedbackTelemetryService',
        'Telemetry disabled, skipping event',
        { eventType: 'test_event' }
      );
    });

    it('sends telemetry event when enabled', async () => {
      getTelemetryEnabledMock.mockResolvedValueOnce(true);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await feedbackTelemetryService.trackEvent({
        eventType: 'protection_toggled',
        eventData: { enabled: true },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${SUPABASE.URL}/functions/v1/submit-feedback/telemetry`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE.ANON_KEY}`,
          }),
          body: expect.stringContaining('protection_toggled'),
        })
      );
      expect(loggerMock.debug).toHaveBeenCalledWith(
        'FeedbackTelemetryService',
        'Event tracked',
        { eventType: 'protection_toggled' }
      );
    });

    it('handles telemetry network errors silently', async () => {
      getTelemetryEnabledMock.mockResolvedValueOnce(true);
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      await feedbackTelemetryService.trackEvent({
        eventType: 'test_event',
      });

      expect(loggerMock.error).toHaveBeenCalledWith(
        'FeedbackTelemetryService',
        'Failed to track event',
        expect.any(Error)
      );
    });

    it('handles telemetry HTTP errors silently', async () => {
      getTelemetryEnabledMock.mockResolvedValueOnce(true);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      await feedbackTelemetryService.trackEvent({
        eventType: 'test_event',
      });

      expect(loggerMock.error).toHaveBeenCalledWith(
        'FeedbackTelemetryService',
        'Failed to track event',
        expect.any(Error)
      );
    });

    it('initializes installation ID before tracking if not set', async () => {
      getTelemetryEnabledMock.mockResolvedValueOnce(true);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await feedbackTelemetryService.trackEvent({
        eventType: 'first_event',
      });

      expect(chrome.storage.local.get).toHaveBeenCalledWith('installationId');
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});

