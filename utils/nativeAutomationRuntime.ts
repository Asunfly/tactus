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
  waitForPageReady(tabId: number): Promise<void>;
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

  private isRecoverablePageError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('Receiving end does not exist')
      || message.includes('等待页面内容脚本就绪超时')
      || message.includes('页面内容脚本尚未就绪');
  }

  private formatRecoverablePageMessage(actionLabel: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return `当前标签页暂时无法${actionLabel}，可能是页面限制了扩展脚本注入、仍在跳转，或页面结构对自动化不友好。\n\n详细错误：${message}\n\n建议：等待几秒后重试，或切换到其他标签页继续。`;
  }

  private formatActionFailure(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private isNonScrollableElementError(errorOrMessage: unknown): boolean {
    const message = errorOrMessage instanceof Error
      ? errorOrMessage.message
      : String(errorOrMessage);
    return message.includes('No scrollable container found');
  }

  async observe(): Promise<NativeAutomationToolResult> {
    const target = await this.ensureCurrentTarget();
    if (!target) {
      return {
        success: false,
        result: '当前窗口中没有可自动化操作的普通网页标签页。请先打开一个网页标签页后再试。',
      };
    }

    let tabsMarkdown = '';
    let browserState: NativeAutomationBrowserState;
    try {
      [tabsMarkdown, browserState] = await Promise.all([
        this.renderTabsMarkdown(target.windowId),
        this.bridge.getBrowserState(target.id),
      ]);
    } catch (error) {
      if (this.isRecoverablePageError(error)) {
        tabsMarkdown = await this.renderTabsMarkdown(target.windowId);
        return {
          success: true,
          result: `## Browser Tabs\n${tabsMarkdown}\n\n## Current Page\n${this.formatRecoverablePageMessage('自动化观察', error)}`,
        };
      }
      throw error;
    }
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
    const options = {
      down: input.down ?? true,
      numPages: input.num_pages ?? 0.5,
      ...(typeof input.pixels === 'number' && input.pixels !== 0 ? { pixels: input.pixels } : {}),
      ...(typeof input.index === 'number' ? { index: input.index } : {}),
    };
    return this.runOnTarget(async target => {
      try {
        const result = await this.bridge.scroll(target.id, options);
        if (
          typeof input.index === 'number'
          && (!result.success || this.isNonScrollableElementError(result.message))
        ) {
          const { index: _index, ...pageScrollOptions } = options;
          return await this.bridge.scroll(target.id, pageScrollOptions);
        }
        return result;
      } catch (error) {
        if (typeof input.index === 'number' && this.isNonScrollableElementError(error)) {
          const { index: _index, ...pageScrollOptions } = options;
          return await this.bridge.scroll(target.id, pageScrollOptions);
        }
        throw error;
      }
    });
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
        let readinessWarning = '';
        try {
          await this.bridge.waitForPageReady(opened.id);
        } catch (error) {
          if (this.isRecoverablePageError(error)) {
            readinessWarning = `\n\n${this.formatRecoverablePageMessage('连接目标页面', error)}`;
          } else {
            throw error;
          }
        }
        this.currentTabId = opened.id;
        return {
          success: true,
          result: `已打开并切换到新标签页：${opened.url ?? action.url}\n\n${await this.renderTabsMarkdown(opened.windowId)}${readinessWarning}`,
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
        let readinessWarning = '';
        try {
          await this.bridge.waitForPageReady(target.id);
        } catch (error) {
          if (this.isRecoverablePageError(error)) {
            readinessWarning = `\n\n${this.formatRecoverablePageMessage('连接目标页面', error)}`;
          } else {
            throw error;
          }
        }
        this.currentTabId = target.id;
        return {
          success: true,
          result: `已切换到标签页：${target.title || target.url || `Tab ${target.id}`}${readinessWarning}`,
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

    let result: NativeAutomationActionResult;
    try {
      result = await runner(target);
    } catch (error) {
      if (this.isRecoverablePageError(error)) {
        return {
          success: true,
          result: this.formatRecoverablePageMessage('执行页面操作', error),
        };
      }
      return {
        success: false,
        result: this.formatActionFailure(error),
      };
    }
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
