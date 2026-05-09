import { render, screen } from '@testing-library/react';
import { describe, it, beforeEach, expect, vi, type Mock } from 'vitest';
import { WelcomeApp } from '@/welcome/welcome';

const sendMessageMock = chrome.runtime.sendMessage as unknown as Mock;

describe('WelcomeApp conditional steps', () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    sendMessageMock.mockImplementation((message: { type: string }) => {
      switch (message?.type) {
        case 'GET_ONBOARDING_STATE':
          return Promise.resolve({
            success: true,
            onboarding: {
              hasCompletedOnboarding: false,
              currentStep: 5,
              emailConfigured: true,
              startedAt: Date.now(),
            },
          });
        case 'GET_ALL_SETTINGS':
          return Promise.resolve({
            success: true,
            settings: {
              theme: 'system',
              burnerEmailEnabled: true,
              telemetryEnabled: false,
              realEmail: 'user@example.com',
            },
          });
        case 'GET_STATE':
          return Promise.resolve({
            success: true,
            data: {
              settings: { protectionEnabled: true, burnerEmailEnabled: true },
              privacyScore: { daily: { trackersBlocked: 3 } },
              realEmail: 'user@example.com',
            },
          });
        case 'GET_CREDIT_SCORE':
          return Promise.resolve({
            success: true,
            creditScore: { score: 700 },
          });
        default:
          return Promise.resolve({ success: true });
      }
    });

    (chrome.tabs as unknown as { create: Mock }).create = vi.fn();
  });

  it('hides burner email step when burner email is already configured', async () => {
    render(<WelcomeApp />);

    expect(await screen.findByText(/5 total/i)).toBeInTheDocument();
    expect(screen.getByText(/step 5/i)).toBeInTheDocument();
    expect(screen.queryByText('Burner Email')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish/i })).toBeInTheDocument();
  });
});
