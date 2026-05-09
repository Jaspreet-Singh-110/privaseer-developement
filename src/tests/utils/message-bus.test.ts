/**
 * @file src/tests/utils/message-bus.test.ts
 *
 * Test Type: Unit
 * Contexts Tested: Background utility layer
 * Chrome APIs Mocked: chrome.runtime, chrome.tabs
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messageBus } from '@/utils/message-bus';

const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: loggerErrorMock,
    warn: loggerWarnMock,
    debug: vi.fn(),
  },
}));

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => void;

describe('message-bus', () => {
  let onMessageListener: Listener | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    onMessageListener = null;
    (messageBus as unknown as { handlers: Map<string, unknown> }).handlers = new Map();
    (messageBus as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests = new Map();
    (messageBus as unknown as { initialized: boolean }).initialized = false;

    global.chrome = {
      runtime: {
        sendMessage: vi.fn((message: unknown, callback?: (response: unknown) => void) => {
          if (typeof callback === 'function') {
            callback({ success: true, data: message });
            return;
          }
          return Promise.resolve({ success: true });
        }),
        onMessage: {
          addListener: vi.fn((listener: Listener) => {
            onMessageListener = listener;
          }),
          removeListener: vi.fn(),
        },
        lastError: undefined,
      },
      tabs: {
        query: vi.fn((_, callback: (tabs: Array<{ id?: number }>) => void) => {
          callback([{ id: 1 }, { id: 2 }, {}]);
        }),
        sendMessage: vi.fn(() => Promise.resolve()),
      },
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    messageBus.clearPendingRequests();
    vi.useRealTimers();
  });

  it('registers message handlers and returns the last result', async () => {
    await messageBus.initialize();

    const firstHandler = vi.fn(async () => ({ success: true, data: 'first' }));
    const secondHandler = vi.fn(async () => ({ success: true, data: 'second' }));

    messageBus.on('GET_STATE', firstHandler);
    messageBus.on('GET_STATE', secondHandler);

    const responseSpy = vi.fn();
    onMessageListener?.(
      { type: 'GET_STATE', data: undefined, requestId: '1', timestamp: Date.now() },
      {} as chrome.runtime.MessageSender,
      responseSpy
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(firstHandler).toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalled();
    expect(responseSpy).toHaveBeenCalledWith({ success: true, data: 'second' });
  });

  it('returns validation errors for invalid payloads', async () => {
    await messageBus.initialize();

    const responseSpy = vi.fn();
    onMessageListener?.(
      {
        type: 'SET_BURNER_EMAIL_SETTING',
        data: { enabled: 'yes' },
        requestId: '2',
        timestamp: Date.now(),
      },
      {} as chrome.runtime.MessageSender,
      responseSpy
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(responseSpy).toHaveBeenCalledWith({
      success: false,
      error: 'Invalid payload for SET_BURNER_EMAIL_SETTING',
    });
  });

  it('rejects invalid message types for send', async () => {
    await expect(
      messageBus.send('INVALID_TYPE' as never)
    ).rejects.toThrow('Invalid message type');
  });

  it('rejects invalid payloads for send', async () => {
    await expect(
      messageBus.send('SET_BURNER_EMAIL_SETTING', { enabled: 'yes' } as never)
    ).rejects.toThrow('Invalid payload for message type');
  });

  it('rejects when runtime errors occur', async () => {
    (chrome.runtime as unknown as { sendMessage: unknown }).sendMessage = vi.fn((...args: unknown[]) => {
      chrome.runtime.lastError = { message: 'runtime failure' };
      const maybeCallback = args[args.length - 1];
      if (typeof maybeCallback === 'function') {
        maybeCallback({ success: true });
      }
    });

    await expect(messageBus.send('GET_STATE')).rejects.toThrow('runtime failure');
  });

  it('rejects when response indicates failure', async () => {
    (chrome.runtime as unknown as { sendMessage: unknown }).sendMessage = vi.fn((...args: unknown[]) => {
      const maybeCallback = args[args.length - 1];
      if (typeof maybeCallback === 'function') {
        maybeCallback({ success: false, error: 'bad response' });
      }
    });

    await expect(messageBus.send('GET_STATE')).rejects.toThrow('bad response');
  });

  it('warns when broadcasting invalid types or payloads', () => {
    messageBus.broadcast('INVALID_TYPE' as never);
    messageBus.broadcast('SET_BURNER_EMAIL_SETTING', { enabled: 'yes' } as never);

    expect(loggerWarnMock).toHaveBeenCalledWith(
      'MessageBus',
      'Attempted to broadcast invalid type: INVALID_TYPE'
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'MessageBus',
      'Invalid payload for broadcast type: SET_BURNER_EMAIL_SETTING'
    );
  });

  it('broadcasts to runtime and tab contexts', () => {
    messageBus.broadcast('STATE_UPDATE');

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'STATE_UPDATE',
      data: undefined,
      timestamp: expect.any(Number),
    });
    expect(chrome.tabs.query).toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('returns error when receiving unknown message types', async () => {
    await messageBus.initialize();

    const responseSpy = vi.fn();
    onMessageListener?.(
      { type: 'UNKNOWN_TYPE', data: undefined, requestId: '3', timestamp: Date.now() },
      {} as chrome.runtime.MessageSender,
      responseSpy
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(responseSpy).toHaveBeenCalledWith({
      success: false,
      error: 'Unknown message type: UNKNOWN_TYPE',
    });
  });

  it('returns error when payload validation fails', async () => {
    await messageBus.initialize();

    const responseSpy = vi.fn();
    onMessageListener?.(
      {
        type: 'SET_TELEMETRY_SETTING',
        data: { enabled: 'nope' },
        requestId: '4',
        timestamp: Date.now(),
      },
      {} as chrome.runtime.MessageSender,
      responseSpy
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(responseSpy).toHaveBeenCalledWith({
      success: false,
      error: 'Invalid payload for SET_TELEMETRY_SETTING',
    });
  });

  it('returns error when no handler is registered', async () => {
    await messageBus.initialize();

    const responseSpy = vi.fn();
    onMessageListener?.(
      { type: 'GET_STATE', data: undefined, requestId: '5', timestamp: Date.now() },
      {} as chrome.runtime.MessageSender,
      responseSpy
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(responseSpy).toHaveBeenCalledWith({
      success: false,
      error: 'No handler for GET_STATE',
    });
  });

  it('times out pending requests when no response arrives', async () => {
    vi.useFakeTimers();
    chrome.runtime.sendMessage = vi.fn();

    const promise = messageBus.send('GET_STATE', undefined, 10);
    const rejection = expect(promise).rejects.toThrow('Message timeout: GET_STATE');
    expect(messageBus.getPendingRequestCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(20);
    await rejection;
    expect(messageBus.getPendingRequestCount()).toBe(0);
  });

  it('clears pending requests and rejects them', async () => {
    chrome.runtime.sendMessage = vi.fn();

    const promise = messageBus.send('GET_STATE');
    const rejection = expect(promise).rejects.toThrow('Request cleared');
    expect(messageBus.getPendingRequestCount()).toBe(1);

    messageBus.clearPendingRequests();
    await rejection;
    expect(messageBus.getPendingRequestCount()).toBe(0);
  });
});
