interface SanitizationResult {
  html: string;
  text: string;
  trackersRemoved: {
    trackingPixels: number;
    remoteImages: number;
    trackingLinks: number;
  };
}

const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
];

const TRACKING_DOMAINS = [
  'track.customer.io',
  'click.mailchimp.com',
  'email.mg',
  'sendgrid.net',
  'mandrillapp.com',
  'links.mail',
  'email.emails',
  't.email',
  'click.email',
  'open.email',
  'pixel.email',
  'tracking.email',
];

export function sanitizeEmail(html: string, text: string): SanitizationResult {
  const result: SanitizationResult = {
    html: html || '',
    text: text || '',
    trackersRemoved: {
      trackingPixels: 0,
      remoteImages: 0,
      trackingLinks: 0,
    },
  };

  if (html) {
    result.html = sanitizeHtml(html, result.trackersRemoved);
  }

  if (text) {
    result.text = sanitizeText(text, result.trackersRemoved);
  }

  return result;
}

function sanitizeHtml(html: string, stats: SanitizationResult['trackersRemoved']): string {
  let sanitized = html;

  sanitized = removeTrackingPixels(sanitized, stats);
  sanitized = blockRemoteImages(sanitized, stats);
  sanitized = removeTrackingLinks(sanitized, stats);
  sanitized = removeEmailBeacons(sanitized, stats);

  return sanitized;
}

function sanitizeText(text: string, stats: SanitizationResult['trackersRemoved']): string {
  const urlRegex = /(https?:\/\/[^\s]+)/g;

  return text.replace(urlRegex, (url) => {
    const cleaned = cleanTrackingUrl(url);
    if (cleaned !== url) {
      stats.trackingLinks++;
    }
    return cleaned;
  });
}

function removeTrackingPixels(html: string, stats: SanitizationResult['trackersRemoved']): string {
  const pixelPatterns = [
    /<img[^>]*width=["']?1["']?[^>]*height=["']?1["']?[^>]*>/gi,
    /<img[^>]*height=["']?1["']?[^>]*width=["']?1["']?[^>]*>/gi,
    /<img[^>]*width=["']?0["']?[^>]*height=["']?0["']?[^>]*>/gi,
    /<img[^>]*style=["'][^"']*display:\s*none[^"']*["'][^>]*>/gi,
    /<img[^>]*style=["'][^"']*visibility:\s*hidden[^"']*["'][^>]*>/gi,
  ];

  let result = html;
  let removedCount = 0;

  for (const pattern of pixelPatterns) {
    const matches = result.match(pattern);
    if (matches) {
      removedCount += matches.length;
      result = result.replace(pattern, '<!-- tracking pixel removed -->');
    }
  }

  stats.trackingPixels += removedCount;
  return result;
}

function blockRemoteImages(html: string, stats: SanitizationResult['trackersRemoved']): string {
  const imgRegex = /<img([^>]*)src=["']([^"']+)["']([^>]*)>/gi;
  let result = html;
  let blockedCount = 0;

  result = result.replace(imgRegex, (match, before, src, after) => {
    if (src.startsWith('http://') || src.startsWith('https://')) {
      const isTrackingDomain = TRACKING_DOMAINS.some(domain => src.includes(domain));

      if (isTrackingDomain) {
        blockedCount++;
        return `<!-- remote tracking image blocked: ${src.substring(0, 50)}... -->`;
      }

      if (src.includes('track') || src.includes('pixel') || src.includes('beacon')) {
        blockedCount++;
        return `<!-- suspicious image blocked: ${src.substring(0, 50)}... -->`;
      }

      blockedCount++;
      return `<img${before}data-original-src="${src}" src="" alt="[Image blocked for privacy]"${after}>`;
    }

    return match;
  });

  stats.remoteImages += blockedCount;
  return result;
}

function removeTrackingLinks(html: string, stats: SanitizationResult['trackersRemoved']): string {
  const linkRegex = /<a([^>]*)href=["']([^"']+)["']([^>]*)>/gi;
  let result = html;
  let cleanedCount = 0;

  result = result.replace(linkRegex, (match, before, href, after) => {
    const cleanedHref = cleanTrackingUrl(href);

    if (cleanedHref !== href) {
      cleanedCount++;
      return `<a${before}href="${cleanedHref}"${after}>`;
    }

    return match;
  });

  stats.trackingLinks += cleanedCount;
  return result;
}

function cleanTrackingUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    for (const param of TRACKING_PARAMS) {
      urlObj.searchParams.delete(param);
    }

    const cleanUrl = urlObj.toString();
    return cleanUrl.replace(/[?&]$/, '');
  } catch {
    return url;
  }
}

function removeEmailBeacons(html: string, stats: SanitizationResult['trackersRemoved']): string {
  let result = html;
  let beaconsRemoved = 0;

  const beaconPatterns = [
    /<img[^>]*src=["'][^"']*\/open\/[^"']*["'][^>]*>/gi,
    /<img[^>]*src=["'][^"']*\/track\/[^"']*["'][^>]*>/gi,
    /<img[^>]*src=["'][^"']*\/beacon[^"']*["'][^>]*>/gi,
    /<img[^>]*src=["'][^"']*\?[^"']*open[^"']*["'][^>]*>/gi,
    /<img[^>]*src=["'][^"']*pixel\.gif[^"']*["'][^>]*>/gi,
    /<img[^>]*src=["'][^"']*spacer\.gif[^"']*["'][^>]*>/gi,
    /<img[^>]*src=["'][^"']*transparent\.gif[^"']*["'][^>]*>/gi,
  ];

  for (const pattern of beaconPatterns) {
    const matches = result.match(pattern);
    if (matches) {
      beaconsRemoved += matches.length;
      result = result.replace(pattern, '<!-- email beacon removed -->');
    }
  }

  stats.trackingPixels += beaconsRemoved;
  return result;
}

export function generateSanitizationReport(result: SanitizationResult): string {
  const total =
    result.trackersRemoved.trackingPixels +
    result.trackersRemoved.remoteImages +
    result.trackersRemoved.trackingLinks;

  if (total === 0) {
    return '';
  }

  const parts: string[] = [];

  if (result.trackersRemoved.trackingPixels > 0) {
    parts.push(`${result.trackersRemoved.trackingPixels} tracking pixel(s)`);
  }

  if (result.trackersRemoved.remoteImages > 0) {
    parts.push(`${result.trackersRemoved.remoteImages} remote image(s)`);
  }

  if (result.trackersRemoved.trackingLinks > 0) {
    parts.push(`${result.trackersRemoved.trackingLinks} tracking parameter(s)`);
  }

  return `\n\n---\nPrivaseer Privacy Protection: Removed ${parts.join(', ')} from this email.\n`;
}

export function sanitizeSubject(subject: string): string {
  const trackingPatterns = [
    /\[TRACK-\d+\]/gi,
    /\{.*tracking.*\}/gi,
  ];

  let cleaned = subject;
  for (const pattern of trackingPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned.trim();
}
