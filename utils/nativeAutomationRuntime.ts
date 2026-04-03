import {
  extractIndexedElementHint,
  formatNativeAutomationBrowserState,
  isNativeAutomationAllowedUrl,
  renderNativeAutomationTabsMarkdown,
  type NativeAutomationBrowserState,
  type ResolvedNativeAutomationTabsAction,
} from './nativeAutomationShared';

export interface NativeAutomationTabInfo {
  id: number;
  windowId?: number;
  title?: string | null;
  url?: string | null;
  active?: boolean;
  pinned?: boolean;
  status?: string;
}

export interface NativeAutomationActionResult {
  success: boolean;
  message: string;
}

export interface NativeAutomationBridge {
  getActiveTab(): Promise<NativeAutomationTabInfo | null>;
  getWindowTabs(windowId?: number): Promise<NativeAutomationTabInfo[]>;
  getTab(tabId: number): Promise<NativeAutomationTabInfo | null>;
  activateTab(tabId: number): Promise<void>;
  openTab(url: string): Promise<NativeAutomationTabInfo>;
  closeTab(tabId: number): Promise<void>;
  getBrowserState(tabId: number): Promise<NativeAutomationBrowserState>;
  clickElement(tabId: number, index: number): Promise<NativeAutomationActionResult>;
  inputText(tabId: number, index: number, text: string): Promise<NativeAutomationActionResult>;
  selectOption(tabId: number, index: number, text: string): Promise<NativeAutomationActionResult>;
  scroll(tabId: number, options: { down: boolean; numPages: number; pixels?: number; index?: number }): Promise<NativeAutomationActionResult>;
  executeJavascript(tabId: number, script: string): Promise<NativeAutomationActionResult>;
}

export interface NativeAutomationToolResult {
  success: boolean;
  result: string;
}

export class NativeAutomationRuntime {
  private readonly bridge: NativeAutomationBridge;
  private currentTabId: number | null = null;
  private lastObservedContent: string | null = null;

  constructor(bridge: NativeAutomationBridge) {
    this.bridge = bridge;
  }

  getCurrentTabId(): number | null {
    return this.currentTabId;
  }

  seedCurrentTabId(tabId: number | null): void {
    if (this.currentTabId === null) {
      this.currentTabId = tabId;
    }
  }

  getIndexedElementHint(index: number): string | null {
    if (!this.lastObservedContent) return null;
    return extractIndexedElementHint(this.lastObservedContent, index);
  }

  async observe(): Promise<NativeAutomationToolResult> {
    const target = await this.ensureCurrentTarget();
    if (!target) {
      return {
        success: false,
        result: '当前窗口中没有可自动化操作的普通网页标签页。请先打开一个网页标签页后再试。',
      };
    }

    const [tabsMarkdown, browserState] = await Promise.all([
      this.renderTabsMarkdown(target.windowId),
      this.bridge.getBrowserState(target.id),
    ]);
    this.lastObservedContent = browserState.content;

    return {
      success: true,
      result: formatNativeAutomationBrowserState({
        tabsMarkdown,
        browserState,
      }),
    };
  }

  async click(index: number): Promise<NativeAutomationToolResult> {
    return this.runOnTarget(target => this.bridge.clickElement(target.id, index));
  }

  async input(index: number, text: string): Promise<NativeAutomationToolResult> {
    return this.runOnTarget(target => this.bridge.inputText(target.id, index, text));
  }

  async selectOption(index: number, text: string): Promise<NativeAutomationToolResult> {
    return this.runOnTarget(target => this.bridge.selectOption(target.id, index, text));
  }

  async scroll(input: {
    down?: boolean;
    num_pages?: number;
    pixels?: number;
    index?: number;
  }): Promise<NativeAutomationToolResult> {
    return this.runOnTarget(target => this.bridge.scroll(target.id, {
      down: input.down ?? true,
      numPages: input.num_pages ?? 0.5,
      ...(typeof input.pixels === 'number' ? { pixels: input.pixels } : {}),
      ...(typeof input.index === 'number' ? { index: input.index } : {}),
    }));
  }

  async wait(seconds = 1): Promise<NativeAutomationToolResult> {
    await new Promise(resolve => setTimeout(resolve, Math.max(1, seconds) * 1000));
    return {
      success: true,
      result: `已等待 ${seconds} 秒。`,
    };
  }

  async executeJs(script: string): Promise<NativeAutomationToolResult> {
    return this.runOnTarget(target => this.bridge.executeJavascript(target.id, script));
  }

  async tabs(action: ResolvedNativeAutomationTabsAction): Promise<NativeAutomationToolResult> {
    const activeTab = await this.bridge.getActiveTab();
    const windowId = activeTab?.windowId;
    const tabs = await this.listAutomatableTabs(windowId);

    switch (action.action) {
      case 'list':
        return {
          success: true,
          result: renderNativeAutomationTabsMarkdown(this.summarizeTabs(tabs)),
        };
      case 'new': {
        if (!action.url) {
          return {
            success: false,
            result: 'browser_tabs(action="new") 需要提供有效的 url 参数。',
          };
        }
        const opened = await this.bridge.openTab(action.url);
        this.currentTabId = opened.id;
        return {
          success: true,
          result: `已打开并切换到新标签页：${opened.url ?? action.url}\n\n${await this.renderTabsMarkdown(opened.windowId)}`,
        };
      }
      case 'select': {
        const target = typeof action.index === 'number' ? tabs[action.index] : tabs.find(tab => tab.id === this.currentTabId) ?? null;
        if (!target) {
          return {
            success: false,
            result: '目标标签页不存在，无法切换。',
          };
        }
        await this.bridge.activateTab(target.id);
        this.currentTabId = target.id;
        return {
          success: true,
          result: `已切换到标签页：${target.title || target.url || `Tab ${target.id}`}`,
        };
      }
      case 'close': {
        const target = typeof action.index === 'number' ? tabs[action.index] : tabs.find(tab => tab.id === this.currentTabId) ?? null;
        if (!target) {
          return {
            success: false,
            result: '目标标签页不存在，无法关闭。',
          };
        }
        await this.bridge.closeTab(target.id);
        const fallback = await this.ensureCurrentTarget();
        const fallbackText = fallback
          ? `已回退到：${fallback.title || fallback.url || `Tab ${fallback.id}`}`
          : '关闭后当前窗口已无可自动化的网页标签页。';
        return {
          success: true,
          result: `已关闭标签页：${target.title || target.url || `Tab ${target.id}`}\n\n${fallbackText}`,
        };
      }
    }
  }

  private async runOnTarget(
    runner: (target: NativeAutomationTabInfo) => Promise<NativeAutomationActionResult>,
  ): Promise<NativeAutomationToolResult> {
    const target = await this.ensureCurrentTarget();
    if (!target) {
      return {
        success: false,
        result: '当前窗口中没有可自动化操作的普通网页标签页。请先打开一个网页标签页后再试。',
      };
    }

    const result = await runner(target);
    return {
      success: result.success,
      result: result.message,
    };
  }

  private async ensureCurrentTarget(): Promise<NativeAutomationTabInfo | null> {
    if (this.currentTabId) {
      const existing = await this.bridge.getTab(this.currentTabId);
      if (existing && isNativeAutomationAllowedUrl(existing.url)) {
        return existing;
      }
      this.currentTabId = null;
    }

    const activeTab = await this.bridge.getActiveTab();
    const windowId = activeTab?.windowId;
    const tabs = await this.listAutomatableTabs(windowId);
    const preferred = tabs.find(tab => tab.active) ?? tabs[0] ?? null;

    this.currentTabId = preferred?.id ?? null;
    return preferred;
  }

  private async listAutomatableTabs(windowId?: number): Promise<NativeAutomationTabInfo[]> {
    const tabs = await this.bridge.getWindowTabs(windowId);
    return tabs.filter(tab => !tab.pinned && isNativeAutomationAllowedUrl(tab.url));
  }

  private async renderTabsMarkdown(windowId?: number): Promise<string> {
    const tabs = await this.listAutomatableTabs(windowId);
    return renderNativeAutomationTabsMarkdown(this.summarizeTabs(tabs));
  }

  private summarizeTabs(tabs: NativeAutomationTabInfo[]) {
    return tabs.map(tab => ({
      id: tab.id,
      title: tab.title || tab.url || `Tab ${tab.id}`,
      url: tab.url || 'about:blank',
      current: tab.id === this.currentTabId,
      active: Boolean(tab.active),
    }));
  }
}
