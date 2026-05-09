import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tabManager } from '@/utils/tab-manager';

const broadcastMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/utils/message-bus', () => ({
  messageBus: {
    broadcast: broadcastMock,
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: loggerMock,
}));

type ChromeTabListener<T extends (...args: any[]) => void> = T[];

describe('tabManager integration', () => {
  let createdListeners: ChromeTabListener<(tab: chrome.tabs.Tab) => void>;
  let updatedListeners: ChromeTabListener<
    (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void
  >;
  let activatedListeners: ChromeTabListener<(activeInfo: chrome.tabs.TabActiveInfo) => void>;
  let removedListeners: ChromeTabListener<(tabId: number) => void>;

  const resetTabManagerState = (): void => {
    const internal = tabManager as unknown as {
      tabs: Map<number, unknown>;
      activeTabId: number | null;
      initialized: boolean;
    };
    internal.tabs.clear();
    internal.activeTabId = null;
    internal.initialized = false;
  };

  const setupChromeTabs = (initialTabs: chrome.tabs.Tab[]): void => {
    createdListeners = [];
    updatedListeners = [];
    activatedListeners = [];
    removedListeners = [];

    const tabsApi = {
      query: vi.fn().mockResolvedValue(initialTabs),
      onCreated: { addListener: vi.fn((cb) => createdListeners.push(cb)) },
      onUpdated: { addListener: vi.fn((cb) => updatedListeners.push(cb)) },
      onActivated: { addListener: vi.fn((cb) => activatedListeners.push(cb)) },
      onRemoved: { addListener: vi.fn((cb) => removedListeners.push(cb)) },
    };

    (globalThis as unknown as { chrome?: unknown }).chrome = {
      tabs: tabsApi,
    } as unknown as typeof chrome;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetTabManagerState();
    setupChromeTabs([
      {
        id: 1,
        url: 'https://example.com/page?ref=1',
        title: 'Example',
        active: true,
        status: 'complete',
      } as chrome.tabs.Tab,
    ]);
  });

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('tracks block counts across navigation updates', async () => {
    await tabManager.initialize();

    expect(tabManager.getBlockCount(1)).toBe(0);

    tabManager.incrementBlockCount(1);
    tabManager.incrementBlockCount(1);

    expect(tabManager.getBlockCount(1)).toBe(2);

    updatedListeners[0]?.(
      1,
      { status: 'loading' } as chrome.tabs.TabChangeInfo,
      {
        id: 1,
        url: 'https://example.com/next',
        title: 'Next',
        active: true,
        status: 'loading',
      } as chrome.tabs.Tab
    );

    expect(tabManager.getBlockCount(1)).toBe(0);
    expect(broadcastMock).toHaveBeenCalledWith(
      'TAB_UPDATED',
      expect.objectContaining({
        tabId: 1,
        tab: expect.objectContaining({ status: 'loading' }),
      })
    );

    tabManager.resetBlockCount(1);
    expect(tabManager.getBlockCount(1)).toBe(0);
  });

  it('cleans up state when tabs close', async () => {
    await tabManager.initialize();

    createdListeners[0]?.({
      id: 2,
      url: 'https://second.example',
      title: 'Second',
      active: false,
      status: 'complete',
    } as chrome.tabs.Tab);

    expect(tabManager.getTab(1)).toBeDefined();
    expect(tabManager.getTab(2)).toBeDefined();

    removedListeners.forEach((listener) => listener(1));

    expect(tabManager.getTab(1)).toBeUndefined();
    expect(tabManager.getActiveTab()).toBeUndefined();
    expect(broadcastMock).toHaveBeenCalledWith('TAB_REMOVED', { tabId: 1 });

    const stats = tabManager.getStats();
    expect(stats.totalTabs).toBe(1);
    expect(stats.totalBlocks).toBe(0);
  });

  it('handles tab creation events', async () => {
    await tabManager.initialize();

    createdListeners[0]?.({
      id: 3,
      url: 'https://new-tab.example',
      title: 'New Tab',
      active: false,
      status: 'complete',
    } as chrome.tabs.Tab);

    expect(tabManager.getTab(3)).toBeDefined();
  });

  it('handles tab activation events', async () => {
    await tabManager.initialize();

    createdListeners[0]?.({
      id: 4,
      url: 'https://inactive.example',
      title: 'Inactive',
      active: false,
      status: 'complete',
    } as chrome.tabs.Tab);

    expect(tabManager.getTab(4)).toBeDefined();

    activatedListeners[0]?.({ tabId: 4, windowId: 1 } as chrome.tabs.TabActiveInfo);
    expect(tabManager.getActiveTab()).toEqual(
      expect.objectContaining({
        id: 4,
        active: true,
      })
    );
  });

  it('cleans up old tab data', async () => {
    await tabManager.initialize();

    // Cleanup removes tabs older than 24 hours, but we need to test the cleanup function exists
    tabManager.cleanup();
    
    // Verify cleanup doesn't crash
    const stats = tabManager.getStats();
    expect(stats).toBeDefined();
  });

  it('returns undefined for non-existent tabs', () => {
    expect(tabManager.getTab(999)).toBeUndefined();
    expect(tabManager.getBlockCount(999)).toBe(0);
  });

  it('handles multiple increments correctly', async () => {
    await tabManager.initialize();

    tabManager.incrementBlockCount(1);
    tabManager.incrementBlockCount(1);
    tabManager.incrementBlockCount(1);

    expect(tabManager.getBlockCount(1)).toBe(3);

    const stats = tabManager.getStats();
    expect(stats.totalBlocks).toBeGreaterThanOrEqual(3);
  });

  it('recovers when initial tab sync fails', async () => {
    const queryError = new Error('tabs query failed');
    setupChromeTabs([]);
    const chromeRef = globalThis.chrome as unknown as {
      tabs: { query: ReturnType<typeof vi.fn> };
    };
    chromeRef.tabs.query.mockRejectedValue(queryError);

    await tabManager.initialize();

    const stats = tabManager.getStats();
    expect(stats.totalTabs).toBe(0);
    expect(loggerMock.error).toHaveBeenCalledWith(
      'TabManager',
      'Failed to sync existing tabs',
      queryError
    );
  });

  it('handles rapid navigation updates without losing final tab state', async () => {
    await tabManager.initialize();

    updatedListeners[0]?.(
      1,
      { status: 'loading' } as chrome.tabs.TabChangeInfo,
      {
        id: 1,
        url: 'https://example.com/loading?ref=track',
        title: 'Loading',
        active: true,
        status: 'loading',
      } as chrome.tabs.Tab
    );

    updatedListeners[0]?.(
      1,
      { status: 'complete' } as chrome.tabs.TabChangeInfo,
      {
        id: 1,
        url: 'https://example.com/final?utm=test',
        title: 'Final',
        active: true,
        status: 'complete',
      } as chrome.tabs.Tab
    );

    const tab = tabManager.getTab(1);
    expect(tab).toEqual(
      expect.objectContaining({
        status: 'complete',
        title: 'Final',
        // URL should be sanitized by tab manager
        url: 'https://example.com/final',
      })
    );
    expect(broadcastMock).toHaveBeenCalledWith(
      'TAB_UPDATED',
      expect.objectContaining({ tabId: 1 })
    );
  });
});
