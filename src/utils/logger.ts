import { sanitizeStackTrace } from './sanitizer';
import { TIME } from './constants';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
  error?: string;
  stack?: string;
}

interface LogStorage {
  logs: LogEntry[];
  lastCleanup: number;
}

const MAX_LOGS = 500;
const MAX_LOG_AGE_MS = TIME.ONE_WEEK_MS;
const STORAGE_KEY = 'privaseer_logs';

class Logger {
  private isDevelopment = import.meta.env.DEV;
  private logBuffer: LogEntry[] = [];
  private flushTimer: number | null = null;
  private initialized = false;
  private initializing = false;
  private initPromise: Promise<void> | null = null;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing && this.initPromise) return this.initPromise;

    this.initializing = true;
    this.initPromise = this.performInitialization();
    await this.initPromise;
  }

  private async performInitialization(): Promise<void> {
    try {
      await this.loadLogs();
      await this.cleanup();
      this.initialized = true;
    } catch (error) {
      console.error('[Logger] Failed to auto-initialize:', error);
      // Continue anyway - logger will work with in-memory buffer
      this.initialized = true;
    } finally {
      this.initializing = false;
    }
  }

  private async loadLogs(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const stored: LogStorage | undefined = result[STORAGE_KEY];

      if (stored?.logs) {
        this.logBuffer = stored.logs.slice(-MAX_LOGS);
      }
    } catch (error) {
      console.error('[Logger] Failed to load logs:', error);
    }
  }

  private async saveLogs(): Promise<void> {
    try {
      if (!chrome?.runtime?.id) {
        return;
      }

      const storage: LogStorage = {
        logs: this.logBuffer.slice(-MAX_LOGS),
        lastCleanup: Date.now(),
      };

      await chrome.storage.local.set({ [STORAGE_KEY]: storage });
    } catch {
      // Silent fail - extension context may be invalidated
    }
  }

  private async cleanup(): Promise<void> {
    const cutoff = Date.now() - MAX_LOG_AGE_MS;
    this.logBuffer = this.logBuffer.filter(log => log.timestamp > cutoff);
    await this.saveLogs();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.saveLogs();
      this.flushTimer = null;
    }, 5000) as unknown as number;
  }

  private createLogEntry(
    level: LogLevel,
    category: string,
    message: string,
    data?: unknown,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
    };

    if (data !== undefined) {
      entry.data = data;
    }

    if (error instanceof Error) {
      entry.error = error.message;
      entry.stack = sanitizeStackTrace(error.stack);
    }

    return entry;
  }

  private writeLog(entry: LogEntry): void {
    // Ensure initialization happens asynchronously (non-blocking)
    this.ensureInitialized().catch(() => {
      // Silent fail - logger will work with in-memory buffer
    });

    this.logBuffer.push(entry);

    if (this.logBuffer.length > MAX_LOGS) {
      this.logBuffer.shift();
    }

    this.scheduleFlush();

    // Only output to console in development mode to prevent duplicate logging
    if (this.isDevelopment) {
      const timestamp = new Date(entry.timestamp).toISOString();
      const prefix = `[Privaseer ${entry.level.toUpperCase()}] [${entry.category}] ${timestamp}`;

      switch (entry.level) {
        case 'debug':
          console.debug(prefix, entry.message, entry.data || '');
          break;
        case 'info':
          console.log(prefix, entry.message, entry.data || '');
          break;
        case 'warn':
          console.warn(prefix, entry.message, entry.data || '');
          break;
        case 'error':
          console.error(prefix, entry.message, entry.error || '', sanitizeStackTrace(entry.stack) || '');
          break;
      }
    }
  }

  debug(category: string, message: string, data?: unknown): void {
    const entry = this.createLogEntry('debug', category, message, data);
    this.writeLog(entry);
  }

  info(category: string, message: string, data?: unknown): void {
    const entry = this.createLogEntry('info', category, message, data);
    this.writeLog(entry);
  }

  warn(category: string, message: string, data?: unknown): void {
    const entry = this.createLogEntry('warn', category, message, data);
    this.writeLog(entry);
  }

  error(category: string, message: string, error?: Error | unknown, data?: unknown): void {
    const errorObj = error instanceof Error ? error : undefined;
    const entry = this.createLogEntry('error', category, message, data, errorObj);
    this.writeLog(entry);
  }

  async getLogs(level?: LogLevel, category?: string, limit = 100): Promise<LogEntry[]> {
    await this.ensureInitialized();
    
    let logs = [...this.logBuffer];

    if (level) {
      logs = logs.filter(log => log.level === level);
    }

    if (category) {
      logs = logs.filter(log => log.category === category);
    }

    return logs.slice(-limit).reverse();
  }

  async clearLogs(): Promise<void> {
    await this.ensureInitialized();
    this.logBuffer = [];
    await this.saveLogs();
    this.info('Logger', 'Logs cleared');
  }

  async exportLogs(): Promise<string> {
    await this.ensureInitialized();
    return JSON.stringify({
      exportDate: new Date().toISOString(),
      version: '1.0.0',
      logs: this.logBuffer,
    }, null, 2);
  }

  getStats(): { total: number; byLevel: Record<LogLevel, number> } {
    const stats = {
      total: this.logBuffer.length,
      byLevel: {
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
      } as Record<LogLevel, number>,
    };

    for (const log of this.logBuffer) {
      stats.byLevel[log.level]++;
    }

    return stats;
  }
}

export const logger = new Logger();

export type { LogLevel, LogEntry };
