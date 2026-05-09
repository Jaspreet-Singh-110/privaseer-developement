import { logger } from '../utils/logger';
import { toError } from '../utils/type-guards';
import { SUPABASE } from '../utils/constants';
import { Storage } from './storage';

const FEEDBACK_ENDPOINT = `${SUPABASE.URL}/functions/v1/submit-feedback/feedback`;
const TELEMETRY_ENDPOINT = `${SUPABASE.URL}/functions/v1/submit-feedback/telemetry`;
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

interface FeedbackData {
  feedbackText: string;
  url?: string;
  domain?: string;
}

interface TelemetryEvent {
  eventType: string;
  eventData?: Record<string, unknown>;
}

class FeedbackTelemetryService {
  private installationId: string | null = null;
  private browserVersion: string | null = null;

  async initialize(): Promise<void> {
    try {
      this.installationId = await this.getOrCreateInstallationId();
      this.browserVersion = await this.getBrowserVersion();
      logger.info('FeedbackTelemetryService', 'Initialized', {
        installationId: this.installationId.substring(0, 8) + '...',
      });
    } catch (error) {
      logger.error('FeedbackTelemetryService', 'Failed to initialize', toError(error));
    }
  }

  private async getOrCreateInstallationId(): Promise<string> {
    const result = await chrome.storage.local.get('installationId');

    if (result.installationId) {
      return result.installationId;
    }

    const newId = crypto.randomUUID();
    await chrome.storage.local.set({ installationId: newId });
    return newId;
  }

  private async getBrowserVersion(): Promise<string> {
    try {
      const info = await chrome.runtime.getPlatformInfo();
      return `Chrome ${info.os}`;
    } catch {
      return 'Unknown';
    }
  }

  async submitFeedback(data: FeedbackData): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.installationId) {
        await this.initialize();
      }

      logger.debug('FeedbackTelemetryService', 'Submitting feedback', {
        endpoint: FEEDBACK_ENDPOINT,
        installationId: this.installationId ? `${this.installationId.substring(0, 8)}...` : null,
        textLength: data.feedbackText.length
      });

      const requestBody = {
        installationId: this.installationId,
        feedbackText: data.feedbackText,
        url: data.url || undefined,
        domain: data.domain || undefined,
        extensionVersion: EXTENSION_VERSION,
        browserVersion: this.browserVersion,
      };

      const response = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE.ANON_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });

      logger.debug('FeedbackTelemetryService', 'Response received', {
        status: response.status,
        ok: response.ok
      });

      const responseText = await response.text();
      logger.debug('FeedbackTelemetryService', 'Response text', { text: responseText.substring(0, 200) });

      if (!response.ok) {
        let errorData;
        try {
          errorData = JSON.parse(responseText);
        } catch {
          errorData = {};
        }
        const errorMsg = errorData.error || errorData.details || `HTTP ${response.status}`;
        logger.error('FeedbackTelemetryService', 'HTTP error', new Error(errorMsg));
        throw new Error(errorMsg);
      }

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        logger.error('FeedbackTelemetryService', 'Parse error', toError(parseError), { responseText });
        throw new Error('Invalid response from server');
      }

      if (!result.success) {
        const errorMsg = result.error || 'Server returned success=false';
        logger.error('FeedbackTelemetryService', 'API error', new Error(errorMsg));
        throw new Error(errorMsg);
      }

      logger.info('FeedbackTelemetryService', 'Feedback submitted successfully');
      return { success: true };
    } catch (error) {
      const err = toError(error);
      logger.error('FeedbackTelemetryService', 'Failed to submit feedback', err);
      return { success: false, error: err.message };
    }
  }

  async trackEvent(event: TelemetryEvent): Promise<void> {
    try {
      const telemetryEnabled = await Storage.getTelemetryEnabled();
      if (!telemetryEnabled) {
        logger.debug('FeedbackTelemetryService', 'Telemetry disabled, skipping event', { eventType: event.eventType });
        return;
      }

      if (!this.installationId) {
        await this.initialize();
      }

      const response = await fetch(TELEMETRY_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE.ANON_KEY}`,
        },
        body: JSON.stringify({
          installationId: this.installationId,
          eventType: event.eventType,
          eventData: event.eventData || {},
          extensionVersion: EXTENSION_VERSION,
          browserVersion: this.browserVersion,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      logger.debug('FeedbackTelemetryService', 'Event tracked', { eventType: event.eventType });
    } catch (error) {
      logger.error('FeedbackTelemetryService', 'Failed to track event', toError(error));
    }
  }

  async getInstallationId(): Promise<string> {
    if (!this.installationId) {
      this.installationId = await this.getOrCreateInstallationId();
    }
    return this.installationId!;
  }
}

export const feedbackTelemetryService = new FeedbackTelemetryService();
