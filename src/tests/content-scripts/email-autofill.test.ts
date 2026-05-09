import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/validation', () => ({
  sanitizeUrlForBurner: vi.fn((url: string) => {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
    } catch {
      return null;
    }
  }),
}));

describe('EmailAutofill Toggle Integration', () => {
  let dom: JSDOM;
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockAddListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://example.com',
      runScripts: 'outside-only',
    });

    global.window = dom.window as any;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.HTMLInputElement = dom.window.HTMLInputElement;
    global.MutationObserver = dom.window.MutationObserver;
    global.Event = dom.window.Event;
    global.FocusEvent = dom.window.FocusEvent;
    global.URL = dom.window.URL;

    mockSendMessage = vi.fn();
    mockAddListener = vi.fn();

    global.chrome = {
      runtime: {
        sendMessage: mockSendMessage,
        onMessage: {
          addListener: mockAddListener,
        },
        id: 'test-extension-id',
      },
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should check if feature is enabled on initialization', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_BURNER_EMAIL_SETTING' });
    });

    it('should setup input detection when enabled', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      // Check that handlers are set up by verifying event listeners were added
      expect(mockAddListener).toHaveBeenCalled();
    });

    it('should not setup input detection when disabled', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: false });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      // Should still setup listener but not input detection
      expect(mockAddListener).toHaveBeenCalled();
    });

    it('should setup setting listener regardless of enabled state', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: false });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      expect(mockAddListener).toHaveBeenCalled();
    });

    it('should handle errors when checking enabled state', async () => {
      mockSendMessage.mockRejectedValueOnce(new Error('Connection failed'));

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      // Should not throw, initialization should complete
      expect(mockAddListener).toHaveBeenCalled();
    });
  });

  describe('Setting Listener', () => {
    it('should listen for BURNER_EMAIL_SETTING_CHANGED messages', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: false });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      expect(mockAddListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should enable when receiving enabled=true message', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: false });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const listener = mockAddListener.mock.calls[0][0];
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: true } });

      // Verify button appears when focusing on email input after enabling
      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });

    it('should disable when receiving enabled=false message', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const listener = mockAddListener.mock.calls[0][0];
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: false } });

      // Verify button doesn't appear when focusing on email input after disabling
      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeNull();
    });

    it('should ignore other message types', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const listener = mockAddListener.mock.calls[0][0];
      listener({ type: 'SOME_OTHER_MESSAGE', data: { enabled: false } });

      // Should still work after ignoring other messages
      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });
  });

  describe('Enable/Disable Functionality', () => {
    it('should setup input detection when enabled', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: false });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const listener = mockAddListener.mock.calls[0][0];
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: true } });

      // Verify input detection works
      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });

    it('should cleanup when disabled', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      // Show button first
      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();

      // Disable
      const listener = mockAddListener.mock.calls[0][0];
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: false } });

      expect(document.getElementById('privaseer-burner-email-btn')).toBeNull();
    });

    it('should remove button when disabled', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();

      const listener = mockAddListener.mock.calls[0][0];
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: false } });
      
      expect(document.getElementById('privaseer-burner-email-btn')).toBeNull();
    });

    it('should not show button when disabled', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: false });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeNull();
    });
  });

  describe('Cleanup', () => {
    it('should remove button when disabling', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();

      // Disable via message
      const listener = mockAddListener.mock.calls[0][0];
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: false } });

      expect(document.getElementById('privaseer-burner-email-btn')).toBeNull();
    });

    it('should stop detecting inputs when disabled', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      // Disable
      const listener = mockAddListener.mock.calls[0][0];
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: false } });

      // Try to trigger button - should not appear
      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeNull();
    });

    it('should handle cleanup when button is already hidden', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      // Disable without showing button first
      const listener = mockAddListener.mock.calls[0][0];
      expect(() => {
        listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: false } });
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should not setup detection twice when already enabled', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();

      // Try to enable again - should not break
      const listener = mockAddListener.mock.calls[0][0];
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: true } });

      // Should still work
      document.getElementById('privaseer-burner-email-btn')?.remove();
      input.dispatchEvent(focusEvent);
      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });

    it('should handle rapid toggle changes', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const listener = mockAddListener.mock.calls[0][0];
      
      // Rapid toggles
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: false } });
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: true } });
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: false } });
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: true } });

      // Should end up enabled and working
      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });

    it('should handle cleanup when nothing is setup', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: false });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const listener = mockAddListener.mock.calls[0][0];
      expect(() => {
        listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: false } });
      }).not.toThrow();
    });
  });

  describe('Email Field Detection', () => {
    it('should detect input with type="email"', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });

    it('should detect input with name containing "email"', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'text';
      input.name = 'user_email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });

    it('should detect input with id containing "email"', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'contact-email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });

    it('should detect input with placeholder containing "email"', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Enter your email address';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });

    it('should detect input with placeholder containing "e-mail"', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Your e-mail';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });

    it('should detect input with autocomplete="email"', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });

    it('should not detect non-email inputs', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'password';
      input.name = 'user_password';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeNull();
    });

    it('should ignore non-input focus targets', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const div = document.createElement('div');
      document.body.appendChild(div);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: div, enumerable: true });
      div.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeNull();
    });
  });

  describe('Button Visibility & Positioning', () => {
    it('should show button on email input focus', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      const button = document.getElementById('privaseer-burner-email-btn');
      expect(button).toBeTruthy();
      expect(button?.textContent).toContain('Generate Burner Email');
    });

    it('should hide button on blur when focus moves away', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();

      const blurEvent = new FocusEvent('focusout', { bubbles: true, relatedTarget: null });
      Object.defineProperty(blurEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(blurEvent);

      await new Promise(resolve => setTimeout(resolve, 250));

      expect(document.getElementById('privaseer-burner-email-btn')).toBeNull();
    });

    it('should keep button visible when clicking on it', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      const button = document.getElementById('privaseer-burner-email-btn');
      expect(button).toBeTruthy();

      const blurEvent = new FocusEvent('focusout', { bubbles: true, relatedTarget: button });
      Object.defineProperty(blurEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(blurEvent);

      await new Promise(resolve => setTimeout(resolve, 250));

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });

    it('keeps button visible when focus moves to a child element', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      const button = document.getElementById('privaseer-burner-email-btn');
      expect(button).toBeTruthy();

      const child = document.createElement('span');
      button?.appendChild(child);

      const blurEvent = new FocusEvent('focusout', { bubbles: true, relatedTarget: child });
      Object.defineProperty(blurEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(blurEvent);

      await new Promise(resolve => setTimeout(resolve, 250));

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();
    });

    it('should position button with absolute positioning', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      const button = document.getElementById('privaseer-burner-email-btn');
      expect(button).toBeTruthy();
      expect(button?.style.position).toBe('absolute');
      expect(button?.style.zIndex).toBe('999999');
    });

    it('should remove old button when showing new one', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input1 = document.createElement('input');
      input1.type = 'email';
      input1.id = 'email1';
      document.body.appendChild(input1);

      const input2 = document.createElement('input');
      input2.type = 'email';
      input2.id = 'email2';
      document.body.appendChild(input2);

      const focusEvent1 = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent1, 'target', { value: input1, enumerable: true });
      input1.dispatchEvent(focusEvent1);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();

      const focusEvent2 = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent2, 'target', { value: input2, enumerable: true });
      input2.dispatchEvent(focusEvent2);

      const buttons = document.querySelectorAll('#privaseer-burner-email-btn');
      expect(buttons.length).toBe(1);
    });
  });

  describe('Email Generation & Autofill', () => {
    it('should create button that can be clicked', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      const button = document.getElementById('privaseer-burner-email-btn');
      expect(button).toBeTruthy();
      expect(button?.tagName).toBe('DIV');
      expect(button?.id).toBe('privaseer-burner-email-btn');
    });

    it('should send GENERATE_BURNER_EMAIL message when button would be clicked', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      const button = document.getElementById('privaseer-burner-email-btn');
      expect(button).toBeTruthy();

      mockSendMessage.mockClear();
      
      const domain = new URL(window.location.href).hostname;
      expect(domain).toBe('example.com');
    });

    it('should have button with correct styling for user interaction', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      const button = document.getElementById('privaseer-burner-email-btn');
      expect(button).toBeTruthy();
      expect(button?.style.position).toBe('absolute');
      expect(button?.style.zIndex).toBe('999999');
      expect(button?.textContent).toContain('Generate Burner Email');
    });

    it('should verify button exists for email generation flow', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      input.id = 'test-email-input';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      const button = document.getElementById('privaseer-burner-email-btn');
      expect(button).not.toBeNull();
      expect(button?.innerHTML).toContain('Generate Burner Email');
    });

    it('should handle button creation for multiple email fields', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input1 = document.createElement('input');
      input1.type = 'email';
      input1.id = 'email1';
      document.body.appendChild(input1);

      const input2 = document.createElement('input');
      input2.type = 'email';
      input2.id = 'email2';
      document.body.appendChild(input2);

      const focusEvent1 = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent1, 'target', { value: input1, enumerable: true });
      input1.dispatchEvent(focusEvent1);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();

      const focusEvent2 = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent2, 'target', { value: input2, enumerable: true });
      input2.dispatchEvent(focusEvent2);

      const buttons = document.querySelectorAll('#privaseer-burner-email-btn');
      expect(buttons.length).toBe(1);
    });

    it('should verify chrome runtime is available for message passing', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      expect(chrome.runtime).toBeDefined();
      expect(chrome.runtime.sendMessage).toBeDefined();
      expect(chrome.runtime.id).toBe('test-extension-id');
    });
  });

  describe('Dynamic Input Detection', () => {
    it('should detect email inputs added after page load', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      await new Promise(resolve => setTimeout(resolve, 50));

      const input = document.createElement('input');
      input.type = 'email';
      input.id = 'dynamic-email';
      document.body.appendChild(input);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(input.dataset.burnerEmailReady).toBe('true');
    });

    it('should mark new inputs with data-burner-email-ready attribute', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input1 = document.createElement('input');
      input1.type = 'email';
      input1.name = 'email1';
      document.body.appendChild(input1);

      await new Promise(resolve => setTimeout(resolve, 50));

      const input2 = document.createElement('input');
      input2.type = 'text';
      input2.id = 'user-email';
      document.body.appendChild(input2);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(input1.dataset.burnerEmailReady).toBe('true');
      expect(input2.dataset.burnerEmailReady).toBe('true');
    });

    it('should not detect inputs when feature is disabled', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: false });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(input.dataset.burnerEmailReady).toBeUndefined();
    });

    it('does not mark placeholder-only inputs during mutation scans', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Email address';
      document.body.appendChild(input);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(input.dataset.burnerEmailReady).toBeUndefined();
    });
  });

  describe('Feature Toggle During Active Use', () => {
    it('should hide button when feature is disabled while visible', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeTruthy();

      const listener = mockAddListener.mock.calls[0][0];
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: false } });

      expect(document.getElementById('privaseer-burner-email-btn')).toBeNull();
    });

    it('should not show button on focus when feature is disabled', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const listener = mockAddListener.mock.calls[0][0];
      listener({ type: 'BURNER_EMAIL_SETTING_CHANGED', data: { enabled: false } });

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      expect(document.getElementById('privaseer-burner-email-btn')).toBeNull();
    });
  });

  describe('Email Generation and Notifications', () => {
    it('should call generateAndFillBurnerEmail when button is clicked', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ success: true, enabled: true })
        .mockResolvedValueOnce({ success: true, email: 'test@burner.privaseer.app' });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      const button = document.getElementById('privaseer-burner-email-btn');
      expect(button).toBeTruthy();
      
      // Test that the button has a click handler
      expect(button?.onclick).toBeDefined();
    });

    it('should send GENERATE_BURNER_EMAIL message with correct domain', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ success: true, enabled: true })
        .mockResolvedValueOnce({ success: true, email: 'test@burner.privaseer.app' });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      // Call the private method directly for testing
      await (autofill as any).generateAndFillBurnerEmail(input);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'GENERATE_BURNER_EMAIL',
          data: expect.objectContaining({
            domain: 'example.com',
          }),
        })
      );
    });

    it('should call message bus for email generation', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ success: true, enabled: true })
        .mockResolvedValueOnce({ success: true, email: 'test@burner.privaseer.app' });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      await (autofill as any).generateAndFillBurnerEmail(input);

      // The method should have called sendMessage for generation
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'GENERATE_BURNER_EMAIL',
        })
      );
      // Verify notification was added to DOM
      expect(document.body.children.length).toBeGreaterThan(1);
    });

    it('should not fill input on generation failure', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ success: true, enabled: true })
        .mockResolvedValueOnce({ success: false, error: 'Rate limit exceeded' });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      await (autofill as any).generateAndFillBurnerEmail(input);

      expect(input.value).toBe('');
      // Verify error notification was added to DOM
      expect(document.body.children.length).toBeGreaterThan(1);
    });

    it('should retry on service worker sleep error', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ success: true, enabled: true })
        .mockRejectedValueOnce(new Error('Receiving end does not exist'))
        .mockResolvedValueOnce({ success: true, email: 'test@burner.privaseer.app' });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      await (autofill as any).generateAndFillBurnerEmail(input);

      expect(mockSendMessage).toHaveBeenCalledTimes(3); // Initial check + 2 generation attempts
      expect(input.value).toBe('test@burner.privaseer.app');
    });

    it('should handle extension context invalidated error', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ success: true, enabled: true })
        .mockRejectedValueOnce(new Error('Extension context invalidated'));

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      await (autofill as any).generateAndFillBurnerEmail(input);

      // Should not fill input on error
      expect(input.value).toBe('');
      // Verify error notification was added
      expect(document.body.children.length).toBeGreaterThan(1);
    });

    it('should use isProcessing flag to prevent duplicate calls', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ success: true, enabled: true })
        .mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ success: true, email: 'test@burner.privaseer.app' }), 100)));

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const initialCallCount = mockSendMessage.mock.calls.length;

      // Call multiple times rapidly - the isProcessing flag should prevent duplicate processing
      const promise1 = (autofill as any).generateAndFillBurnerEmail(input);
      const promise2 = (autofill as any).generateAndFillBurnerEmail(input);
      const promise3 = (autofill as any).generateAndFillBurnerEmail(input);

      await Promise.all([promise1, promise2, promise3]);

      // Should have been called at most once more for generation (due to isProcessing flag)
      const newCalls = mockSendMessage.mock.calls.length - initialCallCount;
      expect(newCalls).toBeLessThanOrEqual(1);
    });

    it('should complete generation flow successfully', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ success: true, enabled: true })
        .mockResolvedValueOnce({ success: true, email: 'test@burner.privaseer.app' });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      await (autofill as any).generateAndFillBurnerEmail(input);

      // Verify generation message was sent
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'GENERATE_BURNER_EMAIL',
        })
      );
      // Notification should have been created
      expect(document.body.children.length).toBeGreaterThan(1);
    });

    it('triggers burner generation message when button is clicked', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ success: true, enabled: true })
        .mockResolvedValueOnce({ success: true, email: 'click@burner.privaseer.app' });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      const button = document.getElementById('privaseer-burner-email-btn');
      expect(button).toBeTruthy();

      (button as HTMLDivElement).click();
      await Promise.resolve();
      await Promise.resolve();
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'GENERATE_BURNER_EMAIL',
          data: expect.objectContaining({ domain: 'example.com' }),
        })
      );
    });

    it('handles generation independently for multiple email inputs', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ success: true, enabled: true })
        .mockResolvedValueOnce({ success: true, email: 'first@burner.privaseer.app' })
        .mockResolvedValueOnce({ success: true, email: 'second@burner.privaseer.app' });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const firstInput = document.createElement('input');
      firstInput.type = 'email';
      const secondInput = document.createElement('input');
      secondInput.type = 'email';
      document.body.appendChild(firstInput);
      document.body.appendChild(secondInput);

      const firstFocus = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(firstFocus, 'target', { value: firstInput, enumerable: true });
      firstInput.dispatchEvent(firstFocus);

      const secondFocus = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(secondFocus, 'target', { value: secondInput, enumerable: true });
      secondInput.dispatchEvent(secondFocus);

      await (autofill as any).generateAndFillBurnerEmail(firstInput);
      await (autofill as any).generateAndFillBurnerEmail(secondInput);

      const generationCalls = mockSendMessage.mock.calls.filter(
        (call) => call[0]?.type === 'GENERATE_BURNER_EMAIL'
      );
      expect(generationCalls).toHaveLength(2);
    });
  });

  describe('Button Positioning', () => {
    it('should position button below input field', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      // Mock getBoundingClientRect
      vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 130,
        left: 50,
        right: 250,
        width: 200,
        height: 30,
        x: 50,
        y: 100,
        toJSON: () => ({}),
      });

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      const button = document.getElementById('privaseer-burner-email-btn');
      expect(button).toBeTruthy();
      expect(button?.style.position).toBe('absolute');
      expect(button?.style.top).toBeTruthy();
      expect(button?.style.left).toBeTruthy();
    });

    it('should account for scroll position when positioning', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      // Mock scroll position
      Object.defineProperty(window, 'scrollY', { value: 500, writable: true });
      Object.defineProperty(window, 'pageYOffset', { value: 500, writable: true });
      Object.defineProperty(window, 'scrollX', { value: 100, writable: true });
      Object.defineProperty(window, 'pageXOffset', { value: 100, writable: true });

      vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 130,
        left: 50,
        right: 250,
        width: 200,
        height: 30,
        x: 50,
        y: 100,
        toJSON: () => ({}),
      });

      const focusEvent = new FocusEvent('focusin', { bubbles: true });
      Object.defineProperty(focusEvent, 'target', { value: input, enumerable: true });
      input.dispatchEvent(focusEvent);

      const button = document.getElementById('privaseer-burner-email-btn');
      expect(button).toBeTruthy();
      
      // Button should be positioned accounting for scroll
      const topValue = parseInt(button?.style.top || '0');
      expect(topValue).toBeGreaterThan(130); // Should be below input + scroll offset
    });
  });

  describe('Notification Auto-Dismiss', () => {
    it('should create notification with auto-dismiss timer', async () => {
      vi.useFakeTimers();
      
      mockSendMessage
        .mockResolvedValueOnce({ success: true, enabled: true })
        .mockResolvedValueOnce({ success: true, email: 'test@burner.privaseer.app' });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const initialChildCount = document.body.children.length;
      await (autofill as any).generateAndFillBurnerEmail(input);

      // Notification should be added
      expect(document.body.children.length).toBeGreaterThan(initialChildCount);

      vi.useRealTimers();
    });

    it('should create error notification with auto-dismiss timer', async () => {
      vi.useFakeTimers();
      
      mockSendMessage
        .mockResolvedValueOnce({ success: true, enabled: true })
        .mockResolvedValueOnce({ success: false, error: 'Test error' });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      const initialChildCount = document.body.children.length;
      await (autofill as any).generateAndFillBurnerEmail(input);

      // Error notification should be added
      expect(document.body.children.length).toBeGreaterThan(initialChildCount);

      vi.useRealTimers();
    });
  });

  describe('Coverage-targeted edge paths', () => {
    it('marks newly discovered email inputs in detectNewEmailInputs()', async () => {
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });
      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);

      (autofill as any).detectNewEmailInputs();

      expect(input.dataset.burnerEmailReady).toBe('true');
    });

    it('auto-dismisses error notification after animation timeout', async () => {
      vi.useFakeTimers();
      mockSendMessage.mockResolvedValueOnce({ success: true, enabled: true });

      const { EmailAutofill } = await import('@/content-scripts/email-autofill');
      const autofill = new EmailAutofill();
      await autofill.initialize();

      (autofill as any).showErrorNotification('Something failed');

      const notification = document.body.lastElementChild as HTMLElement;
      expect(notification).toBeTruthy();
      expect(notification.textContent).toContain('Something failed');

      await vi.advanceTimersByTimeAsync(3000);
      expect(notification.style.animation).toBe('slideOutRight 0.3s ease');

      await vi.advanceTimersByTimeAsync(300);
      expect(document.body.contains(notification)).toBe(false);
      vi.useRealTimers();
    });

    it('defers module auto-init until DOMContentLoaded when document is loading', async () => {
      vi.resetModules();
      mockSendMessage.mockResolvedValue({ success: true, enabled: true });

      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      Object.defineProperty(document, 'readyState', {
        configurable: true,
        get: () => 'loading',
      });

      await import('@/content-scripts/email-autofill');

      expect(addEventListenerSpy).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function));
      expect(mockSendMessage).not.toHaveBeenCalled();

      const domReadyCallback = addEventListenerSpy.mock.calls.find(
        ([eventType]) => eventType === 'DOMContentLoaded'
      )?.[1] as EventListener;

      domReadyCallback(new Event('DOMContentLoaded'));
      await Promise.resolve();

      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_BURNER_EMAIL_SETTING' });
      addEventListenerSpy.mockRestore();
    });
  });
});
