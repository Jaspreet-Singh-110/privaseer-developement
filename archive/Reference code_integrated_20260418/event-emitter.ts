import type { Alert } from '../types';

type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

interface EventMap {
  TRACKER_BLOCKED: {
    domain: string;
    category: string;
    isHighRisk: boolean;
    riskWeight: number;
    tabId: number;
    url: string;
  };
  CLEAN_SITE_DETECTED: {
    domain: string;
    tabId: number;
    url: string;
  };
  NON_COMPLIANT_SITE: {
    domain: string;
    url: string;
    deceptivePatterns: string[];
    severityMultiplier: number;
  };
  SCORE_UPDATED: {
    oldScore: number;
    newScore: number;
    reason: string;
  };
  TRACKER_INCREMENT: {
    domain: string;
    category: string;
    isHighRisk: boolean;
  };
  ALERT_ADDED: {
    alert: Alert;
  };
  POST_CONSENT_VIOLATION: {
    domain: string;
    trackerCount: number;
    trackers: Set<string>;
  };
  CREDIT_METRICS_UPDATED: {
    type: 'tracker' | 'clean_site' | 'violation' | 'high_risk';
    value: number;
  };
  SCORING_ANALYTICS: {
    formulaVersion: string;
    scoreDelta: number;
    factors: {
      protectionConsistencyImpact: number;
      cleanBrowsingImpact: number;
      highRiskExposureImpact: number;
      violationsImpact: number;
    };
  };
  BEHAVIORAL_TRACKER_DETECTED: {
    tracker: import('../types').BehavioralTrackerResult;
  };
  CONSENT_REJECT_CLICKED: {
    domain: string;
    tabId: number;
  };
}

type EventType = keyof EventMap;

class BackgroundEventEmitter {
  private handlers = new Map<EventType, Set<EventHandler<unknown>>>();
  private eventLog: Array<{ type: EventType; timestamp: number }> = [];
  private maxEventLog = 100;

  on<T extends EventType>(event: T, handler: EventHandler<EventMap[T]>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  off<T extends EventType>(event: T, handler: EventHandler<EventMap[T]>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler<unknown>);
    }
  }

  emit<T extends EventType>(event: T, data: EventMap[T]): void {
    this.logEvent(event);

    const handlers = this.handlers.get(event);
    if (!handlers || handlers.size === 0) {
      return;
    }

    // Execute all handlers synchronously
    for (const handler of handlers) {
      try {
        const result = handler(data);
        // If handler returns a promise, catch errors but don't wait
        if (result instanceof Promise) {
          result.catch(error => {
            console.error(`[EventEmitter] Handler error for ${event}:`, error);
          });
        }
      } catch (error) {
        console.error(`[EventEmitter] Handler error for ${event}:`, error);
      }
    }
  }

  async emitAsync<T extends EventType>(event: T, data: EventMap[T]): Promise<void> {
    this.logEvent(event);

    const handlers = this.handlers.get(event);
    if (!handlers || handlers.size === 0) {
      return;
    }

    // Execute all handlers and wait for promises
    const results = Array.from(handlers).map(handler => {
      try {
        return Promise.resolve(handler(data));
      } catch (error) {
        console.error(`[EventEmitter] Handler error for ${event}:`, error);
        return Promise.resolve();
      }
    });

    await Promise.all(results);
  }

  private logEvent(event: EventType): void {
    this.eventLog.push({ type: event, timestamp: Date.now() });
    if (this.eventLog.length > this.maxEventLog) {
      this.eventLog.shift();
    }
  }

  getEventStats(): Record<EventType, number> {
    const stats = {} as Record<EventType, number>;
    for (const { type } of this.eventLog) {
      stats[type] = (stats[type] || 0) + 1;
    }
    return stats;
  }

  getHandlerCount(event?: EventType): number {
    if (event) {
      return this.handlers.get(event)?.size || 0;
    }
    let total = 0;
    for (const handlers of this.handlers.values()) {
      total += handlers.size;
    }
    return total;
  }

  clear(event?: EventType): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}

export const backgroundEvents = new BackgroundEventEmitter();
export type { EventMap, EventType };

