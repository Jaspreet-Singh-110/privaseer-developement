/**
 * ARCHIVED FILE
 * Original Author: Jaspreet
 * Reason: Replaced by new Privacy Advisor / Alternative Finder implementation
 * Date Archived: 2026-04-16
 * This file is preserved for historical reference and is not used in production.
 */

import { logger } from './logger';
import type { MessageType, Message, MessageHandler, MessageDataMap } from '../types';
import { isConsentScanResult, isGetTrackerInfoData, isObject } from './type-guards';

type MessageHandlersMap = Map<MessageType, MessageHandler[]>;
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
};

const VALID_MESSAGE_TYPES = new Set<MessageType>([
  'STATE_UPDATE',
  'GET_STATE',
  'GET_ALL_SETTINGS',
  'TOGGLE_PROTECTION',
  'GET_CREDIT_SCORE',
  'GET_SCORING_CONFIG',
  'CREDIT_SCORE_UPDATED',
  'CONSENT_SCAN_RESULT',
  'GET_TRACKER_INFO',
  'TRACKER_BLOCKED',
  'POST_CONSENT_VIOLATION',
  'TAB_ACTIVATED',
  'TAB_UPDATED',
  'TAB_REMOVED',
  'CLEAR_ALERTS',
  'EXTENSION_READY',
  'GENERATE_BURNER_EMAIL',
  'GET_BURNER_EMAILS',
  'DELETE_BURNER_EMAIL',
  'GET_BURNER_EMAIL_SETTING',
  'SET_BURNER_EMAIL_SETTING',
  'BURNER_EMAIL_SETTING_CHANGED',
  'GET_TELEMETRY_SETTING',
  'SET_TELEMETRY_SETTING',
  'SUBMIT_FEEDBACK',
  'TRACK_EVENT',
  'RECORD_COMPLIANCE_SCORE',
  'GET_METRICS_AGGREGATION',
  'GET_PRIVACY_SCORE_TREND',
  'EXPORT_USER_DATA',
  'DELETE_ALL_DATA',
  'SET_THEME',
  'GET_THEME',
  'THEME_CHANGED',
  'GET_REAL_EMAIL',
  'SET_REAL_EMAIL',
  'GET_ONBOARDING_STATE',
  'SET_ONBOARDING_STEP',
  'COMPLETE_ONBOARDING',
  'SKIP_ONBOARDING',
  'REPORT_FALSE_POSITIVE',
  'REFRESH_CMP_CONFIG',
  'SUGGEST_CMP_PATTERN',
  'GET_ALLOWLIST',
  'ADD_TO_ALLOWLIST',
  'REMOVE_FROM_ALLOWLIST',
]);

const payloadValidators: Partial<Record<MessageType, (payload: unknown) => boolean>> = {
  GET_TRACKER_INFO: isGetTrackerInfoData,
  CONSENT_SCAN_RESULT: isConsentScanResult,
  GENERATE_BURNER_EMAIL: (data): data is MessageDataMap['GENERATE_BURNER_EMAIL'] =>
    isObject(data) && typeof (data as { domain?: unknown }).domain === 'string',
  DELETE_BURNER_EMAIL: (data): data is MessageDataMap['DELETE_BURNER_EMAIL'] =>
    isObject(data) && typeof (data as { emailId?: unknown }).emailId === 'string',
  SET_BURNER_EMAIL_SETTING: (data): data is MessageDataMap['SET_BURNER_EMAIL_SETTING'] =>
    isObject(data) && typeof (data as { enabled?: unknown }).enabled === 'boolean',
  SET_TELEMETRY_SETTING: (data): data is MessageDataMap['SET_TELEMETRY_SETTING'] =>
    isObject(data) && typeof (data as { enabled?: unknown }).enabled === 'boolean',
  SUBMIT_FEEDBACK: (data): data is MessageDataMap['SUBMIT_FEEDBACK'] =>
    isObject(data) && typeof (data as { feedbackText?: unknown }).feedbackText === 'string',
  SET_REAL_EMAIL: (data): data is MessageDataMap['SET_REAL_EMAIL'] =>
    isObject(data) && typeof (data as { email?: unknown }).email === 'string' && Boolean((data as { email: string }).email.trim()),
  SET_THEME: (data): data is MessageDataMap['SET_THEME'] =>
    isObject(data) && ['light', 'dark', 'system'].includes((data as { theme?: string }).theme ?? ''),
  TRACK_EVENT: (data): data is MessageDataMap['TRACK_EVENT'] =>
    isObject(data) && typeof (data as { eventType?: unknown }).eventType === 'string',
  RECORD_COMPLIANCE_SCORE: (data): data is MessageDataMap['RECORD_COMPLIANCE_SCORE'] =>
    isObject(data) && typeof (data as { score?: unknown }).score === 'number',
  EXPORT_USER_DATA: (data): data is MessageDataMap['EXPORT_USER_DATA'] =>
    !data ||
    (isObject(data) &&
      (((data as { format?: unknown }).format === undefined) ||
        (data as { format?: unknown }).format === 'json' ||
        (data as { format?: unknown }).format === 'csv') &&
      (((data as { includeEmail?: unknown }).includeEmail === undefined) ||
        typeof (data as { includeEmail?: unknown }).includeEmail === 'boolean')),
  TAB_ACTIVATED: (data): data is MessageDataMap['TAB_ACTIVATED'] =>
    isObject(data) && typeof (data as { tabId?: unknown }).tabId === 'number',
  TAB_UPDATED: (data): data is MessageDataMap['TAB_UPDATED'] =>
    isObject(data) && typeof (data as { tabId?: unknown }).tabId === 'number',
  TAB_REMOVED: (data): data is MessageDataMap['TAB_REMOVED'] =>
    isObject(data) && typeof (data as { tabId?: unknown }).tabId === 'number',
  SET_ONBOARDING_STEP: (data): data is MessageDataMap['SET_ONBOARDING_STEP'] =>
    isObject(data) &&
    typeof (data as { step?: unknown }).step === 'number' &&
    (((data as { stepId?: unknown }).stepId === undefined) ||
      typeof (data as { stepId?: unknown }).stepId === 'string') &&
    (((data as { previousStepId?: unknown }).previousStepId === undefined) ||
      typeof (data as { previousStepId?: unknown }).previousStepId === 'string') &&
    (((data as { enteredAt?: unknown }).enteredAt === undefined) ||
      typeof (data as { enteredAt?: unknown }).enteredAt === 'number') &&
    (((data as { exitedAt?: unknown }).exitedAt === undefined) ||
      typeof (data as { exitedAt?: unknown }).exitedAt === 'number') &&
    (((data as { durationMs?: unknown }).durationMs === undefined) ||
      typeof (data as { durationMs?: unknown }).durationMs === 'number'),
  COMPLETE_ONBOARDING: (data): data is MessageDataMap['COMPLETE_ONBOARDING'] =>
    !data ||
    (isObject(data) &&
      (((data as { emailConfigured?: unknown }).emailConfigured === undefined) ||
        typeof (data as { emailConfigured?: unknown }).emailConfigured === 'boolean')),
  SKIP_ONBOARDING: (data): data is MessageDataMap['SKIP_ONBOARDING'] =>
    isObject(data) &&
    typeof (data as { atStep?: unknown }).atStep === 'number' &&
    (((data as { reason?: unknown }).reason === undefined) ||
      (data as { reason?: unknown }).reason === 'skipped' ||
      (data as { reason?: unknown }).reason === 'abandoned'),
  REPORT_FALSE_POSITIVE: (data): data is MessageDataMap['REPORT_FALSE_POSITIVE'] =>
    isObject(data) &&
    typeof (data as { domain?: unknown }).domain === 'string' &&
    typeof (data as { url?: unknown }).url === 'string' &&
    Array.isArray((data as { detectedPatterns?: unknown }).detectedPatterns) &&
    ['banner_compliant', 'no_banner_present', 'wrong_detection', 'other'].includes((data as { reason?: string }).reason ?? '') &&
    (((data as { userReason?: unknown }).userReason === undefined) ||
      typeof (data as { userReason?: unknown }).userReason === 'string') &&
    typeof (data as { timestamp?: unknown }).timestamp === 'number' &&
    typeof (data as { installationId?: unknown }).installationId === 'string' &&
    typeof (data as { scanConfidence?: unknown }).scanConfidence === 'number',
  SUGGEST_CMP_PATTERN: (data): data is MessageDataMap['SUGGEST_CMP_PATTERN'] =>
    isObject(data) &&
    typeof (data as { domain?: unknown }).domain === 'string' &&
    typeof (data as { pageUrl?: unknown }).pageUrl === 'string' &&
    Array.isArray((data as { cookieNames?: unknown }).cookieNames) &&
    Array.isArray((data as { bannerSelectors?: unknown }).bannerSelectors) &&
    typeof (data as { timestamp?: unknown }).timestamp === 'number',
  ADD_TO_ALLOWLIST: (data): data is MessageDataMap['ADD_TO_ALLOWLIST'] =>
    isObject(data) && typeof (data as { domain?: unknown }).domain === 'string',
  REMOVE_FROM_ALLOWLIST: (data): data is MessageDataMap['REMOVE_FROM_ALLOWLIST'] =>
    isObject(data) && typeof (data as { domain?: unknown }).domain === 'string',
};

function isValidMessageType(type: unknown): type is MessageType {
  return typeof type === 'string' && VALID_MESSAGE_TYPES.has(type as MessageType);
}

function validatePayload<T extends MessageType>(type: T, data: unknown): data is MessageDataMap[T] {
  const validator = payloadValidators[type];
  return validator ? validator(data) : true;
}

class MessageBus {
  private handlers: MessageHandlersMap = new Map();
  private pendingRequests = new Map<string, PendingRequest>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender)
        .then(sendResponse)
        .catch(error => {
          logger.error('MessageBus', 'Message handler error', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    });

    this.initialized = true;
  }

  on<T extends MessageType>(type: T, handler: MessageHandler<T>): void {
    if (!isValidMessageType(type)) {
      throw new Error(`Invalid message type registration: ${String(type)}`);
    }

    const handlersForType = this.handlers.get(type) ?? [];
    if (!handlersForType.includes(handler as MessageHandler)) {
      handlersForType.push(handler as MessageHandler);
    }
    this.handlers.set(type, handlersForType);
  }

  off(type: MessageType, handler: MessageHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  async send<T extends MessageType, R = unknown>(
    type: T,
    data?: MessageDataMap[T],
    timeout = 5000
  ): Promise<R> {
    if (!isValidMessageType(type)) {
      return Promise.reject(new Error(`Invalid message type: ${String(type)}`));
    }

    if (!validatePayload(type, data)) {
      return Promise.reject(new Error(`Invalid payload for message type: ${type}`));
    }

    const requestId = `${type}_${Date.now()}_${Math.random()}`;
    const message: Message<T> = {
      type,
      data,
      requestId,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        const error = new Error(`Message timeout: ${type}`);
        logger.warn('MessageBus', `Message timeout: ${type}`, { requestId });
        reject(error);
      }, timeout) as unknown as number;

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timeoutId,
      });

      chrome.runtime.sendMessage(message, response => {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(requestId);

          if (chrome.runtime.lastError) {
            logger.error('MessageBus', 'Runtime error', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message || 'Runtime error'));
          } else if (response?.success === false) {
            reject(new Error(response.error || 'Unknown error'));
          } else {
            resolve(response);
          }
        }
      });
    });
  }

  broadcast<T extends MessageType>(type: T, data?: MessageDataMap[T]): void {
    if (!isValidMessageType(type)) {
      logger.warn('MessageBus', `Attempted to broadcast invalid type: ${String(type)}`);
      return;
    }

    if (!validatePayload(type, data)) {
      logger.warn('MessageBus', `Invalid payload for broadcast type: ${type}`);
      return;
    }

    const message: Message<T> = {
      type,
      data,
      timestamp: Date.now(),
    };

    void chrome.runtime.sendMessage(message).catch(() => {
      // Popup may be closed, ignore
    });

    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        if (tab.id) {
          void chrome.tabs.sendMessage(tab.id, message).catch(() => {
            // Content script may not be loaded, ignore
          });
        }
      });
    });
  }

  private async handleMessage(
    message: Message,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    if (!isValidMessageType(message.type)) {
      logger.warn('MessageBus', `Received unknown message type: ${String(message.type)}`);
      return { success: false, error: `Unknown message type: ${String(message.type)}` };
    }

    if (!validatePayload(message.type, message.data)) {
      logger.warn('MessageBus', `Payload validation failed for ${message.type}`);
      return { success: false, error: `Invalid payload for ${message.type}` };
    }

    const handlers = this.handlers.get(message.type);
    if (!handlers || handlers.length === 0) {
      logger.warn('MessageBus', `No handler for message type: ${message.type}`);
      return { success: false, error: `No handler for ${message.type}` };
    }

    try {
      let lastResult: unknown = { success: true };
      // Process sequentially to avoid race conditions between handlers
      for (const handler of [...handlers]) {
        lastResult = await handler(message.data as MessageDataMap[typeof message.type], sender);
      }
      return lastResult;
    } catch (error) {
      logger.error('MessageBus', `Error handling ${message.type}`, error);
      throw error;
    }
  }

  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  clearPendingRequests(): void {
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('Request cleared'));
    });
    this.pendingRequests.clear();
  }
}

export const messageBus = new MessageBus();

export type { MessageType, Message, MessageHandler };
