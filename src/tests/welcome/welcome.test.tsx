import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, beforeEach, expect, vi, type Mock } from 'vitest';
import { WelcomeApp } from '@/welcome/welcome';

const sendMessageMock = chrome.runtime.sendMessage as unknown as Mock;

describe('WelcomeApp', () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    vi.spyOn(window, 'close').mockImplementation(() => {});
    sendMessageMock.mockImplementation((message: { type: string }) => {
      switch (message?.type) {
        case 'GET_ONBOARDING_STATE':
          return Promise.resolve({
            success: true,
            onboarding: {
              hasCompletedOnboarding: false,
              currentStep: 0,
            },
          });
        case 'GET_ALL_SETTINGS':
          return Promise.resolve({
            success: true,
            settings: {
              theme: 'system',
              burnerEmailEnabled: false,
              telemetryEnabled: false,
              realEmail: null,
            },
          });
        default:
          return Promise.resolve({ success: true });
      }
    });

    (chrome.tabs as any).create = vi.fn((_: unknown, callback?: () => void) => {
      callback?.();
      return 123 as any;
    });
  });

  it('renders welcome hero after initial load', async () => {
    render(<WelcomeApp />);

    expect(await screen.findByText(/privacy copilot/i)).toBeInTheDocument();
    expect(screen.getByText(/step 1/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip tour/i })).toBeInTheDocument();
  });

  it('advances to next step when continue is clicked', async () => {
    const user = userEvent.setup();
    render(<WelcomeApp />);
    await screen.findByText(/privacy copilot/i);

    const button = await screen.findByRole('button', { name: /get started/i });
    await user.click(button);

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({
        type: 'SET_ONBOARDING_STEP',
        data: expect.objectContaining({
          step: 1,
          stepId: 'protection',
          previousStepId: 'welcome',
        }),
      });
    });
  });

  it('shows loading state while data is fetched', () => {
    sendMessageMock.mockImplementation(() => new Promise(() => {}));

    render(<WelcomeApp />);

    expect(screen.getByText(/loading guide/i)).toBeInTheDocument();
  });

  it('renders error state when initial load fails', async () => {
    sendMessageMock.mockRejectedValueOnce(new Error('Network down'));

    render(<WelcomeApp />);

    expect(await screen.findByText(/unable to load onboarding/i)).toBeInTheDocument();
    expect(screen.getByText(/network down/i)).toBeInTheDocument();
  });

  it('navigates back to previous step', async () => {
    sendMessageMock.mockImplementation((message: { type: string }) => {
      if (message?.type === 'GET_ONBOARDING_STATE') {
        return Promise.resolve({
          success: true,
          onboarding: {
            hasCompletedOnboarding: false,
            currentStep: 1,
          },
        });
      }
      if (message?.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: null,
          },
        });
      }
      return Promise.resolve({ success: true });
    });

    const user = userEvent.setup();
    render(<WelcomeApp />);
    await screen.findByText(/step 2/i);

    await user.click(screen.getByRole('button', { name: /back/i }));

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({
        type: 'SET_ONBOARDING_STEP',
        data: expect.objectContaining({
          step: 0,
          stepId: 'welcome',
          previousStepId: 'protection',
        }),
      });
    });
  });

  it('skips onboarding when skip is clicked', async () => {
    const user = userEvent.setup();
    render(<WelcomeApp />);
    await screen.findByText(/privacy copilot/i);

    await user.click(screen.getByRole('button', { name: /skip tour/i }));

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({
        type: 'SKIP_ONBOARDING',
        data: { atStep: 0, reason: 'skipped' },
      });
    });
    expect(window.close).toHaveBeenCalled();
  });

  it('completes onboarding on last step and closes window', async () => {
    sendMessageMock.mockImplementation((message: { type: string }) => {
      if (message?.type === 'GET_ONBOARDING_STATE') {
        return Promise.resolve({
          success: true,
          onboarding: {
            hasCompletedOnboarding: false,
            currentStep: 5,
            emailConfigured: true,
          },
        });
      }
      if (message?.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: 'user@example.com',
          },
        });
      }
      return Promise.resolve({ success: true });
    });

    const user = userEvent.setup();
    render(<WelcomeApp />);
    await screen.findByText(/step 6/i);

    await user.click(screen.getByRole('button', { name: /finish/i }));

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({
        type: 'COMPLETE_ONBOARDING',
        data: { emailConfigured: true },
      });
    });
    expect(window.close).toHaveBeenCalled();
  });

  it('applies dark theme when preference is dark', async () => {
    sendMessageMock.mockImplementation((message: { type: string }) => {
      if (message?.type === 'GET_ONBOARDING_STATE') {
        return Promise.resolve({
          success: true,
          onboarding: {
            hasCompletedOnboarding: false,
            currentStep: 0,
          },
        });
      }
      if (message?.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'dark',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: null,
          },
        });
      }
      return Promise.resolve({ success: true });
    });

    render(<WelcomeApp />);
    await screen.findByText(/privacy copilot/i);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('clamps negative onboarding step to first step boundary', async () => {
    sendMessageMock.mockImplementation((message: { type: string }) => {
      if (message?.type === 'GET_ONBOARDING_STATE') {
        return Promise.resolve({
          success: true,
          onboarding: {
            hasCompletedOnboarding: false,
            currentStep: -5,
          },
        });
      }
      if (message?.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: null,
          },
        });
      }
      return Promise.resolve({ success: true });
    });

    render(<WelcomeApp />);
    expect(await screen.findByText(/step 1/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
  });

  it('resets oversized onboarding step to first step boundary', async () => {
    sendMessageMock.mockImplementation((message: { type: string }) => {
      if (message?.type === 'GET_ONBOARDING_STATE') {
        return Promise.resolve({
          success: true,
          onboarding: {
            hasCompletedOnboarding: false,
            currentStep: 999,
            emailConfigured: false,
          },
        });
      }
      if (message?.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: null,
          },
        });
      }
      return Promise.resolve({ success: true });
    });

    render(<WelcomeApp />);
    expect(await screen.findByText(/step 1/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip tour/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
  });

  it('renders consent scanner step content when onboarding is at consent step', async () => {
    sendMessageMock.mockImplementation((message: { type: string }) => {
      if (message?.type === 'GET_ONBOARDING_STATE') {
        return Promise.resolve({
          success: true,
          onboarding: {
            hasCompletedOnboarding: false,
            currentStep: 3,
          },
        });
      }
      if (message?.type === 'GET_ALL_SETTINGS') {
        return Promise.resolve({
          success: true,
          settings: {
            theme: 'system',
            burnerEmailEnabled: false,
            telemetryEnabled: false,
            realEmail: null,
          },
        });
      }
      return Promise.resolve({ success: true });
    });

    render(<WelcomeApp />);
    expect(await screen.findByText(/consent intelligence/i)).toBeInTheDocument();
    expect(screen.getByText(/detect dark patterns before you click anything/i)).toBeInTheDocument();
    expect(screen.getByText(/forced consent/i)).toBeInTheDocument();
  });
});

