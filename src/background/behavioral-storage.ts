import { logger } from '../utils/logger';
import { toError } from '../utils/type-guards';
import type { BehavioralTrackerResult, ComplianceViolationResult } from '../types';

const STORAGE_KEYS = {
  TRACKERS: 'behavioral_trackers',
  VIOLATIONS: 'compliance_violations'
} as const;

/**
 * Temporary Storage Abstraction Layer
 * Completely decoupled from Supabase to provide backend-agnostic logging.
 * When the backend is available, these functions can be swapped with API calls.
 */
export class BehavioralStorage {
  private trackerQueue: BehavioralTrackerResult[] = [];
  private violationQueue: ComplianceViolationResult[] = [];
  private isProcessing = false;

  async saveTrackerData(tracker: BehavioralTrackerResult): Promise<void> {
    this.trackerQueue.push(tracker);
    this.processQueue().catch(e => logger.error('BehavioralStorage', 'Process queue threw', toError(e)));
  }

  async logViolation(violation: ComplianceViolationResult): Promise<void> {
    this.violationQueue.push(violation);
    this.processQueue().catch(e => logger.error('BehavioralStorage', 'Process queue threw', toError(e)));
  }

  private async processQueue() {
    if (this.isProcessing) return;
    if (this.trackerQueue.length === 0 && this.violationQueue.length === 0) return;

    this.isProcessing = true;

    try {
      if (this.trackerQueue.length > 0) {
        const trackersToAdd = [...this.trackerQueue];
        this.trackerQueue = [];
        
        const data = await chrome.storage.local.get(STORAGE_KEYS.TRACKERS);
        const trackers = (data[STORAGE_KEYS.TRACKERS] || []) as BehavioralTrackerResult[];
        
        trackers.push(...trackersToAdd);
        if (trackers.length > 1000) {
          trackers.splice(0, trackers.length - 1000);
        }
        
        await chrome.storage.local.set({ [STORAGE_KEYS.TRACKERS]: trackers });
        logger.debug('BehavioralStorage', `Saved ${trackersToAdd.length} behavioral trackers`);
      }

      if (this.violationQueue.length > 0) {
        const violationsToAdd = [...this.violationQueue];
        this.violationQueue = [];

        const data = await chrome.storage.local.get(STORAGE_KEYS.VIOLATIONS);
        const violations = (data[STORAGE_KEYS.VIOLATIONS] || []) as ComplianceViolationResult[];
        
        violations.push(...violationsToAdd);
        if (violations.length > 1000) {
          violations.splice(0, violations.length - 1000);
        }
        
        await chrome.storage.local.set({ [STORAGE_KEYS.VIOLATIONS]: violations });
        logger.info('BehavioralStorage', `Logged ${violationsToAdd.length} compliance violations`);
      }
    } catch (error) {
      logger.error('BehavioralStorage', 'Failed to process storage queue', toError(error));
    } finally {
      this.isProcessing = false;
      if (this.trackerQueue.length > 0 || this.violationQueue.length > 0) {
        setTimeout(() => {
          this.processQueue().catch(() => {});
        }, 50);
      }
    }
  }
}

export const behavioralStorage = new BehavioralStorage();
