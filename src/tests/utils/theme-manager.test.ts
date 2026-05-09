import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThemeManager } from '@/utils/theme-manager';

describe('ThemeManager', () => {
  let mockMediaQueryList: MediaQueryList;

  beforeEach(() => {
    document.documentElement.className = '';

    mockMediaQueryList = {
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    };

    vi.spyOn(window, 'matchMedia').mockReturnValue(mockMediaQueryList);
  });

  afterEach(() => {
    ThemeManager.cleanup();
    vi.restoreAllMocks();
  });

  describe('detectSystemTheme', () => {
    it('should detect light theme when system prefers light', () => {
      Object.defineProperty(mockMediaQueryList, 'matches', { value: false, writable: true });
      expect(ThemeManager.detectSystemTheme()).toBe('light');
    });

    it('should detect dark theme when system prefers dark', () => {
      Object.defineProperty(mockMediaQueryList, 'matches', { value: true, writable: true });
      expect(ThemeManager.detectSystemTheme()).toBe('dark');
    });
  });

  describe('getEffectiveTheme', () => {
    it('should return light when preference is light', () => {
      expect(ThemeManager.getEffectiveTheme('light')).toBe('light');
    });

    it('should return dark when preference is dark', () => {
      expect(ThemeManager.getEffectiveTheme('dark')).toBe('dark');
    });

    it('should return system theme when preference is system', () => {
      Object.defineProperty(mockMediaQueryList, 'matches', { value: true, writable: true });
      expect(ThemeManager.getEffectiveTheme('system')).toBe('dark');

      Object.defineProperty(mockMediaQueryList, 'matches', { value: false, writable: true });
      expect(ThemeManager.getEffectiveTheme('system')).toBe('light');
    });
  });

  describe('applyTheme', () => {
    it('should add dark class when theme is dark', () => {
      ThemeManager.applyTheme('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('should remove dark class when theme is light', () => {
      document.documentElement.classList.add('dark');
      ThemeManager.applyTheme('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  describe('initialize', () => {
    it('should apply light theme when preference is light', () => {
      ThemeManager.initialize('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('should apply dark theme when preference is dark', () => {
      ThemeManager.initialize('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('should apply system theme and start listening when preference is system', () => {
      Object.defineProperty(mockMediaQueryList, 'matches', { value: true, writable: true });
      ThemeManager.initialize('system');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(mockMediaQueryList.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should not listen to system changes when preference is not system', () => {
      ThemeManager.initialize('light');
      expect(mockMediaQueryList.addEventListener).not.toHaveBeenCalled();
    });
  });

  describe('updatePreference', () => {
    it('should update theme and apply it', () => {
      ThemeManager.initialize('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);

      ThemeManager.updatePreference('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('should start listening when switching to system preference', () => {
      ThemeManager.initialize('light');
      ThemeManager.updatePreference('system');
      expect(mockMediaQueryList.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should stop listening when switching from system preference', () => {
      ThemeManager.initialize('system');
      ThemeManager.updatePreference('light');
      expect(mockMediaQueryList.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should notify listeners of theme change', () => {
      const listener = vi.fn();
      ThemeManager.initialize('light');
      ThemeManager.addListener(listener);

      ThemeManager.updatePreference('dark');
      expect(listener).toHaveBeenCalledWith('dark');
    });
  });

  describe('system theme change handling', () => {
    it('should apply new theme when system preference changes', () => {
      ThemeManager.initialize('system');
      expect(document.documentElement.classList.contains('dark')).toBe(false);

      const changeHandler = (mockMediaQueryList.addEventListener as any).mock.calls[0][1];
      changeHandler({ matches: true });

      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('should not apply theme changes if preference is not system', () => {
      ThemeManager.initialize('light');
      ThemeManager.updatePreference('dark');

      const changeHandler = (mockMediaQueryList.addEventListener as any).mock.calls?.[0]?.[1];
      if (changeHandler) {
        changeHandler({ matches: true });
      }

      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('should notify listeners when system theme changes', () => {
      const listener = vi.fn();
      ThemeManager.initialize('system');
      ThemeManager.addListener(listener);

      const changeHandler = (mockMediaQueryList.addEventListener as any).mock.calls[0][1];
      changeHandler({ matches: true });

      expect(listener).toHaveBeenCalledWith('dark');
    });
  });

  describe('addListener', () => {
    it('should add listener and return cleanup function', () => {
      const listener = vi.fn();
      const cleanup = ThemeManager.addListener(listener);

      ThemeManager.updatePreference('dark');
      expect(listener).toHaveBeenCalledWith('dark');

      cleanup();
      listener.mockClear();

      ThemeManager.updatePreference('light');
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle errors in listeners gracefully', () => {
      const errorListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const successListener = vi.fn();

      ThemeManager.addListener(errorListener);
      ThemeManager.addListener(successListener);

      expect(() => ThemeManager.updatePreference('dark')).not.toThrow();
      expect(successListener).toHaveBeenCalledWith('dark');
    });
  });

  describe('getCurrentEffectiveTheme', () => {
    it('should return current effective theme', () => {
      ThemeManager.initialize('dark');
      expect(ThemeManager.getCurrentEffectiveTheme()).toBe('dark');

      ThemeManager.updatePreference('light');
      expect(ThemeManager.getCurrentEffectiveTheme()).toBe('light');
    });

    it('should return system theme when preference is system', () => {
      Object.defineProperty(mockMediaQueryList, 'matches', { value: true, writable: true });
      ThemeManager.initialize('system');
      expect(ThemeManager.getCurrentEffectiveTheme()).toBe('dark');
    });
  });

  describe('cleanup', () => {
    it('should stop listening to system changes', () => {
      ThemeManager.initialize('system');
      ThemeManager.cleanup();
      expect(mockMediaQueryList.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should clear all listeners', () => {
      const listener = vi.fn();
      ThemeManager.initialize('light');
      ThemeManager.addListener(listener);

      ThemeManager.cleanup();
      ThemeManager.updatePreference('dark');

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
