/**
 * @file src/tests/popup/accessibility.test.tsx
 *
 * Test Type: Component/Integration
 * Contexts Tested: Popup UI and Settings modal accessibility
 * Chrome APIs Mocked: chrome.runtime, chrome.tabs, chrome.storage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popup } from '@/popup/popup';
import { SettingsPage } from '@/popup/settings-page';
import type { Alert, CreditScoreResult, StorageData } from '@/types';

vi.mock('@/popup/burner-emails-section', () => ({
  BurnerEmailsSection: () => <div data-testid="mocked-burner-emails">Mocked Burner Emails</div>,
}));

describe('Popup accessibility compliance', () => {
  const originalChrome = global.chrome;
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockAddListener: ReturnType<typeof vi.fn>;
  let mockRemoveListener: ReturnType<typeof vi.fn>;
  let mockTabsQuery: ReturnType<typeof vi.fn>;

  const createMockCreditScore = (overrides?: Partial<CreditScoreResult>): CreditScoreResult => ({
    score: 650,
    label: 'Good',
    trend: 'stable',
    formulaVersion: '1.0',
    factors: {
      protectionConsistency: { value: 0.85, impact: 60 },
      cleanBrowsing: { value: 0.7, impact: 40 },
      highRiskExposure: { value: 0.15, impact: -30 },
      violations: { value: 0.1, impact: -20 },
    },
    lastCalculated: Date.now(),
    ...overrides,
  });

  const createMockStorageData = (overrides?: Partial<StorageData>): StorageData => ({
    privacyScore: {
      current: 75,
      daily: {
        trackersBlocked: 12,
        cleanSitesVisited: 5,
        nonCompliantSites: 1,
      },
      history: [],
    },
    creditScore: createMockCreditScore(),
    alerts: [],
    trackers: {},
    settings: {
      protectionEnabled: true,
      showNotifications: true,
      theme: 'system',
      burnerEmailEnabled: false,
      telemetryEnabled: false,
    },
    lastReset: Date.now(),
    consentStates: {},
    domainOccurrences: {},
    dailySnapshots: [],
    onboarding: {
      hasCompletedOnboarding: true,
      currentStep: 0,
    },
    ...overrides,
  });

  const createMockAlert = (overrides?: Partial<Alert>): Alert => ({
    id: 'alert-1',
    type: 'non_compliant_site',
    severity: 'medium',
    message: 'example.com may not follow privacy best practices',
    domain: 'example.com',
    timestamp: Date.now(),
    deceptivePatterns: ['forcedConsent'],
    ...overrides,
  });

  beforeEach(() => {
    mockSendMessage = vi.fn();
    mockAddListener = vi.fn();
    mockRemoveListener = vi.fn();
    mockTabsQuery = vi.fn().mockResolvedValue([{ url: 'https://example.com', active: true }]);

    global.chrome = {
      runtime: {
        sendMessage: mockSendMessage,
        onMessage: {
          addListener: mockAddListener,
          removeListener: mockRemoveListener,
        },
        getURL: vi.fn((path) => `chrome-extension://test/${path}`),
      },
      tabs: {
        query: mockTabsQuery,
        create: vi.fn(),
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as typeof chrome;

    mockSendMessage.mockImplementation((message: { type: string }) => {
      if (message.type === 'GET_STATE') {
        return Promise.resolve({ success: true, data: createMockStorageData() });
      }
      if (message.type === 'GET_THEME') {
        return Promise.resolve({ success: true, theme: 'system' });
      }
      if (message.type === 'GET_ONBOARDING_STATE') {
        return Promise.resolve({
          success: true,
          onboarding: { hasCompletedOnboarding: true, currentStep: 0 },
        });
      }
      if (message.type === 'GET_TRACKER_INFO') {
        return Promise.resolve({
          success: true,
          info: { description: 'Tracks user behavior', alternative: 'Use privacy-safe analytics' },
        });
      }
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    global.chrome = originalChrome;
  });

  it('exposes tablist, tabs, and matching tabpanel semantics', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Popup />);

    await waitFor(() => {
      expect(screen.getByRole('tablist', { name: /main navigation/i })).toBeInTheDocument();
    });

    const dashboardTab = screen.getByRole('tab', { name: /dashboard/i });
    const burnerTab = screen.getByRole('tab', { name: /burner emails/i });
    expect(dashboardTab).toHaveAttribute('aria-selected', 'true');
    expect(burnerTab).toHaveAttribute('aria-selected', 'false');

    await user.click(burnerTab);
    expect(burnerTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: /burner emails/i })).toBeInTheDocument();
  });

  it('renders switch semantics and aria-labels for popup icon buttons', async () => {
    const alerts = [createMockAlert()];
    mockSendMessage.mockImplementation((message: { type: string }) => {
      if (message.type === 'GET_STATE') {
        return Promise.resolve({ success: true, data: createMockStorageData({ alerts }) });
      }
      if (message.type === 'GET_THEME') {
        return Promise.resolve({ success: true, theme: 'system' });
      }
      if (message.type === 'GET_ONBOARDING_STATE') {
        return Promise.resolve({
          success: true,
          onboarding: { hasCompletedOnboarding: true, currentStep: 0 },
        });
      }
      return Promise.resolve({ success: true });
    });

    render(<Popup />);

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /toggle tracker protection/i })).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/open settings/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/clear all alerts/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/report false positive/i)).toBeInTheDocument();
  });

  it('supports keyboard expansion for alerts and updates aria-expanded', async () => {
    const user = userEvent.setup({ delay: null });
    const alerts = [createMockAlert()];
    mockSendMessage.mockImplementation((message: { type: string }) => {
      if (message.type === 'GET_STATE') {
        return Promise.resolve({ success: true, data: createMockStorageData({ alerts }) });
      }
      if (message.type === 'GET_THEME') {
        return Promise.resolve({ success: true, theme: 'system' });
      }
      if (message.type === 'GET_ONBOARDING_STATE') {
        return Promise.resolve({
          success: true,
          onboarding: { hasCompletedOnboarding: true, currentStep: 0 },
        });
      }
      return Promise.resolve({ success: true });
    });

    render(<Popup />);

    await waitFor(() => {
      expect(screen.getByRole('list', { name: /recent privacy alerts/i })).toBeInTheDocument();
    });

    const alertToggle = screen.getByRole('button', {
      name: /example\.com may not follow privacy best practices from example\.com/i,
    });
    expect(alertToggle).toHaveAttribute('aria-expanded', 'false');

    alertToggle.focus();
    await user.keyboard('{Enter}');
    expect(alertToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/banner observations/i)).toBeInTheDocument();
  });

  it('renders settings toggles as switches and theme buttons with aria-pressed', async () => {
    render(
      <SettingsPage
        isOpen={true}
        onClose={vi.fn()}
        currentTab={{ url: 'https://example.com' } as chrome.tabs.Tab}
        onFeedbackSuccess={vi.fn()}
        deepLinkSection="theme"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /extension settings/i })).toBeInTheDocument();
    });

    const systemTheme = screen.getByRole('button', { name: /system/i });
    const darkTheme = screen.getByRole('button', { name: /dark/i });
    expect(systemTheme).toHaveAttribute('aria-pressed', 'true');
    expect(darkTheme).toHaveAttribute('aria-pressed', 'false');

    cleanup();

    render(
      <SettingsPage
        isOpen={true}
        onClose={vi.fn()}
        currentTab={{ url: 'https://example.com' } as chrome.tabs.Tab}
        onFeedbackSuccess={vi.fn()}
        deepLinkSection="telemetry"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /toggle telemetry collection/i })).toBeInTheDocument();
    });
  });
});
