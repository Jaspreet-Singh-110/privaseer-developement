import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeHelper } from '@/utils/theme-helper';
import { ThemeManager } from '@/utils/theme-manager';

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ThemeHelper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    } as any;
  });

  describe('getCurrentTheme', () => {
    it('should return theme from successful response', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        theme: 'dark',
      });

      const theme = await ThemeHelper.getCurrentTheme();
      expect(theme).toBe('dark');
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'GET_THEME' });
    });

    it('should return system theme when response fails', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: false,
      });

      const theme = await ThemeHelper.getCurrentTheme();
      expect(theme).toBe('system');
    });

    it('should return system theme on error', async () => {
      (global.chrome.runtime.sendMessage as any).mockRejectedValue(new Error('Network error'));

      const theme = await ThemeHelper.getCurrentTheme();
      expect(theme).toBe('system');
    });
  });

  describe('setTheme', () => {
    it('should return true on successful theme set', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        theme: 'light',
      });

      const result = await ThemeHelper.setTheme('light');
      expect(result).toBe(true);
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'SET_THEME',
        data: { theme: 'light' },
      });
    });

    it('should return false on failed theme set', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: false,
      });

      const result = await ThemeHelper.setTheme('dark');
      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      (global.chrome.runtime.sendMessage as any).mockRejectedValue(new Error('Network error'));

      const result = await ThemeHelper.setTheme('system');
      expect(result).toBe(false);
    });
  });

  describe('setupThemeListener', () => {
    it('should setup message listener for theme changes', () => {
      const callback = vi.fn();
      ThemeHelper.setupThemeListener(callback);

      expect(global.chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    it('should call callback when THEME_CHANGED message received', () => {
      const callback = vi.fn();
      let messageListener: any;

      (global.chrome.runtime.onMessage.addListener as any).mockImplementation((listener: any) => {
        messageListener = listener;
      });

      ThemeHelper.setupThemeListener(callback);

      messageListener({ type: 'THEME_CHANGED', data: { theme: 'dark' } });

      expect(callback).toHaveBeenCalledWith('dark');
    });

    it('should return cleanup function that removes listener', () => {
      const cleanup = ThemeHelper.setupThemeListener();
      cleanup();

      expect(global.chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
    });

    it('should update ThemeManager when theme changes', () => {
      const updateSpy = vi.spyOn(ThemeManager, 'updatePreference');
      let messageListener: any;

      (global.chrome.runtime.onMessage.addListener as any).mockImplementation((listener: any) => {
        messageListener = listener;
      });

      ThemeHelper.setupThemeListener();
      messageListener({ type: 'THEME_CHANGED', data: { theme: 'light' } });

      expect(updateSpy).toHaveBeenCalledWith('light');
    });
  });

  describe('initializeTheme', () => {
    it('should initialize ThemeManager with current theme', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        theme: 'dark',
      });

      const initSpy = vi.spyOn(ThemeManager, 'initialize');

      await ThemeHelper.initializeTheme();

      expect(initSpy).toHaveBeenCalledWith('dark');
    });

    it('should setup theme listener', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        theme: 'system',
      });

      await ThemeHelper.initializeTheme();

      expect(global.chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    it('should return cleanup function', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        theme: 'light',
      });

      const cleanup = await ThemeHelper.initializeTheme();
      const cleanupSpy = vi.spyOn(ThemeManager, 'cleanup');

      cleanup();

      expect(global.chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
      expect(cleanupSpy).toHaveBeenCalled();
    });

    it('should call callback when theme changes', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        theme: 'system',
      });

      const callback = vi.fn();
      let messageListener: any;

      (global.chrome.runtime.onMessage.addListener as any).mockImplementation((listener: any) => {
        messageListener = listener;
      });

      await ThemeHelper.initializeTheme(callback);
      messageListener({ type: 'THEME_CHANGED', data: { theme: 'dark' } });

      expect(callback).toHaveBeenCalledWith('dark');
    });
  });
});
