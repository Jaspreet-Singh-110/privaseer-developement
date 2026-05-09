import { ThemeManager, type ThemePreference } from './theme-manager';
import { logger } from './logger';
import { toError } from './type-guards';

export class ThemeHelper {
  static async getCurrentTheme(): Promise<ThemePreference> {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_THEME' });
      if (response.success && response.theme) {
        return response.theme as ThemePreference;
      }
      return 'system';
    } catch (error) {
      logger.error('ThemeHelper', 'Failed to get current theme', toError(error));
      return 'system';
    }
  }

  static async setTheme(theme: ThemePreference): Promise<boolean> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_THEME',
        data: { theme }
      });
      return response.success;
    } catch (error) {
      logger.error('ThemeHelper', 'Failed to set theme', toError(error));
      return false;
    }
  }

  static setupThemeListener(callback?: (theme: ThemePreference) => void): () => void {
    const listener = (message: { type: string; data?: { theme: ThemePreference } }) => {
      if (message.type === 'THEME_CHANGED' && message.data?.theme) {
        ThemeManager.updatePreference(message.data.theme);
        callback?.(message.data.theme);
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }

  static async initializeTheme(callback?: (theme: ThemePreference) => void): Promise<() => void> {
    const theme = await this.getCurrentTheme();
    ThemeManager.initialize(theme);

    const removeListener = this.setupThemeListener(callback);

    return () => {
      removeListener();
      ThemeManager.cleanup();
    };
  }
}
