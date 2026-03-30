import { describe, expect, it, vi } from 'vitest';
import { PlaywrightRuntimeController } from './playwrightRuntimeController';

type TabLike = {
  id: number;
  windowId: number;
  active: boolean;
  url: string;
  title: string;
};

function createHarness(input?: {
  tabs?: TabLike[];
  boundTabId?: number | null;
  lockedTabId?: number | null;
  connected?: boolean;
  focusWindowError?: string | null;
}) {
  let tabs = [...(input?.tabs ?? [])];
  let boundTabId = input?.boundTabId ?? null;
  let lockedTabId = input?.lockedTabId ?? null;
  let connected = input?.connected ?? false;
  let nextTabId = 100;

  const bindBridge = vi.fn(async (tabId: number) => {
    boundTabId = tabId;
  });
  const reconnectRuntimeServer = vi.fn(async () => {
    connected = true;
  });
  const focusWindow = vi.fn(async (_windowId: number) => {
    if (input?.focusWindowError) {
      throw new Error(input.focusWindowError);
    }
  });
  const updateTab = vi.fn(async (tabId: number, updateProperties: { active?: boolean }) => {
    tabs = tabs.map((tab) => {
      if (tab.id !== tabId) {
        if (updateProperties.active) {
          return {
            ...tab,
            active: false,
          };
        }
        return tab;
      }
      return {
        ...tab,
        ...updateProperties,
      };
    });
    return tabs.find(tab => tab.id === tabId) ?? null;
  });
  const createTab = vi.fn(async (createProperties: { url?: string; active?: boolean }) => {
    const created: TabLike = {
      id: nextTabId++,
      windowId: 99,
      active: createProperties.active ?? true,
      url: createProperties.url ?? 'about:blank',
      title: createProperties.url ?? 'about:blank',
    };
    if (created.active) {
      tabs = tabs.map(tab => ({ ...tab, active: false }));
    }
    tabs.push(created);
    return created;
  });
  const queryTabs = vi.fn(async (queryInfo: Record<string, any>) => {
    return tabs.filter((tab) => {
      if (queryInfo.currentWindow && tab.windowId !== 1) return false;
      if (queryInfo.windowId && tab.windowId !== queryInfo.windowId) return false;
      if (queryInfo.active && !tab.active) return false;
      return true;
    });
  });
  const getTab = vi.fn(async (tabId: number) => {
    const tab = tabs.find(item => item.id === tabId);
    if (!tab) {
      throw new Error(`Tab ${tabId} not found`);
    }
    return tab;
  });
  const removeTab = vi.fn(async (tabId: number) => {
    tabs = tabs.filter(tab => tab.id !== tabId);
  });

  const controller = new PlaywrightRuntimeController({
    getLanguage: () => 'zh-CN',
    getRuntimeServer: () => ({ id: 'builtin-playwright-gateway', name: 'Local Playwright Gateway' }),
    isRuntimeServerConnected: () => connected,
    reconnectRuntimeServer,
    getBoundTabId: () => boundTabId,
    setBoundTabId: (tabId) => {
      boundTabId = tabId;
    },
    getLockedTabId: () => lockedTabId,
    setLockedTabId: (tabId) => {
      lockedTabId = tabId;
    },
    queryTabs,
    getTab,
    removeTab,
    updateTab,
    createTab,
    bindBridge,
    focusWindow,
  });

  return {
    controller,
    bindBridge,
    reconnectRuntimeServer,
    focusWindow,
    updateTab,
    createTab,
    queryTabs,
    getTab,
    removeTab,
    getBoundTabId: () => boundTabId,
    getLockedTabId: () => lockedTabId,
    getTabs: () => tabs,
  };
}

describe('PlaywrightRuntimeController', () => {
  it('已有稳定绑定时直接进入 ready，不重复恢复', async () => {
    const harness = createHarness({
      tabs: [
        { id: 11, windowId: 1, active: true, url: 'https://example.com', title: 'Example' },
      ],
      boundTabId: 11,
      connected: true,
    });

    const result = await harness.controller.prepareForTool('browser_click', { ref: 'e1' });

    expect(result.ok).toBe(true);
    expect(result.snapshot.phase).toBe('ready');
    expect(harness.bindBridge).not.toHaveBeenCalled();
    expect(harness.reconnectRuntimeServer).not.toHaveBeenCalled();
  });

  it('当前窗口没有网页目标时，会自动切到其它窗口的网页 tab 并继续执行', async () => {
    const harness = createHarness({
      tabs: [
        { id: 21, windowId: 1, active: true, url: 'chrome://extensions', title: 'Extensions' },
        { id: 22, windowId: 2, active: false, url: 'https://github.com', title: 'GitHub' },
      ],
      connected: false,
    });

    const result = await harness.controller.prepareForTool('browser_snapshot', {});

    expect(result.ok).toBe(true);
    expect(result.snapshot.phase).toBe('ready');
    expect(harness.bindBridge).toHaveBeenCalledWith(22, 2);
    expect(harness.focusWindow).toHaveBeenCalledWith(2);
    expect(harness.reconnectRuntimeServer).toHaveBeenCalledTimes(1);
  });

  it('browser_tabs 会列出所有窗口里的标签页，并标记 runtime 当前绑定目标', async () => {
    const harness = createHarness({
      tabs: [
        { id: 71, windowId: 1, active: false, url: 'https://current-window.com', title: 'Current Window' },
        { id: 72, windowId: 2, active: true, url: 'https://other-window.com', title: 'Other Window' },
      ],
      boundTabId: 72,
      connected: true,
    });

    const result = await harness.controller.listTabs();

    expect(result).toHaveLength(2);
    expect(result.find(tab => tab.id === 72)?.current).toBe(true);
    expect(result.find(tab => tab.id === 71)?.current).toBe(false);
  });

  it('明确导航意图且没有网页目标时，会直接打开目标 URL 并继续执行', async () => {
    const harness = createHarness({
      tabs: [
        { id: 31, windowId: 1, active: true, url: 'about:blank', title: 'Blank' },
      ],
      connected: false,
    });

    const result = await harness.controller.prepareForTool('browser_navigate', {
      url: 'https://github.com/repos?q=owner%3A%40me',
    });

    expect(result.ok).toBe(true);
    expect(result.snapshot.phase).toBe('ready');
    expect(harness.createTab).toHaveBeenCalledWith({
      url: 'https://github.com/repos?q=owner%3A%40me',
      active: true,
    });
    expect(harness.bindBridge).toHaveBeenCalledWith(100, 99);
  });

  it('跨窗口聚焦失败时不会中断恢复，只要 tab 还能激活和重绑就继续执行', async () => {
    const harness = createHarness({
      tabs: [
        { id: 81, windowId: 1, active: true, url: 'chrome://extensions', title: 'Extensions' },
        { id: 82, windowId: 2, active: false, url: 'https://recover.example', title: 'Recover' },
      ],
      connected: false,
      focusWindowError: 'Window focus denied',
    });

    const result = await harness.controller.prepareForTool('browser_snapshot', {});

    expect(result.ok).toBe(true);
    expect(result.snapshot.phase).toBe('ready');
    expect(harness.bindBridge).toHaveBeenCalledWith(82, 2);
    expect(harness.reconnectRuntimeServer).toHaveBeenCalledTimes(1);
  });

  it('非导航类工具在没有可恢复网页目标时进入 blocked，而不是乱开空白页', async () => {
    const harness = createHarness({
      tabs: [
        { id: 41, windowId: 1, active: true, url: 'about:blank', title: 'Blank' },
      ],
      connected: false,
    });

    const result = await harness.controller.prepareForTool('browser_navigate_back', {});

    expect(result.ok).toBe(false);
    expect(result.snapshot.phase).toBe('blocked');
    expect(harness.createTab).not.toHaveBeenCalled();
  });

  it('导航工具缺少有效 url 参数时会准确进入 blocked，而不是返回错误的缺页提示', async () => {
    const harness = createHarness({
      tabs: [
        { id: 91, windowId: 1, active: true, url: 'about:blank', title: 'Blank' },
      ],
      connected: false,
    });

    const result = await harness.controller.prepareForTool('browser_navigate', {});

    expect(result.ok).toBe(false);
    expect(result.snapshot.reason).toBe('missing_navigation_url');
    expect(result.detail).toContain('url');
  });

  it('会话关闭类错误会进入 recovering，并恢复到可继续执行的 ready', async () => {
    const harness = createHarness({
      tabs: [
        { id: 51, windowId: 1, active: true, url: 'chrome://settings', title: 'Settings' },
        { id: 52, windowId: 2, active: false, url: 'https://example.com/recover', title: 'Recover' },
      ],
      connected: true,
    });

    const result = await harness.controller.recoverForSessionError(
      'browser_navigate_back',
      {},
      'Error: browserContext.newPage: Target page, context or browser has been closed',
    );

    expect(result.ok).toBe(true);
    expect(result.snapshot.phase).toBe('ready');
    expect(harness.bindBridge).toHaveBeenCalledWith(52, 2);
    expect(harness.focusWindow).toHaveBeenCalledWith(2);
    expect(harness.reconnectRuntimeServer).toHaveBeenCalledTimes(1);
  });

  it('新任务开始后会优先当前 task tab，而不是沿用上次绑定的旧 tab', async () => {
    const harness = createHarness({
      tabs: [
        { id: 11, windowId: 1, active: true, url: 'https://docs.qq.com', title: 'Tencent Docs' },
        { id: 22, windowId: 2, active: false, url: 'https://github.com', title: 'GitHub' },
      ],
      boundTabId: 22,
      connected: true,
    });

    await harness.controller.startTask();
    const result = await harness.controller.prepareForTool('browser_snapshot', {});

    expect(harness.getLockedTabId()).toBe(11);
    expect(result.ok).toBe(true);
    expect(result.snapshot.targetTabId).toBe(11);
    expect(harness.bindBridge).toHaveBeenCalledWith(11, 1);
  });

  it('任务结束后会释放 task 锁定，但保留 runtime 已绑定的 tab 作为后续 fallback', async () => {
    const harness = createHarness({
      tabs: [
        { id: 11, windowId: 1, active: true, url: 'https://docs.qq.com', title: 'Tencent Docs' },
        { id: 22, windowId: 2, active: false, url: 'https://github.com', title: 'GitHub' },
      ],
      boundTabId: 22,
      connected: true,
    });

    await harness.controller.startTask();
    const snapshot = harness.controller.finishTask();

    expect(harness.getLockedTabId()).toBe(null);
    expect(snapshot.boundTabId).toBe(22);
    expect(snapshot.lockedTabId).toBe(null);
  });

  it('browser_tabs.close 由 runtime 接管时，会在关闭当前绑定页后自动回退到下一个可恢复目标', async () => {
    const harness = createHarness({
      tabs: [
        { id: 11, windowId: 1, active: true, url: 'https://docs.qq.com', title: 'Tencent Docs' },
        { id: 22, windowId: 2, active: false, url: 'https://github.com', title: 'GitHub' },
      ],
      boundTabId: 22,
      connected: true,
    });

    const result = await harness.controller.closeTab(22);

    expect(result.ok).toBe(true);
    expect(harness.removeTab).toHaveBeenCalledWith(22);
    expect(harness.getBoundTabId()).toBe(11);
    expect(result.snapshot.targetTabId).toBe(11);
    expect(harness.getTabs().some(tab => tab.id === 22)).toBe(false);
    expect(harness.bindBridge).toHaveBeenCalledWith(11, 1);
  });

});
