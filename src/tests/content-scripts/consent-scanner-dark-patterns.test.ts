import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanner } from '@/content-scripts/consent-scanner';

describe('ConsentScanner dark pattern extensions', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    scanner.reset();
  });

  it('detects confusing language patterns', () => {
    const banner = document.createElement('div');
    banner.textContent = "Don't reject cookies to continue browsing";

    const result = (scanner as unknown as { detectConfusingLanguage: (el: Element) => boolean })
      .detectConfusingLanguage(banner);

    expect(result).toBe(true);
  });

  it('detects obstacle pattern when accept exists and reject is absent', () => {
    const accept = [document.createElement('button')];
    const reject: Element[] = [];
    const preferences = [document.createElement('button')];

    const result = (scanner as unknown as {
      detectObstaclePattern: (a: Element[], r: Element[], p: Element[]) => boolean;
    }).detectObstaclePattern(accept, reject, preferences);

    expect(result).toBe(true);
  });

  it('detects color manipulation when reject is visually de-emphasized', () => {
    const accept = document.createElement('button');
    accept.style.backgroundColor = '#00aa00';
    accept.style.color = '#ffffff';
    accept.style.opacity = '1';

    const reject = document.createElement('button');
    reject.style.backgroundColor = '#cccccc';
    reject.style.color = '#666666';
    reject.style.opacity = '0.5';

    const result = (scanner as unknown as {
      detectColorManipulation: (a: Element[], r: Element[]) => boolean;
    }).detectColorManipulation([accept], [reject]);

    expect(result).toBe(true);
  });

  it('detects misdirection when only preferences link exists', () => {
    const preferenceLink = document.createElement('a');
    preferenceLink.href = 'https://example.com/privacy/settings';

    const result = (scanner as unknown as {
      detectMisdirection: (rejectButtons: Element[], preferenceButtons: Element[]) => boolean;
    }).detectMisdirection([], [preferenceLink]);

    expect(result).toBe(true);
  });

  it('detects countdown timer pressure', () => {
    const banner = document.createElement('div');
    banner.textContent = 'Offer expires in 00:15, accept now';

    const result = (scanner as unknown as { detectCountdownTimer: (el: Element) => boolean })
      .detectCountdownTimer(banner);

    expect(result).toBe(true);
  });
});
