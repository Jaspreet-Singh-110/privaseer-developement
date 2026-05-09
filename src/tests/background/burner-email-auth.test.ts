import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { burnerEmailService } from '@/background/burner-email-service';

describe('BurnerEmailService auth helpers', () => {
  const service = burnerEmailService as unknown as {
    computeSignature: (payload: string, secret: string) => Promise<string>;
    authorizedFetch: (url: string, initFactory: () => RequestInit, attempt?: number) => Promise<Response>;
    getValidToken: (forceRefresh?: boolean) => Promise<string>;
    supabaseAnonKey: string;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('computes HMAC signatures that match Node crypto output', async () => {
    const payload = 'test-installation:1700000000000';
    const secret = 'unit-test-secret';
    const expected = createHmac('sha256', secret).update(payload).digest('base64');

    const result = await service.computeSignature(payload, secret);

    expect(result).toBe(expected);
  });

  it('attaches JWT authorization header to outbound requests', async () => {
    const token = 'jwt-token';
    service.getValidToken = vi.fn().mockResolvedValue(token);

    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;

    await service.authorizedFetch('https://api.example.com', () => ({
      method: 'GET',
    }));

    expect(service.getValidToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init!.headers as Headers;
    expect(headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(headers.get('apikey')).toBe(service.supabaseAnonKey);
  });

  it('retries once when the Supabase function returns 401', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;

    service.getValidToken = vi.fn()
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token');

    await service.authorizedFetch('https://api.example.com', () => ({
      method: 'GET',
    }));

    expect(service.getValidToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

