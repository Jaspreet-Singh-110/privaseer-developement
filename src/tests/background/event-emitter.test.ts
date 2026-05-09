import { describe, it, expect, vi } from 'vitest';
import { backgroundEvents } from '@/background/event-emitter';

describe('EventEmitter', () => {
  it('should emit and receive events', () => {
    const callback = vi.fn();
    backgroundEvents.on('TRACKER_INCREMENT', callback);

    backgroundEvents.emit('TRACKER_INCREMENT', { domain: 'test.com', category: 'analytics', isHighRisk: false });

    expect(callback).toHaveBeenCalledWith({
      domain: 'test.com',
      category: 'analytics',
      isHighRisk: false,
    });
  });

  it('should support multiple listeners', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    backgroundEvents.on('SCORE_UPDATED', callback1);
    backgroundEvents.on('SCORE_UPDATED', callback2);

    backgroundEvents.emit('SCORE_UPDATED', { oldScore: 80, newScore: 85, reason: 'test' });

    expect(callback1).toHaveBeenCalledWith({ oldScore: 80, newScore: 85, reason: 'test' });
    expect(callback2).toHaveBeenCalledWith({ oldScore: 80, newScore: 85, reason: 'test' });
  });

  it('should remove listeners', () => {
    const callback = vi.fn();
    backgroundEvents.on('CLEAN_SITE_DETECTED', callback);
    backgroundEvents.off('CLEAN_SITE_DETECTED', callback);

    backgroundEvents.emit('CLEAN_SITE_DETECTED', { domain: 'example.com', tabId: 1, url: 'https://example.com' });

    expect(callback).not.toHaveBeenCalled();
  });

  it('should handle events with no listeners', () => {
    expect(() => {
      backgroundEvents.emit('TRACKER_INCREMENT' as any, { domain: 'test.com', category: 'analytics', isHighRisk: false });
    }).not.toThrow();
  });

  it('should handle async handlers with emitAsync', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    backgroundEvents.on('TRACKER_BLOCKED', callback);

    await backgroundEvents.emitAsync('TRACKER_BLOCKED', {
      domain: 'test.com',
      category: 'analytics',
      isHighRisk: false,
      riskWeight: 1,
      tabId: 1,
      url: 'https://test.com',
    });

    expect(callback).toHaveBeenCalled();
  });

  it('should handle async handler errors gracefully', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const callback = vi.fn().mockImplementation(() => {
      throw new Error('Handler failed');
    });
    backgroundEvents.on('SCORE_UPDATED', callback);

    // emitAsync catches sync errors in try-catch
    await backgroundEvents.emitAsync('SCORE_UPDATED', { oldScore: 80, newScore: 85, reason: 'test' });
    
    expect(callback).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('should log events and provide stats', () => {
    backgroundEvents.emit('TRACKER_INCREMENT', { domain: 'test.com', category: 'analytics', isHighRisk: false });
    backgroundEvents.emit('TRACKER_INCREMENT', { domain: 'test2.com', category: 'analytics', isHighRisk: false });
    backgroundEvents.emit('SCORE_UPDATED', { oldScore: 80, newScore: 85, reason: 'test' });

    const stats = backgroundEvents.getEventStats();
    expect(stats['TRACKER_INCREMENT']).toBeGreaterThanOrEqual(2);
    expect(stats['SCORE_UPDATED']).toBeGreaterThanOrEqual(1);
  });

  it('should return handler count for specific event', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    backgroundEvents.on('CLEAN_SITE_DETECTED', callback1);
    backgroundEvents.on('CLEAN_SITE_DETECTED', callback2);

    expect(backgroundEvents.getHandlerCount('CLEAN_SITE_DETECTED')).toBe(2);
  });

  it('should return total handler count', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    backgroundEvents.on('ALERT_ADDED', callback1);
    backgroundEvents.on('POST_CONSENT_VIOLATION', callback2);

    expect(backgroundEvents.getHandlerCount()).toBeGreaterThanOrEqual(2);
  });

  it('should clear specific event handlers', () => {
    const callback = vi.fn();
    backgroundEvents.on('NON_COMPLIANT_SITE', callback);
    backgroundEvents.clear('NON_COMPLIANT_SITE');

    backgroundEvents.emit('NON_COMPLIANT_SITE', {
      domain: 'test.com',
      url: 'https://test.com',
      deceptivePatterns: [],
      severityMultiplier: 1,
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('should clear all event handlers', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    backgroundEvents.on('CREDIT_METRICS_UPDATED', callback1);
    backgroundEvents.on('ALERT_ADDED', callback2);
    backgroundEvents.clear();

    expect(backgroundEvents.getHandlerCount()).toBe(0);
  });

  it('should handle sync handler errors without crashing', () => {
    const throwingCallback = vi.fn(() => {
      throw new Error('Sync error');
    });
    const normalCallback = vi.fn();

    backgroundEvents.on('TRACKER_INCREMENT', throwingCallback);
    backgroundEvents.on('TRACKER_INCREMENT', normalCallback);

    expect(() => {
      backgroundEvents.emit('TRACKER_INCREMENT', { domain: 'test.com', category: 'analytics', isHighRisk: false });
    }).not.toThrow();

    expect(normalCallback).toHaveBeenCalled();
  });

  it('should handle async handler errors in emit without waiting', () => {
    const throwingCallback = vi.fn().mockRejectedValue(new Error('Async error'));
    backgroundEvents.on('TRACKER_BLOCKED', throwingCallback);

    expect(() => {
      backgroundEvents.emit('TRACKER_BLOCKED', {
        domain: 'test.com',
        category: 'analytics',
        isHighRisk: false,
        riskWeight: 1,
        tabId: 1,
        url: 'https://test.com',
      });
    }).not.toThrow();
  });
});
