import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '@/utils/logger';

describe('logger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic logging', () => {
    it('should log debug messages', () => {
      const consoleSpy = vi.spyOn(console, 'debug');
      logger.debug('TestCategory', 'Debug message', { foo: 'bar' });

      // In dev mode, should log to console
      if (import.meta.env.DEV) {
        expect(consoleSpy).toHaveBeenCalled();
      }
    });

    it('should log info messages', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      logger.info('TestCategory', 'Info message');

      if (import.meta.env.DEV) {
        expect(consoleSpy).toHaveBeenCalled();
      }
    });

    it('should log warn messages', () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      logger.warn('TestCategory', 'Warning message');

      if (import.meta.env.DEV) {
        expect(consoleSpy).toHaveBeenCalled();
      }
    });

    it('should log error messages with error objects', () => {
      const consoleSpy = vi.spyOn(console, 'error');
      const error = new Error('Test error');
      logger.error('TestCategory', 'Error occurred', error);

      if (import.meta.env.DEV) {
        expect(consoleSpy).toHaveBeenCalled();
      }
    });
  });

  describe('log retrieval', () => {
    it('should retrieve logs', async () => {
      logger.info('Test', 'Message 1');
      logger.warn('Test', 'Message 2');

      const logs = await logger.getLogs();
      expect(logs).toBeInstanceOf(Array);
      expect(logs.length).toBeGreaterThan(0);
    });

    it('should filter logs by level', async () => {
      logger.info('Test', 'Info message');
      logger.warn('Test', 'Warn message');
      logger.error('Test', 'Error message');

      const warnLogs = await logger.getLogs('warn');
      expect(warnLogs.every(log => log.level === 'warn')).toBe(true);
    });

    it('should filter logs by category', async () => {
      logger.info('CategoryA', 'Message A');
      logger.info('CategoryB', 'Message B');

      const categoryALogs = await logger.getLogs(undefined, 'CategoryA');
      expect(categoryALogs.every(log => log.category === 'CategoryA')).toBe(true);
    });

    it('should limit number of logs returned', async () => {
      for (let i = 0; i < 10; i++) {
        logger.info('Test', `Message ${i}`);
      }

      const logs = await logger.getLogs(undefined, undefined, 5);
      expect(logs.length).toBeLessThanOrEqual(5);
    });
  });

  describe('log management', () => {
    it('should clear logs', async () => {
      logger.info('Test', 'Before clear');
      await logger.clearLogs();

      const logs = await logger.getLogs();
      // Might have the "Logs cleared" message
      expect(logs.length).toBeLessThanOrEqual(1);
    });

    it('should export logs as JSON', async () => {
      logger.info('Test', 'Export test');

      const exported = await logger.exportLogs();
      expect(exported).toContain('"version"');
      expect(exported).toContain('"logs"');
      expect(exported).toContain('"exportDate"');

      const parsed = JSON.parse(exported);
      expect(parsed.version).toBe('1.0.0');
      expect(Array.isArray(parsed.logs)).toBe(true);
    });

    it('should provide statistics', () => {
      logger.info('Test', 'Info');
      logger.warn('Test', 'Warn');
      logger.error('Test', 'Error');

      const stats = logger.getStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byLevel');
      expect(stats.byLevel).toHaveProperty('info');
      expect(stats.byLevel).toHaveProperty('warn');
      expect(stats.byLevel).toHaveProperty('error');
      expect(stats.byLevel).toHaveProperty('debug');
    });
  });

  describe('error handling', () => {
    it('should handle errors without stack traces', () => {
      const error = new Error('No stack');
      delete error.stack;

      expect(() => {
        logger.error('Test', 'Error without stack', error);
      }).not.toThrow();
    });

    it('should handle non-Error objects', () => {
      expect(() => {
        logger.error('Test', 'Non-error object', { message: 'error' });
      }).not.toThrow();
    });
  });
});
