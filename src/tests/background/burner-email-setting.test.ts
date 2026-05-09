import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Storage } from '@/background/storage';

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Burner Email Setting', () => {
  let storedPrivacyData: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    storedPrivacyData = null;
    (Storage as any).cache = null;
    (Storage as any).isDirty = false;
    (Storage as any).saveTimer = null;
    (Storage as any).isSaving = false;

    global.chrome = {
      storage: {
        local: {
          get: vi.fn().mockImplementation(async (key: string | string[]) => {
            if (key === 'privacyData' || (Array.isArray(key) && key.includes('privacyData'))) {
              return storedPrivacyData ? { privacyData: storedPrivacyData } : {};
            }
            return {};
          }),
          set: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
            if (data && typeof data === 'object' && 'privacyData' in data) {
              storedPrivacyData = (data as { privacyData: any }).privacyData;
            }
          }),
        },
      },
    } as any;

    await Storage.initialize();
  });

  describe('getBurnerEmailEnabled', () => {
    it('should return false by default', async () => {
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });

    it('should return the stored value when set to false', async () => {
      await Storage.setBurnerEmailEnabled(false);
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });

    it('should return the stored value when set to true', async () => {
      await Storage.setBurnerEmailEnabled(false);
      await Storage.setBurnerEmailEnabled(true);
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(true);
    });

    it('should return false when setting is undefined (backwards compatibility)', async () => {
      const data = await Storage.get();
      delete (data.settings as any).burnerEmailEnabled;

      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });
  });

  describe('setBurnerEmailEnabled', () => {
    it('should set burner email to false', async () => {
      await Storage.setBurnerEmailEnabled(false);
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });

    it('should set burner email to true', async () => {
      await Storage.setBurnerEmailEnabled(true);
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(true);
    });

    it('should toggle between true and false', async () => {
      await Storage.setBurnerEmailEnabled(false);
      expect(await Storage.getBurnerEmailEnabled()).toBe(false);

      await Storage.setBurnerEmailEnabled(true);
      expect(await Storage.getBurnerEmailEnabled()).toBe(true);

      await Storage.setBurnerEmailEnabled(false);
      expect(await Storage.getBurnerEmailEnabled()).toBe(false);
    });

    it('should persist the setting', async () => {
      await Storage.setBurnerEmailEnabled(false);

      const data = await Storage.get();
      expect(data.settings.burnerEmailEnabled).toBe(false);
    });

    it('should not affect other settings', async () => {
      const initialData = await Storage.get();
      const initialProtection = initialData.settings.protectionEnabled;
      const initialNotifications = initialData.settings.showNotifications;
      const initialTheme = initialData.settings.theme;

      await Storage.setBurnerEmailEnabled(false);

      const updatedData = await Storage.get();
      expect(updatedData.settings.protectionEnabled).toBe(initialProtection);
      expect(updatedData.settings.showNotifications).toBe(initialNotifications);
      expect(updatedData.settings.theme).toBe(initialTheme);
      expect(updatedData.settings.burnerEmailEnabled).toBe(false);
    });
  });

  describe('Setting persistence', () => {
    it('should persist disabled state across storage operations', async () => {
      await Storage.setBurnerEmailEnabled(false);

      (Storage as any).isDirty = false;

      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });

    it('should persist enabled state across storage operations', async () => {
      await Storage.setBurnerEmailEnabled(true);

      (Storage as any).isDirty = false;

      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(true);
    });

    it('should maintain setting when other data is updated', async () => {
      await Storage.setBurnerEmailEnabled(false);

      await Storage.incrementTrackerBlock('example.com', 'advertising', false);

      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });

    it('should survive service worker reinitialization', async () => {
      await Storage.setBurnerEmailEnabled(false);

      (Storage as any).cache = null;

      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });

    it('should write the updated value to chrome storage immediately', async () => {
      const setSpy = chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>;
      await Storage.setBurnerEmailEnabled(false);

      expect(setSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          privacyData: expect.objectContaining({
            settings: expect.objectContaining({
              burnerEmailEnabled: false,
            }),
          }),
        })
      );
    });
  });

  describe('Default behavior', () => {
    it('should include burnerEmailEnabled in default storage data', async () => {
      const data = await Storage.get();
      expect(data.settings).toHaveProperty('burnerEmailEnabled');
      expect(typeof data.settings.burnerEmailEnabled).toBe('boolean');
    });

    it('should default to false when not explicitly set', async () => {
      const enabled = await Storage.getBurnerEmailEnabled();
      expect(enabled).toBe(false);
    });
  });
});
