import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popup } from '../../popup/popup';
import type { StorageData, Alert, CreditScoreResult, CreditScoreLabel } from '../../types';

// Mock BurnerEmailsSection to prevent heavy component render and memory issues
vi.mock('../../popup/burner-emails-section', () => ({
  BurnerEmailsSection: () => <div data-testid="mocked-burner-emails">Mocked Burner Emails</div>
}));

vi.mock('../../popup/settings-page', () => ({
  SettingsPage: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="mocked-settings-page">Mocked Settings</div> : null,
}));

describe('Popup Dashboard Component', () => {
  const originalChrome = global.chrome;
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockAddListener: ReturnType<typeof vi.fn>;
  let mockRemoveListener: ReturnType<typeof vi.fn>;
  let mockStorageGet: ReturnType<typeof vi.fn>;
  let mockStorageSet: ReturnType<typeof vi.fn>;
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
        nonCompliantSites: 2,
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
    id: `alert-${Date.now()}`,
    type: 'tracker_blocked',
    severity: 'medium',
    message: 'Blocked tracker.example.com',
    domain: 'example.com',
    timestamp: Date.now(),
    ...overrides,
  });

  // Helper to setup mock with custom storage data
  const setupMockWithData = (dataOverrides?: Partial<StorageData>) => {
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_STATE') {
        return Promise.resolve({
          success: true,
          data: createMockStorageData(dataOverrides),
        });
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
      if (message.type === 'GET_BURNER_EMAIL_SETTING') {
        return Promise.resolve({ success: true, enabled: false });
      }
      if (message.type === 'GET_BURNER_EMAILS') {
        return Promise.resolve({ success: true, emails: [] });
      }
      if (message.type === 'GET_REAL_EMAIL') {
        return Promise.resolve({ success: true, email: null });
      }
      if (message.type === 'CLEAR_ALERTS') {
        return Promise.resolve({ success: true });
      }
      if (message.type === 'GET_METRICS_AGGREGATION') {
        return Promise.resolve({
          success: true,
          aggregation: {
            period: message.data?.period ?? 'week',
            totalTrackersBlocked: 25,
            trackersByCategory: { advertising: 12, analytics: 8, social: 5 },
            averagePrivacyScore: 87,
            averageComplianceScore: 90,
            cleanSitesVisited: 7,
            nonCompliantSites: 2,
            burnerEmailsGenerated: 1,
            burnerEmailsForwarded: 1,
            topBlockedDomains: [{ domain: 'tracker.com', count: 10 }],
          },
        });
      }
      return Promise.resolve({ success: true });
    });
  };

  beforeEach(() => {
    mockSendMessage = vi.fn();
    mockAddListener = vi.fn();
    mockRemoveListener = vi.fn();
    mockStorageGet = vi.fn().mockResolvedValue({});
    mockStorageSet = vi.fn().mockResolvedValue(undefined);
    mockTabsQuery = vi.fn().mockResolvedValue([{ url: 'https://example.com', active: true }]);

    // Mock Chrome APIs
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
          get: mockStorageGet,
          set: mockStorageSet,
        },
      },
    } as unknown as typeof chrome;

    if (!global.requestAnimationFrame) {
      global.requestAnimationFrame = ((callback: FrameRequestCallback) =>
        setTimeout(() => callback(performance.now()), 16)) as unknown as typeof requestAnimationFrame;
    }
    if (!global.cancelAnimationFrame) {
      global.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
    }

    // Default mock implementation
    mockSendMessage.mockImplementation((message) => {
      if (message.type === 'GET_STATE') {
        return Promise.resolve({
          success: true,
          data: createMockStorageData(),
        });
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
      if (message.type === 'GET_BURNER_EMAIL_SETTING') {
        return Promise.resolve({ success: true, enabled: false });
      }
      if (message.type === 'GET_BURNER_EMAILS') {
        return Promise.resolve({ success: true, emails: [] });
      }
      if (message.type === 'GET_REAL_EMAIL') {
        return Promise.resolve({ success: true, email: null });
      }
      if (message.type === 'GET_METRICS_AGGREGATION') {
        return Promise.resolve({
          success: true,
          aggregation: {
            period: message.data?.period ?? 'week',
            totalTrackersBlocked: 25,
            trackersByCategory: { advertising: 12, analytics: 8, social: 5 },
            averagePrivacyScore: 87,
            averageComplianceScore: 90,
            cleanSitesVisited: 7,
            nonCompliantSites: 2,
            burnerEmailsGenerated: 1,
            burnerEmailsForwarded: 1,
            topBlockedDomains: [{ domain: 'tracker.com', count: 10 }],
          },
        });
      }
      return Promise.resolve({ success: true });
    });
  });

  afterEach(() => {
    cleanup(); // Unmount React components
    vi.clearAllMocks();
    vi.useRealTimers();
    global.chrome = originalChrome;
  });

  describe('Tab Switching', () => {
    it('should display dashboard tab as active by default', async () => {
      render(<Popup />);

      await waitFor(() => {
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
      }, { timeout: 500 });

      const dashboardButton = screen.getByRole('tab', { name: /dashboard/i });
      expect(dashboardButton).toHaveClass('bg-white');
    });

    it('should switch to Burner Emails tab and display BurnerEmailsSection', async () => {
      const user = userEvent.setup({ delay: null }); // Remove realistic delays

      render(<Popup />);

      await waitFor(() => {
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
      }, { timeout: 500 });

      const burnerButton = screen.getByRole('tab', { name: /burner emails/i });
      await user.click(burnerButton);

      await waitFor(() => {
        expect(burnerButton).toHaveClass('bg-white');
        expect(screen.getByText('Burner Emails')).toBeInTheDocument();
        // Check for mocked BurnerEmailsSection
        expect(screen.getByTestId('mocked-burner-emails')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('should switch back to Dashboard tab after viewing Burner Emails', async () => {
      const user = userEvent.setup({ delay: null });

      render(<Popup />);

      await waitFor(() => {
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
      }, { timeout: 500 });

      // Switch to Burner Emails
      const burnerButton = screen.getByRole('tab', { name: /burner emails/i });
      await user.click(burnerButton);

      await waitFor(() => {
        expect(screen.getByTestId('mocked-burner-emails')).toBeInTheDocument();
      }, { timeout: 500 });

      // Switch back to Dashboard
      const dashboardButton = screen.getByRole('tab', { name: /dashboard/i });
      await user.click(dashboardButton);

      await waitFor(() => {
        expect(dashboardButton).toHaveClass('bg-white');
        // Credit score should be visible
        expect(screen.getByText('Score: 650 / 850')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('reloads state when STATE_UPDATE is received', async () => {
      render(<Popup />);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_STATE' });
      }, { timeout: 500 });

      const listener = mockAddListener.mock.calls[0][0];
      listener({ type: 'STATE_UPDATE' });

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_STATE' });
      }, { timeout: 500 });
    });

    it('supports keyboard tab navigation with Home/End/Arrow keys', async () => {
      render(<Popup />);

      const dashboardTab = await screen.findByRole('tab', { name: /dashboard/i });
      const burnerTab = screen.getByRole('tab', { name: /burner emails/i });
      expect(dashboardTab).toHaveAttribute('aria-selected', 'true');

      fireEvent.keyDown(dashboardTab, { key: 'End' });
      await waitFor(() => {
        expect(burnerTab).toHaveAttribute('aria-selected', 'true');
      }, { timeout: 500 });

      fireEvent.keyDown(burnerTab, { key: 'Home' });
      await waitFor(() => {
        expect(dashboardTab).toHaveAttribute('aria-selected', 'true');
      }, { timeout: 500 });

      fireEvent.keyDown(dashboardTab, { key: 'ArrowRight' });
      await waitFor(() => {
        expect(burnerTab).toHaveAttribute('aria-selected', 'true');
      }, { timeout: 500 });

      fireEvent.keyDown(burnerTab, { key: 'ArrowLeft' });
      await waitFor(() => {
        expect(dashboardTab).toHaveAttribute('aria-selected', 'true');
      }, { timeout: 500 });
    });

    it('ignores non-navigation keys on tab controls', async () => {
      render(<Popup />);

      const dashboardTab = await screen.findByRole('tab', { name: /dashboard/i });
      const burnerTab = screen.getByRole('tab', { name: /burner emails/i });
      expect(dashboardTab).toHaveAttribute('aria-selected', 'true');

      fireEvent.keyDown(dashboardTab, { key: 'Enter' });

      await waitFor(() => {
        expect(dashboardTab).toHaveAttribute('aria-selected', 'true');
        expect(burnerTab).toHaveAttribute('aria-selected', 'false');
      }, { timeout: 500 });
    });
  });

  describe('Privacy Score Display', () => {
    it('should render privacy score with correct value', async () => {
      setupMockWithData({
        creditScore: createMockCreditScore({ score: 780, label: 'Excellent' }),
      });

      render(<Popup />);

      await waitFor(() => {
        expect(screen.getByText('Score: 780 / 850')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('should display "Excellent" label for score >= 750', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ creditScore: createMockCreditScore({ score: 780, label: 'Excellent' }) }),
          });
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
        expect(screen.getByText('Excellent')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('should display "Good" label for score >= 650 and < 750', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ creditScore: createMockCreditScore({ score: 700, label: 'Good' }) }),
          });
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
        expect(screen.getByText('Good')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('should display "Fair" label for score >= 550 and < 650', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ creditScore: createMockCreditScore({ score: 600, label: 'Fair' }) }),
          });
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
        expect(screen.getByText('Fair')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('applies score color classes for excellent scores', async () => {
      setupMockWithData({
        creditScore: createMockCreditScore({ score: 780, label: 'Excellent' }),
      });

      render(<Popup />);

      await waitFor(() => {
        const label = screen.getByText('Excellent');
        expect(label.className).toContain('text-emerald-600');
      }, { timeout: 500 });
    });

    it('applies score color classes for poor scores', async () => {
      setupMockWithData({
        creditScore: createMockCreditScore({ score: 500, label: 'Poor' }),
      });

      render(<Popup />);

      await waitFor(() => {
        const label = screen.getByText('Poor');
        expect(label.className).toContain('text-orange-600');
      }, { timeout: 500 });
    });

    it('applies exact score label boundaries (750/650/550/400)', async () => {
      const renderWithScore = async (score: number, label: CreditScoreLabel) => {
        setupMockWithData({
          creditScore: createMockCreditScore({ score, label }),
        });
        cleanup();
        render(<Popup />);
        await waitFor(() => {
          expect(screen.getByText(label)).toBeInTheDocument();
        }, { timeout: 500 });
      };

      await renderWithScore(750, 'Excellent');
      await renderWithScore(650, 'Good');
      await renderWithScore(550, 'Fair');
      await renderWithScore(400, 'Poor');
    });

    it('renders trend labels with their color classes', async () => {
      setupMockWithData({
        creditScore: createMockCreditScore({ score: 700, label: 'Good', trend: 'improving' }),
      });

      render(<Popup />);

      await waitFor(() => {
        const trend = screen.getByText('improving');
        expect(trend.parentElement?.className).toContain('text-green-600');
      }, { timeout: 500 });

      setupMockWithData({
        creditScore: createMockCreditScore({ score: 620, label: 'Fair', trend: 'declining' }),
      });

      cleanup();
      render(<Popup />);

      await waitFor(() => {
        const trend = screen.getByText('declining');
        expect(trend.parentElement?.className).toContain('text-red-600');
      }, { timeout: 500 });
    });

    it('shows factor contribution pills and breakdown', async () => {
      setupMockWithData({
        creditScore: createMockCreditScore({
          score: 680,
          label: 'Good',
          factors: {
            protectionConsistency: { value: 0.85, impact: 60 },
            cleanBrowsing: { value: 0.7, impact: 40 },
            highRiskExposure: { value: 0.2, impact: -30 },
            violations: { value: 0.1, impact: -20 },
          },
        }),
      });

      render(<Popup />);

      await waitFor(() => {
        expect(screen.getByText('Protection +60')).toBeInTheDocument();
        expect(screen.getByText('High-Risk -30')).toBeInTheDocument();
        expect(screen.getByText('Why This Score?')).toBeInTheDocument();
        expect(screen.getByText('Safe Sites')).toBeInTheDocument();
        expect(screen.getByText('Violations')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('should animate credit score to target value', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ creditScore: createMockCreditScore({ score: 700, label: 'Good' }) }),
          });
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

      // Wait for initial render
      await waitFor(() => {
        expect(screen.getByText('Score: 700 / 850')).toBeInTheDocument();
      }, { timeout: 500 });

      await new Promise(resolve => setTimeout(resolve, 1700));

      // Check final animated value
      await waitFor(() => {
        const scoreText = screen.getByText('700');
        expect(scoreText).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('should display daily trackers blocked count', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ privacyScore: { current: 75, daily: { trackersBlocked: 42, cleanSitesVisited: 5, nonCompliantSites: 2 }, history: [] } }),
          });
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
        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getByText('prevented today')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('renders aggregated analytics card and switches period', async () => {
      const user = userEvent.setup({ delay: null });
      render(<Popup />);

      await waitFor(() => {
        expect(screen.getByText('Aggregated Analytics')).toBeInTheDocument();
        expect(screen.getByText('Trackers Prevented')).toBeInTheDocument();
        expect(screen.getByText('25')).toBeInTheDocument();
      }, { timeout: 500 });

      await user.click(screen.getByRole('button', { name: /month/i }));

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'GET_METRICS_AGGREGATION',
          data: { period: 'month' },
        });
      }, { timeout: 500 });
    });
  });

  describe('Alerts Rendering', () => {
    it('should display empty state when no alerts exist', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ alerts: [] }),
          });
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
        expect(screen.getByText('Start browsing to see your privacy insights')).toBeInTheDocument();
        expect(screen.getByText(/We'll track your privacy health/)).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('should render list of alerts with message, domain, and timestamp', async () => {
      const alerts = [
        createMockAlert({
          id: 'alert-1',
          message: 'Blocked tracker-one.com',
          domain: 'example.com',
          type: 'tracker_blocked',
          severity: 'medium',
        }),
        createMockAlert({
          id: 'alert-2',
          message: 'Blocked tracker-two.com',
          domain: 'test.com',
          type: 'high_risk',
          severity: 'high',
        }),
      ];

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ alerts }),
          });
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
        expect(screen.getByText('Blocked tracker-one.com')).toBeInTheDocument();
        expect(screen.getByText('Blocked tracker-two.com')).toBeInTheDocument();
        expect(screen.getByText('example.com')).toBeInTheDocument();
        expect(screen.getByText('test.com')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('should display different alert types correctly', async () => {
      const alerts = [
        createMockAlert({
          id: 'alert-1',
          message: 'Blocked tracker',
          domain: 'example.com',
          type: 'tracker_blocked',
          severity: 'low',
        }),
        createMockAlert({
          id: 'alert-2',
          message: 'Non-compliant cookie banner',
          domain: 'test.com',
          type: 'non_compliant_site',
          severity: 'medium',
        }),
        createMockAlert({
          id: 'alert-3',
          message: 'Post-consent violation detected',
          domain: 'bad.com',
          type: 'post_consent_violation',
          severity: 'high',
        }),
      ];

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ alerts }),
          });
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
        expect(screen.getByText('Blocked tracker')).toBeInTheDocument();
        expect(screen.getByText('Non-compliant cookie banner')).toBeInTheDocument();
        expect(screen.getByText('Post-consent violation detected')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('should expand alert to show deceptive patterns when clicked', async () => {
      const user = userEvent.setup({ delay: null });

      const alerts = [
        createMockAlert({
          id: 'alert-1',
          message: 'example.com may not follow privacy best practices',
          domain: 'example.com',
          type: 'non_compliant_site',
          severity: 'medium',
          deceptivePatterns: ['forcedConsent', 'acceptButtonProminence'],
        }),
      ];

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ alerts }),
          });
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
        expect(screen.getByText('example.com may not follow privacy best practices')).toBeInTheDocument();
      }, { timeout: 500 });

      // Click the alert to expand
      const alertElement = screen.getByText('example.com may not follow privacy best practices').closest('div');
      if (alertElement) {
        await user.click(alertElement);
      }

      await waitFor(() => {
        expect(screen.getByText('Banner observations:')).toBeInTheDocument();
        expect(screen.getByText(/Limited consent options available/)).toBeInTheDocument();
        expect(screen.getByText(/Accept option appears more prominent/)).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('loads tracker info when a tracker alert is expanded', async () => {
      const user = userEvent.setup({ delay: null });
      const alerts = [
        createMockAlert({
          id: 'alert-1',
          message: 'Blocked tracker.example.com',
          domain: 'example.com',
          type: 'tracker_blocked',
          severity: 'medium',
        }),
      ];

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ alerts }),
          });
        }
        if (message.type === 'GET_TRACKER_INFO') {
          return Promise.resolve({
            success: true,
            info: { description: 'Tracks user behavior', alternative: 'Use privacy-safe analytics' },
          });
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
        expect(screen.getByText('Blocked tracker.example.com')).toBeInTheDocument();
      }, { timeout: 500 });

      const alertRow = screen.getByText('Blocked tracker.example.com').closest('div');
      if (alertRow) {
        await user.click(alertRow);
      }

      await waitFor(() => {
        expect(screen.getByText(/what it does/i)).toBeInTheDocument();
        expect(screen.getByText('Tracks user behavior')).toBeInTheDocument();
        expect(screen.getByText('Use privacy-safe analytics')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('allows false positive reports for banner alerts', async () => {
      const user = userEvent.setup({ delay: null });
      const alerts = [
        createMockAlert({
          id: 'alert-1',
          message: 'example.com may not follow privacy best practices',
          domain: 'example.com',
          type: 'non_compliant_site',
          severity: 'medium',
          deceptivePatterns: ['forcedConsent'],
        }),
      ];

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ alerts }),
          });
        }
        if (message.type === 'REPORT_FALSE_POSITIVE') {
          return Promise.resolve({ success: true, reportCount: 2, alreadyOverridden: false });
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
        expect(screen.getByLabelText('False positive reason')).toBeInTheDocument();
      }, { timeout: 500 });

      await user.click(screen.getByRole('button', { name: 'Report false positive' }));

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'REPORT_FALSE_POSITIVE',
            data: expect.objectContaining({
              reason: 'wrong_detection',
            }),
          })
        );
        expect(screen.getByText('Reported')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('renders time ago labels for alerts', async () => {
      const baseTime = new Date('2026-01-20T12:00:00Z').getTime();
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(baseTime);
      const alerts = [
        createMockAlert({
          id: 'alert-now',
          message: 'Recent alert',
          timestamp: baseTime - 30 * 1000,
        }),
        createMockAlert({
          id: 'alert-min',
          message: 'Minutes alert',
          timestamp: baseTime - 5 * 60 * 1000,
        }),
        createMockAlert({
          id: 'alert-hours',
          message: 'Hours alert',
          timestamp: baseTime - 2 * 60 * 60 * 1000,
        }),
        createMockAlert({
          id: 'alert-days',
          message: 'Days alert',
          timestamp: baseTime - 3 * 24 * 60 * 60 * 1000,
        }),
      ];

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ alerts }),
          });
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
        expect(screen.getByText('Just now')).toBeInTheDocument();
        expect(screen.getByText('5m ago')).toBeInTheDocument();
        expect(screen.getByText('2h ago')).toBeInTheDocument();
        expect(screen.getByText('3d ago')).toBeInTheDocument();
      }, { timeout: 500 });

      nowSpy.mockRestore();
    });

    it('renders severity indicators by alert severity', async () => {
      const alerts = [
        createMockAlert({ id: 'high', message: 'High severity', severity: 'high' }),
        createMockAlert({ id: 'medium', message: 'Medium severity', severity: 'medium' }),
        createMockAlert({ id: 'low', message: 'Low severity', severity: 'low' }),
      ];

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ alerts }),
          });
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

      const { container } = render(<Popup />);

      await waitFor(() => {
        expect(screen.getByText('High severity')).toBeInTheDocument();
      }, { timeout: 500 });

      expect(container.querySelectorAll('div.bg-red-500')).not.toHaveLength(0);
      expect(container.querySelectorAll('div.bg-amber-500')).not.toHaveLength(0);
      expect(container.querySelectorAll('div.bg-green-500')).not.toHaveLength(0);
    });
  });

  describe('Protection Toggle and Onboarding', () => {
    it('toggles protection and shows a status toast', async () => {
      const user = userEvent.setup({ delay: null });
      let protectionEnabled = true;

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({
              settings: { ...createMockStorageData().settings, protectionEnabled },
            }),
          });
        }
        if (message.type === 'TOGGLE_PROTECTION') {
          protectionEnabled = !protectionEnabled;
          return Promise.resolve({ success: true, enabled: protectionEnabled });
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

      const toggleButton = await screen.findByTitle(/protection enabled/i);
      await user.click(toggleButton);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({ type: 'TOGGLE_PROTECTION' });
        expect(screen.getByText('Protection Paused')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('hides the protection toast after timeout', async () => {
      const user = userEvent.setup({ delay: null });
      let protectionEnabled = true;

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({
              settings: { ...createMockStorageData().settings, protectionEnabled },
            }),
          });
        }
        if (message.type === 'TOGGLE_PROTECTION') {
          protectionEnabled = !protectionEnabled;
          return Promise.resolve({ success: true, enabled: protectionEnabled });
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

      const toggleButton = await screen.findByTitle(/protection enabled/i);
      await user.click(toggleButton);

      await waitFor(() => {
        expect(screen.getByText('Protection Paused')).toBeInTheDocument();
      }, { timeout: 500 });

      await new Promise(resolve => setTimeout(resolve, 3100));
      await waitFor(() => {
        expect(screen.queryByText('Protection Paused')).not.toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('renders the invalid page state and allows settings access', async () => {
      const user = userEvent.setup({ delay: null });
      mockTabsQuery.mockResolvedValue([{ url: 'chrome://extensions', active: true }]);

      render(<Popup />);

      await waitFor(() => {
        expect(
          screen.getByText(/open this extension on a website to see privacy insights/i)
        ).toBeInTheDocument();
      }, { timeout: 500 });

      const settingsButton = screen.getByTitle('Settings');
      await user.click(settingsButton);

      expect(screen.getByTestId('mocked-settings-page')).toBeInTheDocument();
    });

    it('shows onboarding banner and opens the welcome guide', async () => {
      const user = userEvent.setup({ delay: null });
      const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData(),
          });
        }
        if (message.type === 'GET_THEME') {
          return Promise.resolve({ success: true, theme: 'system' });
        }
        if (message.type === 'GET_ONBOARDING_STATE') {
          return Promise.resolve({
            success: true,
            onboarding: { hasCompletedOnboarding: false, currentStep: 1 },
          });
        }
        return Promise.resolve({ success: true });
      });

      render(<Popup />);

      await waitFor(() => {
        expect(screen.getByText('Complete setup')).toBeInTheDocument();
      }, { timeout: 500 });

      await user.click(screen.getByRole('button', { name: /resume/i }));

      expect(global.chrome.tabs.create).toHaveBeenCalledWith(
        { url: 'chrome-extension://test/src/welcome/welcome.html', active: true },
        expect.any(Function)
      );

      closeSpy.mockRestore();
    });
  });

  describe('Clear All Alerts', () => {
    it('should not display Clear All button when no alerts exist', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ alerts: [] }),
          });
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
        expect(screen.getByText('Start browsing to see your privacy insights')).toBeInTheDocument();
      }, { timeout: 500 });

      expect(screen.queryByText('Clear All')).not.toBeInTheDocument();
    });

    it('should display Clear All button when alerts exist', async () => {
      const alerts = [
        createMockAlert({
          id: 'alert-1',
          message: 'Blocked tracker',
          domain: 'example.com',
        }),
      ];

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ alerts }),
          });
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
        expect(screen.getByText('Clear All')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    it('should send CLEAR_ALERTS message and reload data when Clear All is clicked', async () => {
      const user = userEvent.setup({ delay: null });

      const alerts = [
        createMockAlert({
          id: 'alert-1',
          message: 'Blocked tracker',
          domain: 'example.com',
        }),
      ];

      let callCount = 0;
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_STATE') {
          callCount++;
          // First call returns alerts, second call (after clear) returns empty
          return Promise.resolve({
            success: true,
            data: createMockStorageData({ alerts: callCount === 1 ? alerts : [] }),
          });
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
        if (message.type === 'CLEAR_ALERTS') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({ success: true });
      });

      render(<Popup />);

      await waitFor(() => {
        expect(screen.getByText('Clear All')).toBeInTheDocument();
      }, { timeout: 500 });

      const clearButton = screen.getByText('Clear All');
      await user.click(clearButton);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({ type: 'CLEAR_ALERTS' });
      }, { timeout: 500 });

      // After clearing, should reload data and show empty state
      await waitFor(() => {
        expect(screen.getByText('Start browsing to see your privacy insights')).toBeInTheDocument();
      }, { timeout: 500 });
    });
  });
});

