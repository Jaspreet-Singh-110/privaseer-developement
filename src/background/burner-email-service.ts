import type { BurnerEmail } from '../types';
import { logger } from '../utils/logger';
import { toError } from '../utils/type-guards';
import { SUPABASE, BURNER_AUTH } from '../utils/constants';
import { Storage } from './storage';
import { validateEmail } from '../utils/validation';

class BurnerEmailService {
  private installationId: string | null = null;
  private supabaseUrl: string = SUPABASE.URL;
  private supabaseAnonKey: string = SUPABASE.ANON_KEY;
  private apiUrl: string;
  private authUrl: string;
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;
  private installationSecret: string | null = null;
  private cachedEmails: BurnerEmail[] | null = null;
  private emailsCacheExpiry: number = 0;
  private readonly EMAILS_CACHE_TTL = 30000; // 30 seconds

  constructor() {
    this.apiUrl = `${this.supabaseUrl}/functions/v1/generate-burner-email`;
    this.authUrl = `${this.supabaseUrl}${BURNER_AUTH.AUTH_ENDPOINT}`;
  }

  async initialize(): Promise<void> {
    this.installationId = await this.getOrCreateInstallationId();
    logger.debug('BurnerEmailService', 'Initialized', {
      installationId: this.installationId,
      apiUrl: this.apiUrl
    });
  }

  private async getOrCreateInstallationId(): Promise<string> {
    const stored = await chrome.storage.local.get('installationId');

    if (stored.installationId) {
      return stored.installationId;
    }

    const newId = crypto.randomUUID();
    await chrome.storage.local.set({ installationId: newId });
    return newId;
  }

  private async getInstallationSecret(): Promise<string | null> {
    if (this.installationSecret) {
      return this.installationSecret;
    }
    const stored = await chrome.storage.local.get(BURNER_AUTH.SECRET_STORAGE_KEY);
    if (stored && stored[BURNER_AUTH.SECRET_STORAGE_KEY]) {
      this.installationSecret = stored[BURNER_AUTH.SECRET_STORAGE_KEY];
      return this.installationSecret;
    }
    return null;
  }

  private async computeSignature(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const bytes = new Uint8Array(signature);
    let binary = '';
    bytes.forEach(b => (binary += String.fromCharCode(b)));
    return btoa(binary);
  }

  private async requestAuthToken(): Promise<string> {
    if (!this.installationId) {
      this.installationId = await this.getOrCreateInstallationId();
    }
    if (!this.installationId) {
      throw new Error('Installation ID unavailable');
    }

    const timestamp = Date.now();
    const secret = await this.getInstallationSecret();
    const signature = secret
      ? await this.computeSignature(`${this.installationId}:${timestamp}`, secret)
      : undefined;

    const response = await fetch(this.authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.supabaseAnonKey,
      },
      body: JSON.stringify({
        installationId: this.installationId,
        timestamp,
        ...(signature ? { signature } : {}),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Auth token request failed (${response.status}): ${text}`);
    }

    const data = await response.json() as { token: string; expiresAt?: string; secret?: string };

    if (data.secret) {
      await chrome.storage.local.set({ [BURNER_AUTH.SECRET_STORAGE_KEY]: data.secret });
      this.installationSecret = data.secret;
    }

    if (!data.token) {
      throw new Error('Auth token missing in response');
    }

    const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : Date.now() + 10 * 60 * 1000;
    this.cachedToken = data.token;
    this.tokenExpiry = expiresAt;
    return data.token;
  }

  private async getValidToken(forceRefresh = false): Promise<string> {
    const buffer = BURNER_AUTH.TOKEN_REFRESH_BUFFER_MS;
    if (!forceRefresh && this.cachedToken && (Date.now() + buffer) < this.tokenExpiry) {
      return this.cachedToken;
    }
    return this.requestAuthToken();
  }

  private async authorizedFetch(url: string, initFactory: () => RequestInit, attempt = 0): Promise<Response> {
    const token = await this.getValidToken(attempt > 0);
    const init = initFactory();
    const headers = new Headers(init.headers ?? {});
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('apikey', this.supabaseAnonKey);
    const nextInit: RequestInit = {
      ...init,
      headers,
    };
    const response = await fetch(url, nextInit);
    if (response.status === 401 && attempt < BURNER_AUTH.MAX_TOKEN_RETRIES) {
      this.cachedToken = null;
      return this.authorizedFetch(url, initFactory, attempt + 1);
    }
    return response;
  }

  async generateEmail(domain: string, url?: string, label?: string): Promise<string> {
    logger.debug('BurnerEmailService', 'generateEmail called with:', { domain, url, label });
    try {
      const isEnabled = await Storage.getBurnerEmailEnabled();
      logger.debug('BurnerEmailService', 'Feature enabled check:', { isEnabled });
      if (!isEnabled) {
        logger.info('BurnerEmailService', 'Generation blocked - feature disabled', { domain });
        throw new Error('Burner email feature is disabled');
      }

      // Check if real email is configured
      const realEmail = await Storage.getRealEmail();
      logger.debug('BurnerEmailService', 'Real email configured check', { hasEmail: !!realEmail });
      if (!realEmail) {
        logger.info('BurnerEmailService', 'Generation blocked - real email not configured', { domain });
        throw new Error('Real email not configured. Please set your real email in Settings > Burner Email Services.');
      }

      // Validate the stored real email before making API request
      // This handles cases where invalid email might be in storage from older versions
      const emailValidation = validateEmail(realEmail);
      if (!emailValidation.valid) {
        logger.error('BurnerEmailService', 'Invalid real email in storage', new Error(emailValidation.error || 'Invalid email'), { realEmail });
        throw new Error(`Your saved forwarding email is invalid. Please update it in Settings > Burner Email Services. Error: ${emailValidation.error}`);
      }
      const sanitizedRealEmail = emailValidation.sanitized!;

      if (!this.installationId) {
        await this.initialize();
      }

      // Sanitize URL and enforce length limit as a safety net
      // The content script should have already sanitized it, but this prevents errors
      // if another part of the extension calls this service directly.
      let finalUrl = url;
      if (finalUrl && finalUrl.length > 2048) {
        logger.warn('BurnerEmailService', 'URL too long, omitting', { urlLength: finalUrl.length, domain });
        finalUrl = undefined;
      }

      const requestBody = {
        installationId: this.installationId,
        realEmail: sanitizedRealEmail,
        domain,
        url: finalUrl || undefined,
        label: label || undefined,
      };

      const payload = JSON.stringify(requestBody);
      const response = await this.authorizedFetch(this.apiUrl, () => ({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: payload,
      }));

      logger.debug('BurnerEmailService', 'Response received', { status: response.status, ok: response.ok });

      const responseText = await response.text();

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        logger.error('BurnerEmailService', 'JSON parse error', toError(parseError), { responseText });
        throw new Error(`Invalid JSON response from server: ${responseText.substring(0, 100)}`);
      }

      if (!response.ok) {
        // Include the detailed message from server validation errors for better debugging
        const errorMsg = data.message 
          ? `${data.error}: ${data.message}` 
          : (data.error || data.details || `HTTP ${response.status}: ${response.statusText}`);
        logger.error('BurnerEmailService', 'HTTP error', new Error(errorMsg), { data });
        throw new Error(errorMsg);
      }

      if (!data.success) {
        // Include the detailed message from server validation errors for better debugging
        const errorMsg = data.message 
          ? `${data.error}: ${data.message}` 
          : (data.error || data.details || 'Server returned success=false');
        logger.error('BurnerEmailService', 'API error', new Error(errorMsg), { data });
        throw new Error(errorMsg);
      }

      if (!data.email || !data.email.email_address) {
        logger.error('BurnerEmailService', 'Missing email in response', new Error('No email field'), { data });
        throw new Error('Server did not return an email address');
      }

      logger.info('BurnerEmailService', 'Success! Generated email');
      
      // Invalidate email cache after generation
      this.cachedEmails = null;
      this.emailsCacheExpiry = 0;

      return data.email.email_address;
    } catch (error) {
      const err = toError(error);
      logger.error('BurnerEmailService', 'generateEmail FAILED', err, { domain });
      throw new Error(`Failed to generate burner email: ${err.message}`);
    }
  }

  async getEmails(forceRefresh = false): Promise<BurnerEmail[]> {
    try {
      // Return cached emails if still valid
      if (!forceRefresh && this.cachedEmails && Date.now() < this.emailsCacheExpiry) {
        logger.debug('BurnerEmailService', 'Returning cached emails', { count: this.cachedEmails.length });
        return this.cachedEmails;
      }

      if (!this.installationId) {
        await this.initialize();
      }

      const response = await this.authorizedFetch(
        `${this.apiUrl}?installationId=${this.installationId}`,
        () => ({
          method: 'GET',
        }),
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch burner emails');
      }

      const emails = data.emails || [];
      
      // Cache the emails
      this.cachedEmails = emails;
      this.emailsCacheExpiry = Date.now() + this.EMAILS_CACHE_TTL;
      logger.debug('BurnerEmailService', 'Emails cached', { count: emails.length, ttl: this.EMAILS_CACHE_TTL });

      return emails;
    } catch (error) {
      logger.error('BurnerEmailService', 'Failed to fetch burner emails', toError(error));
      throw error;
    }
  }

  async deleteEmail(emailId: string): Promise<void> {
    try {
      if (!this.installationId) {
        await this.initialize();
      }

      const response = await this.authorizedFetch(
        `${this.apiUrl}?emailId=${emailId}&installationId=${this.installationId}`,
        () => ({
          method: 'DELETE',
        }),
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete burner email');
      }

      logger.info('BurnerEmailService', 'Burner email deleted', { emailId });
      
      // Invalidate email cache after deletion
      this.cachedEmails = null;
      this.emailsCacheExpiry = 0;
    } catch (error) {
      logger.error('BurnerEmailService', 'Failed to delete burner email', toError(error));
      throw error;
    }
  }

  async copyToClipboard(email: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(email);
      logger.debug('BurnerEmailService', 'Email copied to clipboard');
    } catch (error) {
      logger.error('BurnerEmailService', 'Failed to copy email', toError(error));
      throw error;
    }
  }
}

export const burnerEmailService = new BurnerEmailService();
