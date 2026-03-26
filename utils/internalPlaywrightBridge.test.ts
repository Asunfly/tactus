import { describe, expect, it } from 'vitest';
import {
  INTERNAL_PLAYWRIGHT_BRIDGE_BIND_MESSAGE_TYPE,
  INTERNAL_PLAYWRIGHT_RELAY_DEFAULT_PORT,
  createInternalPlaywrightBridgeBindMessage,
  createInternalPlaywrightRelayEndpoints,
  getInternalPlaywrightBridgeTargetTabId,
  getInternalPlaywrightTabsAction,
  renderInternalPlaywrightTabsMarkdown,
} from './internalPlaywrightBridge';

describe('createInternalPlaywrightRelayEndpoints', () => {
  it('生成默认 relay 的 CDP 和 extension 端点', () => {
    expect(createInternalPlaywrightRelayEndpoints()).toEqual({
      cdpEndpoint: 'ws://127.0.0.1:8932/cdp',
      extensionEndpoint: 'ws://127.0.0.1:8932/extension',
    });
  });

  it('支持自定义 relay 端口', () => {
    expect(createInternalPlaywrightRelayEndpoints(9012)).toEqual({
      cdpEndpoint: 'ws://127.0.0.1:9012/cdp',
      extensionEndpoint: 'ws://127.0.0.1:9012/extension',
    });
  });
});

describe('createInternalPlaywrightBridgeBindMessage', () => {
  it('把 tab 绑定信息和 extension 端点打包成 background 消息', () => {
    expect(createInternalPlaywrightBridgeBindMessage({
      tabId: 321,
      windowId: 8,
    })).toEqual({
      type: INTERNAL_PLAYWRIGHT_BRIDGE_BIND_MESSAGE_TYPE,
      tabId: 321,
      windowId: 8,
      extensionEndpoint: 'ws://127.0.0.1:8932/extension',
    });
  });

  it('允许自定义 relay 端口', () => {
    expect(createInternalPlaywrightBridgeBindMessage({
      tabId: 321,
      relayPort: 9020,
    })).toEqual({
      type: INTERNAL_PLAYWRIGHT_BRIDGE_BIND_MESSAGE_TYPE,
      tabId: 321,
      extensionEndpoint: 'ws://127.0.0.1:9020/extension',
    });
  });
});

describe('getInternalPlaywrightBridgeTargetTabId', () => {
  it('优先使用已经绑定中的 Playwright 标签页 id', () => {
    expect(getInternalPlaywrightBridgeTargetTabId(999, 123, 456)).toBe(999);
  });

  it('优先使用锁定的标签页 id', () => {
    expect(getInternalPlaywrightBridgeTargetTabId(null, 123, 456)).toBe(123);
  });

  it('锁定标签页不存在时回退到当前活动标签页', () => {
    expect(getInternalPlaywrightBridgeTargetTabId(null, null, 456)).toBe(456);
  });

  it('两者都不存在时返回 null', () => {
    expect(getInternalPlaywrightBridgeTargetTabId(null, null, null)).toBeNull();
  });
});

describe('relay defaults', () => {
  it('使用固定 relay 端口，便于本地 script 和扩展侧复用', () => {
    expect(INTERNAL_PLAYWRIGHT_RELAY_DEFAULT_PORT).toBe(8932);
  });
});

describe('getInternalPlaywrightTabsAction', () => {
  it('解析 browser_tabs 的 action 参数', () => {
    expect(getInternalPlaywrightTabsAction('browser_tabs', { action: 'list' })).toBe('list');
    expect(getInternalPlaywrightTabsAction('browser_tabs', { action: 'new' })).toBe('new');
  });

  it('忽略其他工具和缺失 action 的情况', () => {
    expect(getInternalPlaywrightTabsAction('browser_click', { action: 'list' })).toBeNull();
    expect(getInternalPlaywrightTabsAction('browser_tabs', {})).toBeNull();
  });
});

describe('renderInternalPlaywrightTabsMarkdown', () => {
  it('输出和官方风格接近的 tabs 文本', () => {
    expect(renderInternalPlaywrightTabsMarkdown([
      { title: 'GitHub', url: 'https://github.com', current: true },
      { title: 'Google', url: 'https://google.com', current: false },
    ])).toEqual([
      '- 0: (current) [GitHub](https://github.com)',
      '- 1: [Google](https://google.com)',
    ]);
  });

  it('没有 tab 时返回提示', () => {
    expect(renderInternalPlaywrightTabsMarkdown([])).toEqual([
      'No open tabs. Navigate to a URL to create one.',
    ]);
  });
});
