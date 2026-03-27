import { describe, expect, it, vi } from 'vitest';
import {
  INTERNAL_PLAYWRIGHT_BRIDGE_BIND_MESSAGE_TYPE,
  createInternalPlaywrightBridgeBindMessage,
} from './internalPlaywrightBridge';
import {
  InternalPlaywrightBridgeBackground,
  type BridgeDebuggerApi,
  type BridgeSocketLike,
  type BridgeTabsApi,
} from './internalPlaywrightBridgeBackground';

class FakeSocket implements BridgeSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(_code?: number, reason?: string): void {
    this.readyState = 3;
    this.onclose?.({ reason });
  }

  emitOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0);
    return;
  }
  await new Promise(resolve => setTimeout(resolve, 0));
}

function createDebuggerApi() {
  const eventListeners = new Set<(source: { tabId?: number; sessionId?: string }, method: string, params: any) => void>();
  const detachListeners = new Set<(source: { tabId?: number }, reason: string) => void>();

  const attachCalls: Array<{ debuggee: { tabId: number }; version: string }> = [];
  const sendCalls: Array<{ debuggee: { tabId: number; sessionId?: string }; method: string; params: any }> = [];
  const detachCalls: Array<{ tabId: number }> = [];

  const api: BridgeDebuggerApi = {
    async attach(debuggee, version) {
      attachCalls.push({ debuggee, version });
    },
    async sendCommand(debuggee, method, params) {
      sendCalls.push({ debuggee, method, params });
      if (method === 'Target.getTargetInfo') {
        return {
          targetInfo: {
            targetId: `tab-${debuggee.tabId}`,
            type: 'page',
            title: 'Example',
            url: 'https://example.com',
          },
        };
      }
      return { ok: true, method };
    },
    async detach(debuggee) {
      detachCalls.push(debuggee);
    },
    onEvent: {
      addListener(listener) {
        eventListeners.add(listener);
      },
      removeListener(listener) {
        eventListeners.delete(listener);
      },
    },
    onDetach: {
      addListener(listener) {
        detachListeners.add(listener);
      },
      removeListener(listener) {
        detachListeners.delete(listener);
      },
    },
  };

  return {
    api,
    attachCalls,
    sendCalls,
    detachCalls,
    emitDebuggerEvent(source: { tabId?: number; sessionId?: string }, method: string, params: any) {
      for (const listener of eventListeners) {
        listener(source, method, params);
      }
    },
    emitDebuggerDetach(source: { tabId?: number }, reason: string) {
      for (const listener of detachListeners) {
        listener(source, reason);
      }
    },
  };
}

function createTabsApi() {
  let nextTabId = 100;
  const tabs = new Map<number, {
    id: number;
    windowId: number;
    active: boolean;
    url: string;
    title?: string;
  }>();
  tabs.set(11, { id: 11, windowId: 1, active: true, url: 'https://example.com/11', title: 'Tab 11' });
  tabs.set(22, { id: 22, windowId: 1, active: false, url: 'https://example.com/22', title: 'Tab 22' });
  tabs.set(33, { id: 33, windowId: 1, active: true, url: 'https://example.com/33', title: 'Tab 33' });
  tabs.set(44, { id: 44, windowId: 1, active: true, url: 'https://example.com/44', title: 'Tab 44' });
  tabs.set(55, { id: 55, windowId: 1, active: true, url: 'https://example.com/55', title: 'Tab 55' });
  tabs.set(66, { id: 66, windowId: 1, active: true, url: 'chrome://extensions', title: 'Extensions' });
  tabs.set(77, { id: 77, windowId: 1, active: false, url: 'https://example.com/77', title: 'Tab 77' });

  const api: BridgeTabsApi = {
    async create(createProperties) {
      const id = nextTabId++;
      const tab = {
        id,
        windowId: 1,
        active: createProperties.active ?? true,
        url: createProperties.url ?? 'about:blank',
        title: createProperties.url ?? 'about:blank',
      };
      tabs.set(id, tab);
      return tab;
    },
    async get(tabId) {
      const tab = tabs.get(tabId);
      if (!tab) {
        throw new Error(`Tab ${tabId} not found`);
      }
      return tab;
    },
    async remove(tabId) {
      tabs.delete(tabId);
    },
    async query() {
      return Array.from(tabs.values());
    },
  };

  return { api, tabs };
}

describe('InternalPlaywrightBridgeBackground', () => {
  it('建立到 relay extension 端点的 websocket 连接', async () => {
    const sockets: FakeSocket[] = [];
    const debuggerApi = createDebuggerApi();
    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: (url) => {
        const socket = new FakeSocket();
        sockets.push(socket);
        expect(url).toBe('ws://127.0.0.1:8932/extension');
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 11 }));

    expect(sockets).toHaveLength(1);
  });

  it('相同 tab 和端点重复绑定时复用现有连接', async () => {
    let socketCount = 0;
    const debuggerApi = createDebuggerApi();
    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socketCount += 1;
        const socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
    });

    const message = createInternalPlaywrightBridgeBindMessage({ tabId: 11 });
    await manager.ensureBinding(message);
    await manager.ensureBinding(message);

    expect(socketCount).toBe(1);
  });

  it('切换默认 tab 时复用同一 websocket，并在已附着状态下发送重绑事件', async () => {
    let socketCount = 0;
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socketCount += 1;
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 11 }));
    socket.emitMessage({ id: 1, method: 'attachToTab', params: {} });
    await flushMicrotasks();
    socket.sent = [];

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 22 }));
    await flushMicrotasks();

    expect(socketCount).toBe(1);
    expect(debuggerApi.attachCalls.at(-1)).toEqual({ debuggee: { tabId: 11 }, version: '1.3' });
    const lifecycleMessage = socket.sent
      .map(entry => JSON.parse(entry))
      .find(entry => entry.method === 'tabReattached');
    expect(lifecycleMessage).toBeUndefined();
  });

  it('收到 attachToTab 命令时会附着到当前 tab 并返回 targetInfo', async () => {
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 22 }));
    socket.emitMessage({ id: 1, method: 'attachToTab', params: {} });
    await flushMicrotasks();

    expect(debuggerApi.attachCalls).toEqual([{ debuggee: { tabId: 22 }, version: '1.3' }]);
    const attachResponse = socket.sent
      .map(entry => JSON.parse(entry))
      .find(entry => entry.id === 1);
    expect(attachResponse).toEqual({
      id: 1,
      result: {
        tabId: 22,
        targetInfo: {
          targetId: 'tab-22',
          type: 'page',
          title: 'Example',
          url: 'https://example.com',
        },
      },
    });
  });

  it('默认 tab 指向 chrome:// 页面时，会自动回退到可调试页面再 attach', async () => {
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 66 }));
    socket.emitMessage({ id: 9, method: 'attachToTab', params: {} });
    await flushMicrotasks();

    expect(debuggerApi.attachCalls).toEqual([{ debuggee: { tabId: 11 }, version: '1.3' }]);
    expect(JSON.parse(socket.sent.at(-1) || '')).toEqual({
      id: 9,
      result: {
        tabId: 11,
        targetInfo: {
          targetId: 'tab-11',
          type: 'page',
          title: 'Example',
          url: 'https://example.com',
        },
      },
    });
  });

  it('收到 forwardCDPCommand 时会转发到 chrome.debugger', async () => {
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 22 }));
    socket.emitMessage({
      id: 2,
      method: 'forwardCDPCommand',
      params: {
        sessionId: 'pw-tab-1',
        method: 'Runtime.evaluate',
        params: { expression: '2 + 2' },
      },
    });
    await flushMicrotasks();

    expect(debuggerApi.sendCalls.at(-1)).toEqual({
      debuggee: { tabId: 22, sessionId: 'pw-tab-1' },
      method: 'Runtime.evaluate',
      params: { expression: '2 + 2' },
    });
    expect(JSON.parse(socket.sent.at(-1) || '')).toEqual({
      id: 2,
      result: { ok: true, method: 'Runtime.evaluate' },
    });
  });

  it('会把当前 tab 的 debugger 事件转发回 relay', async () => {
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 33 }));
    debuggerApi.emitDebuggerEvent({ tabId: 33, sessionId: 'pw-tab-2' }, 'Page.loadEventFired', { ts: 1 });

    expect(JSON.parse(socket.sent[0])).toEqual({
      method: 'forwardCDPEvent',
      params: {
        tabId: 33,
        sessionId: 'pw-tab-2',
        method: 'Page.loadEventFired',
        params: { ts: 1 },
      },
    });
  });

  it('收到 createTab 命令时会创建新 tab 并返回新的 targetInfo', async () => {
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    const tabsApi = createTabsApi();
    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: tabsApi.api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 22 }));
    socket.emitMessage({ id: 1, method: 'attachToTab', params: {} });
    await flushMicrotasks();
    socket.sent = [];
    socket.emitMessage({
      id: 3,
      method: 'createTab',
      params: {
        url: 'https://example.com/new',
        active: true,
      },
    });
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = JSON.parse(socket.sent.at(-1) || '');
    expect(response.id).toBe(3);
    expect(response.result.tabId).toBeGreaterThanOrEqual(100);
    expect(response.result.targetInfo.targetId).toBe(`tab-${response.result.tabId}`);
    expect(debuggerApi.attachCalls.at(-1)).toEqual({
      debuggee: { tabId: response.result.tabId },
      version: '1.3',
    });
  });

  it('关闭当前 tab 后如果活动页是 chrome://，会回退到下一个可调试页面作为默认 target', async () => {
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    const tabsApi = createTabsApi();
    tabsApi.tabs.get(66)!.active = true;
    tabsApi.tabs.get(11)!.active = false;
    tabsApi.tabs.get(77)!.active = false;

    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: tabsApi.api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 22 }));
    socket.emitMessage({
      id: 10,
      method: 'closeTab',
      params: {
        tabId: 22,
      },
    });
    await flushMicrotasks();

    socket.emitMessage({ id: 11, method: 'attachToTab', params: {} });
    await flushMicrotasks();

    expect(debuggerApi.attachCalls.at(-1)).toEqual({
      debuggee: { tabId: 33 },
      version: '1.3',
    });
  });

  it('收到 bindToTab 且要求静默切换时不会向 relay 发送 tabReattached 事件', async () => {
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 22 }));
    socket.emitMessage({ id: 1, method: 'attachToTab', params: {} });
    await flushMicrotasks();
    socket.sent = [];

    socket.emitMessage({
      id: 4,
      method: 'bindToTab',
      params: {
        tabId: 11,
        emitLifecycleEvent: false,
      },
    });
    await flushMicrotasks();

    const messages = socket.sent.map(entry => JSON.parse(entry));
    expect(messages.some(message => message.method === 'tabReattached')).toBe(false);
    const bindResponse = messages.find(message => message.id === 4);
    expect(bindResponse).toEqual({
      id: 4,
      result: {
        tabId: 11,
        targetInfo: {
          targetId: 'tab-11',
          type: 'page',
          title: 'Example',
          url: 'https://example.com',
        },
      },
    });
  });

  it('dialog 已关闭后再收到 handleJavaScriptDialog 会直接返回空结果，不再转发到底层', async () => {
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 22 }));
    socket.emitMessage({ id: 1, method: 'attachToTab', params: {} });
    await flushMicrotasks();
    debuggerApi.emitDebuggerEvent({ tabId: 22 }, 'Page.javascriptDialogOpening', {});
    debuggerApi.emitDebuggerEvent({ tabId: 22 }, 'Page.javascriptDialogClosed', {});
    socket.sent = [];
    const sendCallCount = debuggerApi.sendCalls.length;

    socket.emitMessage({
      id: 5,
      method: 'forwardCDPCommand',
      params: {
        method: 'Page.handleJavaScriptDialog',
        params: { accept: false },
      },
    });
    await flushMicrotasks();

    expect(debuggerApi.sendCalls).toHaveLength(sendCallCount);
    expect(JSON.parse(socket.sent.at(-1) || '')).toEqual({
      id: 5,
      result: {},
    });
  });

  it('Runtime 上下文已失效时会返回可恢复的 undefined 结果，而不是直接抛协议错误', async () => {
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    debuggerApi.api.sendCommand = async (debuggee, method, params) => {
      debuggerApi.sendCalls.push({ debuggee, method, params });
      if (method === 'Target.getTargetInfo') {
        return {
          targetInfo: {
            targetId: `tab-${debuggee.tabId}`,
            type: 'page',
            title: 'Example',
            url: 'https://example.com',
          },
        };
      }
      if (method === 'Runtime.callFunctionOn') {
        throw new Error('Cannot find context with specified id');
      }
      return { ok: true, method };
    };

    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 22 }));
    socket.emitMessage({
      id: 6,
      method: 'forwardCDPCommand',
      params: {
        method: 'Runtime.callFunctionOn',
        params: { objectId: '1', functionDeclaration: '() => 1' },
      },
    });
    await flushMicrotasks();

    expect(JSON.parse(socket.sent.at(-1) || '')).toEqual({
      id: 6,
      result: {
        result: {
          type: 'undefined',
        },
      },
    });
  });

  it('新 tab 首次命令如果提示 debugger 未附着，会自动补 attach 后重试一次', async () => {
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    let firstAttempt = true;
    debuggerApi.api.sendCommand = async (debuggee, method, params) => {
      debuggerApi.sendCalls.push({ debuggee, method, params });
      if (method === 'Target.getTargetInfo') {
        return {
          targetInfo: {
            targetId: `tab-${debuggee.tabId}`,
            type: 'page',
            title: 'Example',
            url: 'https://example.com',
          },
        };
      }
      if (method === 'Runtime.evaluate' && firstAttempt) {
        firstAttempt = false;
        throw new Error(`Debugger is not attached to the tab with id: ${debuggee.tabId}.`);
      }
      return { ok: true, method };
    };

    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 22 }));
    socket.emitMessage({ id: 7, method: 'attachToTab', params: {} });
    await flushMicrotasks();
    socket.sent = [];

    socket.emitMessage({
      id: 8,
      method: 'forwardCDPCommand',
      params: {
        method: 'Runtime.evaluate',
        params: { expression: '1 + 1' },
      },
    });
    await flushMicrotasks();

    expect(debuggerApi.attachCalls).toHaveLength(2);
    expect(JSON.parse(socket.sent.at(-1) || '')).toEqual({
      id: 8,
      result: { ok: true, method: 'Runtime.evaluate' },
    });
  });

  it('空闲超时后会自动断开 debugger，并在下一条命令时自动重新附着', async () => {
    vi.useFakeTimers();
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
      idleTimeoutMs: 5_000,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 44 }));
    socket.emitMessage({ id: 1, method: 'attachToTab', params: {} });
    await flushMicrotasks();

    expect(debuggerApi.attachCalls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5_100);
    expect(debuggerApi.detachCalls).toContainEqual({ tabId: 44 });
    expect(socket.readyState).toBe(1);

    socket.emitMessage({
      id: 2,
      method: 'forwardCDPCommand',
      params: {
        method: 'Runtime.evaluate',
        params: { expression: '1 + 1' },
      },
    });
    await flushMicrotasks();

    expect(debuggerApi.attachCalls).toHaveLength(2);
    expect(JSON.parse(socket.sent.at(-1) || '')).toEqual({
      id: 2,
      result: { ok: true, method: 'Runtime.evaluate' },
    });

    vi.useRealTimers();
    await manager.dispose();
  });

  it('用户手动关闭调试后不会断开 websocket，并可在下一条命令时重新附着', async () => {
    let socket!: FakeSocket;
    const debuggerApi = createDebuggerApi();
    const manager = new InternalPlaywrightBridgeBackground({
      createSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emitOpen());
        return socket;
      },
      debuggerApi: debuggerApi.api,
      tabsApi: createTabsApi().api,
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 55 }));
    socket.emitMessage({ id: 1, method: 'attachToTab', params: {} });
    await flushMicrotasks();

    debuggerApi.emitDebuggerDetach({ tabId: 55 }, 'canceled_by_user');
    await flushMicrotasks();

    expect(socket.readyState).toBe(1);

    socket.emitMessage({
      id: 2,
      method: 'forwardCDPCommand',
      params: {
        method: 'Runtime.evaluate',
        params: { expression: '3 + 3' },
      },
    });
    await flushMicrotasks();

    expect(debuggerApi.attachCalls).toHaveLength(2);
    expect(JSON.parse(socket.sent.at(-1) || '')).toEqual({
      id: 2,
      result: { ok: true, method: 'Runtime.evaluate' },
    });
  });
});
