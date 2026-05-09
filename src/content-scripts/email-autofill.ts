import { logger } from '../utils/logger';
import { toError } from '../utils/type-guards';
import { sanitizeUrlForBurner } from '../utils/validation';

export class EmailAutofill {
  private isProcessing: boolean = false;
  private burnerEmailButton: HTMLElement | null = null;
  private isEnabled: boolean = false;
  private focusinHandler: ((event: Event) => void) | null = null;
  private focusoutHandler: ((event: Event) => void) | null = null;
  private mutationObserver: MutationObserver | null = null;

  async initialize(): Promise<void> {
    try {
      const enabled = await this.checkIfEnabled();
      this.isEnabled = enabled;

      if (this.isEnabled) {
        this.setupInputDetection();
      }

      this.setupSettingListener();
      logger.debug('EmailAutofill', 'Initialized successfully', { url: window.location.href, enabled: this.isEnabled });
    } catch (error) {
      logger.error('EmailAutofill', 'Failed to initialize', toError(error));
    }
  }

  private async checkIfEnabled(): Promise<boolean> {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_BURNER_EMAIL_SETTING' });
      return response?.success && response?.enabled === true;
    } catch (error) {
      logger.error('EmailAutofill', 'Failed to check if enabled', toError(error));
      return false;
    }
  }

  private setupSettingListener(): void {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'BURNER_EMAIL_SETTING_CHANGED') {
        const enabled = message.data?.enabled === true;
        logger.debug('EmailAutofill', 'Setting changed', { enabled });

        if (enabled && !this.isEnabled) {
          this.enable();
        } else if (!enabled && this.isEnabled) {
          this.disable();
        }
      }
    });
  }

  private enable(): void {
    this.isEnabled = true;
    this.setupInputDetection();
    logger.info('EmailAutofill', 'Burner email feature enabled');
  }

  private disable(): void {
    this.isEnabled = false;
    this.cleanup();
    logger.info('EmailAutofill', 'Burner email feature disabled');
  }

  private setupInputDetection(): void {
    if (this.focusinHandler || this.focusoutHandler) {
      return;
    }

    this.focusinHandler = (event: Event) => {
      if (!this.isEnabled) return;

      const target = event.target as HTMLElement;

      if (this.isEmailInput(target)) {
        this.showBurnerEmailButton(target as HTMLInputElement);
      }
    };

    this.focusoutHandler = (event: Event) => {
      if (!this.isEnabled) return;

      const target = event.target as HTMLElement;

      if (this.isEmailInput(target)) {
        setTimeout(() => {
          const relatedTarget = (event as FocusEvent).relatedTarget as HTMLElement;
          if (relatedTarget !== this.burnerEmailButton && !this.burnerEmailButton?.contains(relatedTarget)) {
            this.hideBurnerEmailButton();
          }
        }, 200);
      }
    };

    document.addEventListener('focusin', this.focusinHandler);
    document.addEventListener('focusout', this.focusoutHandler);

    this.mutationObserver = new MutationObserver(() => {
      if (this.isEnabled) {
        this.detectNewEmailInputs();
      }
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    logger.debug('EmailAutofill', 'Input detection setup complete');
  }

  private cleanup(): void {
    if (this.focusinHandler) {
      document.removeEventListener('focusin', this.focusinHandler);
      this.focusinHandler = null;
    }

    if (this.focusoutHandler) {
      document.removeEventListener('focusout', this.focusoutHandler);
      this.focusoutHandler = null;
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    this.hideBurnerEmailButton();

    logger.debug('EmailAutofill', 'Cleanup complete');
  }

  private isEmailInput(element: HTMLElement): boolean {
    if (!(element instanceof HTMLInputElement)) return false;

    const type = element.type?.toLowerCase();
    const name = element.name?.toLowerCase();
    const id = element.id?.toLowerCase();
    const placeholder = element.placeholder?.toLowerCase();
    const autocomplete = element.autocomplete?.toLowerCase();

    return (
      type === 'email' ||
      autocomplete === 'email' ||
      name?.includes('email') ||
      id?.includes('email') ||
      placeholder?.includes('email') ||
      placeholder?.includes('e-mail')
    );
  }

  private detectNewEmailInputs(): void {
    const inputs = document.querySelectorAll('input[type="email"], input[name*="email" i], input[id*="email" i]');

    inputs.forEach((input) => {
      if (input instanceof HTMLInputElement && !input.dataset.burnerEmailReady) {
        input.dataset.burnerEmailReady = 'true';
      }
    });
  }

  private showBurnerEmailButton(input: HTMLInputElement): void {
    if (this.burnerEmailButton) {
      this.hideBurnerEmailButton();
    }

    const button = document.createElement('div');
    button.id = 'privaseer-burner-email-btn';
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', 'Generate burner email address');
    button.setAttribute('tabindex', '0');
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
        <polyline points="22,6 12,13 2,6"></polyline>
        <path d="M12 13l-8 5"></path>
        <path d="M12 13l8 5"></path>
      </svg>
      <span>Generate Burner Email</span>
    `;

    button.style.cssText = `
      position: absolute;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      transition: all 0.2s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-2px)';
      button.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.5)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
    });

    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      button.style.opacity = '0.6';
      button.style.pointerEvents = 'none';

      await this.generateAndFillBurnerEmail(input);
    });

    button.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (button.style.pointerEvents === 'none') {
        return;
      }

      button.style.opacity = '0.6';
      button.style.pointerEvents = 'none';

      await this.generateAndFillBurnerEmail(input);
    });

    this.positionButton(button, input);
    document.body.appendChild(button);
    this.burnerEmailButton = button;
  }

  private positionButton(button: HTMLElement, input: HTMLInputElement): void {
    const rect = input.getBoundingClientRect();
    const scrollY = window.scrollY || window.pageYOffset;
    const scrollX = window.scrollX || window.pageXOffset;

    button.style.top = `${rect.bottom + scrollY + 8}px`;
    button.style.left = `${rect.left + scrollX}px`;
  }

  private hideBurnerEmailButton(): void {
    if (this.burnerEmailButton) {
      this.burnerEmailButton.remove();
      this.burnerEmailButton = null;
    }
  }

  private async generateAndFillBurnerEmail(input: HTMLInputElement): Promise<void> {
    if (this.isProcessing) {
      logger.debug('EmailAutofill', 'Already processing, ignoring click');
      return;
    }

    this.isProcessing = true;
    logger.debug('EmailAutofill', 'Starting burner email generation');

    try {
      const domain = new URL(window.location.href).hostname;
      logger.debug('EmailAutofill', 'Domain:', { domain });

      if (!chrome?.runtime?.id) {
        logger.error('EmailAutofill', 'Extension context invalidated');
        throw new Error('Extension context invalidated - please reload the page');
      }

      logger.debug('EmailAutofill', 'Sending message to background', { domain });

      let response;
      let retries = 0;
      const maxRetries = 2;

      while (retries <= maxRetries) {
        try {
          logger.debug('EmailAutofill', `Sending GENERATE_BURNER_EMAIL message (attempt ${retries + 1}/${maxRetries + 1})`);
          const sanitizedUrl = sanitizeUrlForBurner(window.location.href);
          response = await chrome.runtime.sendMessage({
            type: 'GENERATE_BURNER_EMAIL',
            data: {
              domain,
              ...(sanitizedUrl && { url: sanitizedUrl }),
            },
          });
          logger.debug('EmailAutofill', 'Response received from background', { response });
          break;
        } catch (err) {
          const error = toError(err);
          logger.error('EmailAutofill', 'Message send error', error, { errorMessage: error.message });
          if (error.message.includes('Receiving end does not exist') && retries < maxRetries) {
            logger.debug('EmailAutofill', `Service worker asleep, retrying in 500ms...`);
            retries++;
            await new Promise(resolve => setTimeout(resolve, 500));
          } else {
            throw error;
          }
        }
      }

      logger.debug('EmailAutofill', 'Final response from background', { response });

      if (response && response.success && response.email) {
        input.value = response.email;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        this.showSuccessNotification(response.email);
        this.hideBurnerEmailButton();

        logger.info('EmailAutofill', 'Burner email generated and filled', { domain, email: response.email });
      } else {
        const errorMsg = response?.error || 'Failed to generate burner email';
        logger.error('EmailAutofill', 'Generation failed', new Error(errorMsg));
        this.showErrorNotification(errorMsg);
        this.hideBurnerEmailButton();
      }
    } catch (error) {
      const err = toError(error);
      logger.error('EmailAutofill', 'Failed to generate burner email', err);

      if (err.message.includes('Extension context invalidated')) {
        this.showErrorNotification('Please reload the page to use burner emails');
      } else if (err.message.includes('Receiving end does not exist')) {
        this.showErrorNotification('Extension not ready - please try again');
      } else {
        this.showErrorNotification('Could not generate burner email');
      }

      this.hideBurnerEmailButton();
    } finally {
      this.isProcessing = false;
    }
  }

  private showSuccessNotification(email: string): void {
    const notification = document.createElement('div');
    notification.setAttribute('role', 'alert');
    notification.setAttribute('aria-live', 'assertive');
    notification.setAttribute('aria-atomic', 'true');
    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        <div>
          <div style="font-weight: 600; margin-bottom: 2px;">Burner Email Created</div>
          <div style="font-size: 12px; opacity: 0.9;">${email}</div>
        </div>
      </div>
    `;

    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 8px;
      font-size: 14px;
      z-index: 9999999;
      box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
      animation: slideInRight 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  private showErrorNotification(message: string): void {
    const notification = document.createElement('div');
    notification.setAttribute('role', 'alert');
    notification.setAttribute('aria-live', 'assertive');
    notification.setAttribute('aria-atomic', 'true');
    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <div>${message}</div>
      </div>
    `;

    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 20px;
      background: #ef4444;
      color: white;
      border-radius: 8px;
      font-size: 14px;
      z-index: 9999999;
      box-shadow: 0 8px 24px rgba(239, 68, 68, 0.4);
      animation: slideInRight 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

const autofill = new EmailAutofill();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => autofill.initialize());
} else {
  autofill.initialize();
}
