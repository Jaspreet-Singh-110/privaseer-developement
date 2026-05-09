import type { AllowlistEntry } from '../types';
import { ALLOWLIST } from './constants';
import { Storage } from '../background/storage';

const VERIFIED_ALLOWLIST_PATH = 'data/verified-compliant.json';

export class AllowlistManager {
  private static verifiedAllowlist: Set<string> | null = null;

  private static normalizeDomain(domain: string): string {
    const normalized = domain.trim().toLowerCase();
    return normalized.startsWith('www.') ? normalized.slice(4) : normalized;
  }

  private static isSubdomainMatch(domain: string, entryDomain: string): boolean {
    return domain === entryDomain || domain.endsWith(`.${entryDomain}`);
  }

  private static isExpired(entry: AllowlistEntry): boolean {
    return typeof entry.expiresAt === 'number' && entry.expiresAt <= Date.now();
  }

  private static async loadVerifiedAllowlist(): Promise<Set<string>> {
    if (this.verifiedAllowlist) {
      return this.verifiedAllowlist;
    }

    try {
      const response = await fetch(chrome.runtime.getURL(VERIFIED_ALLOWLIST_PATH));
      const data = (await response.json()) as string[];
      this.verifiedAllowlist = new Set(data.map((entry) => this.normalizeDomain(entry)));
    } catch {
      this.verifiedAllowlist = new Set();
    }

    return this.verifiedAllowlist;
  }

  static async isAllowlisted(domain: string): Promise<boolean> {
    const normalized = this.normalizeDomain(domain);
    const verified = await this.loadVerifiedAllowlist();

    for (const entry of verified) {
      if (this.isSubdomainMatch(normalized, entry)) {
        return true;
      }
    }

    const entries = await Storage.getAllowlistEntries();
    for (const entry of Object.values(entries)) {
      if (this.isExpired(entry)) {
        continue;
      }
      const entryDomain = this.normalizeDomain(entry.domain);
      if (this.isSubdomainMatch(normalized, entryDomain)) {
        return true;
      }
    }

    return false;
  }

  static async getEntries(): Promise<Record<string, AllowlistEntry>> {
    return Storage.getAllowlistEntries();
  }

  static async addEntry(domain: string, source: AllowlistEntry['source'] = 'user'): Promise<void> {
    const normalized = this.normalizeDomain(domain);
    const expiresAt =
      source === 'user'
        ? Date.now() + ALLOWLIST.USER_ENTRY_EXPIRY_DAYS * 24 * 60 * 60 * 1000
        : undefined;

    const entry: AllowlistEntry = {
      domain: normalized,
      addedAt: Date.now(),
      source,
      expiresAt,
    };

    await Storage.setAllowlistEntry(normalized, entry);
  }

  static async removeEntry(domain: string): Promise<void> {
    const normalized = this.normalizeDomain(domain);
    await Storage.removeAllowlistEntry(normalized);
  }
}
