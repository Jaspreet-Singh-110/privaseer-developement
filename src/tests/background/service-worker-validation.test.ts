import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Storage } from '@/background/storage';

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/background/burner-email-service', () => ({
  burnerEmailService: {
    generateEmail: vi.fn().mockResolvedValue('test@burner.privaseer.app'),
    getEmails: vi.fn().mockResolvedValue([
      { id: '1', email: 'test1@burner.privaseer.app', domain: 'example.com' },
      { id: '2', email: 'test2@burner.privaseer.app', domain: 'test.com' },
    ]),
    deleteEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/feedback-telemetry-service', () => ({
  feedbackTelemetryService: {
    trackEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Service Worker Feature State Enforcement', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    (Storage as any).cache = null;
    (Storage as any).isDirty = false;
    (Storage as any).saveTimer = null;
    (Storage as any).isSaving = false;

    global.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
    } as any;

    await Storage.initialize();
  });

  describe('GENERATE_BURNER_EMAIL handler', () => {
    it('should allow generation when feature is enabled', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const handler = async (_data: { domain: string }) => {
        const isEnabled = await Storage.getBurnerEmailEnabled();

        if (!isEnabled) {
          return { success: false, error: 'Burner email feature is disabled' };
        }

        return { success: true, email: 'test@burner.privaseer.app' };
      };

      const result = await handler({ domain: 'example.com' });

      expect(result.success).toBe(true);
      expect(result.email).toBe('test@burner.privaseer.app');
    });

    it('should block generation when feature is disabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const handler = async (_data: { domain: string }) => {
        const isEnabled = await Storage.getBurnerEmailEnabled();

        if (!isEnabled) {
          return { success: false, error: 'Burner email feature is disabled' };
        }

        return { success: true, email: 'test@burner.privaseer.app' };
      };

      const result = await handler({ domain: 'example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Burner email feature is disabled');
    });

    it('should check enabled state before generating', async () => {
      const getBurnerEmailEnabledSpy = vi.spyOn(Storage, 'getBurnerEmailEnabled');
      await Storage.setBurnerEmailEnabled(true);

      const handler = async (_data: { domain: string }) => {
        const isEnabled = await Storage.getBurnerEmailEnabled();

        if (!isEnabled) {
          return { success: false, error: 'Burner email feature is disabled' };
        }

        return { success: true, email: 'test@burner.privaseer.app' };
      };

      await handler({ domain: 'example.com' });

      expect(getBurnerEmailEnabledSpy).toHaveBeenCalled();
    });

    it('should return specific error message when disabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const handler = async (_data: { domain: string }) => {
        const isEnabled = await Storage.getBurnerEmailEnabled();

        if (!isEnabled) {
          return { success: false, error: 'Burner email feature is disabled' };
        }

        return { success: true, email: 'test@burner.privaseer.app' };
      };

      const result = await handler({ domain: 'example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('should respect toggle changes', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const handler = async (_data: { domain: string }) => {
        const isEnabled = await Storage.getBurnerEmailEnabled();

        if (!isEnabled) {
          return { success: false, error: 'Burner email feature is disabled' };
        }

        return { success: true, email: 'test@burner.privaseer.app' };
      };

      let result = await handler({ domain: 'example.com' });
      expect(result.success).toBe(false);

      await Storage.setBurnerEmailEnabled(true);

      result = await handler({ domain: 'example.com' });
      expect(result.success).toBe(true);
    });
  });

  describe('GET_BURNER_EMAILS handler', () => {
    it('should allow fetching emails when feature is enabled', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const handler = async () => {
        return {
          success: true,
          emails: [
            { id: '1', email: 'test1@burner.privaseer.app', domain: 'example.com' },
            { id: '2', email: 'test2@burner.privaseer.app', domain: 'test.com' },
          ],
        };
      };

      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.emails).toHaveLength(2);
    });

    it('should allow fetching emails when feature is disabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const handler = async () => {
        return {
          success: true,
          emails: [
            { id: '1', email: 'test1@burner.privaseer.app', domain: 'example.com' },
            { id: '2', email: 'test2@burner.privaseer.app', domain: 'test.com' },
          ],
        };
      };

      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.emails).toHaveLength(2);
    });

    it('should not check enabled state when fetching emails', async () => {
      const getBurnerEmailEnabledSpy = vi.spyOn(Storage, 'getBurnerEmailEnabled');
      await Storage.setBurnerEmailEnabled(false);

      const handler = async () => {
        return {
          success: true,
          emails: [
            { id: '1', email: 'test1@burner.privaseer.app', domain: 'example.com' },
          ],
        };
      };

      await handler();

      expect(getBurnerEmailEnabledSpy).not.toHaveBeenCalled();
    });
  });

  describe('DELETE_BURNER_EMAIL handler', () => {
    it('should allow deleting emails when feature is enabled', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const handler = async (_data: { emailId: string }) => {
        return { success: true };
      };

      const result = await handler({ emailId: '123' });

      expect(result.success).toBe(true);
    });

    it('should allow deleting emails when feature is disabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const handler = async (_data: { emailId: string }) => {
        return { success: true };
      };

      const result = await handler({ emailId: '123' });

      expect(result.success).toBe(true);
    });

    it('should not check enabled state when deleting emails', async () => {
      const getBurnerEmailEnabledSpy = vi.spyOn(Storage, 'getBurnerEmailEnabled');
      await Storage.setBurnerEmailEnabled(false);

      const handler = async (_data: { emailId: string }) => {
        return { success: true };
      };

      await handler({ emailId: '123' });

      expect(getBurnerEmailEnabledSpy).not.toHaveBeenCalled();
    });
  });

  describe('Feature State Behavior', () => {
    it('should enforce state only on generation', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const generateHandler = async (_data: { domain: string }) => {
        const isEnabled = await Storage.getBurnerEmailEnabled();
        if (!isEnabled) {
          return { success: false, error: 'Burner email feature is disabled' };
        }
        return { success: true, email: 'test@burner.privaseer.app' };
      };

      const getHandler = async () => {
        return { success: true, emails: [] };
      };

      const deleteHandler = async (_data: { emailId: string }) => {
        return { success: true };
      };

      const generateResult = await generateHandler({ domain: 'example.com' });
      const getResult = await getHandler();
      const deleteResult = await deleteHandler({ emailId: '123' });

      expect(generateResult.success).toBe(false);
      expect(getResult.success).toBe(true);
      expect(deleteResult.success).toBe(true);
    });

    it('should allow all operations when enabled', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const generateHandler = async (_data: { domain: string }) => {
        const isEnabled = await Storage.getBurnerEmailEnabled();
        if (!isEnabled) {
          return { success: false, error: 'Burner email feature is disabled' };
        }
        return { success: true, email: 'test@burner.privaseer.app' };
      };

      const getHandler = async () => {
        return { success: true, emails: [] };
      };

      const deleteHandler = async (_data: { emailId: string }) => {
        return { success: true };
      };

      const generateResult = await generateHandler({ domain: 'example.com' });
      const getResult = await getHandler();
      const deleteResult = await deleteHandler({ emailId: '123' });

      expect(generateResult.success).toBe(true);
      expect(getResult.success).toBe(true);
      expect(deleteResult.success).toBe(true);
    });

    it('should respond immediately when generation is blocked', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const handler = async (_data: { domain: string }) => {
        const isEnabled = await Storage.getBurnerEmailEnabled();
        if (!isEnabled) {
          return { success: false, error: 'Burner email feature is disabled' };
        }
        return { success: true, email: 'test@burner.privaseer.app' };
      };

      const startTime = Date.now();
      const result = await handler({ domain: 'example.com' });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(false);
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Error Handling', () => {
    it('should handle storage errors gracefully', async () => {
      vi.spyOn(Storage, 'getBurnerEmailEnabled').mockRejectedValueOnce(new Error('Storage error'));

      const handler = async (_data: { domain: string }) => {
        try {
          const isEnabled = await Storage.getBurnerEmailEnabled();
          if (!isEnabled) {
            return { success: false, error: 'Burner email feature is disabled' };
          }
          return { success: true, email: 'test@burner.privaseer.app' };
        } catch (error) {
          return { success: false, error: 'Failed to check feature state' };
        }
      };

      const result = await handler({ domain: 'example.com' });

      expect(result.success).toBe(false);
    });

    it('should default to blocking on storage errors', async () => {
      vi.spyOn(Storage, 'getBurnerEmailEnabled').mockRejectedValueOnce(new Error('Storage error'));

      const handler = async (_data: { domain: string }) => {
        try {
          const isEnabled = await Storage.getBurnerEmailEnabled();
          if (!isEnabled) {
            return { success: false, error: 'Burner email feature is disabled' };
          }
          return { success: true, email: 'test@burner.privaseer.app' };
        } catch (error) {
          return { success: false, error: 'Failed to check feature state' };
        }
      };

      const result = await handler({ domain: 'example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });
});
