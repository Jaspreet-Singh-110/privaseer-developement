/**
 * Sanitization utilities for privacy and security
 * Removes sensitive information from URLs and stack traces
 */

/**
 * Sanitizes a URL by removing query parameters and hash fragments
 * Keeps protocol, hostname, and pathname for debugging purposes
 * @param url - The URL to sanitize (string or undefined/null)
 * @returns Sanitized URL or original value if invalid
 */
export function sanitizeUrl(url: string | undefined | null): string | undefined | null {
  if (!url) return url;
  
  try {
    const urlObj = new URL(url);
    // Return only protocol + hostname + pathname (no query params or hash)
    return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
  } catch {
    // If URL parsing fails, return a safe placeholder
    return '[invalid-url]';
  }
}

/**
 * Sanitizes a stack trace by removing absolute file paths
 * Keeps relative paths and line numbers for debugging
 * @param stack - The stack trace string to sanitize
 * @returns Sanitized stack trace or undefined
 */
export function sanitizeStackTrace(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  
  try {
    // Remove absolute file paths but keep relative paths and line numbers
    // Pattern matches common absolute path formats:
    // - Windows: C:\path\to\file.js:123:45
    // - Unix: /path/to/file.js:123:45
    // - chrome-extension:// URLs
    
    let sanitized = stack;
    
    // Replace Windows absolute paths (C:\..., D:\..., etc.)
    sanitized = sanitized.replace(/[A-Z]:\\[^\s:)]+/g, (match) => {
      // Extract just the filename from the path
      const parts = match.split('\\');
      return parts[parts.length - 1] || '[file]';
    });
    
    // Replace Unix absolute paths (/home/..., /usr/..., etc.)
    sanitized = sanitized.replace(/\/(?:home|usr|opt|var|Users)\/[^\s:)]+/g, (match) => {
      const parts = match.split('/');
      return parts[parts.length - 1] || '[file]';
    });
    
    // Replace chrome-extension:// URLs but keep the filename
    sanitized = sanitized.replace(/chrome-extension:\/\/[a-z]+\/([^\s:)]+)/g, 'ext:/$1');
    
    // Replace any remaining absolute paths (generic catch-all)
    sanitized = sanitized.replace(/(?:file:\/\/|\/)[^\s:)]*\//g, '');
    
    return sanitized;
  } catch {
    // If sanitization fails, return a safe placeholder
    return '[stack trace unavailable]';
  }
}

