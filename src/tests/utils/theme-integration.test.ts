import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThemeManager } from '@/utils/theme-manager';
import { ThemeHelper } from '@/utils/theme-helper';

describe('Theme Integration Tests', () => {
  let mockMediaQueryList: {
    matches: boolean;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockMediaQueryList = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    global.window = {
      matchMedia: vi.fn().mockReturnValue(mockMediaQueryList),
    } as any;

    global.document = {
      documentElement: {
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
        },
      },
    } as any;

    global.chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      storage: {
        local: {
          get: vi.fn(),
          set: vi.fn(),
        },
      },
    } as any;

    ThemeManager.cleanup();
  });

  afterEach(() => {
    ThemeManager.cleanup();
  });

  describe('Theme Switching', () => {
    it('should switch from light to dark theme', () => {
      ThemeManager.initialize('light');
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');

      ThemeManager.updatePreference('dark');
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });

    it('should switch from dark to light theme', () => {
      ThemeManager.initialize('dark');
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');

      ThemeManager.updatePreference('light');
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });

    it('should switch from light to system theme', () => {
      mockMediaQueryList.matches = true;
      ThemeManager.initialize('light');

      ThemeManager.updatePreference('system');
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
      expect(mockMediaQueryList.addEventListener).toHaveBeenCalled();
    });

    it('should switch from dark to system theme', () => {
      mockMediaQueryList.matches = false;
      ThemeManager.initialize('dark');

      ThemeManager.updatePreference('system');
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
      expect(mockMediaQueryList.addEventListener).toHaveBeenCalled();
    });

    it('should switch from system to explicit theme', () => {
      mockMediaQueryList.matches = true;
      ThemeManager.initialize('system');
      expect(mockMediaQueryList.addEventListener).toHaveBeenCalled();

      ThemeManager.updatePreference('light');
      expect(mockMediaQueryList.removeEventListener).toHaveBeenCalled();
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });
  });

  describe('Theme Persistence', () => {
    it('should persist light theme through storage', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        theme: 'light',
      });

      const theme = await ThemeHelper.getCurrentTheme();
      expect(theme).toBe('light');
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'GET_THEME' });
    });

    it('should persist dark theme through storage', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        theme: 'dark',
      });

      const theme = await ThemeHelper.getCurrentTheme();
      expect(theme).toBe('dark');
    });

    it('should persist system theme through storage', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        theme: 'system',
      });

      const theme = await ThemeHelper.getCurrentTheme();
      expect(theme).toBe('system');
    });

    it('should restore theme on initialization', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        theme: 'dark',
      });

      const cleanup = await ThemeHelper.initializeTheme();
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');

      cleanup();
    });
  });

  describe('System Theme Detection', () => {
    it('should detect light system theme', () => {
      mockMediaQueryList.matches = false;
      const theme = ThemeManager.detectSystemTheme();
      expect(theme).toBe('light');
    });

    it('should detect dark system theme', () => {
      mockMediaQueryList.matches = true;
      const theme = ThemeManager.detectSystemTheme();
      expect(theme).toBe('dark');
    });

    it('should apply system theme correctly when preference is system', () => {
      mockMediaQueryList.matches = true;
      ThemeManager.initialize('system');
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');

      mockMediaQueryList.matches = false;
      ThemeManager.initialize('system');
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });

    it('should update theme when system preference changes', () => {
      mockMediaQueryList.matches = false;
      ThemeManager.initialize('system');

      const changeHandler = (mockMediaQueryList.addEventListener as any).mock.calls[0][1];

      changeHandler({ matches: true });
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');

      changeHandler({ matches: false });
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });
  });

  describe('Theme Broadcast', () => {
    it('should broadcast theme changes to all listeners', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        theme: 'dark',
      });

      const success = await ThemeHelper.setTheme('dark');

      expect(success).toBe(true);
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'SET_THEME',
        data: { theme: 'dark' },
      });
    });

    it('should receive and apply broadcasted theme changes', () => {
      let messageListener: any;
      (global.chrome.runtime.onMessage.addListener as any).mockImplementation((listener: any) => {
        messageListener = listener;
      });

      ThemeHelper.setupThemeListener();

      messageListener({ type: 'THEME_CHANGED', data: { theme: 'dark' } });
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');

      messageListener({ type: 'THEME_CHANGED', data: { theme: 'light' } });
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });

    it('should handle multiple simultaneous listeners', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      const listeners: any[] = [];
      (global.chrome.runtime.onMessage.addListener as any).mockImplementation((listener: any) => {
        listeners.push(listener);
      });

      ThemeHelper.setupThemeListener(callback1);
      ThemeHelper.setupThemeListener(callback2);
      ThemeHelper.setupThemeListener(callback3);

      listeners.forEach(listener => {
        listener({ type: 'THEME_CHANGED', data: { theme: 'dark' } });
      });

      expect(callback1).toHaveBeenCalledWith('dark');
      expect(callback2).toHaveBeenCalledWith('dark');
      expect(callback3).toHaveBeenCalledWith('dark');
    });
  });

  describe('Dark Mode Styles Application', () => {
    it('should apply dark class to document root for dark theme', () => {
      ThemeManager.applyTheme('dark');
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });

    it('should remove dark class from document root for light theme', () => {
      ThemeManager.applyTheme('light');
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });

    it('should maintain dark class when switching between dark and system (dark)', () => {
      mockMediaQueryList.matches = true;

      ThemeManager.initialize('dark');
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');

      ThemeManager.updatePreference('system');
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });

    it('should correctly transition from light to dark', () => {
      ThemeManager.initialize('light');
      const removeCallsBefore = (document.documentElement.classList.remove as any).mock.calls.length;

      ThemeManager.updatePreference('dark');
      const addCallsAfter = (document.documentElement.classList.add as any).mock.calls.length;

      expect(removeCallsBefore).toBeGreaterThan(0);
      expect(addCallsAfter).toBeGreaterThan(0);
    });
  });

  describe('Theme Transitions', () => {
    it('should not cause flashing by applying theme immediately on init', () => {
      const addCallsBefore = (document.documentElement.classList.add as ReturnType<typeof vi.fn>).mock.calls.length;
      ThemeManager.initialize('dark');
      const addCallsAfter = (document.documentElement.classList.add as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(addCallsAfter).toBeGreaterThan(addCallsBefore);
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });

    it('should apply new theme immediately on update', () => {
      ThemeManager.initialize('light');

      const addCallsBefore = (document.documentElement.classList.add as ReturnType<typeof vi.fn>).mock.calls.length;
      ThemeManager.updatePreference('dark');
      const addCallsAfter = (document.documentElement.classList.add as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(addCallsAfter).toBeGreaterThan(addCallsBefore);
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });

    it('should handle rapid theme switches without errors', () => {
      expect(() => {
        ThemeManager.initialize('light');
        ThemeManager.updatePreference('dark');
        ThemeManager.updatePreference('system');
        ThemeManager.updatePreference('light');
        ThemeManager.updatePreference('dark');
      }).not.toThrow();
    });
  });

  describe('Cleanup and Memory Management', () => {
    it('should remove all listeners on cleanup', () => {
      ThemeManager.initialize('system');
      expect(mockMediaQueryList.addEventListener).toHaveBeenCalled();

      ThemeManager.cleanup();
      expect(mockMediaQueryList.removeEventListener).toHaveBeenCalled();
    });

    it('should not leak listeners when switching themes multiple times', () => {
      ThemeManager.initialize('system');
      const addCallsAfterInit = (mockMediaQueryList.addEventListener as any).mock.calls.length;

      ThemeManager.updatePreference('light');
      ThemeManager.updatePreference('system');
      ThemeManager.updatePreference('dark');
      ThemeManager.updatePreference('system');

      const addCallsAfterSwitches = (mockMediaQueryList.addEventListener as any).mock.calls.length;
      const removeCallsAfterSwitches = (mockMediaQueryList.removeEventListener as any).mock.calls.length;

      expect(addCallsAfterSwitches).toBe(addCallsAfterInit + 2);
      expect(removeCallsAfterSwitches).toBeGreaterThan(0);
    });

    it('should cleanup properly when using ThemeHelper', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        theme: 'system',
      });

      const cleanup = await ThemeHelper.initializeTheme();
      expect(mockMediaQueryList.addEventListener).toHaveBeenCalled();

      cleanup();
      expect(mockMediaQueryList.removeEventListener).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing window object gracefully', () => {
      const originalWindow = global.window;
      (global as any).window = undefined;

      const theme = ThemeManager.detectSystemTheme();
      expect(theme).toBe('light');

      global.window = originalWindow;
    });

    it('should handle missing document object gracefully', () => {
      const originalDocument = global.document;
      (global as any).document = undefined;

      expect(() => {
        ThemeManager.applyTheme('dark');
      }).not.toThrow();

      global.document = originalDocument;
    });

    it('should handle invalid theme values gracefully', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: false,
        error: 'Invalid theme value',
      });

      const theme = await ThemeHelper.getCurrentTheme();
      expect(theme).toBe('system');
    });

    it('should handle network errors when fetching theme', async () => {
      (global.chrome.runtime.sendMessage as any).mockRejectedValue(new Error('Network error'));

      const theme = await ThemeHelper.getCurrentTheme();
      expect(theme).toBe('system');
    });

    it('should handle multiple cleanup calls without errors', () => {
      ThemeManager.initialize('system');

      expect(() => {
        ThemeManager.cleanup();
        ThemeManager.cleanup();
        ThemeManager.cleanup();
      }).not.toThrow();
    });
  });

  describe('Cross-Component Synchronization', () => {
    it('should notify all listeners when theme changes', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      ThemeManager.addListener(listener1);
      ThemeManager.addListener(listener2);
      ThemeManager.addListener(listener3);

      ThemeManager.updatePreference('dark');

      expect(listener1).toHaveBeenCalledWith('dark');
      expect(listener2).toHaveBeenCalledWith('dark');
      expect(listener3).toHaveBeenCalledWith('dark');
    });

    it('should allow listeners to unsubscribe', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      const unsubscribe1 = ThemeManager.addListener(listener1);
      ThemeManager.addListener(listener2);

      ThemeManager.updatePreference('dark');
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);

      unsubscribe1();

      ThemeManager.updatePreference('light');
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(2);
    });

    it('should maintain consistency across multiple theme updates', async () => {
      (global.chrome.runtime.sendMessage as any)
        .mockResolvedValueOnce({ success: true, theme: 'light' })
        .mockResolvedValueOnce({ success: true, theme: 'dark' })
        .mockResolvedValueOnce({ success: true, theme: 'system' });

      const theme1 = await ThemeHelper.getCurrentTheme();
      const theme2 = await ThemeHelper.getCurrentTheme();
      const theme3 = await ThemeHelper.getCurrentTheme();

      expect(theme1).toBe('light');
      expect(theme2).toBe('dark');
      expect(theme3).toBe('system');
    });
  });
});
