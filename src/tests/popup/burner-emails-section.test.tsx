import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BurnerEmailsSection } from '../../popup/burner-emails-section';
import type { BurnerEmail } from '../../types';

describe('BurnerEmailsSection', () => {
  const originalChrome = global.chrome;
  const originalClipboard = global.navigator.clipboard;
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockAddListener: ReturnType<typeof vi.fn>;
  let mockRemoveListener: ReturnType<typeof vi.fn>;
  let mockClipboardWriteText: ReturnType<typeof vi.fn>;

  const mockBurnerEmails: BurnerEmail[] = [
    {
      id: 'email-1',
      email_address: 'burner1@privaseer.email',
      domain: 'example.com',
      is_active: true,
      times_used: 0,
      created_at: new Date().toISOString(),
    },
    {
      id: 'email-2',
      email_address: 'burner2@privaseer.email',
      domain: 'test.org',
      label: 'Newsletter signup',
      is_active: true,
      times_used: 3,
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
  ];

  beforeEach(() => {
    mockSendMessage = vi.fn();
    mockAddListener = vi.fn();
    mockRemoveListener = vi.fn();
    mockClipboardWriteText = vi.fn().mockResolvedValue(undefined);

    // Mock Chrome APIs
    global.chrome = {
      runtime: {
        sendMessage: mockSendMessage,
        onMessage: {
          addListener: mockAddListener,
          removeListener: mockRemoveListener,
        },
      },
    } as unknown as typeof chrome;

    // Mock clipboard API
    if (!global.navigator.clipboard) {
      Object.defineProperty(global.navigator, 'clipboard', {
        value: {
          writeText: mockClipboardWriteText,
        },
        writable: true,
        configurable: true,
      });
    } else {
      global.navigator.clipboard.writeText = mockClipboardWriteText as any;
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
    global.chrome = originalChrome;
    if (originalClipboard) {
      Object.defineProperty(global.navigator, 'clipboard', {
        value: originalClipboard,
        writable: true,
        configurable: true,
      });
    }
  });

  describe('Feature Disabled State', () => {
    it('should show "Feature is off" message when disabled', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: false });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: [] });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: null });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText(/Feature is off/i)).toBeInTheDocument();
      });
    });

    it('should show "Go to Settings" button when disabled', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: false });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: [] });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: null });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText('Go to Settings')).toBeInTheDocument();
      });
    });

    it('should call onOpenSettings callback when button clicked', async () => {
      const user = userEvent.setup();
      const mockOnOpenSettings = vi.fn();

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: false });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: [] });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: null });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection onOpenSettings={mockOnOpenSettings} />);

      await waitFor(() => {
        expect(screen.getByText('Go to Settings')).toBeInTheDocument();
      });

      const settingsButton = screen.getByText('Go to Settings');
      await user.click(settingsButton);

      expect(mockOnOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('should hide email configuration form when disabled', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: false });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: [] });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: null });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText(/Feature is off/i)).toBeInTheDocument();
      });

      // Email configuration form should not be visible
      expect(screen.queryByText('Forwarding Email Address')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('your.email@example.com')).not.toBeInTheDocument();
    });

    it('still shows existing emails when feature is disabled', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: false });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: mockBurnerEmails });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: null });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText('burner1@privaseer.email')).toBeInTheDocument();
      });

      const copyButtons = screen.getAllByLabelText(/Copy email address/i);
      const deleteButtons = screen.getAllByLabelText(/Delete email address/i);
      expect(copyButtons).toHaveLength(2);
      expect(deleteButtons).toHaveLength(2);
    });
  });

  describe('Real Email Validation and Save', () => {
    it('should show email input when feature is enabled', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: [] });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: null });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText('Forwarding Email Address')).toBeInTheDocument();
      });

      expect(screen.getByPlaceholderText('your.email@example.com')).toBeInTheDocument();
    });

    it('should disable save button when email input is empty', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: [] });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: null });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('your.email@example.com')).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /Save Email/i });
      // Button should be disabled when input is empty
      expect(saveButton).toBeDisabled();
    });

    it('should validate invalid email format and show error', async () => {
      const user = userEvent.setup();

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: [] });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: null });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('your.email@example.com')).toBeInTheDocument();
      });

      const emailInput = screen.getByPlaceholderText('your.email@example.com');
      await user.type(emailInput, 'invalid-email');

      const saveButton = screen.getByRole('button', { name: /Save Email/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/Invalid email format/i)).toBeInTheDocument();
      });
    });

    it('should successfully save valid email', async () => {
      const user = userEvent.setup();

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: [] });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: null });
        }
        if (message.type === 'SET_REAL_EMAIL') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('your.email@example.com')).toBeInTheDocument();
      });

      const emailInput = screen.getByPlaceholderText('your.email@example.com');
      await user.type(emailInput, 'test@example.com');

      const saveButton = screen.getByRole('button', { name: /Save Email/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'SET_REAL_EMAIL',
          data: { email: 'test@example.com' },
        });
      });
    });

    it('should display masked current email after save', async () => {
      const user = userEvent.setup();

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: [] });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: null });
        }
        if (message.type === 'SET_REAL_EMAIL') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('your.email@example.com')).toBeInTheDocument();
      });

      const emailInput = screen.getByPlaceholderText('your.email@example.com');
      await user.type(emailInput, 'user@example.com');

      const saveButton = screen.getByRole('button', { name: /Save Email/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'SET_REAL_EMAIL',
          data: { email: 'user@example.com' },
        });
      });

      // After save, the masked email should be displayed
      await waitFor(() => {
        expect(screen.getByText(/u\*\*\*@example\.com/)).toBeInTheDocument();
      });
    });
  });

  describe('Email List Display', () => {
    it('should render empty state when no emails exist', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: [] });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: null });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText('No burner emails yet')).toBeInTheDocument();
      });

      expect(screen.getByText(/Focus any email field on a website to generate one/i)).toBeInTheDocument();
    });

    it('should display list of burner emails with address and domain', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: mockBurnerEmails });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: 'test@example.com' });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText('burner1@privaseer.email')).toBeInTheDocument();
      });

      expect(screen.getByText('burner2@privaseer.email')).toBeInTheDocument();
      expect(screen.getByText('example.com')).toBeInTheDocument();
      expect(screen.getByText('test.org')).toBeInTheDocument();
    });

    it('should show Copy and Delete buttons for each email', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: mockBurnerEmails });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: 'test@example.com' });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText('burner1@privaseer.email')).toBeInTheDocument();
      });

      // Check for copy buttons (aria-label includes "Copy email address")
      const copyButtons = screen.getAllByLabelText(/Copy email address/i);
      expect(copyButtons).toHaveLength(2);

      // Check for delete buttons (aria-label includes "Delete email address")
      const deleteButtons = screen.getAllByLabelText(/Delete email address/i);
      expect(deleteButtons).toHaveLength(2);
    });

    it('should display creation date for each email', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: mockBurnerEmails });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: 'test@example.com' });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText('burner1@privaseer.email')).toBeInTheDocument();
      });

      // First email should show "Just now" or similar
      expect(screen.getByText(/Just now|m ago|h ago/i)).toBeInTheDocument();

      // Second email should show "1d ago" (created 1 day ago)
      expect(screen.getByText('1d ago')).toBeInTheDocument();
    });
  });

  describe('Button Interactions', () => {
    it('should copy email to clipboard when Copy button clicked', async () => {
      const user = userEvent.setup();

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: mockBurnerEmails });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: 'test@example.com' });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText('burner1@privaseer.email')).toBeInTheDocument();
      });

      const copyButtons = screen.getAllByLabelText(/Copy email address/i);
      await user.click(copyButtons[0]);

      await waitFor(() => {
        expect(mockClipboardWriteText).toHaveBeenCalledWith('burner1@privaseer.email');
      });
    });

    it('should show checkmark feedback after copy', async () => {
      const user = userEvent.setup();

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: mockBurnerEmails });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: 'test@example.com' });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText('burner1@privaseer.email')).toBeInTheDocument();
      });

      const copyButtons = screen.getAllByLabelText(/Copy email address/i);
      await user.click(copyButtons[0]);

      // Checkmark should appear after copy
      await waitFor(() => {
        expect(mockClipboardWriteText).toHaveBeenCalledWith('burner1@privaseer.email');
      });

      // The checkmark SVG should be visible
      const svgElement = copyButtons[0].querySelector('svg');
      expect(svgElement).toBeInTheDocument();
    });

    it('should send DELETE_BURNER_EMAIL message when Delete button clicked', async () => {
      const user = userEvent.setup();

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: mockBurnerEmails });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: 'test@example.com' });
        }
        if (message.type === 'DELETE_BURNER_EMAIL') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText('burner1@privaseer.email')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByLabelText(/Delete email address/i);
      
      // Clear previous calls
      mockSendMessage.mockClear();
      
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'DELETE_BURNER_EMAIL',
          data: { emailId: 'email-1' },
        });
      });
    });

    it('should remove email from displayed list after delete', async () => {
      const user = userEvent.setup();

      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: mockBurnerEmails });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: 'test@example.com' });
        }
        if (message.type === 'DELETE_BURNER_EMAIL') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      await waitFor(() => {
        expect(screen.getByText('burner1@privaseer.email')).toBeInTheDocument();
        expect(screen.getByText('burner2@privaseer.email')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByLabelText(/Delete email address/i);
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.queryByText('burner1@privaseer.email')).not.toBeInTheDocument();
      });

      // Second email should still be visible
      expect(screen.getByText('burner2@privaseer.email')).toBeInTheDocument();
    });
  });

  describe('Additional Edge Cases', () => {
    it('should show loading state initially', () => {
      mockSendMessage.mockImplementation(() => new Promise(() => {})); // Never resolves

      render(<BurnerEmailsSection />);

      // Loading skeleton should be visible
      const loadingElement = screen.getByText((_content, element) => {
        return element?.classList.contains('animate-pulse') ?? false;
      });
      expect(loadingElement).toBeInTheDocument();
    });

    it('should display label when burner email has one', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: mockBurnerEmails });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: 'test@example.com' });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      // Wait for component to load first
      await waitFor(() => {
        expect(screen.getByText('burner2@privaseer.email')).toBeInTheDocument();
      });

      // Then check for the label
      expect(screen.getByText('Newsletter signup')).toBeInTheDocument();
    });

    it('should show warning when feature enabled but no real email configured', async () => {
      mockSendMessage.mockImplementation((message) => {
        if (message.type === 'GET_BURNER_EMAIL_SETTING') {
          return Promise.resolve({ success: true, enabled: true });
        }
        if (message.type === 'GET_BURNER_EMAILS') {
          return Promise.resolve({ success: true, emails: [] });
        }
        if (message.type === 'GET_REAL_EMAIL') {
          return Promise.resolve({ success: true, email: null });
        }
        return Promise.resolve({ success: true });
      });

      render(<BurnerEmailsSection />);

      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText('Forwarding Email Address')).toBeInTheDocument();
      });

      // Check for the warning message
      expect(screen.getByText('Forwarding Email Not Configured')).toBeInTheDocument();
      expect(screen.getByText(/To receive emails at your burner addresses/i)).toBeInTheDocument();
    });
  });
});

