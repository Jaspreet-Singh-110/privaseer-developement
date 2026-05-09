import { logger } from './logger';

export type ThemePreference = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

export class ThemeManager {
  private static mediaQuery: MediaQueryList | null = null;
  private static listeners: Array<(theme: EffectiveTheme) => void> = [];
  private static currentPreference: ThemePreference = 'system';

  static detectSystemTheme(): EffectiveTheme {
    if (typeof window === 'undefined') {
      return 'light';
    }

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    return prefersDark.matches ? 'dark' : 'light';
  }

  static getEffectiveTheme(preference: ThemePreference): EffectiveTheme {
    if (preference === 'system') {
      return this.detectSystemTheme();
    }
    return preference;
  }

  static applyTheme(theme: EffectiveTheme): void {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;

    if (theme === 'dark') {
      root.classList.add('dark');
      logger.info('ThemeManager', 'Dark theme applied');
    } else {
      root.classList.remove('dark');
      logger.info('ThemeManager', 'Light theme applied');
    }
  }

  static initialize(preference: ThemePreference): void {
    this.currentPreference = preference;
    const effectiveTheme = this.getEffectiveTheme(preference);
    this.applyTheme(effectiveTheme);

    if (preference === 'system') {
      this.startListeningToSystemChanges();
    } else {
      this.stopListeningToSystemChanges();
    }

    logger.info('ThemeManager', 'Theme manager initialized', {
      preference,
      effectiveTheme,
    });
  }

  static updatePreference(preference: ThemePreference): void {
    this.currentPreference = preference;
    const effectiveTheme = this.getEffectiveTheme(preference);
    this.applyTheme(effectiveTheme);

    if (preference === 'system') {
      this.startListeningToSystemChanges();
    } else {
      this.stopListeningToSystemChanges();
    }

    this.notifyListeners(effectiveTheme);

    logger.info('ThemeManager', 'Theme preference updated', {
      preference,
      effectiveTheme,
    });
  }

  private static handleSystemThemeChange = (event: MediaQueryListEvent): void => {
    if (this.currentPreference !== 'system') {
      return;
    }

    const newTheme: EffectiveTheme = event.matches ? 'dark' : 'light';
    this.applyTheme(newTheme);
    this.notifyListeners(newTheme);

    logger.info('ThemeManager', 'System theme changed', { newTheme });
  };

  private static startListeningToSystemChanges(): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (!this.mediaQuery) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    }

    this.mediaQuery.addEventListener('change', this.handleSystemThemeChange);
    logger.info('ThemeManager', 'Started listening to system theme changes');
  }

  private static stopListeningToSystemChanges(): void {
    if (this.mediaQuery) {
      this.mediaQuery.removeEventListener('change', this.handleSystemThemeChange);
      logger.info('ThemeManager', 'Stopped listening to system theme changes');
    }
  }

  static addListener(callback: (theme: EffectiveTheme) => void): () => void {
    this.listeners.push(callback);

    return () => {
      this.listeners = this.listeners.filter(listener => listener !== callback);
    };
  }

  private static notifyListeners(theme: EffectiveTheme): void {
    this.listeners.forEach(listener => {
      try {
        listener(theme);
      } catch (error) {
        logger.error('ThemeManager', 'Error in theme listener', error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  static getCurrentEffectiveTheme(): EffectiveTheme {
    return this.getEffectiveTheme(this.currentPreference);
  }

  static cleanup(): void {
    this.stopListeningToSystemChanges();
    this.listeners = [];
    this.mediaQuery = null;
    logger.info('ThemeManager', 'Theme manager cleaned up');
  }
}
