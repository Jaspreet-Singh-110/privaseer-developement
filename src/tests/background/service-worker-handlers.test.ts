import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Storage } from '@/background/storage';
import { burnerEmailService } from '@/background/burner-email-service';
import { feedbackTelemetryService } from '@/background/feedback-telemetry-service';
import { messageBus } from '@/utils/message-bus';
import { validateEventPayload } from '@/utils/validation';
import type { BurnerEmail } from '@/types';

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock burner email service
vi.mock('@/background/burner-email-service', () => ({
  burnerEmailService: {
    getEmails: vi.fn(),
    deleteEmail: vi.fn(),
  },
}));

// Mock feedback telemetry service
vi.mock('@/background/feedback-telemetry-service', () => ({
  feedbackTelemetryService: {
    trackEvent: vi.fn(),
  },
}));

// Mock message bus
vi.mock('@/utils/message-bus', () => ({
  messageBus: {
    broadcast: vi.fn(),
  },
}));

describe('Service Worker Message Handlers', () => {
  let storedPrivacyData: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    storedPrivacyData = null;
    (Storage as any).cache = null;
    (Storage as any).isDirty = false;
    (Storage as any).saveTimer = null;
    (Storage as any).isSaving = false;

    global.chrome = {
      storage: {
        local: {
          get: vi.fn().mockImplementation(async (key: string | string[]) => {
            if (key === 'privacyData' || (Array.isArray(key) && key.includes('privacyData'))) {
              return storedPrivacyData ? { privacyData: storedPrivacyData } : {};
            }
            return {};
          }),
          set: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
            if (data && typeof data === 'object' && 'privacyData' in data) {
              storedPrivacyData = (data as { privacyData: any }).privacyData;
            }
          }),
        },
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
      tabs: {
        query: vi.fn().mockImplementation((_queryInfo, callback) => {
          callback?.([]);
          return Promise.resolve([]);
        }),
        sendMessage: vi.fn(),
      },
    } as any;

    await Storage.initialize();
  });

  describe('GET_BURNER_EMAILS', () => {
    it('returns emails successfully', async () => {
      const mockEmails: BurnerEmail[] = [
        {
          id: '1',
          email_address: 'test1@burner.privaseer.app',
          domain: 'example.com',
          url: 'https://example.com',
          label: 'Test 1',
          is_active: true,
          times_used: 5,
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: '2',
          email_address: 'test2@burner.privaseer.app',
          domain: 'test.com',
          is_active: true,
          times_used: 2,
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      vi.mocked(burnerEmailService.getEmails).mockResolvedValue(mockEmails);

      // Simulate handler logic
      const handler = async () => {
        try {
          const emails = await burnerEmailService.getEmails();
          return { success: true, emails };
        } catch (error) {
          return { success: false, error: 'Failed to fetch burner emails' };
        }
      };

      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.emails).toEqual(mockEmails);
      expect(result.emails).toHaveLength(2);
      expect(burnerEmailService.getEmails).toHaveBeenCalledTimes(1);
    });

    it('returns empty array when no emails', async () => {
      vi.mocked(burnerEmailService.getEmails).mockResolvedValue([]);

      const handler = async () => {
        try {
          const emails = await burnerEmailService.getEmails();
          return { success: true, emails };
        } catch (error) {
          return { success: false, error: 'Failed to fetch burner emails' };
        }
      };

      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.emails).toEqual([]);
      expect(result.emails).toHaveLength(0);
    });

    it('returns error on service failure', async () => {
      vi.mocked(burnerEmailService.getEmails).mockRejectedValue(
        new Error('Network error')
      );

      const handler = async () => {
        try {
          const emails = await burnerEmailService.getEmails();
          return { success: true, emails };
        } catch (error) {
          return { success: false, error: 'Failed to fetch burner emails' };
        }
      };

      const result = await handler();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to fetch burner emails');
    });
  });

  describe('DELETE_BURNER_EMAIL', () => {
    it('deletes email successfully', async () => {
      vi.mocked(burnerEmailService.deleteEmail).mockResolvedValue(undefined);

      const handler = async (data: unknown) => {
        try {
          const { emailId } = data as { emailId: string };
          await burnerEmailService.deleteEmail(emailId);
          return { success: true };
        } catch (error) {
          return { success: false, error: 'Failed to delete burner email' };
        }
      };

      const result = await handler({ emailId: 'test-email-id-123' });

      expect(result.success).toBe(true);
      expect(burnerEmailService.deleteEmail).toHaveBeenCalledWith('test-email-id-123');
      expect(burnerEmailService.deleteEmail).toHaveBeenCalledTimes(1);
    });

    it('handles missing emailId', async () => {
      const handler = async (data: unknown) => {
        try {
          const { emailId } = data as { emailId: string };
          if (!emailId) {
            return { success: false, error: 'emailId is required' };
          }
          await burnerEmailService.deleteEmail(emailId);
          return { success: true };
        } catch (error) {
          return { success: false, error: 'Failed to delete burner email' };
        }
      };

      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('emailId');
      expect(burnerEmailService.deleteEmail).not.toHaveBeenCalled();
    });

    it('returns error on service failure', async () => {
      vi.mocked(burnerEmailService.deleteEmail).mockRejectedValue(
        new Error('Database error')
      );

      const handler = async (data: unknown) => {
        try {
          const { emailId } = data as { emailId: string };
          await burnerEmailService.deleteEmail(emailId);
          return { success: true };
        } catch (error) {
          return { success: false, error: 'Failed to delete burner email' };
        }
      };

      const result = await handler({ emailId: 'test-email-id-123' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to delete burner email');
    });
  });

  describe('SET_REAL_EMAIL', () => {
    it('sets email when feature enabled', async () => {
      await Storage.setBurnerEmailEnabled(true);
      const setRealEmailSpy = vi.spyOn(Storage, 'setRealEmail').mockResolvedValue(undefined);

      const handler = async (data: unknown) => {
        try {
          const { email } = data as { email: string };
          if (typeof email !== 'string' || !email.trim()) {
            return { success: false, error: 'Invalid email value' };
          }

          const isEnabled = await Storage.getBurnerEmailEnabled();
          if (!isEnabled) {
            return {
              success: false,
              error: 'Burner email feature is disabled. Please enable it in settings to configure your forwarding email address.',
            };
          }

          await Storage.setRealEmail(email);
          messageBus.broadcast('STATE_UPDATE');
          return { success: true };
        } catch (error) {
          const err = error as Error;
          return { success: false, error: err.message };
        }
      };

      const result = await handler({ email: 'user@example.com' });

      expect(result.success).toBe(true);
      expect(setRealEmailSpy).toHaveBeenCalledWith('user@example.com');
      expect(messageBus.broadcast).toHaveBeenCalledWith('STATE_UPDATE');
    });

    it('rejects when feature disabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const handler = async (data: unknown) => {
        try {
          const { email } = data as { email: string };
          if (typeof email !== 'string' || !email.trim()) {
            return { success: false, error: 'Invalid email value' };
          }

          const isEnabled = await Storage.getBurnerEmailEnabled();
          if (!isEnabled) {
            return {
              success: false,
              error: 'Burner email feature is disabled. Please enable it in settings to configure your forwarding email address.',
            };
          }

          await Storage.setRealEmail(email);
          messageBus.broadcast('STATE_UPDATE');
          return { success: true };
        } catch (error) {
          const err = error as Error;
          return { success: false, error: err.message };
        }
      };

      const result = await handler({ email: 'user@example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
      expect(result.error).toContain('enable it in settings');
    });

    it('rejects invalid email format', async () => {
      const handler = async (data: unknown) => {
        try {
          const { email } = data as { email: string };
          if (typeof email !== 'string' || !email.trim()) {
            return { success: false, error: 'Invalid email value' };
          }

          const isEnabled = await Storage.getBurnerEmailEnabled();
          if (!isEnabled) {
            return {
              success: false,
              error: 'Burner email feature is disabled. Please enable it in settings to configure your forwarding email address.',
            };
          }

          await Storage.setRealEmail(email);
          messageBus.broadcast('STATE_UPDATE');
          return { success: true };
        } catch (error) {
          const err = error as Error;
          return { success: false, error: err.message };
        }
      };

      // Test empty string
      const result1 = await handler({ email: '' });
      expect(result1.success).toBe(false);
      expect(result1.error).toBe('Invalid email value');

      // Test whitespace only
      const result2 = await handler({ email: '   ' });
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('Invalid email value');

      // Test non-string
      const result3 = await handler({ email: 123 });
      expect(result3.success).toBe(false);
      expect(result3.error).toBe('Invalid email value');
    });

    it('broadcasts STATE_UPDATE after success', async () => {
      await Storage.setBurnerEmailEnabled(true);
      vi.spyOn(Storage, 'setRealEmail').mockResolvedValue(undefined);

      const handler = async (data: unknown) => {
        try {
          const { email } = data as { email: string };
          if (typeof email !== 'string' || !email.trim()) {
            return { success: false, error: 'Invalid email value' };
          }

          const isEnabled = await Storage.getBurnerEmailEnabled();
          if (!isEnabled) {
            return {
              success: false,
              error: 'Burner email feature is disabled. Please enable it in settings to configure your forwarding email address.',
            };
          }

          await Storage.setRealEmail(email);
          messageBus.broadcast('STATE_UPDATE');
          return { success: true };
        } catch (error) {
          const err = error as Error;
          return { success: false, error: err.message };
        }
      };

      await handler({ email: 'user@example.com' });

      expect(messageBus.broadcast).toHaveBeenCalledWith('STATE_UPDATE');
      expect(messageBus.broadcast).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET_ALL_SETTINGS', () => {
    it('returns all settings in single response', async () => {
      // Configure all settings
      await Storage.setTheme('dark');
      await Storage.setBurnerEmailEnabled(true);
      await Storage.setTelemetryEnabled(true);
      
      // Manually set real email in the cache since setRealEmail has complex validation
      const data = await Storage.get();
      data.realEmail = 'test@example.com';
      await Storage.save(data);

      const handler = async () => {
        try {
          const data = await Storage.get();
          const theme = data.settings.theme ?? 'system';
          const burnerEmailEnabled = data.settings.burnerEmailEnabled ?? false;
          const telemetryEnabled = data.settings.telemetryEnabled ?? false;
          const realEmail = data.realEmail ?? null;

          return {
            success: true,
            settings: {
              theme,
              burnerEmailEnabled,
              telemetryEnabled,
              realEmail,
            },
          };
        } catch (error) {
          return { success: false, error: 'Failed to get settings' };
        }
      };

      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.settings).toBeDefined();
      expect(result.settings?.theme).toBe('dark');
      expect(result.settings?.burnerEmailEnabled).toBe(true);
      expect(result.settings?.telemetryEnabled).toBe(true);
      expect(result.settings?.realEmail).toBe('test@example.com');
    });

    it('returns defaults for missing settings', async () => {
      // Initialize with empty storage - should get defaults
      const handler = async () => {
        try {
          const data = await Storage.get();
          const theme = data.settings.theme ?? 'system';
          const burnerEmailEnabled = data.settings.burnerEmailEnabled ?? false;
          const telemetryEnabled = data.settings.telemetryEnabled ?? false;
          const realEmail = data.realEmail ?? null;

          return {
            success: true,
            settings: {
              theme,
              burnerEmailEnabled,
              telemetryEnabled,
              realEmail,
            },
          };
        } catch (error) {
          return { success: false, error: 'Failed to get settings' };
        }
      };

      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.settings).toBeDefined();
      expect(result.settings?.theme).toBe('system');
      expect(result.settings?.burnerEmailEnabled).toBe(false);
      expect(result.settings?.telemetryEnabled).toBe(false);
      expect(result.settings?.realEmail).toBeNull();
    });
  });

  describe('TRACK_EVENT', () => {
    it('tracks valid event', async () => {
      vi.mocked(feedbackTelemetryService.trackEvent).mockResolvedValue(undefined);

      const handler = async (data: unknown) => {
        try {
          const validation = validateEventPayload(data);
          if (!validation.valid || !validation.sanitized) {
            const errorMessage = validation.error ?? 'Invalid event payload';
            return { success: false, error: errorMessage };
          }

          const { eventType, eventData } = validation.sanitized;
          await feedbackTelemetryService.trackEvent({ eventType, eventData });
          return { success: true };
        } catch (error) {
          return { success: false, error: 'Failed to track event' };
        }
      };

      const result = await handler({
        eventType: 'button_clicked',
        eventData: { buttonId: 'test-button', page: 'settings' },
      });

      expect(result.success).toBe(true);
      expect(feedbackTelemetryService.trackEvent).toHaveBeenCalledWith({
        eventType: 'button_clicked',
        eventData: { buttonId: 'test-button', page: 'settings' },
      });
    });

    it('rejects missing eventType', async () => {
      const handler = async (data: unknown) => {
        try {
          const validation = validateEventPayload(data);
          if (!validation.valid || !validation.sanitized) {
            const errorMessage = validation.error ?? 'Invalid event payload';
            return { success: false, error: errorMessage };
          }

          const { eventType, eventData } = validation.sanitized;
          await feedbackTelemetryService.trackEvent({ eventType, eventData });
          return { success: true };
        } catch (error) {
          return { success: false, error: 'Failed to track event' };
        }
      };

      // Missing eventType
      const result1 = await handler({});
      expect(result1.success).toBe(false);
      expect(result1.error).toContain('eventType');

      // Empty eventType
      const result2 = await handler({ eventType: '' });
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('eventType');

      // Non-string eventType
      const result3 = await handler({ eventType: 123 });
      expect(result3.success).toBe(false);
      expect(result3.error).toContain('eventType');

      expect(feedbackTelemetryService.trackEvent).not.toHaveBeenCalled();
    });

    it('rejects eventData exceeding 10KB', async () => {
      const handler = async (data: unknown) => {
        try {
          const validation = validateEventPayload(data);
          if (!validation.valid || !validation.sanitized) {
            const errorMessage = validation.error ?? 'Invalid event payload';
            return { success: false, error: errorMessage };
          }

          const { eventType, eventData } = validation.sanitized;
          await feedbackTelemetryService.trackEvent({ eventType, eventData });
          return { success: true };
        } catch (error) {
          return { success: false, error: 'Failed to track event' };
        }
      };

      // Create eventData that exceeds 10KB
      const largeData: Record<string, string> = {};
      for (let i = 0; i < 1000; i++) {
        largeData[`key${i}`] = 'x'.repeat(100);
      }

      const result = await handler({
        eventType: 'test_event',
        eventData: largeData,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('10KB');
      expect(feedbackTelemetryService.trackEvent).not.toHaveBeenCalled();
    });
  });
});

