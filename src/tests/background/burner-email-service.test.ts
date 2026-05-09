import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { burnerEmailService } from '@/background/burner-email-service';
import type { BurnerEmail } from '@/types';
import { BURNER_AUTH } from '@/utils/constants';

const storageMocks = vi.hoisted(() => ({
  getBurnerEmailEnabled: vi.fn(),
  getRealEmail: vi.fn(),
}));

vi.mock('@/background/storage', () => ({
  Storage: {
    getBurnerEmailEnabled: storageMocks.getBurnerEmailEnabled,
    getRealEmail: storageMocks.getRealEmail,
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

interface BurnerEmailServiceTestInstance {
  installationId: string | null;
  installationSecret: string | null;
  cachedToken: string | null;
  tokenExpiry: number;
  cachedEmails: BurnerEmail[] | null;
  emailsCacheExpiry: number;
  EMAILS_CACHE_TTL: number;
  getOrCreateInstallationId(): Promise<string>;
  initialize(): Promise<void>;
  requestAuthToken(): Promise<string>;
  generateEmail(domain: string, url?: string, label?: string): Promise<string>;
  getEmails(forceRefresh?: boolean): Promise<BurnerEmail[]>;
  deleteEmail(emailId: string): Promise<void>;
  authorizedFetch: (url: string, initFactory: () => RequestInit, attempt?: number) => Promise<Response>;
}

const service = burnerEmailService as unknown as BurnerEmailServiceTestInstance;

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
}

const ensureCryptoRandomUUID = (): void => {
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: () => 'test-installation-id',
    });
  }
};

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

let chromeStorageGet: ReturnType<typeof vi.fn>;
let chromeStorageSet: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

describe('BurnerEmailService', () => {
  beforeEach(() => {
    storageMocks.getBurnerEmailEnabled.mockReset();
    storageMocks.getRealEmail.mockReset();

    storageMocks.getBurnerEmailEnabled.mockResolvedValue(true);
    storageMocks.getRealEmail.mockResolvedValue('user@example.com');

    chromeStorageGet = vi.fn().mockImplementation(async (key: string | string[]) => {
      if (key === 'installationId' || (Array.isArray(key) && key.includes('installationId'))) {
        return { installationId: 'stored-installation-id' };
      }
      return {};
    });
    chromeStorageSet = vi.fn().mockResolvedValue(undefined);

    global.chrome = {
      storage: {
        local: {
          get: chromeStorageGet,
          set: chromeStorageSet,
        },
      },
    } as unknown as typeof chrome;

    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    ensureCryptoRandomUUID();

    service.installationId = null;
    service.installationSecret = null;
    service.cachedToken = null;
    service.tokenExpiry = 0;
    service.cachedEmails = null;
    service.emailsCacheExpiry = 0;
  });

  describe('Installation ID management', () => {
    it('creates new installation ID when none exists', async () => {
      const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('12345678-1234-1234-1234-123456789012' as `${string}-${string}-${string}-${string}-${string}`);
      chromeStorageGet.mockResolvedValue({});

      const id = await service.getOrCreateInstallationId();

      expect(id).toBe('12345678-1234-1234-1234-123456789012');
      expect(uuidSpy).toHaveBeenCalledTimes(1);
      expect(chromeStorageSet).toHaveBeenCalledWith({ installationId: '12345678-1234-1234-1234-123456789012' });

      uuidSpy.mockRestore();
    });

    it('returns stored installation ID when it already exists', async () => {
      chromeStorageGet.mockResolvedValue({ installationId: 'existing-id' });
      const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID');

      const id = await service.getOrCreateInstallationId();

      expect(id).toBe('existing-id');
      expect(uuidSpy).not.toHaveBeenCalled();
      expect(chromeStorageSet).not.toHaveBeenCalled();

      uuidSpy.mockRestore();
    });

    it('reuses cached installation ID without re-reading storage', async () => {
      const getOrCreateSpy = vi.spyOn(service as unknown as Record<string, any>, 'getOrCreateInstallationId');
      service.installationId = 'cached-id';

      fetchMock.mockResolvedValue(
        jsonResponse({
          token: 'jwt-token',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        }),
      );

      chromeStorageGet.mockImplementation(async (key: string | string[]) => {
        if (key === BURNER_AUTH.SECRET_STORAGE_KEY) {
          return {};
        }
        return {};
      });

      await service.requestAuthToken();

      expect(getOrCreateSpy).not.toHaveBeenCalled();

      getOrCreateSpy.mockRestore();
    });
  });

  describe('generateEmail guard conditions', () => {
    it('throws when burner email feature is disabled', async () => {
      storageMocks.getBurnerEmailEnabled.mockResolvedValue(false);

      await expect(service.generateEmail('example.com')).rejects.toThrow(
        'Failed to generate burner email: Burner email feature is disabled',
      );
    });

    it('throws when real email is not configured', async () => {
      storageMocks.getRealEmail.mockResolvedValue(null);

      await expect(service.generateEmail('example.com')).rejects.toThrow(
        /Failed to generate burner email: Real email not configured\./,
      );
    });

    it('throws when stored real email is invalid', async () => {
      storageMocks.getRealEmail.mockResolvedValue('invalid-email');

      await expect(service.generateEmail('example.com')).rejects.toThrow(
        /Failed to generate burner email: Your saved forwarding email is invalid/,
      );
    });

    it('omits URL when it exceeds 2048 characters', async () => {
      const authorizedFetchSpy = vi
        .spyOn(service as unknown as Record<string, any>, 'authorizedFetch')
        .mockImplementation(async (_url, _initFactory) => {
          return jsonResponse({
            success: true,
            email: { email_address: 'burner@example.com' },
          });
        });

      const longUrl = `https://example.com/${'a'.repeat(2050)}`;
      const email = await service.generateEmail('example.com', longUrl);

      expect(email).toBe('burner@example.com');
      const [, initFactory] = authorizedFetchSpy.mock.calls[0];
      const body = JSON.parse((initFactory as () => RequestInit)().body as string);
      expect(body.url).toBeUndefined();

      authorizedFetchSpy.mockRestore();
    });
  });

  describe('generateEmail success path', () => {
    it('generates an email when feature is enabled and real email is set', async () => {
      storageMocks.getRealEmail.mockResolvedValue('User@Example.COM');
      const authorizedFetchSpy = vi
        .spyOn(service as unknown as Record<string, any>, 'authorizedFetch')
        .mockImplementation(async (_url, _initFactory) => {
          return jsonResponse({
            success: true,
            email: { email_address: 'burner@example.com' },
          });
        });

      const result = await service.generateEmail('example.com', 'https://example.com');

      expect(result).toBe('burner@example.com');
      expect(authorizedFetchSpy).toHaveBeenCalledTimes(1);
      const [, initFactory] = authorizedFetchSpy.mock.calls[0];
      const body = JSON.parse((initFactory as () => RequestInit)().body as string);
      expect(body.realEmail).toBe('user@example.com');

      authorizedFetchSpy.mockRestore();
    });

    it('includes optional label in the request payload', async () => {
      const authorizedFetchSpy = vi
        .spyOn(service as unknown as Record<string, any>, 'authorizedFetch')
        .mockImplementation(async (_url, _initFactory) => {
          return jsonResponse({
            success: true,
            email: { email_address: 'label@example.com' },
          });
        });

      const label = 'newsletters';
      const result = await service.generateEmail('example.com', undefined, label);

      expect(result).toBe('label@example.com');
      const [, initFactory] = authorizedFetchSpy.mock.calls[0];
      const body = JSON.parse((initFactory as () => RequestInit)().body as string);
      expect(body.label).toBe(label);

      authorizedFetchSpy.mockRestore();
    });

    it('invalidates cached emails after generation', async () => {
      service.cachedEmails = [
        {
          id: '1',
          email_address: 'cached@example.com',
          domain: 'example.com',
          is_active: true,
          times_used: 0,
          created_at: new Date().toISOString(),
        },
      ];
      service.emailsCacheExpiry = Date.now() + 10000;

      const authorizedFetchSpy = vi
        .spyOn(service as any, 'authorizedFetch')
        .mockImplementation(async () => {
          return jsonResponse({
            success: true,
            email: { email_address: 'fresh@example.com' },
          });
        });

      await service.generateEmail('example.com');

      expect(service.cachedEmails).toBeNull();
      expect(service.emailsCacheExpiry).toBe(0);

      authorizedFetchSpy.mockRestore();
    });
  });

  describe('getEmails caching', () => {
    it('returns cached emails when cache is still valid', async () => {
      const cached: BurnerEmail[] = [
        {
          id: 'cached',
          email_address: 'cached@example.com',
          domain: 'example.com',
          is_active: true,
          times_used: 1,
          created_at: new Date().toISOString(),
        },
      ];
      service.cachedEmails = cached;
      service.emailsCacheExpiry = Date.now() + 5000;

      const authorizedFetchSpy = vi.spyOn(service as unknown as Record<string, any>, 'authorizedFetch');

      const emails = await service.getEmails();
      expect(emails).toBe(cached);
      expect(authorizedFetchSpy).not.toHaveBeenCalled();

      authorizedFetchSpy.mockRestore();
    });

    it('fetches emails from API when cache expired', async () => {
      service.cachedEmails = [
        {
          id: 'stale',
          email_address: 'stale@example.com',
          domain: 'example.com',
          is_active: true,
          times_used: 1,
          created_at: new Date().toISOString(),
        },
      ];
      service.emailsCacheExpiry = Date.now() - 1000;

      const authorizedFetchSpy = vi
        .spyOn(service as unknown as Record<string, any>, 'authorizedFetch')
        .mockImplementation(async () => {
          return jsonResponse({
            success: true,
            emails: [
              {
                id: 'fresh',
                email_address: 'fresh@example.com',
                domain: 'example.com',
                is_active: true,
                times_used: 0,
                created_at: new Date().toISOString(),
              },
            ],
          });
        });

      const emails = await service.getEmails();

      expect(authorizedFetchSpy).toHaveBeenCalledTimes(1);
      expect(emails).toHaveLength(1);
      expect(service.cachedEmails).toHaveLength(1);
      expect(service.emailsCacheExpiry).toBeGreaterThan(Date.now());

      authorizedFetchSpy.mockRestore();
    });

    it('bypasses cache when forceRefresh is true', async () => {
      service.cachedEmails = [
        {
          id: 'cached',
          email_address: 'cached@example.com',
          domain: 'example.com',
          is_active: true,
          times_used: 1,
          created_at: new Date().toISOString(),
        },
      ];
      service.emailsCacheExpiry = Date.now() + 10000;

      const authorizedFetchSpy = vi
        .spyOn(service as unknown as Record<string, any>, 'authorizedFetch')
        .mockImplementation(async () => {
          return jsonResponse({
            success: true,
            emails: [],
          });
        });

      await service.getEmails(true);

      expect(authorizedFetchSpy).toHaveBeenCalledTimes(1);

      authorizedFetchSpy.mockRestore();
    });
  });

  describe('deleteEmail', () => {
    it('deletes email and invalidates cache', async () => {
      service.cachedEmails = [
        {
          id: 'delete-me',
          email_address: 'delete@example.com',
          domain: 'example.com',
          is_active: true,
          times_used: 0,
          created_at: new Date().toISOString(),
        },
      ];
      service.emailsCacheExpiry = Date.now() + 10000;

      const authorizedFetchSpy = vi
        .spyOn(service as unknown as Record<string, any>, 'authorizedFetch')
        .mockImplementation(async () => jsonResponse({ success: true }));

      await service.deleteEmail('delete-me');

      expect(service.cachedEmails).toBeNull();
      expect(service.emailsCacheExpiry).toBe(0);
      const [url] = authorizedFetchSpy.mock.calls[0];
      expect(url).toContain('emailId=delete-me');

      authorizedFetchSpy.mockRestore();
    });

    it('throws when API responds with an error', async () => {
      const authorizedFetchSpy = vi
        .spyOn(service as unknown as Record<string, any>, 'authorizedFetch')
        .mockImplementation(async () => jsonResponse({ success: false, error: 'boom' }));

      await expect(service.deleteEmail('missing')).rejects.toThrow('boom');

      authorizedFetchSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('surface network failures when generating emails', async () => {
      const authorizedFetchSpy = vi
        .spyOn(service as unknown as Record<string, any>, 'authorizedFetch')
        .mockRejectedValue(new Error('network down'));

      await expect(service.generateEmail('example.com')).rejects.toThrow(
        'Failed to generate burner email: network down',
      );

      authorizedFetchSpy.mockRestore();
    });

    it('handles malformed JSON responses from the API', async () => {
      const authorizedFetchSpy = vi
        .spyOn(service as any, 'authorizedFetch')
        .mockResolvedValue(new Response('not-json', { status: 200 }));

      await expect(service.generateEmail('example.com')).rejects.toThrow(
        /Failed to generate burner email: Invalid JSON response from server/,
      );

      authorizedFetchSpy.mockRestore();
    });
  });
});

