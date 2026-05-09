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

describe('Real Email Storage', () => {
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

  describe('getRealEmail', () => {
    it('should return null by default', async () => {
      const email = await Storage.getRealEmail();
      expect(email).toBeNull();
    });

    it('should return stored real email', async () => {
      const testEmail = 'user@example.com';
      await Storage.setRealEmail(testEmail);
      const email = await Storage.getRealEmail();
      expect(email).toBe(testEmail.toLowerCase());
    });
  });

  describe('setRealEmail', () => {
    it('should store valid email address', async () => {
      const testEmail = 'user@example.com';
      await Storage.setRealEmail(testEmail);
      const email = await Storage.getRealEmail();
      expect(email).toBe(testEmail.toLowerCase());
    });

    it('should trim and lowercase email', async () => {
      const testEmail = '  User@Example.COM  ';
      await Storage.setRealEmail(testEmail);
      const email = await Storage.getRealEmail();
      expect(email).toBe('user@example.com');
    });

    it('should throw error for invalid email format', async () => {
      await expect(Storage.setRealEmail('invalid-email')).rejects.toThrow('Invalid email format');
      await expect(Storage.setRealEmail('user@')).rejects.toThrow('Invalid email format');
      await expect(Storage.setRealEmail('@example.com')).rejects.toThrow('Invalid email format');
      await expect(Storage.setRealEmail('user@example')).rejects.toThrow('Invalid email format');
    });

    it('should throw error for empty email', async () => {
      await expect(Storage.setRealEmail('')).rejects.toThrow('Invalid email format');
    });

    it('should handle email with subdomain', async () => {
      const testEmail = 'user@mail.example.com';
      await Storage.setRealEmail(testEmail);
      const email = await Storage.getRealEmail();
      expect(email).toBe(testEmail.toLowerCase());
    });

    it('should handle email with plus sign', async () => {
      const testEmail = 'user+tag@example.com';
      await Storage.setRealEmail(testEmail);
      const email = await Storage.getRealEmail();
      expect(email).toBe(testEmail.toLowerCase());
    });

    it('should update existing email', async () => {
      await Storage.setRealEmail('old@example.com');
      await Storage.setRealEmail('new@example.com');
      const email = await Storage.getRealEmail();
      expect(email).toBe('new@example.com');
    });
  });
});


