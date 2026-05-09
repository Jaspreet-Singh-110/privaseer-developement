import { describe, it, expect } from 'vitest';
import { sanitizeEmail, sanitizeSubject, generateSanitizationReport } from "../../../../supabase/functions/inbound-email/email-sanitizer";

describe('email-sanitizer', () => {
  it('sanitizeEmail - removes 1x1 tracking pixels', () => {
    const html = `
    <html>
      <body>
        <p>Hello World</p>
        <img src="https://tracker.com/pixel.gif" width="1" height="1">
      </body>
    </html>
  `;

    const result = sanitizeEmail(html, "");

    expect(result.trackersRemoved.trackingPixels).toBe(1);
    expect(result.html.includes("tracking pixel removed")).toBe(true);
    expect(result.html.includes('width="1"')).toBe(false);
  });

  it('sanitizeEmail - blocks remote images', () => {
    const html = `
    <html>
      <body>
        <img src="https://example.com/image.jpg" alt="Test">
        <img src="https://track.customer.io/pixel.gif">
      </body>
    </html>
  `;

    const result = sanitizeEmail(html, "");

    expect(result.trackersRemoved.remoteImages).toBe(2);
    expect(result.html.includes("data-original-src")).toBe(true);
  });

  it('sanitizeEmail - removes UTM parameters', () => {
    const html = `
    <a href="https://example.com/page?utm_source=email&utm_campaign=test&foo=bar">Link</a>
  `;

    const result = sanitizeEmail(html, "");

    expect(result.html.includes("utm_source")).toBe(false);
    expect(result.html.includes("utm_campaign")).toBe(false);
    expect(result.html.includes("foo=bar")).toBe(true);
    expect(result.trackersRemoved.trackingLinks).toBe(1);
  });

  it('sanitizeEmail - removes fbclid and gclid', () => {
    const html = `
    <a href="https://example.com?fbclid=abc123">Facebook</a>
    <a href="https://example.com?gclid=xyz789">Google</a>
  `;

    const result = sanitizeEmail(html, "");

    expect(result.html.includes("fbclid")).toBe(false);
    expect(result.html.includes("gclid")).toBe(false);
    expect(result.trackersRemoved.trackingLinks).toBe(2);
  });

  it('sanitizeEmail - removes email beacons', () => {
    const html = `
    <img src="https://mail.example.com/open/abc123">
    <img src="https://track.mailchimp.com/track/xyz">
    <img src="https://example.com/pixel.gif">
  `;

    const result = sanitizeEmail(html, "");

    // At least some tracking pixels should be removed (may be counted as remoteImages or trackingPixels)
    expect(result.trackersRemoved.trackingPixels + result.trackersRemoved.remoteImages >= 2).toBe(true);
    expect(result.html.includes("email beacon removed") || result.html.includes("tracking pixel removed") || result.html.includes("remote tracking image blocked")).toBe(true);
  });

  it('sanitizeEmail - handles hidden images', () => {
    const html = `
    <img src="https://tracker.com/img.gif" style="display:none">
    <img src="https://tracker.com/img2.gif" style="visibility:hidden">
  `;

    const result = sanitizeEmail(html, "");

    expect(result.trackersRemoved.trackingPixels).toBe(2);
  });

  it('sanitizeEmail - sanitizes text links', () => {
    const text = "Check out https://example.com/page?utm_source=email&utm_campaign=test";

    const result = sanitizeEmail("", text);

    expect(result.text.includes("utm_source")).toBe(false);
    expect(result.text.includes("utm_campaign")).toBe(false);
    expect(result.text.includes("https://example.com/page")).toBe(true);
    expect(result.trackersRemoved.trackingLinks).toBe(1);
  });

  it('sanitizeEmail - blocks tracking domain images', () => {
    const html = `
    <img src="https://track.customer.io/open.gif">
    <img src="https://click.mailchimp.com/track.png">
  `;

    const result = sanitizeEmail(html, "");

    expect(result.trackersRemoved.remoteImages).toBe(2);
    expect(result.html.includes("remote tracking image blocked")).toBe(true);
  });

  it('sanitizeEmail - removes suspicious images', () => {
    const html = `
    <img src="https://example.com/tracking-pixel.gif">
    <img src="https://example.com/beacon-image.png">
  `;

    const result = sanitizeEmail(html, "");

    expect(result.trackersRemoved.remoteImages).toBe(2);
    expect(result.html.includes("suspicious image blocked")).toBe(true);
  });

  it('sanitizeEmail - handles complex URLs', () => {
    const html = `
    <a href="https://example.com/page?foo=bar&utm_source=email&baz=qux&utm_medium=newsletter">Link</a>
  `;

    const result = sanitizeEmail(html, "");

    expect(result.html.includes("utm_source")).toBe(false);
    expect(result.html.includes("utm_medium")).toBe(false);
    expect(result.html.includes("foo=bar")).toBe(true);
    expect(result.html.includes("baz=qux")).toBe(true);
    expect(result.trackersRemoved.trackingLinks).toBe(1);
  });

  it('sanitizeEmail - preserves clean content', () => {
    const html = "<p>Hello World</p><img src='data:image/png;base64,abc'>";
    const text = "Hello World";

    const result = sanitizeEmail(html, text);

    expect(result.html).toBe(html);
    expect(result.text).toBe(text);
    expect(result.trackersRemoved.trackingPixels).toBe(0);
    expect(result.trackersRemoved.remoteImages).toBe(0);
    expect(result.trackersRemoved.trackingLinks).toBe(0);
  });

  it('generateSanitizationReport - generates correct report', () => {
    const result = {
      html: "",
      text: "",
      trackersRemoved: {
        trackingPixels: 2,
        remoteImages: 3,
        trackingLinks: 1,
      },
    };

    const report = generateSanitizationReport(result);

    expect(report.includes("2 tracking pixel(s)")).toBe(true);
    expect(report.includes("3 remote image(s)")).toBe(true);
    expect(report.includes("1 tracking parameter(s)")).toBe(true);
    expect(report.includes("Privaseer Privacy Protection")).toBe(true);
  });

  it('generateSanitizationReport - returns empty for clean emails', () => {
    const result = {
      html: "",
      text: "",
      trackersRemoved: {
        trackingPixels: 0,
        remoteImages: 0,
        trackingLinks: 0,
      },
    };

    const report = generateSanitizationReport(result);

    expect(report).toBe("");
  });

  it('sanitizeSubject - removes tracking patterns', () => {
    const subject1 = "[TRACK-12345] Important Message";
    const subject2 = "{tracking_abc} Newsletter";

    expect(sanitizeSubject(subject1)).toBe("Important Message");
    expect(sanitizeSubject(subject2)).toBe("Newsletter");
  });

  it('sanitizeSubject - preserves clean subjects', () => {
    const subject = "Your Monthly Newsletter";

    expect(sanitizeSubject(subject)).toBe(subject);
  });

  it('sanitizeEmail - comprehensive test', () => {
    const html = `
    <html>
      <body>
        <h1>Newsletter</h1>
        <p>Check out our latest offer!</p>
        <a href="https://example.com/offer?utm_source=email&utm_campaign=spring">Click here</a>
        <img src="https://example.com/banner.jpg" alt="Banner">
        <img src="https://track.customer.io/pixel.gif" width="1" height="1">
        <img src="https://example.com/tracking-beacon.gif">
      </body>
    </html>
  `;

    const text = "Visit https://example.com/page?utm_source=email for more info";

    const result = sanitizeEmail(html, text);

    expect(result.trackersRemoved.trackingPixels >= 1).toBe(true);
    expect(result.trackersRemoved.remoteImages >= 2).toBe(true);
    expect(result.trackersRemoved.trackingLinks >= 2).toBe(true);

    expect(result.html.includes("utm_source")).toBe(false);
    expect(result.html.includes("utm_campaign")).toBe(false);
    expect(result.html.includes("Newsletter")).toBe(true);

    expect(result.text.includes("utm_source")).toBe(false);
    expect(result.text.includes("https://example.com/page")).toBe(true);
  });
});
