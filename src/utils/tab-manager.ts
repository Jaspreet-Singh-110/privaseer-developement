import { logger } from './logger';
import { messageBus } from './message-bus';
import { sanitizeUrl } from './sanitizer';
import { TIME } from './constants';

interface TabInfo {
  id: number;
  url?: string;
  title?: string;
  active: boolean;
  blockCount: number;
  lastUpdate: number;
  status?: 'loading' | 'complete';
}

class TabManager {
  private tabs = new Map<number, TabInfo>();
  private activeTabId: number | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    chrome.tabs.onCreated.addListener((tab) => this.handleTabCreated(tab));
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
      this.handleTabUpdated(tabId, changeInfo, tab)
    );
    chrome.tabs.onActivated.addListener((activeInfo) =>
      this.handleTabActivated(activeInfo)
    );
    chrome.tabs.onRemoved.addListener((tabId) => this.handleTabRemoved(tabId));

    await this.syncExistingTabs();
    this.initialized = true;
  }

  private async syncExistingTabs(): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          this.tabs.set(tab.id, {
            id: tab.id,
            url: sanitizeUrl(tab.url) ?? undefined,
            title: tab.title,
            active: tab.active,
            blockCount: 0,
            lastUpdate: Date.now(),
            status: tab.status as 'loading' | 'complete',
          });

          if (tab.active) {
            this.activeTabId = tab.id;
          }
        }
      }

    } catch (error) {
      logger.error('TabManager', 'Failed to sync existing tabs', error);
    }
  }

  private handleTabCreated(tab: chrome.tabs.Tab): void {
    if (!tab.id) return;

    this.tabs.set(tab.id, {
      id: tab.id,
      url: sanitizeUrl(tab.url) ?? undefined,
      title: tab.title,
      active: tab.active,
      blockCount: 0,
      lastUpdate: Date.now(),
      status: tab.status as 'loading' | 'complete',
    });
  }

  private handleTabUpdated(
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab
  ): void {
    const existingTab = this.tabs.get(tabId);

    if (changeInfo.status === 'loading') {
      if (existingTab) {
        existingTab.blockCount = 0;
        existingTab.status = 'loading';
      }
    }

    if (existingTab) {
      Object.assign(existingTab, {
        url: sanitizeUrl(tab.url) || existingTab.url,
        title: tab.title || existingTab.title,
        status: tab.status as 'loading' | 'complete' || existingTab.status,
        lastUpdate: Date.now(),
      });
    } else {
      this.tabs.set(tabId, {
        id: tabId,
        url: sanitizeUrl(tab.url) ?? undefined,
        title: tab.title,
        active: tab.active,
        blockCount: 0,
        lastUpdate: Date.now(),
        status: tab.status as 'loading' | 'complete',
      });
    }

    messageBus.broadcast('TAB_UPDATED', {
      tabId,
      changeInfo: changeInfo as Record<string, unknown>,
      tab: this.tabs.get(tabId),
    });
  }

  private handleTabActivated(activeInfo: chrome.tabs.TabActiveInfo): void {
    if (this.activeTabId !== null) {
      const previousTab = this.tabs.get(this.activeTabId);
      if (previousTab) {
        previousTab.active = false;
      }
    }

    this.activeTabId = activeInfo.tabId;

    const activeTab = this.tabs.get(activeInfo.tabId);
    if (activeTab) {
      activeTab.active = true;
      activeTab.lastUpdate = Date.now();
    }

    messageBus.broadcast('TAB_ACTIVATED', {
      tabId: activeInfo.tabId,
      tab: activeTab,
    });
  }

  private handleTabRemoved(tabId: number): void {
    this.tabs.delete(tabId);

    if (this.activeTabId === tabId) {
      this.activeTabId = null;
    }

    // Notify other components about tab removal for cleanup
    messageBus.broadcast('TAB_REMOVED', { tabId });
  }

  getTab(tabId: number): TabInfo | undefined {
    return this.tabs.get(tabId);
  }

  getActiveTab(): TabInfo | undefined {
    return this.activeTabId !== null ? this.tabs.get(this.activeTabId) : undefined;
  }

  getAllTabs(): TabInfo[] {
    return Array.from(this.tabs.values());
  }

  incrementBlockCount(tabId: number): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.blockCount++;
      tab.lastUpdate = Date.now();
    }
  }

  resetBlockCount(tabId: number): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.blockCount = 0;
      tab.lastUpdate = Date.now();
    }
  }

  getBlockCount(tabId: number): number {
    return this.tabs.get(tabId)?.blockCount || 0;
  }

  getStats(): {
    totalTabs: number;
    activeTabs: number;
    totalBlocks: number;
  } {
    const tabs = Array.from(this.tabs.values());
    return {
      totalTabs: tabs.length,
      activeTabs: tabs.filter(t => t.active).length,
      totalBlocks: tabs.reduce((sum, t) => sum + t.blockCount, 0),
    };
  }

  cleanup(): void {
    const cutoff = Date.now() - TIME.ONE_DAY_MS;

    for (const [tabId, tab] of this.tabs.entries()) {
      if (tab.lastUpdate < cutoff && !tab.active) {
        this.tabs.delete(tabId);
      }
    }
  }
}

export const tabManager = new TabManager();

export type { TabInfo };
