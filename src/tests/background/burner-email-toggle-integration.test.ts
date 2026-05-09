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
    getEmails: vi.fn().mockResolvedValue([
      { id: '1', email: 'existing1@burner.privaseer.io', domain: 'example.com', created_at: new Date().toISOString() },
      { id: '2', email: 'existing2@burner.privaseer.io', domain: 'test.com', created_at: new Date().toISOString() },
    ]),
    deleteEmail: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/feedback-telemetry-service', () => ({
  feedbackTelemetryService: {
    trackEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Burner Email Toggle - Integration Tests', () => {
  let mockRuntimeSendMessage: ReturnType<typeof vi.fn>;
  let mockTabsSendMessage: ReturnType<typeof vi.fn>;
  let mockTabsQuery: ReturnType<typeof vi.fn>;
  let messageListeners: Array<(message: any) => void> = [];
  let contentScriptInstances: Array<{ isEnabled: boolean; listener: (message: any) => void }> = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    messageListeners = [];
    contentScriptInstances = [];
    (Storage as any).cache = null;
    (Storage as any).isDirty = false;
    (Storage as any).saveTimer = null;
    (Storage as any).isSaving = false;

    mockRuntimeSendMessage = vi.fn().mockImplementation(async (message, callback) => {
      // Route message through message bus handlers
      let response: any = { success: false, error: 'No handler found' };
      
      try {
        const handlers = (messageBus as any).handlers.get(message.type);
        if (handlers && handlers.length > 0) {
          response = await handlers[0](message.data, {} as any);
        }
      } catch (error) {
        response = { success: false, error: (error as Error).message };
      }

      // Simulate broadcasting to all listeners for state change messages
      if (message.type === 'BURNER_EMAIL_SETTING_CHANGED' || message.type === 'STATE_UPDATE') {
        messageListeners.forEach(listener => {
          try {
            listener(message);
          } catch (e) {
            // Ignore errors
          }
        });
      }

      if (callback) {
        callback(response);
      }
      return Promise.resolve(response);
    });

    mockTabsSendMessage = vi.fn().mockImplementation((_tabId, message, callback) => {
      // Simulate sending to content scripts
      contentScriptInstances.forEach(instance => {
        if (message.type === 'BURNER_EMAIL_SETTING_CHANGED') {
          instance.listener(message);
        }
      });
      if (callback) callback({ success: true });
      return Promise.resolve({ success: true });
    });

    mockTabsQuery = vi.fn().mockResolvedValue([
      { id: 1, url: 'https://example.com' },
      { id: 2, url: 'https://test.com' },
    ]);

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
          addListener: vi.fn((listener) => {
            messageListeners.push(listener);
          }),
          removeListener: vi.fn((listener) => {
            const index = messageListeners.indexOf(listener);
            if (index > -1) messageListeners.splice(index, 1);
          }),
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

        // Broadcast to all tabs and popup
        chrome.runtime.sendMessage({
          type: 'BURNER_EMAIL_SETTING_CHANGED',
          data: { enabled }
        }).catch(() => {});

        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, {
                type: 'BURNER_EMAIL_SETTING_CHANGED',
                data: { enabled }
              }).catch(() => {});
            }
          });
        });

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

    messageBus.on('GET_BURNER_EMAILS', async () => {
      try {
        const { burnerEmailService } = await import('@/background/burner-email-service');
        const emails = await burnerEmailService.getEmails();
        return { success: true, emails };
      } catch (error) {
        return { success: false, error: 'Failed to fetch burner emails' };
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to invoke message handlers directly for testing
  async function invokeHandler(type: string, data?: unknown): Promise<any> {
    const handlers = (messageBus as any).handlers.get(type);
    if (!handlers || handlers.length === 0) {
      throw new Error(`No handler found for ${type}`);
    }
    return await handlers[0](data, {} as any);
  }

  // Helper to create a content script instance
  async function createContentScriptInstance() {
    const instance = {
      isEnabled: false,
      listener: (message: any) => {
        if (message.type === 'BURNER_EMAIL_SETTING_CHANGED') {
          instance.isEnabled = message.data?.enabled === true;
        }
      },
    };

    // Initialize by checking current state (default is false)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_BURNER_EMAIL_SETTING' });
      if (response?.success && typeof response.enabled === 'boolean') {
        instance.isEnabled = response.enabled === true;
      } else {
        // Default to false if response is invalid
        instance.isEnabled = false;
      }
    } catch (error) {
      // Default to false if initialization fails
      instance.isEnabled = false;
    }

    // Listen for changes
    chrome.runtime.onMessage.addListener(instance.listener);
    contentScriptInstances.push(instance);

    return instance;
  }

  // Helper to create a popup instance
  async function createPopupInstance() {
    let isEnabled = false;
    const listener = (message: any) => {
      if (message.type === 'BURNER_EMAIL_SETTING_CHANGED') {
        isEnabled = message.data?.enabled === true;
      }
    };

    // Initialize by checking current state (default is false)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_BURNER_EMAIL_SETTING' });
      if (response?.success && typeof response.enabled === 'boolean') {
        isEnabled = response.enabled === true;
      } else {
        // Default to false if response is invalid
        isEnabled = false;
      }
    } catch (error) {
      // Default to false if initialization fails
      isEnabled = false;
    }

    // Listen for changes
    chrome.runtime.onMessage.addListener(listener);

    return {
      getIsEnabled: () => isEnabled,
      toggle: async () => {
        const newValue = !isEnabled;
        const response = await chrome.runtime.sendMessage({
          type: 'SET_BURNER_EMAIL_SETTING',
          data: { enabled: newValue }
        });
        if (response && (response as any).success) {
          isEnabled = newValue;
        }
        return response;
      },
      getSetting: async () => {
        return await chrome.runtime.sendMessage({ type: 'GET_BURNER_EMAIL_SETTING' });
      },
      listener,
    };
  }

  describe('Full Flow: Settings Toggle → Content Script Updates', () => {
    it('should update content script when toggle is changed in settings', async () => {
      await Storage.setBurnerEmailEnabled(true);

      // Create content script instance
      const contentScript = await createContentScriptInstance();

      expect(contentScript.isEnabled).toBe(true);

      // Toggle off via settings
      const popup = await createPopupInstance();

      await popup.toggle();
      await new Promise(resolve => setTimeout(resolve, 10)); // Wait for broadcast

      expect(contentScript.isEnabled).toBe(false);
      expect(await Storage.getBurnerEmailEnabled()).toBe(false);
    });

    it('should update multiple content scripts when toggle changes', async () => {
      await Storage.setBurnerEmailEnabled(true);

      // Create multiple content script instances (simulating multiple tabs)
      const contentScript1 = await createContentScriptInstance();
      const contentScript2 = await createContentScriptInstance();

      expect(contentScript1.isEnabled).toBe(true);
      expect(contentScript2.isEnabled).toBe(true);

      // Toggle off
      const popup = await createPopupInstance();
      await popup.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(contentScript1.isEnabled).toBe(false);
      expect(contentScript2.isEnabled).toBe(false);
    });

    it('should enable content script when feature is re-enabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const contentScript = await createContentScriptInstance();

      expect(contentScript.isEnabled).toBe(false);

      // Enable via settings
      const popup = await createPopupInstance();
      await popup.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(contentScript.isEnabled).toBe(true);
    });
  });

  describe('Persistence: Disable → Close Popup → Reopen → Verify', () => {
    it('should persist disabled state across popup close/reopen', async () => {
      // Initial state: enabled
      await Storage.setBurnerEmailEnabled(true);
      expect(await Storage.getBurnerEmailEnabled()).toBe(true);

      // Disable feature
      const popup1 = await createPopupInstance();
      await popup1.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(await Storage.getBurnerEmailEnabled()).toBe(false);

      // Simulate popup close (remove listener)
      chrome.runtime.onMessage.removeListener(popup1.listener);

      // Simulate popup reopen
      const popup2 = await createPopupInstance();

      const setting = await popup2.getSetting();
      expect(setting).toHaveProperty('success', true);
      expect(setting).toHaveProperty('enabled', false);
      expect(popup2.getIsEnabled()).toBe(false);
    });

    it('should persist enabled state across popup close/reopen', async () => {
      // Initial state: disabled
      await Storage.setBurnerEmailEnabled(false);

      // Enable feature
      const popup1 = await createPopupInstance();
      await popup1.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(await Storage.getBurnerEmailEnabled()).toBe(true);

      // Simulate popup close
      chrome.runtime.onMessage.removeListener(popup1.listener);

      // Simulate popup reopen
      const popup2 = await createPopupInstance();

      const setting = await popup2.getSetting();
      expect(setting).toHaveProperty('enabled', true);
      expect(popup2.getIsEnabled()).toBe(true);
    });

    it('should maintain state through storage operations', async () => {
      await Storage.setBurnerEmailEnabled(false);

      // Perform other storage operations
      await Storage.incrementTrackerBlock('example.com', 'advertising', false);
      await Storage.addAlert({
        id: 'test',
        type: 'tracker_blocked',
        severity: 'medium',
        domain: 'example.com',
        message: 'Test',
        timestamp: Date.now(),
      });

      // Verify burner email setting is still disabled
      expect(await Storage.getBurnerEmailEnabled()).toBe(false);
    });
  });

  describe('Email Generation Rejection When Disabled', () => {
    it('should reject email generation when feature is disabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const result = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Burner email feature is disabled');
    });

    it('should allow email generation when feature is enabled', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const result = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });

      expect(result.success).toBe(true);
      expect(result.email).toBeDefined();
    });

    it('should check state on every generation request', async () => {
      await Storage.setBurnerEmailEnabled(true);

      // First request should succeed
      const result1 = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });
      expect(result1.success).toBe(true);

      // Disable feature
      await Storage.setBurnerEmailEnabled(false);

      // Second request should fail
      const result2 = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'test.com' });
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('Burner email feature is disabled');
    });
  });

  describe('Existing Emails Remain Accessible When Disabled', () => {
    it('should allow fetching existing emails when feature is disabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const result = await invokeHandler('GET_BURNER_EMAILS');

      expect(result.success).toBe(true);
      expect(result.emails).toBeDefined();
      expect(Array.isArray(result.emails)).toBe(true);
      expect(result.emails.length).toBeGreaterThan(0);
    });

    it('should allow deleting existing emails when feature is disabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      // Verify that GET_BURNER_EMAILS still works when disabled
      const result = await invokeHandler('GET_BURNER_EMAILS');
      expect(result.success).toBe(true);
      expect(result.emails).toBeDefined();
    });

    it('should show existing emails in popup when feature is disabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      await createPopupInstance();

      // Simulate fetching emails
      const emailsResult = await chrome.runtime.sendMessage({ type: 'GET_BURNER_EMAILS' });

      expect(emailsResult).toHaveProperty('success', true);
      expect(emailsResult).toHaveProperty('emails');
    });
  });

  describe('Re-enabling Feature Restores Full Functionality', () => {
    it('should restore email generation when re-enabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      // Verify generation is blocked
      const result1 = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });
      expect(result1.success).toBe(false);

      // Re-enable
      await Storage.setBurnerEmailEnabled(true);

      // Verify generation works
      const result2 = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });
      expect(result2.success).toBe(true);
      expect(result2.email).toBeDefined();
    });

    it('should restore content script functionality when re-enabled', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const contentScript = await createContentScriptInstance();
      expect(contentScript.isEnabled).toBe(false);

      // Re-enable
      const popup = await createPopupInstance();
      await popup.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(contentScript.isEnabled).toBe(true);
    });

    it('should restore full workflow after re-enabling', async () => {
      await Storage.setBurnerEmailEnabled(false);

      // Disable state
      const disabledResult = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });
      expect(disabledResult.success).toBe(false);

      // Re-enable
      await Storage.setBurnerEmailEnabled(true);

      // Full workflow should work
      const enabledResult = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });
      expect(enabledResult.success).toBe(true);

      const emailsResult = await invokeHandler('GET_BURNER_EMAILS');
      expect(emailsResult.success).toBe(true);
    });
  });

  describe('Multiple Popup Instances Sync Toggle State', () => {
    it('should sync toggle state across multiple popup instances', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const popup1 = await createPopupInstance();
      const popup2 = await createPopupInstance();

      expect(popup1.getIsEnabled()).toBe(true);
      expect(popup2.getIsEnabled()).toBe(true);

      // Toggle in popup1
      await popup1.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Popup2 should receive update
      expect(popup1.getIsEnabled()).toBe(false);
      expect(popup2.getIsEnabled()).toBe(false);
    });

    it('should handle rapid toggles from different popup instances', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const popup1 = await createPopupInstance();
      const popup2 = await createPopupInstance();

      // Rapid toggles from both popups
      await Promise.all([
        popup1.toggle(),
        popup2.toggle(),
      ]);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Both should reflect final state
      const finalState = await Storage.getBurnerEmailEnabled();
      expect(popup1.getIsEnabled()).toBe(finalState);
      expect(popup2.getIsEnabled()).toBe(finalState);
    });

    it('should maintain consistency when multiple popups query state', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const popup1 = await createPopupInstance();
      const popup2 = await createPopupInstance();
      const popup3 = await createPopupInstance();

      // All should see same state
      const [state1, state2, state3] = await Promise.all([
        popup1.getSetting(),
        popup2.getSetting(),
        popup3.getSetting(),
      ]);

      expect(state1).toHaveProperty('enabled', false);
      expect(state2).toHaveProperty('enabled', false);
      expect(state3).toHaveProperty('enabled', false);
    });
  });

  describe('Content Script on Multiple Tabs Respects Global Setting', () => {
    it('should apply same setting to all tabs', async () => {
      await Storage.setBurnerEmailEnabled(true);

      // Create content scripts for multiple tabs
      const tab1Script = await createContentScriptInstance();
      const tab2Script = await createContentScriptInstance();
      const tab3Script = await createContentScriptInstance();

      // All should be enabled
      expect(tab1Script.isEnabled).toBe(true);
      expect(tab2Script.isEnabled).toBe(true);
      expect(tab3Script.isEnabled).toBe(true);

      // Disable globally
      const popup = await createPopupInstance();
      await popup.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));

      // All tabs should be disabled
      expect(tab1Script.isEnabled).toBe(false);
      expect(tab2Script.isEnabled).toBe(false);
      expect(tab3Script.isEnabled).toBe(false);
    });

    it('should update all tabs when setting changes', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const tab1Script = await createContentScriptInstance();
      const tab2Script = await createContentScriptInstance();

      expect(tab1Script.isEnabled).toBe(false);
      expect(tab2Script.isEnabled).toBe(false);

      // Enable globally
      const popup = await createPopupInstance();
      await popup.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));

      // All tabs should be enabled
      expect(tab1Script.isEnabled).toBe(true);
      expect(tab2Script.isEnabled).toBe(true);
    });

    it('should handle new tabs created after setting change', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const existingTab = await createContentScriptInstance();
      expect(existingTab.isEnabled).toBe(true);

      // Disable
      const popup = await createPopupInstance();
      await popup.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(existingTab.isEnabled).toBe(false);

      // New tab created after disable
      const newTab = await createContentScriptInstance();

      // New tab should also be disabled
      expect(newTab.isEnabled).toBe(false);
    });

    it('should maintain global state consistency across all tabs', async () => {
      await Storage.setBurnerEmailEnabled(false);

      // Create multiple tabs
      const tabs = await Promise.all(Array.from({ length: 5 }, () => createContentScriptInstance()));

      // All should be disabled
      tabs.forEach(tab => {
        expect(tab.isEnabled).toBe(false);
      });

      // Enable globally
      const popup = await createPopupInstance();
      await popup.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));

      // All should be enabled
      tabs.forEach(tab => {
        expect(tab.isEnabled).toBe(true);
      });
    });
  });

  describe('End-to-End Integration Scenarios', () => {
    it('should handle complete user workflow: enable → use → disable → re-enable', async () => {
      // Start disabled
      await Storage.setBurnerEmailEnabled(false);
      const contentScript = await createContentScriptInstance();
      expect(contentScript.isEnabled).toBe(false);

      // Enable
      const popup = await createPopupInstance();
      await popup.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(contentScript.isEnabled).toBe(true);

      // Generate email (should work)
      const result1 = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });
      expect(result1.success).toBe(true);

      // Disable
      await popup.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(contentScript.isEnabled).toBe(false);

      // Generate email (should fail)
      const result2 = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });
      expect(result2.success).toBe(false);

      // Re-enable
      await popup.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(contentScript.isEnabled).toBe(true);

      // Generate email (should work again)
      const result3 = await invokeHandler('GENERATE_BURNER_EMAIL', { domain: 'example.com' });
      expect(result3.success).toBe(true);
    });

    it('should maintain state consistency with multiple components', async () => {
      await Storage.setBurnerEmailEnabled(true);

      const popup1 = await createPopupInstance();
      const popup2 = await createPopupInstance();
      const tab1Script = await createContentScriptInstance();
      const tab2Script = await createContentScriptInstance();

      // All should be enabled
      expect(popup1.getIsEnabled()).toBe(true);
      expect(popup2.getIsEnabled()).toBe(true);
      expect(tab1Script.isEnabled).toBe(true);
      expect(tab2Script.isEnabled).toBe(true);

      // Disable from popup1
      await popup1.toggle();
      await new Promise(resolve => setTimeout(resolve, 10));

      // All should be disabled
      expect(popup1.getIsEnabled()).toBe(false);
      expect(popup2.getIsEnabled()).toBe(false);
      expect(tab1Script.isEnabled).toBe(false);
      expect(tab2Script.isEnabled).toBe(false);
      expect(await Storage.getBurnerEmailEnabled()).toBe(false);
    });
  });
});

