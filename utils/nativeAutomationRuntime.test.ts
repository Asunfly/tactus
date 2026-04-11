import { describe, expect, it } from 'vitest';

import { NativeAutomationRuntime, type NativeAutomationBridge, type NativeAutomationTabInfo } from './nativeAutomationRuntime';

type BrowserState = {
  url: string;
  title: string;
  header: string;
  content: string;
  footer: string;
};

function createBridge(input?: {
  activeTabId?: number | null;
  tabs?: NativeAutomationTabInfo[];
  browserStates?: Record<number, BrowserState>;
}) {
  let activeTabId = input?.activeTabId ?? input?.tabs?.find(tab => tab.active)?.id ?? null;
  let tabs = [...(input?.tabs ?? [])];
  const browserStates = {
    ...(input?.browserStates ?? {}),
  };
  const readyCalls: number[] = [];

  const bridge: NativeAutomationBridge = {
    async getActiveTab() {
      return tabs.find(tab => tab.id === activeTabId) ?? null;
    },
    async getWindowTabs(windowId) {
      return tabs.filter(tab => (windowId ? tab.windowId === windowId : true));
    },
    async getTab(tabId) {
      return tabs.find(tab => tab.id === tabId) ?? null;
    },
    async activateTab(tabId) {
      activeTabId = tabId;
      tabs = tabs.map(tab => ({ ...tab, active: tab.id === tabId }));
    },
    async openTab(url) {
      const newTab: NativeAutomationTabInfo = {
        id: Math.max(0, ...tabs.map(tab => tab.id)) + 1,
        windowId: 1,
        title: url,
        url,
        active: true,
      };
      tabs = tabs.map(tab => ({ ...tab, active: false }));
      tabs.push(newTab);
      activeTabId = newTab.id;
      browserStates[newTab.id] = {
        url,
        title: url,
        header: 'Header',
        content: 'Content',
        footer: 'Footer',
      };
      return newTab;
    },
    async closeTab(tabId) {
      tabs = tabs.filter(tab => tab.id !== tabId);
      if (activeTabId === tabId) {
        activeTabId = tabs[0]?.id ?? null;
        tabs = tabs.map((tab, index) => ({ ...tab, active: index === 0 }));
      }
    },
    async waitForPageReady(tabId) {
      readyCalls.push(tabId);
    },
    async getBrowserState(tabId) {
      const state = browserStates[tabId];
      if (!state) throw new Error(`Missing state for ${tabId}`);
      return state;
    },
    async clickElement(_tabId, index) {
      return { success: true, message: `clicked:${index}` };
    },
    async inputText(_tabId, index, text) {
      return { success: true, message: `input:${index}:${text}` };
    },
    async selectOption(_tabId, index, text) {
      return { success: true, message: `select:${index}:${text}` };
    },
    async scroll(_tabId, options) {
      return { success: true, message: `scroll:${options.down}:${options.numPages}` };
    },
    async executeJavascript(_tabId, script) {
      return { success: true, message: `js:${script}` };
    },
  };

  return { bridge, getTabs: () => tabs, getActiveTabId: () => activeTabId, getReadyCalls: () => readyCalls };
}

describe('NativeAutomationRuntime', () => {
  it('observes the current allowed tab', async () => {
    const { bridge } = createBridge({
      tabs: [
        { id: 11, windowId: 1, title: 'Example', url: 'https://example.com', active: true },
      ],
      browserStates: {
        11: {
          url: 'https://example.com',
          title: 'Example',
          header: 'Header',
          content: 'Content',
          footer: 'Footer',
        },
      },
    });
    const runtime = new NativeAutomationRuntime(bridge);

    const result = await runtime.observe();

    expect(result.success).toBe(true);
    expect(result.result).toContain('Example');
    expect(runtime.getCurrentTabId()).toBe(11);
  });

  it('falls back to the first automatable tab when the active page is restricted', async () => {
    const { bridge } = createBridge({
      activeTabId: 99,
      tabs: [
        { id: 99, windowId: 1, title: 'Settings', url: 'chrome://settings', active: true },
        { id: 11, windowId: 1, title: 'Example', url: 'https://example.com', active: false },
      ],
      browserStates: {
        11: {
          url: 'https://example.com',
          title: 'Example',
          header: 'Header',
          content: 'Content',
          footer: 'Footer',
        },
      },
    });
    const runtime = new NativeAutomationRuntime(bridge);

    const result = await runtime.observe();

    expect(result.success).toBe(true);
    expect(runtime.getCurrentTabId()).toBe(11);
    expect(result.result).toContain('https://example.com');
  });

  it('opens a new tab and makes it current', async () => {
    const { bridge, getReadyCalls } = createBridge({
      tabs: [
        { id: 11, windowId: 1, title: 'Example', url: 'https://example.com', active: true },
      ],
      browserStates: {
        11: {
          url: 'https://example.com',
          title: 'Example',
          header: 'Header',
          content: 'Content',
          footer: 'Footer',
        },
      },
    });
    const runtime = new NativeAutomationRuntime(bridge);

    const result = await runtime.tabs({ action: 'new', url: 'https://docs.example.com' });

    expect(result.success).toBe(true);
    expect(result.result).toContain('docs.example.com');
    expect(runtime.getCurrentTabId()).toBe(12);
    expect(getReadyCalls()).toEqual([12]);
  });

  it('keeps browser_tabs new non-fatal when the target page is not automatable yet', async () => {
    const { bridge } = createBridge({
      tabs: [
        { id: 11, windowId: 1, title: 'Example', url: 'https://example.com', active: true },
      ],
      browserStates: {
        11: {
          url: 'https://example.com',
          title: 'Example',
          header: 'Header',
          content: 'Content',
          footer: 'Footer',
        },
      },
    });
    bridge.waitForPageReady = async () => {
      throw new Error('等待页面内容脚本就绪超时。');
    };

    const runtime = new NativeAutomationRuntime(bridge);
    const result = await runtime.tabs({ action: 'new', url: 'https://blocked.example.com' });

    expect(result.success).toBe(true);
    expect(result.result).toContain('已打开并切换到新标签页');
    expect(result.result).toContain('等待页面内容脚本就绪超时');
  });

  it('selects a tab by rendered index', async () => {
    const { bridge, getReadyCalls } = createBridge({
      tabs: [
        { id: 11, windowId: 1, title: 'Example', url: 'https://example.com', active: true },
        { id: 22, windowId: 1, title: 'Docs', url: 'https://docs.example.com', active: false },
      ],
      browserStates: {
        11: {
          url: 'https://example.com',
          title: 'Example',
          header: 'Header',
          content: 'Content',
          footer: 'Footer',
        },
        22: {
          url: 'https://docs.example.com',
          title: 'Docs',
          header: 'Header',
          content: 'Content',
          footer: 'Footer',
        },
      },
    });
    const runtime = new NativeAutomationRuntime(bridge);

    const result = await runtime.tabs({ action: 'select', index: 1 });

    expect(result.success).toBe(true);
    expect(result.result).toContain('Docs');
    expect(runtime.getCurrentTabId()).toBe(22);
    expect(getReadyCalls()).toEqual([22]);
  });

  it('returns a recoverable observe message when page control receiver is missing', async () => {
    const { bridge } = createBridge({
      tabs: [
        { id: 11, windowId: 1, title: 'Blocked', url: 'https://blocked.example.com', active: true },
      ],
      browserStates: {
        11: {
          url: 'https://blocked.example.com',
          title: 'Blocked',
          header: 'Header',
          content: 'Content',
          footer: 'Footer',
        },
      },
    });
    bridge.getBrowserState = async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    };

    const runtime = new NativeAutomationRuntime(bridge);
    const result = await runtime.observe();

    expect(result.success).toBe(true);
    expect(result.result).toContain('暂时无法自动化观察');
    expect(result.result).toContain('Receiving end does not exist');
  });

  it('closes the current tab and falls back to another automatable tab', async () => {
    const { bridge } = createBridge({
      tabs: [
        { id: 11, windowId: 1, title: 'Example', url: 'https://example.com', active: false },
        { id: 22, windowId: 1, title: 'Docs', url: 'https://docs.example.com', active: true },
      ],
      browserStates: {
        11: {
          url: 'https://example.com',
          title: 'Example',
          header: 'Header',
          content: 'Content',
          footer: 'Footer',
        },
        22: {
          url: 'https://docs.example.com',
          title: 'Docs',
          header: 'Header',
          content: 'Content',
          footer: 'Footer',
        },
      },
    });
    const runtime = new NativeAutomationRuntime(bridge);
    await runtime.tabs({ action: 'select', index: 1 });

    const result = await runtime.tabs({ action: 'close' });

    expect(result.success).toBe(true);
    expect(runtime.getCurrentTabId()).toBe(11);
    expect(result.result).toContain('Example');
  });
});
