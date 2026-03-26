import { describe, expect, it } from 'vitest';
import {
  INTERNAL_PLAYWRIGHT_BRIDGE_BIND_MESSAGE_TYPE,
  createInternalPlaywrightBridgeBindMessage,
} from './internalPlaywrightBridge';
import {
  InternalPlaywrightBridgeBackground,
  type BridgeDebuggerApi,
  type BridgeSocketLike,
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
    });

    const message = createInternalPlaywrightBridgeBindMessage({ tabId: 11 });
    await manager.ensureBinding(message);
    await manager.ensureBinding(message);

    expect(socketCount).toBe(1);
  });

  it('切换到另一个 tab 时复用同一 websocket，并向 relay 发送重绑事件', async () => {
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
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 11 }));
    socket.emitMessage({ id: 1, method: 'attachToTab', params: {} });
    await flushMicrotasks();
    socket.sent = [];

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 22 }));
    await flushMicrotasks();

    expect(socketCount).toBe(1);
    expect(debuggerApi.detachCalls).toContainEqual({ tabId: 11 });
    expect(debuggerApi.attachCalls.at(-1)).toEqual({ debuggee: { tabId: 22 }, version: '1.3' });
    expect(JSON.parse(socket.sent[0])).toEqual({
      method: 'tabReattached',
      params: {
        targetInfo: {
          targetId: 'tab-22',
          type: 'page',
          title: 'Example',
          url: 'https://example.com',
        },
      },
    });
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
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 22 }));
    socket.emitMessage({ id: 1, method: 'attachToTab', params: {} });
    await flushMicrotasks();

    expect(debuggerApi.attachCalls).toEqual([{ debuggee: { tabId: 22 }, version: '1.3' }]);
    expect(JSON.parse(socket.sent[0])).toEqual({
      id: 1,
      result: {
        targetInfo: {
          targetId: 'tab-22',
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
    });

    await manager.ensureBinding(createInternalPlaywrightBridgeBindMessage({ tabId: 33 }));
    debuggerApi.emitDebuggerEvent({ tabId: 33, sessionId: 'pw-tab-2' }, 'Page.loadEventFired', { ts: 1 });

    expect(JSON.parse(socket.sent[0])).toEqual({
      method: 'forwardCDPEvent',
      params: {
        sessionId: 'pw-tab-2',
        method: 'Page.loadEventFired',
        params: { ts: 1 },
      },
    });
  });
});
