import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BUTTON_PATTERNS,
  detectPageLanguage,
  getLocalizedPatterns,
  matchesAnyPattern,
} from '@/utils/i18n-patterns';

describe('i18n-patterns', () => {
  beforeEach(() => {
    document.documentElement.lang = '';
  });

  afterEach(() => {
    document.head.querySelectorAll('meta[name="language"], meta[http-equiv="content-language"]')
      .forEach((node) => node.remove());
  });

  it('detects language from html lang attribute', () => {
    document.documentElement.lang = 'de-DE';
    expect(detectPageLanguage()).toBe('de');
  });

  it('normalizes zh-hant language variants', () => {
    expect(getLocalizedPatterns('zh-Hant-HK')).toEqual(BUTTON_PATTERNS['zh-hant']);
    expect(getLocalizedPatterns('ZH-HANT')).toEqual(BUTTON_PATTERNS['zh-hant']);
  });

  it('normalizes common locale variants to base language', () => {
    expect(getLocalizedPatterns('pt-BR')).toEqual(BUTTON_PATTERNS.pt);
    expect(getLocalizedPatterns('es-ES')).toEqual(BUTTON_PATTERNS.es);
    expect(getLocalizedPatterns('fr-ca')).toEqual(BUTTON_PATTERNS.fr);
  });

  it('falls back to English patterns for unknown language', () => {
    const patterns = getLocalizedPatterns('unknown');
    expect(patterns.accept.length).toBeGreaterThan(0);
    expect(patterns.reject.length).toBeGreaterThan(0);
    expect(patterns.preferences.length).toBeGreaterThan(0);
  });

  it('matches patterns in a case-insensitive way', () => {
    const patterns = getLocalizedPatterns('fr');
    expect(matchesAnyPattern('TOUT ACCEPTER', patterns.accept)).toBe(true);
  });

  it('matches patterns with diacritics removed', () => {
    const patterns = getLocalizedPatterns('fr');
    expect(matchesAnyPattern('Paramètres', patterns.preferences)).toBe(true);
  });

  it('trims whitespace before matching', () => {
    const patterns = getLocalizedPatterns('en');
    expect(matchesAnyPattern('   accept cookies   ', patterns.accept)).toBe(true);
  });

  it('returns false when no pattern matches', () => {
    const patterns = getLocalizedPatterns('en');
    expect(matchesAnyPattern('banana pineapple rocket', patterns.accept)).toBe(false);
  });

  it('returns patterns for all supported languages', () => {
    Object.keys(BUTTON_PATTERNS).forEach((language) => {
      const patterns = getLocalizedPatterns(language);
      expect(patterns.accept.length).toBeGreaterThan(0);
      expect(patterns.reject.length).toBeGreaterThan(0);
      expect(patterns.preferences.length).toBeGreaterThan(0);
    });
  });

  it('matches native CJK consent actions', () => {
    const ja = getLocalizedPatterns('ja');
    const ko = getLocalizedPatterns('ko');
    const zh = getLocalizedPatterns('zh-CN');
    const zhHant = getLocalizedPatterns('zh-Hant');

    expect(matchesAnyPattern('すべて同意', ja.accept)).toBe(true);
    expect(matchesAnyPattern('모두 거부', ko.reject)).toBe(true);
    expect(matchesAnyPattern('全部拒绝', zh.reject)).toBe(true);
    expect(matchesAnyPattern('設定', zhHant.preferences)).toBe(true);
  });
});
