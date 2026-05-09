/**
 * @file src/tests/popup/settings-page.test.tsx
 *
 * Test Type: Component
 * Contexts Tested: Settings modal UI
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '@/popup/settings-page';
import { logger } from '@/utils/logger';

const updateThemePreferenceMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/theme-manager', () => ({
  ThemeManager: {
    updatePreference: updateThemePreferenceMock,
  },
}));

describe('SettingsPage', () => {
  const originalChrome = global.chrome;
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockAddListener: ReturnType<typeof vi.fn>;
  let mockRemoveListener: ReturnType<typeof vi.fn>;

  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    currentTab: { url: 'https://example.com' } as chrome.tabs.Tab,
    onFeedbackSuccess: vi.fn(),
  };

  beforeEach(() => {
    mockSendMessage = vi.fn();
    mockAddListener = vi.fn();
    mockRemoveListener = vi.fn();

    global.chrome = {
      runtime: {
        sendMessage: mockSendMessage,
        onMessage: {
          addListener: mockAddListener,
          removeListener: mockRemoveListener,
        },
      },
    } as unknown as typeof chrome;

    mockSendMessage.mockImplementation((message: { type: string }) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      return Promise.resolve({ success: true });
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    global.chrome = originalChrome;
    vi.useRealTimers();
  });

  it('navigates between menu, theme, and back', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPage {...baseProps} />);

    await screen.findByText('Settings');

    await user.click(await screen.findByRole('button', { name: /theme/i }));

    await waitFor(() => {
      expect(screen.getByText('Theme')).toBeInTheDocument();
    }, { timeout: 2000 });

    await user.click(await screen.findByLabelText(/back to menu/i));

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it('submits feedback with domain info', async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    const onFeedbackSuccess = vi.fn();

    render(<SettingsPage {...baseProps} onClose={onClose} onFeedbackSuccess={onFeedbackSuccess} />);

    await user.click(screen.getByRole('button', { name: /feedback/i }));

    const textarea = await screen.findByPlaceholderText(/type your feedback here/i);
    const submitButton = screen.getByRole('button', { name: /submit feedback/i });

    expect(submitButton).toBeDisabled();

    await user.type(textarea, 'Great extension!');
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'SUBMIT_FEEDBACK',
        data: {
          feedbackText: 'Great extension!',
          url: 'https://example.com/',
          domain: 'example.com',
        },
      });
      expect(onFeedbackSuccess).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('sends theme updates when selecting a theme', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPage {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /theme/i }));

    const darkButton = await screen.findByRole('button', { name: /dark/i });
    await user.click(darkButton);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'SET_THEME',
        data: { theme: 'dark' },
      });
      expect(darkButton.className).toContain('border-blue-500');
    });
  });

  it('toggles telemetry and sends setting update', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPage {...baseProps} deepLinkSection="telemetry" />);

    await waitFor(() => {
      expect(screen.getByText('Telemetry & Improvements')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText(/toggle telemetry collection/i));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'SET_TELEMETRY_SETTING',
        data: { enabled: true },
      });
    });
  });

  it('keeps feedback modal open and resets submitting state when API returns failure', async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    const onFeedbackSuccess = vi.fn();
    const loggerErrorSpy = vi.spyOn(logger, 'error');

    mockSendMessage.mockImplementation((message: { type: string }) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      if (message.type === 'SUBMIT_FEEDBACK') {
        return Promise.resolve({ success: false, error: 'feedback failed' });
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage {...baseProps} onClose={onClose} onFeedbackSuccess={onFeedbackSuccess} />);

    await user.click(screen.getByRole('button', { name: /feedback/i }));
    const textarea = await screen.findByPlaceholderText(/type your feedback here/i);
    await user.type(textarea, 'Please fix this issue');
    await user.click(screen.getByRole('button', { name: /submit feedback/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'SUBMIT_FEEDBACK',
        data: {
          feedbackText: 'Please fix this issue',
          url: 'https://example.com/',
          domain: 'example.com',
        },
      });
      expect(screen.getByRole('button', { name: /submit feedback/i })).toBeEnabled();
    });

    expect(textarea).toHaveValue('Please fix this issue');
    expect(onClose).not.toHaveBeenCalled();
    expect(onFeedbackSuccess).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(screen.getByText('Feedback')).toBeInTheDocument();
  });

  it('handles feedback submission exceptions and uses unknown domain for invalid tab URL', async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    const onFeedbackSuccess = vi.fn();
    const loggerErrorSpy = vi.spyOn(logger, 'error');

    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      if (message.type === 'SUBMIT_FEEDBACK') {
        return Promise.reject(new Error('sendMessage failed'));
      }
      return Promise.resolve({ success: true });
    });

    render(
      <SettingsPage
        {...baseProps}
        onClose={onClose}
        onFeedbackSuccess={onFeedbackSuccess}
        currentTab={{ url: 'not-a-valid-url' } as chrome.tabs.Tab}
      />
    );

    await user.click(screen.getByRole('button', { name: /feedback/i }));
    const textarea = await screen.findByPlaceholderText(/type your feedback here/i);
    await user.type(textarea, 'Error handling case');
    await user.click(screen.getByRole('button', { name: /submit feedback/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'SUBMIT_FEEDBACK',
        data: {
          feedbackText: 'Error handling case',
          url: undefined,
          domain: 'unknown',
        },
      });
      expect(screen.getByRole('button', { name: /submit feedback/i })).toBeEnabled();
    });

    expect(textarea).toHaveValue('Error handling case');
    expect(onClose).not.toHaveBeenCalled();
    expect(onFeedbackSuccess).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it('omits non-http tab url metadata from feedback payload', async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    const onFeedbackSuccess = vi.fn();

    render(
      <SettingsPage
        {...baseProps}
        onClose={onClose}
        onFeedbackSuccess={onFeedbackSuccess}
        currentTab={{ url: 'chrome://settings/privacy' } as chrome.tabs.Tab}
      />
    );

    await user.click(screen.getByRole('button', { name: /feedback/i }));
    const textarea = await screen.findByPlaceholderText(/type your feedback here/i);
    await user.type(textarea, 'Works on chrome settings page');
    await user.click(screen.getByRole('button', { name: /submit feedback/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'SUBMIT_FEEDBACK',
        data: {
          feedbackText: 'Works on chrome settings page',
          url: undefined,
          domain: 'unknown',
        },
      });
      expect(onFeedbackSuccess).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('opens burner services via deep link and returns to menu', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPage {...baseProps} deepLinkSection="burner-services" />);

    await waitFor(() => {
      expect(screen.getByText(/Burner Email Services/i)).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText(/back to menu/i));
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('navigates directly to theme via deep link', async () => {
    render(<SettingsPage {...baseProps} deepLinkSection="theme" />);

    await waitFor(() => {
      expect(screen.getByText('Theme')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /light/i })).toBeInTheDocument();
    });
  });

  it('navigates directly to feedback via deep link and can go back to menu', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPage {...baseProps} deepLinkSection="feedback" />);

    await waitFor(() => {
      expect(screen.getByText('Feedback')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/type your feedback here/i)).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText(/back to menu/i));

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  it('applies deep link only when modal is open', async () => {
    const { rerender } = render(
      <SettingsPage {...baseProps} isOpen={false} deepLinkSection="theme" />
    );

    expect(screen.queryByText('Theme')).not.toBeInTheDocument();

    rerender(<SettingsPage {...baseProps} isOpen deepLinkSection="theme" />);

    await waitFor(() => {
      expect(screen.getByText('Theme')).toBeInTheDocument();
    });
  });

  it('responds to deep link section changes after modal is open', async () => {
    const { rerender } = render(
      <SettingsPage {...baseProps} isOpen deepLinkSection="menu" />
    );

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    rerender(<SettingsPage {...baseProps} isOpen deepLinkSection="about" />);

    await waitFor(() => {
      expect(screen.getByText('About')).toBeInTheDocument();
    });
  });

  it('applies forward animation class when navigating menu to theme', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<SettingsPage {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /theme/i }));
    await screen.findByText('Theme');
    const themePanel = container.querySelector('div.animate-slide-in-right');

    expect(themePanel).toBeTruthy();
  });

  it('applies backward animation class when navigating back to menu', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<SettingsPage {...baseProps} deepLinkSection="theme" />);

    await waitFor(() => {
      expect(screen.getByText('Theme')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText(/back to menu/i));

    await waitFor(() => {
      const menuPanel = container.querySelector('div.animate-slide-in-left');
      expect(menuPanel).toBeTruthy();
    });
  });

  it('shows selected theme visual state and unselected state correctly', async () => {
    render(<SettingsPage {...baseProps} deepLinkSection="theme" />);

    const systemButton = await screen.findByRole('button', { name: /system/i });
    const darkButton = screen.getByRole('button', { name: /dark/i });

    expect(systemButton.className).toContain('border-blue-500');
    expect(systemButton.querySelector('div.bg-blue-500')).toBeTruthy();

    expect(darkButton.className).toContain('border-gray-200');
    expect(darkButton.querySelector('div.bg-blue-500')).toBeNull();
  });

  it('shows validation error and blocks save for invalid real email', async () => {
    const user = userEvent.setup({ delay: null });
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: true,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage {...baseProps} deepLinkSection="burner-services" />);

    const emailInput = await screen.findByPlaceholderText('your.email@example.com');
    await user.type(emailInput, 'invalid-email');
    await user.click(screen.getByRole('button', { name: /save email/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email format/i)).toBeInTheDocument();
    });

    expect(mockSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_REAL_EMAIL' })
    );
  });

  it('saves a valid real email and clears input after success', async () => {
    const user = userEvent.setup({ delay: null });
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: true,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      if (message.type === 'SET_REAL_EMAIL') {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage {...baseProps} deepLinkSection="burner-services" />);

    const emailInput = await screen.findByPlaceholderText('your.email@example.com');
    await user.type(emailInput, 'Person@Example.COM');
    await user.click(screen.getByRole('button', { name: /save email/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'SET_REAL_EMAIL',
        data: { email: 'person@example.com' },
      });
    });
    expect(emailInput).toHaveValue('');
  });

  it('disables real email controls when burner email feature is off', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPage {...baseProps} deepLinkSection="burner-services" />);

    const emailInput = await screen.findByPlaceholderText('your.email@example.com');
    const saveButton = screen.getByRole('button', { name: /save email|update email/i });

    expect(emailInput).toBeDisabled();
    expect(saveButton).toBeDisabled();

    await user.type(emailInput, 'user@example.com');
    expect(emailInput).toHaveValue('');
  });

  it('disables save when input equals existing real email', async () => {
    const user = userEvent.setup({ delay: null });
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: true,
            telemetryEnabled: false,
            realEmail: 'existing@example.com',
          },
        });
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage {...baseProps} deepLinkSection="burner-services" />);

    const emailInput = await screen.findByPlaceholderText('your.email@example.com');
    const saveButton = screen.getByRole('button', { name: /save email|update email/i });

    await user.type(emailInput, 'existing@example.com');
    expect(saveButton).toBeDisabled();
  });

  it('keeps save button disabled while real email save is in progress', async () => {
    const user = userEvent.setup({ delay: null });
    let resolveSave: ((value: unknown) => void) | null = null;

    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: true,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      if (message.type === 'SET_REAL_EMAIL') {
        return new Promise<unknown>((resolve) => {
          resolveSave = resolve;
        });
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage {...baseProps} deepLinkSection="burner-services" />);

    const emailInput = await screen.findByPlaceholderText('your.email@example.com');
    await user.type(emailInput, 'pending@example.com');
    const saveButton = screen.getByRole('button', { name: /save email|update email/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
    });

    if (resolveSave) {
      (resolveSave as (value: unknown) => void)({ success: true });
    }
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save email|update email/i })).toBeInTheDocument();
    });
  });

  it('surfaces save real email backend errors', async () => {
    const user = userEvent.setup({ delay: null });
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: true,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      if (message.type === 'SET_REAL_EMAIL') {
        return Promise.resolve({
          success: false,
          error: 'Burner email feature is disabled. Please enable it in settings to configure your forwarding email address.',
        });
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage {...baseProps} deepLinkSection="burner-services" />);

    const emailInput = await screen.findByPlaceholderText('your.email@example.com');
    await user.type(emailInput, 'person@example.com');
    await user.click(screen.getByRole('button', { name: /save email/i }));

    await waitFor(() => {
      expect(screen.getByText(/feature is disabled/i)).toBeInTheDocument();
    });
  });

  it('shows generic error when saving real email throws an exception', async () => {
    const user = userEvent.setup({ delay: null });
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: true,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      if (message.type === 'SET_REAL_EMAIL') {
        return Promise.reject(new Error('service worker unavailable'));
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage {...baseProps} deepLinkSection="burner-services" />);

    const emailInput = await screen.findByPlaceholderText('your.email@example.com');
    await user.type(emailInput, 'person@example.com');
    await user.click(screen.getByRole('button', { name: /save email/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to save email. Please try again.')).toBeInTheDocument();
    });
  });

  it('clears real email error when user edits input', async () => {
    const user = userEvent.setup({ delay: null });
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: true,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage {...baseProps} deepLinkSection="burner-services" />);

    const emailInput = await screen.findByPlaceholderText('your.email@example.com');
    await user.type(emailInput, 'invalid-email');
    await user.click(screen.getByRole('button', { name: /save email/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email format/i)).toBeInTheDocument();
    });

    await user.type(emailInput, 'x');

    await waitFor(() => {
      expect(screen.queryByText(/invalid email format/i)).not.toBeInTheDocument();
    });
  });

  it('does not apply theme preference when SET_THEME fails', async () => {
    const user = userEvent.setup({ delay: null });
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      if (message.type === 'SET_THEME') {
        return Promise.resolve({ success: false, error: 'Theme update failed' });
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage {...baseProps} deepLinkSection="theme" />);
    const darkButton = await screen.findByRole('button', { name: /dark/i });
    await user.click(darkButton);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'SET_THEME',
        data: { theme: 'dark' },
      });
    });
    expect(updateThemePreferenceMock).not.toHaveBeenCalled();
  });

  it('keeps telemetry toggle stable when update fails', async () => {
    const user = userEvent.setup({ delay: null });
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      if (message.type === 'SET_TELEMETRY_SETTING') {
        return Promise.resolve({ success: false, error: 'Telemetry update failed' });
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage {...baseProps} deepLinkSection="telemetry" />);

    const toggle = await screen.findByLabelText(/toggle telemetry collection/i);
    expect(toggle.className).toContain('bg-gray-300');

    await user.click(toggle);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'SET_TELEMETRY_SETTING',
        data: { enabled: true },
      });
    });

    expect(toggle.className).toContain('bg-gray-300');
  });

  it('completes burner highlight callback after timer', async () => {
    vi.useFakeTimers();
    const onBurnerHighlightComplete = vi.fn();

    render(
      <SettingsPage
        {...baseProps}
        deepLinkSection="burner-services"
        highlightBurnerToggle
        onBurnerHighlightComplete={onBurnerHighlightComplete}
      />
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText(/Burner Email Services/i)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2600);
    expect(onBurnerHighlightComplete).toHaveBeenCalledTimes(1);
  });

  it('exports user data via EXPORT_USER_DATA with selected options', async () => {
    const user = userEvent.setup({ delay: null });
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    mockSendMessage.mockImplementation((message: { type: string; data?: unknown }) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      if (message.type === 'EXPORT_USER_DATA') {
        return Promise.resolve({
          success: true,
          exportData: {
            filename: 'privaseer-data-export-2026-03-05.csv',
            mimeType: 'text/csv;charset=utf-8',
            content: 'section,metric,value',
          },
        });
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage {...baseProps} deepLinkSection="about" />);

    await waitFor(() => {
      expect(screen.getByText('About')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText(/select export format/i), 'csv');
    await user.click(screen.getByRole('checkbox', { name: /include forwarding email address/i }));
    await user.click(screen.getByRole('button', { name: /export my data/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'EXPORT_USER_DATA',
        data: {
          format: 'csv',
          includeEmail: true,
        },
      });
    });

    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  it('deletes local data after confirmation', async () => {
    const user = userEvent.setup({ delay: null });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    mockSendMessage.mockImplementation((message: { type: string }) => {
      if (message.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: '',
          },
        });
      }
      if (message.type === 'DELETE_ALL_DATA') {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage {...baseProps} deepLinkSection="about" />);
    await user.click(screen.getByRole('button', { name: /delete all local extension data/i }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'DELETE_ALL_DATA' });
    });

    confirmSpy.mockRestore();
  });
});
