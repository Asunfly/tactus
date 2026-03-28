import { describe, expect, it } from 'vitest';
import {
  INTERNAL_PLAYWRIGHT_BRIDGE_BIND_MESSAGE_TYPE,
  INTERNAL_PLAYWRIGHT_RELAY_DEFAULT_PORT,
  createInternalPlaywrightBridgeBindMessage,
  createInternalPlaywrightRelayEndpoints,
  getInternalPlaywrightBridgeTargetTabId,
  getInternalPlaywrightTabsAction,
  isInternalPlaywrightBridgeAllowedUrl,
  resolveInternalPlaywrightBridgeTarget,
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

describe('isInternalPlaywrightBridgeAllowedUrl', () => {
  it('允许普通网页', () => {
    expect(isInternalPlaywrightBridgeAllowedUrl('https://example.com')).toBe(true);
    expect(isInternalPlaywrightBridgeAllowedUrl('http://localhost:3000')).toBe(true);
  });

  it('拒绝浏览器内页和扩展页', () => {
    expect(isInternalPlaywrightBridgeAllowedUrl('chrome://extensions')).toBe(false);
    expect(isInternalPlaywrightBridgeAllowedUrl('chrome-extension://abcd/options.html')).toBe(false);
    expect(isInternalPlaywrightBridgeAllowedUrl('devtools://devtools/bundled/inspector.html')).toBe(false);
    expect(isInternalPlaywrightBridgeAllowedUrl('edge://extensions')).toBe(false);
    expect(isInternalPlaywrightBridgeAllowedUrl('about:blank')).toBe(false);
    expect(isInternalPlaywrightBridgeAllowedUrl(undefined)).toBe(false);
  });
});

describe('resolveInternalPlaywrightBridgeTarget', () => {
  const tabs = [
    { id: 11, active: false, url: 'https://example.com/a', title: 'A' },
    { id: 22, active: true, url: 'https://example.com/b', title: 'B' },
    { id: 33, active: false, url: 'chrome://extensions', title: 'Extensions' },
  ];

  it('优先使用已经绑定且可调试的 tab', () => {
    expect(resolveInternalPlaywrightBridgeTarget({
      boundTabId: 11,
      lockedTabId: 22,
      tabs,
    })).toMatchObject({
      status: 'ready',
      source: 'bound',
      tab: { id: 11 },
      activeTab: { id: 22 },
    });
  });

  it('当前活动页不可调试时会回退到其他可调试 tab', () => {
    expect(resolveInternalPlaywrightBridgeTarget({
      boundTabId: null,
      lockedTabId: null,
      tabs: [
        { id: 33, active: true, url: 'chrome://extensions', title: 'Extensions' },
        { id: 11, active: false, url: 'https://example.com/a', title: 'A' },
      ],
    })).toMatchObject({
      status: 'ready',
      source: 'fallback',
      tab: { id: 11 },
      activeTab: { id: 33 },
    });
  });

  it('已绑定 tab 失效时会回退到锁定中的可调试 tab', () => {
    expect(resolveInternalPlaywrightBridgeTarget({
      boundTabId: 33,
      lockedTabId: 11,
      tabs,
    })).toMatchObject({
      status: 'ready',
      source: 'locked',
      tab: { id: 11 },
      activeTab: { id: 22 },
    });
  });

  it('已明确绑定到 about:blank 时，仍然继续使用该 tab 作为当前任务目标', () => {
    expect(resolveInternalPlaywrightBridgeTarget({
      boundTabId: 99,
      lockedTabId: null,
      tabs: [
        { id: 99, active: true, url: 'about:blank', title: 'Blank' },
        { id: 11, active: false, url: 'https://example.com/a', title: 'A' },
      ],
    })).toMatchObject({
      status: 'ready',
      source: 'bound',
      tab: { id: 99, url: 'about:blank' },
      activeTab: { id: 99 },
    });
  });

  it('只有活动页是 about:blank 时，不会直接绑定空白页，而是回退到真正的网页标签页', () => {
    expect(resolveInternalPlaywrightBridgeTarget({
      boundTabId: null,
      lockedTabId: null,
      tabs: [
        { id: 99, active: true, url: 'about:blank', title: 'Blank' },
        { id: 11, active: false, url: 'https://example.com/a', title: 'A' },
      ],
    })).toMatchObject({
      status: 'ready',
      source: 'fallback',
      tab: { id: 11, url: 'https://example.com/a' },
      activeTab: { id: 99, url: 'about:blank' },
    });
  });

  it('普通 fallback 仍然忽略无关的 about:blank，优先选择真正的网页标签页', () => {
    expect(resolveInternalPlaywrightBridgeTarget({
      boundTabId: null,
      lockedTabId: null,
      tabs: [
        { id: 88, active: true, url: 'chrome://extensions', title: 'Extensions' },
        { id: 99, active: false, url: 'about:blank', title: 'Blank' },
        { id: 11, active: false, url: 'https://example.com/a', title: 'A' },
      ],
    })).toMatchObject({
      status: 'ready',
      source: 'fallback',
      tab: { id: 11, url: 'https://example.com/a' },
      activeTab: { id: 88 },
    });
  });

  it('没有任何可调试 tab 时返回 blocked', () => {
    expect(resolveInternalPlaywrightBridgeTarget({
      boundTabId: null,
      lockedTabId: null,
      tabs: [
        { id: 33, active: true, url: 'chrome://extensions', title: 'Extensions' },
        { id: 44, active: false, url: 'devtools://devtools/bundled/inspector.html', title: 'DevTools' },
      ],
    })).toEqual({
      status: 'blocked',
      activeTab: { id: 33, active: true, url: 'chrome://extensions', title: 'Extensions' },
    });
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
