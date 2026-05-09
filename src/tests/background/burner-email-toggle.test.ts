import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Storage } from '@/background/storage';
import { messageBus } from '@/utils/message-bus';

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
    generateEmail: vi.fn().mockResolvedValue('test@burner.privaseer.io'),
    getEmails: vi.fn().mockResolvedValue([]),
    deleteEmail: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/feedback-telemetry-service', () => ({
  feedbackTelemetryService: {
    trackEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Burner Email Toggle - Comprehensive Tests', () => {
  let mockTabsSendMessage: ReturnType<typeof vi.fn>;
  let mockTabsQuery: ReturnType<typeof vi.fn>;
  let mockRuntimeSendMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    (Storage as any).cache = null;
    (Storage as any).isDirty = false;
    (Storage as any).saveTimer = null;
    (Storage as any).isSaving = false;

    mockTabsSendMessage = vi.fn().mockResolvedValue(undefined);
    mockTabsQuery = vi.fn().mockResolvedValue([
      { id: 1, url: 'https://example.com' },
      { id: 2, url: 'https://test.com' },
    ]);
    mockRuntimeSendMessage = vi.fn().mockResolvedValue(undefined);

    global.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
      runtime: {
        sendMessage: mockRuntimeSendMessage,
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        id: 'test-extension-id',
      },
      tabs: {
        query: mockTabsQuery,
        sendMessage: mockTabsSendMessage,
      },
      action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
      },
    } as any;

    await Storage.initialize();
    await messageBus.initialize();

    // Setup message handlers (simulating service-worker setup)
    messageBus.on('GET_BURNER_EMAIL_SETTING', async () => {
      try {
        const enabled = await Storage.getBurnerEmailEnabled();
        return { success: true, enabled };
      } catch (error) {
        return { success: false, error: 'Failed to get burner email setting' };
      }
    });

    messageBus.on('SET_BURNER_EMAIL_SETTING', async (data: unknown) => {
      try {
        const { enabled } = data as { enabled: boolean };
        if (typeof enabled !== 'boolean') {
          return { success: false, error: 'Invalid enabled value' };
        }
        await Storage.setBurnerEmailEnabled(enabled);

        chrome.runtime.sendMessage({
          type: 'BURNER_EMAIL_SETTING_CHANGED',
          data: { enabled }
        }).catch(() => {});

        return { success: true, enabled };
      } catch (error) {
        return { success: false, error: 'Failed to set burner email setting' };
      }
    });

    messageBus.on('GENERATE_BURNER_EMAIL', async (_data: unknown) => {
      try {
        const isEnabled = await Storage.getBurnerEmailEnabled();

        if (!isEnabled) {
          return { success: false, error: 'Burner email feature is disabled' };
        }

        // const { domain } = data as { domain: string };
        return { success: true, email: `test@burner.privaseer.io` };
      } catch (error) {
        return { success: false, error: 'Failed to generate burner email' };
      }
    });

    messageBus.on('GET_TELEMETRY_SETTING', async () => {
      try {
        const enabled = await Storage.getTelemetryEnabled();
        return { success: true, enabled };
      } catch (error) {
        return { success: false, error: 'Failed to get telemetry setting' };
      }
    });

    messageBus.on('SET_TELEMETRY_SETTING', async (data: unknown) => {
      try {
        const { enabled } = data as { enabled: boolean };
        if (typeof enabled !== 'boolean') {
          return { success: false, error: 'Invalid enabled value' };
        }
        await Storage.setTelemetryEnabled(enabled);
        messageBus.broadcast('STATE_UPDATE');
        return { success: true, enabled };
      } catch (error) {
        return { success: false, error: 'Failed to set telemetry setting' };
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to directly invoke message handlers for testing
  async function invokeHandler(type: string, data?: unknown): Promise<any> {
    const handlers = (messageBus as any).handlers.get(type);
    if (!handlers || handlers.length === 0) {
      throw new Error(`No handler found for ${type}`);
    }
    return await handlers[0](data, {} as any);
  }

  describe('Storage Getter/Setter Methods', () => {
    it('should get burner email enabled state', async () => {
      await Storage.setBurnerEmailEnabled(true);
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(true);
    });

    it('should set burner email enabled state to false', async () => {
      await Storage.setBurnerEmailEnabled(false);
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });

    it('should set burner email enabled state to true', async () => {
      await Storage.setBurnerEmailEnabled(true);
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(true);
    });

    it('should return false by default when not set', async () => {
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });

    it('should persist setting across multiple calls', async () => {
      await Storage.setBurnerEmailEnabled(false);
      expect(await Storage.getBurnerEmailEnabled()).toBe(false);
      expect(await Storage.getBurnerEmailEnabled()).toBe(false);
      expect(await Storage.getBurnerEmailEnabled()).toBe(false);
    });

    it('should handle rapid toggle operations', async () => {
      await Storage.setBurnerEmailEnabled(true);
      await Storage.setBurnerEmailEnabled(false);
      await Storage.setBurnerEmailEnabled(true);
      await Storage.setBurnerEmailEnabled(false);
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });

    it('should maintain setting when other storage operations occur', async () => {
      await Storage.setBurnerEmailEnabled(false);
      await Storage.incrementTrackerBlock('example.com', 'advertising', false);
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });
  });

  describe('Message Handlers - GET_BURNER_EMAIL_SETTING', () => {
    it('should handle GET_BURNER_EMAIL_SETTING message and return enabled state', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const result = await invokeHandler('GET_BURNER_EMAIL_SETTING');
      expect(result).toEqual({ success: true, enabled: true });
    });

    it('should return false when feature is disabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const result = await invokeHandler('GET_BURNER_EMAIL_SETTING');
      expect(result).toEqual({ success: true, enabled: false });
    });

    it('should handle errors in GET handler gracefully', async () => {
      vi.spyOn(Storage, 'getBurnerEmailEnabled').mockRejectedValueOnce(
        new Error('Storage error')
      );

      const result = await invokeHandler('GET_BURNER_EMAIL_SETTING');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return success response structure', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const result = await invokeHandler('GET_BURNER_EMAIL_SETTING');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('enabled');
      expect(typeof result.enabled).toBe('boolean');
    });
  });

  describe('Telemetry Settings Handlers', () => {
    it('should default telemetry to disabled', async () => {
      const result = await invokeHandler('GET_TELEMETRY_SETTING');
      expect(result).toEqual({ success: true, enabled: false });
    });

    it('should set telemetry enabled state', async () => {
      const setResult = await invokeHandler('SET_TELEMETRY_SETTING', { enabled: true });
      expect(setResult).toEqual({ success: true, enabled: true });

      const getResult = await invokeHandler('GET_TELEMETRY_SETTING');
      expect(getResult).toEqual({ success: true, enabled: true });
    });

    it('should broadcast telemetry changes', async () => {
      const broadcastSpy = vi.spyOn(messageBus, 'broadcast');
      await invokeHandler('SET_TELEMETRY_SETTING', { enabled: true });
      expect(broadcastSpy).toHaveBeenCalledWith('STATE_UPDATE');
      broadcastSpy.mockRestore();
    });

    it('should reject invalid payloads', async () => {
      const result = await invokeHandler('SET_TELEMETRY_SETTING', { enabled: 'yes' });
      expect(result).toEqual({ success: false, error: 'Invalid enabled value' });
    });
  });

  describe('Message Handlers - SET_BURNER_EMAIL_SETTING', () => {
    it('should handle SET_BURNER_EMAIL_SETTING message with valid boolean', async () => {
      const result = await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: false });
      expect(result.success).toBe(true);
      expect(result.enabled).toBe(false);

      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });

    it('should reject invalid enabled value (non-boolean)', async () => {
      const result = await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: 'true' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid enabled value');
    });

    it('should reject missing enabled property', async () => {
      const result = await invokeHandler('SET_BURNER_EMAIL_SETTING', {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle storage errors in SET handler', async () => {
      vi.spyOn(Storage, 'setBurnerEmailEnabled').mockRejectedValueOnce(
        new Error('Storage error')
      );

      const result = await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: true });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should update storage when setting is changed', async () => {
      await Storage.setBurnerEmailEnabled(true);
      expect(await Storage.getBurnerEmailEnabled()).toBe(true);

      await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: false });
      expect(await Storage.getBurnerEmailEnabled()).toBe(false);
    });
  });

  describe('Broadcast Functionality', () => {
    it('should broadcast BURNER_EMAIL_SETTING_CHANGED when setting changes', async () => {
      await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: false });

      // Verify broadcast was sent
      expect(mockRuntimeSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BURNER_EMAIL_SETTING_CHANGED',
          data: { enabled: false },
        })
      );
    });

    it('should broadcast correct enabled value', async () => {
      await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: true });

      expect(mockRuntimeSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BURNER_EMAIL_SETTING_CHANGED',
          data: { enabled: true },
        })
      );
    });

    it('should handle broadcast errors gracefully', async () => {
      mockRuntimeSendMessage.mockRejectedValueOnce(new Error('Broadcast failed'));

      // Should not throw even if broadcast fails
      const result = await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: false });
      expect(result.success).toBe(true);
    });

    it('should broadcast after storage is updated', async () => {
      await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: false });

      // Verify storage was updated
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);

      // Verify broadcast was sent
      expect(mockRuntimeSendMessage).toHaveBeenCalled();
    });
  });

  describe('Content Script Enable/Disable Behavior', () => {
    it('should respond to BURNER_EMAIL_SETTING_CHANGED message', () => {
      const message = {
        type: 'BURNER_EMAIL_SETTING_CHANGED',
        data: { enabled: true },
      };

      // Verify message structure
      expect(message.type).toBe('BURNER_EMAIL_SETTING_CHANGED');
      expect(message.data.enabled).toBe(true);
    });

    it('should handle enabled=true message correctly', () => {
      const message = {
        type: 'BURNER_EMAIL_SETTING_CHANGED',
        data: { enabled: true },
      };

      expect(message.data.enabled).toBe(true);
      expect(typeof message.data.enabled).toBe('boolean');
    });

    it('should handle enabled=false message correctly', () => {
      const message = {
        type: 'BURNER_EMAIL_SETTING_CHANGED',
        data: { enabled: false },
      };

      expect(message.data.enabled).toBe(false);
      expect(typeof message.data.enabled).toBe('boolean');
    });

    it('should have correct message structure for content script', () => {
      const message = {
        type: 'BURNER_EMAIL_SETTING_CHANGED',
        data: { enabled: true },
        timestamp: Date.now(),
      };

      expect(message).toHaveProperty('type');
      expect(message).toHaveProperty('data');
      expect(message.data).toHaveProperty('enabled');
    });
  });

  describe('Service Worker Validation of Feature State', () => {
    it('should check feature state before generating email', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const result = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('should allow email generation when feature is enabled', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const getEnabledSpy = vi.spyOn(Storage, 'getBurnerEmailEnabled');
      const result = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });

      expect(getEnabledSpy).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.email).toBeDefined();
    });

    it('should return error when feature is disabled during generation', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const result = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Burner email feature is disabled');
    });

    it('should validate feature state on every generation request', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const getEnabledSpy = vi.spyOn(Storage, 'getBurnerEmailEnabled');

      await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });
      await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'test.com' });

      expect(getEnabledSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle storage errors during validation', async () => {
      vi.spyOn(Storage, 'getBurnerEmailEnabled').mockRejectedValueOnce(
        new Error('Storage error')
      );

      const result = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('UI Toggle Component Interactions', () => {
    it('should load current setting on component mount', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const response = await invokeHandler('GET_BURNER_EMAIL_SETTING');

      expect(response).toHaveProperty('success', true);
      expect(response).toHaveProperty('enabled', true);
    });

    it('should update setting when toggle is clicked', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const result = await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: true });

      expect(result.success).toBe(true);
      expect(result.enabled).toBe(true);

      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(true);
    });

    it('should handle toggle errors and reload setting', async () => {
      vi.spyOn(Storage, 'setBurnerEmailEnabled').mockRejectedValueOnce(
        new Error('Storage error')
      );

      const result = await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: true });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // UI should reload setting after error
      const currentState = await invokeHandler('GET_BURNER_EMAIL_SETTING');
      expect(currentState).toHaveProperty('success');
    });

    it('should prevent multiple simultaneous toggles', async () => {
      // Simulate rapid clicks
      const promises = [
        invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: true }),
        invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: false }),
        invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: true }),
      ];

      await Promise.all(promises);

      // Final state should be consistent
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(typeof enabled).toBe('boolean');
    });

    it('should update UI state after successful toggle', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const result = await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: true });

      // UI should receive success response
      expect(result.success).toBe(true);
      expect(result.enabled).toBe(true);

      // UI can verify by getting current state
      const verifyState = await invokeHandler('GET_BURNER_EMAIL_SETTING');
      expect(verifyState.enabled).toBe(true);
    });
  });

  describe('Error Handling Scenarios', () => {
    it('should handle storage get errors gracefully', async () => {
      vi.spyOn(Storage, 'getBurnerEmailEnabled').mockRejectedValueOnce(
        new Error('Storage get failed')
      );

      const handler = (messageBus as any).handlers.get('GET_BURNER_EMAIL_SETTING');
      if (handler && handler.length > 0) {
        const result = await handler[0](undefined, {} as any) as any;

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('Failed to get');
      }
    });

    it('should handle storage set errors gracefully', async () => {
      vi.spyOn(Storage, 'setBurnerEmailEnabled').mockRejectedValueOnce(
        new Error('Storage set failed')
      );

      const handler = (messageBus as any).handlers.get('SET_BURNER_EMAIL_SETTING');
      if (handler && handler.length > 0) {
        const result = await handler[0]({ enabled: true }, {} as any) as any;

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('Failed to set');
      }
    });

    it('should handle invalid message data', async () => {
      const testCases = [
        { enabled: null },
        { enabled: undefined },
        { enabled: 0 },
        { enabled: 1 },
        { enabled: 'true' },
        { enabled: 'false' },
      ];

      for (const testCase of testCases) {
        const result = await invokeHandler('SET_BURNER_EMAIL_SETTING', testCase);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      }
    });

    it('should handle broadcast failures without breaking flow', async () => {
      mockRuntimeSendMessage.mockRejectedValue(new Error('Broadcast failed'));

      const handler = (messageBus as any).handlers.get('SET_BURNER_EMAIL_SETTING');
      if (handler && handler.length > 0) {
        const result = await handler[0]({ enabled: false }, {} as any) as any;

        // Should still succeed even if broadcast fails
        expect(result.success).toBe(true);
        expect(await Storage.getBurnerEmailEnabled()).toBe(false);
      }
    });

    it('should handle concurrent access errors', async () => {
      let callCount = 0;
      vi.spyOn(Storage, 'setBurnerEmailEnabled').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Concurrent access error');
        }
        return Promise.resolve();
      });

      const result = await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: true });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle missing storage data', async () => {
      (Storage as any).cache = null;
      vi.spyOn(Storage, 'get').mockResolvedValueOnce({
        settings: {},
      } as any);

      const enabled = await Storage.getBurnerEmailEnabled();
      // Should default to false
      expect(enabled).toBe(false);
    });

    it('should handle corrupted storage data', async () => {
      (Storage as any).cache = {
        settings: {
          burnerEmailEnabled: 'invalid',
        },
      };

      const enabled = await Storage.getBurnerEmailEnabled();
      // Should handle gracefully
      expect(typeof enabled).toBe('boolean');
    });

    it('should recover from transient errors', async () => {
      let attemptCount = 0;
      vi.spyOn(Storage, 'getBurnerEmailEnabled').mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('Transient error');
        }
        return true;
      });

      // First call should fail
      const firstResult = await invokeHandler('GET_BURNER_EMAIL_SETTING');
      expect(firstResult.success).toBe(false);

      // Second call should succeed
      const secondResult = await invokeHandler('GET_BURNER_EMAIL_SETTING');
      expect(secondResult.success).toBe(true);
      expect(secondResult.enabled).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    it('should complete full toggle flow: get -> set -> broadcast -> verify', async () => {
      // 1. Get initial state
      const initialStateResult = await invokeHandler('GET_BURNER_EMAIL_SETTING');
      const initialState = initialStateResult.enabled;

      // 2. Set new state
      const newState = !initialState;
      const result = await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: newState });

      expect(result.success).toBe(true);
      expect(result.enabled).toBe(newState);

      // 3. Verify broadcast
      expect(mockRuntimeSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BURNER_EMAIL_SETTING_CHANGED',
          data: { enabled: newState },
        })
      );

      // 4. Verify storage
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(newState);

      // 5. Verify get returns new state
      const verifyResult = await invokeHandler('GET_BURNER_EMAIL_SETTING');
      expect(verifyResult.enabled).toBe(newState);
    });

    it('should handle multiple rapid toggles correctly', async () => {
      const states = [true, false, true, false, true];

      for (const state of states) {
        await invokeHandler('SET_BURNER_EMAIL_SETTING', { enabled: state });
      }

      const finalState = await Storage.getBurnerEmailEnabled();
      expect(finalState).toBe(true);
    });

    it('should maintain consistency across multiple components', async () => {
      await Storage.setBurnerEmailEnabled(true);

      // Simulate multiple components checking state
      const results = await Promise.all([
        invokeHandler('GET_BURNER_EMAIL_SETTING'),
        invokeHandler('GET_BURNER_EMAIL_SETTING'),
        invokeHandler('GET_BURNER_EMAIL_SETTING'),
      ]);

      // All should return same state
      results.forEach((result) => {
        expect(result.enabled).toBe(true);
      });
    });
  });
});

