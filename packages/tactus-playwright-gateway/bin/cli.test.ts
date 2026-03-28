import { describe, expect, it, vi } from 'vitest';
// @ts-ignore Local ESM runtime helper used by the gateway wrapper tests.
import { InternalCDPRelayRuntime } from './relayRuntime.mjs';

function createRuntime() {
  const sentToPlaywright: any[] = [];
  const waitForExtensionConnection = vi.fn(async () => {});
  const callExtension = vi.fn(async (method: string, params: any) => {
    switch (method) {
      case 'attachToTab':
        return {
          tabId: 11,
          targetInfo: {
            targetId: 'target-11',
            type: 'page',
            title: 'Tab 11',
            url: 'https://example.com/11',
          },
        };
      case 'createTab':
        return {
          tabId: 22,
          targetInfo: {
            targetId: 'target-22',
            type: 'page',
            title: 'Tab 22',
            url: params.url,
          },
        };
      case 'bindToTab':
        return {
          tabId: params.tabId,
          targetInfo: {
            targetId: `target-${params.tabId}`,
            type: 'page',
            title: `Tab ${params.tabId}`,
            url: `https://example.com/${params.tabId}`,
          },
        };
      case 'closeTab':
        return { success: true };
      case 'forwardCDPCommand':
        return { ok: true, method: params.method };
      default:
        throw new Error(`Unexpected extension method: ${method}`);
    }
  });

  const runtime = new InternalCDPRelayRuntime({
    waitForExtensionConnection,
    callExtension,
    sendToPlaywright(message: any) {
      sentToPlaywright.push(message);
    },
  });

  return {
    runtime,
    callExtension,
    sentToPlaywright,
    waitForExtensionConnection,
  };
}

describe('InternalCDPRelayRuntime', () => {
  it('setAutoAttach 后会登记当前 target 并发送 attached 事件', async () => {
    const { runtime, sentToPlaywright } = createRuntime();

    const result = await runtime.handlePlaywrightMessage({
      id: 1,
      method: 'Target.setAutoAttach',
      params: { autoAttach: true, flatten: true },
    });

    expect(result).toEqual({});
    expect(sentToPlaywright).toContainEqual({
      method: 'Target.attachedToTarget',
      params: {
        sessionId: 'tactus-tab-1',
        targetInfo: {
          targetId: 'target-11',
          type: 'page',
          title: 'Tab 11',
          url: 'https://example.com/11',
          browserContextId: 'tactus-default-context',
          attached: true,
        },
        waitingForDebugger: false,
      },
    });
  });

  it('createTarget 会创建新 tab 并发出 created/attached/infoChanged 事件', async () => {
    const { runtime, sentToPlaywright } = createRuntime();
    await runtime.handlePlaywrightMessage({
      id: 1,
      method: 'Target.setAutoAttach',
      params: { autoAttach: true, flatten: true },
    });
    sentToPlaywright.length = 0;

    const result = await runtime.handlePlaywrightMessage({
      id: 2,
      method: 'Target.createTarget',
      params: { url: 'https://example.com/new' },
    });

    expect(result).toEqual({ targetId: 'target-22' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sentToPlaywright).toContainEqual({
      method: 'Target.targetCreated',
      params: {
        targetInfo: {
          targetId: 'target-22',
          type: 'page',
          title: 'Tab 22',
          url: 'https://example.com/new',
          browserContextId: 'tactus-default-context',
        },
      },
    });
    expect(sentToPlaywright).toContainEqual({
      method: 'Target.targetInfoChanged',
      params: {
        targetInfo: {
          targetId: 'target-22',
          type: 'page',
          title: 'Tab 22',
          url: 'https://example.com/new',
          browserContextId: 'tactus-default-context',
        },
      },
    });
    expect(sentToPlaywright).toContainEqual({
      method: 'Target.attachedToTarget',
      params: {
        sessionId: 'tactus-tab-2',
        targetInfo: {
          targetId: 'target-22',
          type: 'page',
          title: 'Tab 22',
          url: 'https://example.com/new',
          browserContextId: 'tactus-default-context',
          attached: true,
        },
        waitingForDebugger: false,
      },
    });
  });

  it('按 sessionId 转发命令时会按目标 tabId 直接路由到扩展侧', async () => {
    const { runtime, callExtension } = createRuntime();
    await runtime.handlePlaywrightMessage({
      id: 1,
      method: 'Target.setAutoAttach',
      params: { autoAttach: true, flatten: true },
    });
    await runtime.handlePlaywrightMessage({
      id: 2,
      method: 'Target.createTarget',
      params: { url: 'https://example.com/new' },
    });

    const result = await runtime.handlePlaywrightMessage({
      id: 3,
      method: 'Runtime.evaluate',
      sessionId: 'tactus-tab-1',
      params: { expression: '1 + 1' },
    });

    expect(result).toEqual({ ok: true, method: 'Runtime.evaluate' });
    expect(callExtension).toHaveBeenCalledWith('forwardCDPCommand', {
      tabId: 11,
      sessionId: undefined,
      method: 'Runtime.evaluate',
      params: { expression: '1 + 1' },
    });
  });

  it('closeTarget 会关闭指定 tab 并发送 detached 事件', async () => {
    const { runtime, sentToPlaywright, callExtension } = createRuntime();
    await runtime.handlePlaywrightMessage({
      id: 1,
      method: 'Target.setAutoAttach',
      params: { autoAttach: true, flatten: true },
    });
    await runtime.handlePlaywrightMessage({
      id: 2,
      method: 'Target.createTarget',
      params: { url: 'https://example.com/new' },
    });
    sentToPlaywright.length = 0;

    const result = await runtime.handlePlaywrightMessage({
      id: 4,
      method: 'Target.closeTarget',
      params: { targetId: 'target-22' },
    });

    expect(result).toEqual({ success: true });
    expect(callExtension).toHaveBeenCalledWith('closeTab', { tabId: 22 });
    expect(sentToPlaywright).toContainEqual({
      method: 'Target.detachedFromTarget',
      params: {
        sessionId: 'tactus-tab-2',
        targetId: 'target-22',
      },
    });
  });

  it('createTarget 的生命周期事件会在响应返回后异步发出，避免和响应同拍竞争', async () => {
    const { runtime, sentToPlaywright } = createRuntime();
    await runtime.handlePlaywrightMessage({
      id: 1,
      method: 'Target.setAutoAttach',
      params: { autoAttach: true, flatten: true },
    });
    sentToPlaywright.length = 0;

    const result = await runtime.handlePlaywrightMessage({
      id: 2,
      method: 'Target.createTarget',
      params: { url: 'https://example.com/new' },
    });

    expect(result).toEqual({ targetId: 'target-22' });
    expect(sentToPlaywright).toEqual([]);

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sentToPlaywright).toContainEqual({
      method: 'Target.targetCreated',
      params: {
        targetInfo: {
          targetId: 'target-22',
          type: 'page',
          title: 'Tab 22',
          url: 'https://example.com/new',
          browserContextId: 'tactus-default-context',
        },
      },
    });
    expect(sentToPlaywright).toContainEqual({
      method: 'Target.attachedToTarget',
      params: {
        sessionId: 'tactus-tab-2',
        targetInfo: {
          targetId: 'target-22',
          type: 'page',
          title: 'Tab 22',
          url: 'https://example.com/new',
          browserContextId: 'tactus-default-context',
          attached: true,
        },
        waitingForDebugger: false,
      },
    });
  });

  it('activateTarget 会重新绑定到已有 tab，并把后续命令路由到该 tab', async () => {
    const { runtime, sentToPlaywright, callExtension } = createRuntime();
    await runtime.handlePlaywrightMessage({
      id: 1,
      method: 'Target.setAutoAttach',
      params: { autoAttach: true, flatten: true },
    });
    await runtime.handlePlaywrightMessage({
      id: 2,
      method: 'Target.createTarget',
      params: { url: 'https://example.com/new' },
    });
    sentToPlaywright.length = 0;

    const result = await runtime.handlePlaywrightMessage({
      id: 3,
      method: 'Target.activateTarget',
      params: { targetId: 'target-11' },
    });

    expect(result).toEqual({});
    expect(callExtension).toHaveBeenCalledWith('bindToTab', {
      tabId: 11,
      emitLifecycleEvent: false,
    });
    expect(sentToPlaywright.some(message => message.method === 'Target.targetCreated')).toBe(false);

    await runtime.handlePlaywrightMessage({
      id: 4,
      method: 'Runtime.evaluate',
      params: { expression: '1 + 1' },
    });
    expect(callExtension).toHaveBeenLastCalledWith('forwardCDPCommand', {
      tabId: 11,
      sessionId: undefined,
      method: 'Runtime.evaluate',
      params: { expression: '1 + 1' },
    });
  });

  it('tabReattached 刷新当前 target 时不会重复创建 target 事件', async () => {
    const { runtime, sentToPlaywright, callExtension } = createRuntime();
    await runtime.handlePlaywrightMessage({
      id: 1,
      method: 'Target.setAutoAttach',
      params: { autoAttach: true, flatten: true },
    });
    await runtime.handlePlaywrightMessage({
      id: 2,
      method: 'Target.createTarget',
      params: { url: 'https://example.com/new' },
    });
    sentToPlaywright.length = 0;

    await runtime.handleExtensionMessage('tabReattached', {
      tabId: 22,
      targetInfo: {
        targetId: 'target-22',
        type: 'page',
        title: 'Tab 22 rebound',
        url: 'https://example.com/rebound',
      },
    });

    expect(sentToPlaywright.some(message => message.method === 'Target.targetCreated')).toBe(false);

    await runtime.handlePlaywrightMessage({
      id: 3,
      method: 'Runtime.evaluate',
      params: { expression: '2 + 2' },
    });
    expect(callExtension).toHaveBeenLastCalledWith('forwardCDPCommand', {
      tabId: 22,
      sessionId: undefined,
      method: 'Runtime.evaluate',
      params: { expression: '2 + 2' },
    });
  });
});
