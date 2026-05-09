import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AllowlistManager } from '@/utils/allowlist-manager';
import { ALLOWLIST } from '@/utils/constants';
import type { AllowlistEntry } from '@/types';

const getAllowlistEntriesMock = vi.hoisted(() => vi.fn());
const setAllowlistEntryMock = vi.hoisted(() => vi.fn());
const removeAllowlistEntryMock = vi.hoisted(() => vi.fn());

vi.mock('@/background/storage', () => ({
  Storage: {
    getAllowlistEntries: getAllowlistEntriesMock,
    setAllowlistEntry: setAllowlistEntryMock,
    removeAllowlistEntry: removeAllowlistEntryMock,
  },
}));

describe('allowlist-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (AllowlistManager as unknown as { verifiedAllowlist: Set<string> | null }).verifiedAllowlist = null;
    (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = {
      runtime: {
        getURL: (path: string) => path,
      },
    } as typeof chrome;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ['example.com'],
    }));

    getAllowlistEntriesMock.mockResolvedValue({});
  });

  it('matches verified allowlist domains including subdomains', async () => {
    const result = await AllowlistManager.isAllowlisted('news.example.com');
    expect(result).toBe(true);
  });

  it('matches local allowlist entries', async () => {
    const entry: AllowlistEntry = {
      domain: 'local.com',
      addedAt: Date.now(),
      source: 'user',
    };
    getAllowlistEntriesMock.mockResolvedValue({ 'local.com': entry });

    const result = await AllowlistManager.isAllowlisted('local.com');
    expect(result).toBe(true);
  });

  it('normalizes domains by stripping www prefix', async () => {
    const entry: AllowlistEntry = {
      domain: 'www.local.com',
      addedAt: Date.now(),
      source: 'user',
    };
    getAllowlistEntriesMock.mockResolvedValue({ 'www.local.com': entry });

    const result = await AllowlistManager.isAllowlisted('local.com');
    expect(result).toBe(true);
  });

  it('ignores expired local allowlist entries', async () => {
    const entry: AllowlistEntry = {
      domain: 'expired.com',
      addedAt: Date.now() - 1000,
      source: 'user',
      expiresAt: Date.now() - 500,
    };
    getAllowlistEntriesMock.mockResolvedValue({ 'expired.com': entry });

    const result = await AllowlistManager.isAllowlisted('expired.com');
    expect(result).toBe(false);
  });

  it('treats expiresAt equal to current time as expired boundary', async () => {
    const now = Date.now();
    const originalDateNow = Date.now;
    Date.now = () => now;

    const entry: AllowlistEntry = {
      domain: 'boundary-expired.com',
      addedAt: now - 1000,
      source: 'user',
      expiresAt: now,
    };
    getAllowlistEntriesMock.mockResolvedValue({ 'boundary-expired.com': entry });

    const result = await AllowlistManager.isAllowlisted('boundary-expired.com');
    expect(result).toBe(false);

    Date.now = originalDateNow;
  });

  it('adds entries to storage', async () => {
    await AllowlistManager.addEntry('test.com', 'user');
    expect(setAllowlistEntryMock).toHaveBeenCalledWith(
      'test.com',
      expect.objectContaining({
        domain: 'test.com',
        source: 'user',
      })
    );
  });

  it('adds normalized entry with expiry for user source', async () => {
    const now = Date.now();
    const originalDateNow = Date.now;
    Date.now = () => now;

    await AllowlistManager.addEntry('WWW.TEST.COM', 'user');

    expect(setAllowlistEntryMock).toHaveBeenCalledWith(
      'test.com',
      expect.objectContaining({
        domain: 'test.com',
        source: 'user',
        expiresAt: now + ALLOWLIST.USER_ENTRY_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      })
    );

    Date.now = originalDateNow;
  });

  it('adds non-expiring entry for verified source', async () => {
    await AllowlistManager.addEntry('verified.com', 'verified');

    expect(setAllowlistEntryMock).toHaveBeenCalledWith(
      'verified.com',
      expect.objectContaining({
        domain: 'verified.com',
        source: 'verified',
        expiresAt: undefined,
      })
    );
  });

  it('removes entries from storage', async () => {
    await AllowlistManager.removeEntry('test.com');
    expect(removeAllowlistEntryMock).toHaveBeenCalledWith('test.com');
  });

  it('removes entries using normalized domain', async () => {
    await AllowlistManager.removeEntry('WWW.TEST.COM');
    expect(removeAllowlistEntryMock).toHaveBeenCalledWith('test.com');
  });

  it('handles verified allowlist fetch failures gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const result = await AllowlistManager.isAllowlisted('example.com');
    expect(result).toBe(false);
  });
});
