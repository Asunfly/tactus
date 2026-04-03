import {
  NATIVE_AUTOMATION_PAGE_CONTROL_MESSAGE,
  NATIVE_AUTOMATION_TAB_CONTROL_MESSAGE,
} from './nativeAutomationShared';
import type {
  NativeAutomationActionResult,
  NativeAutomationBridge,
  NativeAutomationTabInfo,
} from './nativeAutomationRuntime';

type BrowserState = {
  url: string;
  title: string;
  header: string;
  content: string;
  footer: string;
};

async function sendTabControl(action: string, payload?: Record<string, unknown>): Promise<any> {
  return await browser.runtime.sendMessage({
    type: NATIVE_AUTOMATION_TAB_CONTROL_MESSAGE,
    action,
    ...(payload ? { payload } : {}),
  });
}

async function sendPageControl(action: string, targetTabId: number, payload?: unknown): Promise<any> {
  return await browser.runtime.sendMessage({
    type: NATIVE_AUTOMATION_PAGE_CONTROL_MESSAGE,
    action,
    targetTabId,
    ...(payload !== undefined ? { payload } : {}),
  });
}

function assertSuccess<T>(response: any, fallbackMessage: string): T {
  if (!response?.success) {
    throw new Error(response?.error || fallbackMessage);
  }
  return response as T;
}

export function createNativeAutomationBridge(): NativeAutomationBridge {
  return {
    async getActiveTab(): Promise<NativeAutomationTabInfo | null> {
      const response = assertSuccess<{ success: true; tab: NativeAutomationTabInfo | null }>(
        await sendTabControl('get_active_tab'),
        '无法获取当前活动标签页',
      );
      return response.tab;
    },
    async getWindowTabs(windowId?: number): Promise<NativeAutomationTabInfo[]> {
      const response = assertSuccess<{ success: true; tabs: NativeAutomationTabInfo[] }>(
        await sendTabControl('get_window_tabs', windowId ? { windowId } : {}),
        '无法获取窗口标签页列表',
      );
      return response.tabs || [];
    },
    async getTab(tabId: number): Promise<NativeAutomationTabInfo | null> {
      const response = assertSuccess<{ success: true; tab: NativeAutomationTabInfo | null }>(
        await sendTabControl('get_tab_info', { tabId }),
        '无法获取标签页信息',
      );
      return response.tab;
    },
    async activateTab(tabId: number): Promise<void> {
      assertSuccess(await sendTabControl('activate_tab', { tabId }), '无法切换到目标标签页');
    },
    async openTab(url: string): Promise<NativeAutomationTabInfo> {
      const response = assertSuccess<{ success: true; tab: NativeAutomationTabInfo }>(
        await sendTabControl('open_new_tab', { url }),
        '无法打开新标签页',
      );
      return response.tab;
    },
    async closeTab(tabId: number): Promise<void> {
      assertSuccess(await sendTabControl('close_tab', { tabId }), '无法关闭标签页');
    },
    async getBrowserState(tabId: number): Promise<BrowserState> {
      return assertSuccess<BrowserState & { success?: true }>(
        await sendPageControl('get_browser_state', tabId),
        '无法获取页面状态',
      );
    },
    async clickElement(tabId: number, index: number): Promise<NativeAutomationActionResult> {
      return assertSuccess<NativeAutomationActionResult>(
        await sendPageControl('click_element', tabId, [index]),
        '无法点击页面元素',
      );
    },
    async inputText(tabId: number, index: number, text: string): Promise<NativeAutomationActionResult> {
      return assertSuccess<NativeAutomationActionResult>(
        await sendPageControl('input_text', tabId, [index, text]),
        '无法向页面输入文本',
      );
    },
    async selectOption(tabId: number, index: number, text: string): Promise<NativeAutomationActionResult> {
      return assertSuccess<NativeAutomationActionResult>(
        await sendPageControl('select_option', tabId, [index, text]),
        '无法选择页面选项',
      );
    },
    async scroll(tabId: number, options): Promise<NativeAutomationActionResult> {
      return assertSuccess<NativeAutomationActionResult>(
        await sendPageControl('scroll', tabId, [options]),
        '无法滚动页面',
      );
    },
    async executeJavascript(tabId: number, script: string): Promise<NativeAutomationActionResult> {
      return assertSuccess<NativeAutomationActionResult>(
        await sendPageControl('execute_javascript', tabId, [script]),
        '无法执行页面脚本',
      );
    },
  };
}
