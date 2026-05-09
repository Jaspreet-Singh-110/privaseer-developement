import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../popup/settings-page';

describe('Settings Page - Burner Email Toggle', () => {
  const originalChrome = global.chrome;
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockAddListener: ReturnType<typeof vi.fn>;
  let mockRemoveListener: ReturnType<typeof vi.fn>;
  let mockStorageGet: ReturnType<typeof vi.fn>;
  let mockStorageSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSendMessage = vi.fn();
    mockAddListener = vi.fn();
    mockRemoveListener = vi.fn();
    mockStorageGet = vi.fn().mockResolvedValue({});
    mockStorageSet = vi.fn().mockResolvedValue(undefined);

    // Mock Chrome APIs
    global.chrome = {
      runtime: {
        sendMessage: mockSendMessage,
        onMessage: {
          addListener: mockAddListener,
          removeListener: mockRemoveListener,
        },
      },
      storage: {
        local: {
          get: mockStorageGet,
          set: mockStorageSet,
        },
      },
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    vi.clearAllMocks();
    global.chrome = originalChrome;
  });

  it('should enable email input after toggling burner email ON', async () => {
    const user = userEvent.setup();
    
    // Mock initial state - burner email is disabled
    mockSendMessage.mockImplementation((message: { type: string }) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({ 
          success: true, 
          settings: {
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            protectionEnabled: true
          }
        });
      }
      if (message.type === 'GET_REAL_EMAIL') {
        return Promise.resolve({ success: true, email: '' });
      }
      if (message.type === 'GET_THEME') {
        return Promise.resolve({ success: true, theme: 'system' });
      }
      return Promise.resolve({ success: true });
    });

    const mockOnClose = vi.fn();
    const mockOnFeedbackSuccess = vi.fn();

    render(
      <SettingsPage
        isOpen={true}
        onClose={mockOnClose}
        currentTab={null}
        onFeedbackSuccess={mockOnFeedbackSuccess}
        deepLinkSection="burner-services"
      />
    );

    // Wait for initial load
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_ALL_SETTINGS' });
    });

    // Find the email input - it should be disabled initially
    const emailInput = screen.getByPlaceholderText('your.email@example.com') as HTMLInputElement;
    expect(emailInput.disabled).toBe(true);

    // Find and click the toggle button
    const toggleButton = screen.getByLabelText('Toggle burner email protection');
    
    // Mock the toggle response - burner email is now enabled
    mockSendMessage.mockImplementation((message: { type: string }) => {
      if (message.type === 'SET_BURNER_EMAIL_SETTING') {
        return Promise.resolve({ success: true, enabled: true });
      }
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({ 
          success: true, 
          settings: {
            burnerEmailEnabled: true,
            telemetryEnabled: false,
            protectionEnabled: true
          }
        });
      }
      if (message.type === 'GET_REAL_EMAIL') {
        return Promise.resolve({ success: true, email: '' });
      }
      if (message.type === 'GET_THEME') {
        return Promise.resolve({ success: true, theme: 'system' });
      }
      return Promise.resolve({ success: true });
    });

    await user.click(toggleButton);

    // Wait for the toggle operation to complete
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'SET_BURNER_EMAIL_SETTING',
        data: { enabled: true }
      });
    });

    // Wait for the state to reload
    await waitFor(() => {
      // The input should now be enabled
      expect(emailInput.disabled).toBe(false);
    }, { timeout: 3000 });

    // Verify we can type in the input
    await user.type(emailInput, 'test@example.com');
    expect(emailInput.value).toBe('test@example.com');
  });

  it('should disable email input when burner email is toggled OFF', async () => {
    const user = userEvent.setup();
    
    // Mock initial state - burner email is enabled
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({ 
          success: true, 
          settings: {
            burnerEmailEnabled: true,
            telemetryEnabled: false,
            protectionEnabled: true
          }
        });
      }
      if (message.type === 'GET_REAL_EMAIL') {
        return Promise.resolve({ success: true, email: 'test@example.com' });
      }
      if (message.type === 'GET_THEME') {
        return Promise.resolve({ success: true, theme: 'system' });
      }
      return Promise.resolve({ success: true });
    });

    const mockOnClose = vi.fn();
    const mockOnFeedbackSuccess = vi.fn();

    render(
      <SettingsPage
        isOpen={true}
        onClose={mockOnClose}
        currentTab={null}
        onFeedbackSuccess={mockOnFeedbackSuccess}
        deepLinkSection="burner-services"
      />
    );

    // Wait for initial load
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_ALL_SETTINGS' });
    });

    // Find the email input - it should be enabled initially
    const emailInput = screen.getByPlaceholderText('your.email@example.com') as HTMLInputElement;
    expect(emailInput.disabled).toBe(false);

    // Find and click the toggle button
    const toggleButton = screen.getByLabelText('Toggle burner email protection');
    
    // Mock the toggle response - burner email is now disabled
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'SET_BURNER_EMAIL_SETTING') {
        return Promise.resolve({ success: true, enabled: false });
      }
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({ 
          success: true, 
          settings: {
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            protectionEnabled: true
          }
        });
      }
      if (message.type === 'GET_REAL_EMAIL') {
        return Promise.resolve({ success: true, email: 'test@example.com' });
      }
      if (message.type === 'GET_THEME') {
        return Promise.resolve({ success: true, theme: 'system' });
      }
      return Promise.resolve({ success: true });
    });

    await user.click(toggleButton);

    // Wait for the toggle operation to complete
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'SET_BURNER_EMAIL_SETTING',
        data: { enabled: false }
      });
    });

    // Wait for the state to reload
    await waitFor(() => {
      // The input should now be disabled
      expect(emailInput.disabled).toBe(true);
    }, { timeout: 3000 });
  });

  it('should not have race conditions with multiple rapid toggles', async () => {
    const user = userEvent.setup();
    let currentEnabled = false;
    
    // Mock that tracks the current state
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'SET_BURNER_EMAIL_SETTING') {
        currentEnabled = (message.data as any).enabled;
        return Promise.resolve({ success: true, enabled: currentEnabled });
      }
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({ 
          success: true, 
          settings: {
            burnerEmailEnabled: currentEnabled,
            telemetryEnabled: false,
            protectionEnabled: true
          }
        });
      }
      if (message.type === 'GET_REAL_EMAIL') {
        return Promise.resolve({ success: true, email: '' });
      }
      if (message.type === 'GET_THEME') {
        return Promise.resolve({ success: true, theme: 'system' });
      }
      return Promise.resolve({ success: true });
    });

    const mockOnClose = vi.fn();
    const mockOnFeedbackSuccess = vi.fn();

    render(
      <SettingsPage
        isOpen={true}
        onClose={mockOnClose}
        currentTab={null}
        onFeedbackSuccess={mockOnFeedbackSuccess}
        deepLinkSection="burner-services"
      />
    );

    // Wait for initial load
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_ALL_SETTINGS' });
    });

    const toggleButton = screen.getByLabelText('Toggle burner email protection');
    const emailInput = screen.getByPlaceholderText('your.email@example.com') as HTMLInputElement;

    // Rapidly toggle multiple times
    await user.click(toggleButton); // OFF -> ON
    await waitFor(() => expect(emailInput.disabled).toBe(false));
    
    await user.click(toggleButton); // ON -> OFF
    await waitFor(() => expect(emailInput.disabled).toBe(true));
    
    await user.click(toggleButton); // OFF -> ON
    await waitFor(() => expect(emailInput.disabled).toBe(false));

    // Final state should match the last toggle
    expect(currentEnabled).toBe(true);
    expect(emailInput.disabled).toBe(false);
  });

  it('blocks toggle while a previous toggle is in progress', async () => {
    const user = userEvent.setup();
    let resolveToggle: ((value: unknown) => void) | null = null;

    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            protectionEnabled: true,
          },
        });
      }
      if (message.type === 'GET_REAL_EMAIL') {
        return Promise.resolve({ success: true, email: '' });
      }
      if (message.type === 'GET_THEME') {
        return Promise.resolve({ success: true, theme: 'system' });
      }
      if (message.type === 'SET_BURNER_EMAIL_SETTING') {
        return new Promise<unknown>((resolve) => {
          resolveToggle = resolve;
        });
      }
      return Promise.resolve({ success: true });
    });

    render(
      <SettingsPage
        isOpen={true}
        onClose={vi.fn()}
        currentTab={null}
        onFeedbackSuccess={vi.fn()}
        deepLinkSection="burner-services"
      />
    );

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_ALL_SETTINGS' });
    });

    const toggleButton = screen.getByLabelText('Toggle burner email protection');

    await user.click(toggleButton);
    await user.click(toggleButton);

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'SET_BURNER_EMAIL_SETTING',
      data: { enabled: true },
    });

    expect(
      mockSendMessage.mock.calls.filter(
        (call) => call[0]?.type === 'SET_BURNER_EMAIL_SETTING'
      )
    ).toHaveLength(1);

    if (resolveToggle) {
      (resolveToggle as (value: unknown) => void)({ success: true, enabled: true });
    }
  });
});
