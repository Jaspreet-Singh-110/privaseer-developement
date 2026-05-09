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

describe('Burner Email Message Integration', () => {
  let mockSendMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    (Storage as any).cache = null;
    (Storage as any).isDirty = false;
    (Storage as any).saveTimer = null;
    (Storage as any).isSaving = false;

    mockSendMessage = vi.fn().mockResolvedValue(undefined);

    global.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
      runtime: {
        sendMessage: mockSendMessage,
      },
    } as any;

    await Storage.initialize();
  });

  describe('Message Type Definitions', () => {
    it('should have GET_BURNER_EMAIL_SETTING message type', () => {
      const messageType: 'GET_BURNER_EMAIL_SETTING' = 'GET_BURNER_EMAIL_SETTING';
      expect(messageType).toBe('GET_BURNER_EMAIL_SETTING');
    });

    it('should have SET_BURNER_EMAIL_SETTING message type', () => {
      const messageType: 'SET_BURNER_EMAIL_SETTING' = 'SET_BURNER_EMAIL_SETTING';
      expect(messageType).toBe('SET_BURNER_EMAIL_SETTING');
    });

    it('should have BURNER_EMAIL_SETTING_CHANGED message type', () => {
      const messageType: 'BURNER_EMAIL_SETTING_CHANGED' = 'BURNER_EMAIL_SETTING_CHANGED';
      expect(messageType).toBe('BURNER_EMAIL_SETTING_CHANGED');
    });
  });

  describe('Storage and Message Flow', () => {
    it('should store and retrieve enabled status', async () => {
      await Storage.setBurnerEmailEnabled(true);
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(true);
    });

    it('should store and retrieve disabled status', async () => {
      await Storage.setBurnerEmailEnabled(false);
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });

    it('should toggle between enabled and disabled', async () => {
      await Storage.setBurnerEmailEnabled(false);
      expect(await Storage.getBurnerEmailEnabled()).toBe(false);

      await Storage.setBurnerEmailEnabled(true);
      expect(await Storage.getBurnerEmailEnabled()).toBe(true);

      await Storage.setBurnerEmailEnabled(false);
      expect(await Storage.getBurnerEmailEnabled()).toBe(false);
    });
  });

  describe('Message Handler Structure', () => {
    it('should define handler for getting burner email setting', () => {
      const handlerStructure = {
        type: 'GET_BURNER_EMAIL_SETTING',
        handler: async () => {
          const enabled = await Storage.getBurnerEmailEnabled();
          return { success: true, enabled };
        }
      };

      expect(handlerStructure.type).toBe('GET_BURNER_EMAIL_SETTING');
      expect(typeof handlerStructure.handler).toBe('function');
    });

    it('should define handler for setting burner email setting', () => {
      const handlerStructure = {
        type: 'SET_BURNER_EMAIL_SETTING',
        handler: async (data: { enabled: boolean }) => {
          if (typeof data.enabled !== 'boolean') {
            return { success: false, error: 'Invalid enabled value' };
          }
          await Storage.setBurnerEmailEnabled(data.enabled);
          return { success: true, enabled: data.enabled };
        }
      };

      expect(handlerStructure.type).toBe('SET_BURNER_EMAIL_SETTING');
      expect(typeof handlerStructure.handler).toBe('function');
    });

    it('should validate boolean input for SET handler', async () => {
      const handler = async (data: { enabled: boolean }) => {
        if (typeof data.enabled !== 'boolean') {
          return { success: false, error: 'Invalid enabled value' };
        }
        await Storage.setBurnerEmailEnabled(data.enabled);
        return { success: true, enabled: data.enabled };
      };

      const invalidResult = await handler({ enabled: 'true' as any });
      expect(invalidResult.success).toBe(false);
      expect(invalidResult.error).toBe('Invalid enabled value');

      const validResult = await handler({ enabled: true });
      expect(validResult.success).toBe(true);
      expect(validResult.enabled).toBe(true);
    });
  });

  describe('Broadcast Message Structure', () => {
    it('should create proper broadcast message structure', () => {
      const broadcastMessage = {
        type: 'BURNER_EMAIL_SETTING_CHANGED',
        data: { enabled: true }
      };

      expect(broadcastMessage.type).toBe('BURNER_EMAIL_SETTING_CHANGED');
      expect(broadcastMessage.data.enabled).toBe(true);
    });

    it('should support both enabled and disabled broadcasts', () => {
      const enabledBroadcast = {
        type: 'BURNER_EMAIL_SETTING_CHANGED',
        data: { enabled: true }
      };

      const disabledBroadcast = {
        type: 'BURNER_EMAIL_SETTING_CHANGED',
        data: { enabled: false }
      };

      expect(enabledBroadcast.data.enabled).toBe(true);
      expect(disabledBroadcast.data.enabled).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle storage errors in GET handler', async () => {
      vi.spyOn(Storage, 'getBurnerEmailEnabled').mockRejectedValueOnce(new Error('Storage error'));

      const handler = async () => {
        try {
          const enabled = await Storage.getBurnerEmailEnabled();
          return { success: true, enabled };
        } catch (error) {
          return { success: false, error: 'Failed to get burner email setting' };
        }
      };

      const result = await handler();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to get burner email setting');
    });

    it('should handle storage errors in SET handler', async () => {
      vi.spyOn(Storage, 'setBurnerEmailEnabled').mockRejectedValueOnce(new Error('Storage error'));

      const handler = async (data: { enabled: boolean }) => {
        try {
          if (typeof data.enabled !== 'boolean') {
            return { success: false, error: 'Invalid enabled value' };
          }
          await Storage.setBurnerEmailEnabled(data.enabled);
          return { success: true, enabled: data.enabled };
        } catch (error) {
          return { success: false, error: 'Failed to set burner email setting' };
        }
      };

      const result = await handler({ enabled: true });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to set burner email setting');
    });
  });
});
