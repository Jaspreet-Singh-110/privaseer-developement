/**
 * @file src/tests/contracts/message-payload-contracts.test.ts
 *
 * Test Type: Contract
 * Contexts Tested: Message payload validation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { messageBus } from '@/utils/message-bus';
import type { MessageType } from '@/types';

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('message payload contracts', () => {
  let sendMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessageMock = vi.fn((_message: unknown, callback?: (response: unknown) => void) => {
      callback?.({ success: true });
      return Promise.resolve({ success: true });
    });

    global.chrome = {
      runtime: {
        sendMessage: sendMessageMock,
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        lastError: undefined,
      },
    } as unknown as typeof chrome;
  });

  it('rejects invalid payloads for validated message types', async () => {
    const invalidCases: Array<{ type: MessageType; payload: unknown }> = [
      { type: 'SET_BURNER_EMAIL_SETTING', payload: { enabled: 'yes' } },
      { type: 'SET_TELEMETRY_SETTING', payload: { enabled: 1 } },
      { type: 'SET_THEME', payload: { theme: 'pink' } },
      { type: 'SET_REAL_EMAIL', payload: { email: '   ' } },
      { type: 'GENERATE_BURNER_EMAIL', payload: {} },
      { type: 'DELETE_BURNER_EMAIL', payload: { emailId: 1 } },
      { type: 'SET_ONBOARDING_STEP', payload: { step: 'two' } },
      { type: 'SKIP_ONBOARDING', payload: { atStep: 'one' } },
      { type: 'COMPLETE_ONBOARDING', payload: { emailConfigured: 'yes' } },
      { type: 'REPORT_FALSE_POSITIVE', payload: { domain: 'x', url: '', detectedPatterns: 'bad', reason: 'invalid', timestamp: '1', installationId: 1, scanConfidence: '0' } },
      { type: 'ADD_TO_ALLOWLIST', payload: { domain: 123 } },
      { type: 'REMOVE_FROM_ALLOWLIST', payload: { domain: null } },
      { type: 'RECORD_COMPLIANCE_SCORE', payload: { score: '99' } },
      { type: 'TRACK_EVENT', payload: { eventType: 42 } },
      { type: 'TAB_ACTIVATED', payload: { tabId: '1' } },
      { type: 'TAB_UPDATED', payload: { tabId: null } },
      { type: 'TAB_REMOVED', payload: { tabId: '2' } },
      { type: 'CONSENT_SCAN_RESULT', payload: {} },
      { type: 'GET_TRACKER_INFO', payload: { domain: 123 } },
    ];

    for (const testCase of invalidCases) {
      await expect(messageBus.send(testCase.type, testCase.payload as never)).rejects.toThrow(
        `Invalid payload for message type: ${testCase.type}`
      );
    }
  });

  it('accepts valid payloads for validated message types', async () => {
    const validCases: Array<{ type: MessageType; payload: unknown }> = [
      { type: 'SET_BURNER_EMAIL_SETTING', payload: { enabled: true } },
      { type: 'SET_TELEMETRY_SETTING', payload: { enabled: false } },
      { type: 'SET_THEME', payload: { theme: 'dark' } },
      { type: 'SET_REAL_EMAIL', payload: { email: 'test@example.com' } },
      { type: 'GENERATE_BURNER_EMAIL', payload: { domain: 'example.com' } },
      { type: 'DELETE_BURNER_EMAIL', payload: { emailId: 'email-123' } },
      { type: 'SET_ONBOARDING_STEP', payload: { step: 2 } },
      { type: 'SKIP_ONBOARDING', payload: { atStep: 1 } },
      { type: 'COMPLETE_ONBOARDING', payload: { emailConfigured: true } },
      { type: 'REPORT_FALSE_POSITIVE', payload: { domain: 'example.com', url: 'https://example.com', detectedPatterns: [], reason: 'wrong_detection', timestamp: Date.now(), installationId: 'install-1', scanConfidence: 0.5 } },
      { type: 'ADD_TO_ALLOWLIST', payload: { domain: 'example.com' } },
      { type: 'REMOVE_FROM_ALLOWLIST', payload: { domain: 'example.com' } },
      { type: 'RECORD_COMPLIANCE_SCORE', payload: { score: 88 } },
      { type: 'TRACK_EVENT', payload: { eventType: 'click' } },
      { type: 'TAB_ACTIVATED', payload: { tabId: 1 } },
      { type: 'TAB_UPDATED', payload: { tabId: 2 } },
      { type: 'TAB_REMOVED', payload: { tabId: 3 } },
      { type: 'CONSENT_SCAN_RESULT', payload: { url: 'https://example.com', hasBanner: true, hasRejectButton: true, isCompliant: true, deceptivePatterns: [], timestamp: Date.now() } },
      { type: 'GET_TRACKER_INFO', payload: { domain: 'tracker.example.com' } },
    ];

    for (const testCase of validCases) {
      await expect(messageBus.send(testCase.type, testCase.payload as never)).resolves.toEqual({ success: true });
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: testCase.type,
          data: testCase.payload,
        }),
        expect.any(Function)
      );
    }
  });
});
