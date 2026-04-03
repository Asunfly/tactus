import {
  NATIVE_AUTOMATION_PAGE_CONTROL_MESSAGE,
  NATIVE_AUTOMATION_TAB_CONTROL_MESSAGE,
} from '../utils/nativeAutomationShared';

async function openSidePanel(tabId?: number): Promise<void> {
  const sidePanelApi = (browser as any).sidePanel;
  if (sidePanelApi?.open && tabId) {
    await sidePanelApi.open({ tabId });
    return;
  }

  const sidebarActionApi = (browser as any).sidebarAction;
  if (sidebarActionApi?.open) {
    await sidebarActionApi.open();
    return;
  }

  throw new Error('当前浏览器不支持侧边栏 API');
}

async function executeMainWorldScript(tabId: number, code: string): Promise<void> {
  const scriptingApi = (browser as any).scripting;
  if (scriptingApi?.executeScript) {
    await scriptingApi.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (injectedCode: string) => {
        const script = document.createElement('script');
        script.textContent = injectedCode;
        document.documentElement.appendChild(script);
        script.remove();
      },
      args: [code],
    });
    return;
  }

  const tabsApi = (browser as any).tabs;
  if (tabsApi?.executeScript) {
    const injectionCode = `
(() => {
  const script = document.createElement('script');
  script.textContent = ${JSON.stringify(code)};
  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();
})();`;
    await tabsApi.executeScript(tabId, { code: injectionCode });
    return;
  }

  throw new Error('当前浏览器不支持脚本注入 API');
}

async function readMainWorldResult(tabId: number, key: string): Promise<any> {
  const scriptingApi = (browser as any).scripting;
  if (scriptingApi?.executeScript) {
    const results = await scriptingApi.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (resultKey: string) => {
        const result = (window as any)[resultKey];
        if (result !== undefined && result !== null) {
          delete (window as any)[resultKey];
          return result;
        }
        return undefined;
      },
      args: [key],
    });

    return results?.[0]?.result;
  }

  const tabsApi = (browser as any).tabs;
  if (tabsApi?.executeScript) {
    const readCode = `
(() => {
  const resultKey = ${JSON.stringify(key)};
  const result = window[resultKey];
  if (result !== undefined && result !== null) {
    delete window[resultKey];
    return result;
  }
  return undefined;
})();`;

    const results = await tabsApi.executeScript(tabId, { code: readCode });
    return results?.[0];
  }

  throw new Error('当前浏览器不支持脚本读取 API');
}

// 执行脚本的核心逻辑
async function executeScriptInTab(tabId: number, code: string, args: Record<string, any>, scriptId: string): Promise<any> {
  const resultKey = `__skill_result_${scriptId}_${Date.now()}__`;
  
  const wrappedCode = `
(async () => {
  try {
    const __args__ = ${JSON.stringify(args || {})};
    const __result__ = await (async () => {
      ${code}
    })();
    window['${resultKey}'] = { success: true, data: __result__ };
  } catch (error) {
    window['${resultKey}'] = { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
})();
`;

  // 使用 script 标签注入执行，绕过 CSP
  await executeMainWorldScript(tabId, wrappedCode);

  // 轮询等待结果，最多 60 秒
  const maxWait = 60000;
  const interval = 1000;
  let waited = 0;
  
  while (waited < maxWait) {
    await new Promise(resolve => setTimeout(resolve, interval));
    waited += interval;

    // 检查是否获取到有效结果（必须是包含 success 属性的对象）
    const execResult = await readMainWorldResult(tabId, resultKey);
    if (execResult && typeof execResult === 'object' && 'success' in execResult) {
      if (execResult.success) {
        return execResult.data;
      } else {
        throw new Error(execResult.error);
      }
    }
  }
  
  throw new Error('脚本执行超时');
}

async function handleNativeAutomationTabControl(
  message: { action: string; payload?: Record<string, any> },
) {
  switch (message.action) {
    case 'get_active_tab': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return { success: true, tab: tab ?? null };
    }
    case 'get_tab_info': {
      const tabId = Number(message.payload?.tabId);
      const tab = await browser.tabs.get(tabId);
      return { success: true, tab };
    }
    case 'get_window_tabs': {
      const windowId = typeof message.payload?.windowId === 'number'
        ? message.payload.windowId
        : undefined;
      const tabs = await browser.tabs.query(windowId ? { windowId } : { currentWindow: true });
      return { success: true, tabs };
    }
    case 'open_new_tab': {
      const url = typeof message.payload?.url === 'string' ? message.payload.url : '';
      if (!url) {
        return { success: false, error: 'open_new_tab 需要有效的 url。' };
      }
      const tab = await browser.tabs.create({ url, active: true });
      return { success: true, tab };
    }
    case 'activate_tab': {
      const tabId = Number(message.payload?.tabId);
      const tab = await browser.tabs.update(tabId, { active: true });
      if (tab && typeof tab.windowId === 'number') {
        await browser.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
      return { success: true, tab };
    }
    case 'close_tab': {
      const tabId = Number(message.payload?.tabId);
      await browser.tabs.remove(tabId);
      return { success: true };
    }
    default:
      return { success: false, error: `未知的自动化标签页动作: ${String(message.action)}` };
  }
}

async function handleNativeAutomationPageControl(
  message: { action: string; targetTabId: number; payload?: unknown },
) {
  const result = await browser.tabs.sendMessage(message.targetTabId, {
    type: NATIVE_AUTOMATION_PAGE_CONTROL_MESSAGE,
    action: message.action,
    payload: message.payload,
  });
  return result;
}

export default defineBackground(() => {
  // 监听扩展安装事件
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install') {
      // 首次安装时，检测并设置语言
      const { initializeLanguage } = await import('../utils/storage');
      await initializeLanguage();
    }
  });

  // 跟踪 sidepanel 连接状态
  let sidePanelPort: any = null;

  // 监听 sidepanel 连接
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidepanel') {
      sidePanelPort = port;
      port.onDisconnect.addListener(() => {
        sidePanelPort = null;
      });
    }
  });

  // Open/toggle side panel when extension icon is clicked
  const actionApi = (browser as any).action ?? (browser as any).browserAction;
  actionApi?.onClicked?.addListener(async (tab: any) => {
    try {
      // Firefox: use sidebarAction.toggle() for open/close behavior
      const sidebarActionApi = (browser as any).sidebarAction;
      if (sidebarActionApi?.toggle) {
        await sidebarActionApi.toggle();
        return;
      }
      // Chrome: fallback to openSidePanel (though setPanelBehavior handles this)
      await openSidePanel(tab?.id);
    } catch (error) {
      console.error('Failed to open side panel:', error);
    }
  });

  // Handle messages from content script
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === NATIVE_AUTOMATION_TAB_CONTROL_MESSAGE) {
      handleNativeAutomationTabControl(message)
        .then(sendResponse)
        .catch((error) => sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      return true;
    }
    if (message.type === NATIVE_AUTOMATION_PAGE_CONTROL_MESSAGE) {
      handleNativeAutomationPageControl(message)
        .then(sendResponse)
        .catch((error) => sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      return true;
    }
    if (message.type === 'OPEN_SIDEPANEL') {
      openSidePanel(sender.tab?.id).catch((error) => {
        console.error('Failed to open side panel:', error);
      });
    }
    if (message.type === 'TOGGLE_SIDEPANEL') {
      if ((browser as any).sidePanel?.open) {
        if (sidePanelPort) {
          // sidepanel 已打开，发送关闭消息
          sidePanelPort.postMessage({ type: 'CLOSE' });
        } else {
          // sidepanel 未打开，打开它
          openSidePanel(sender.tab?.id).catch((error) => {
            console.error('Failed to open side panel:', error);
          });
        }
      } else {
        const sidebarActionApi = (browser as any).sidebarAction;
        if (sidePanelPort && sidebarActionApi?.close) {
          sidebarActionApi.close().catch((error: unknown) => {
            console.error('Failed to close sidebar:', error);
          });
        } else if (sidePanelPort) {
          sidePanelPort.postMessage({ type: 'CLOSE' });
        } else {
          openSidePanel(sender.tab?.id).catch((error) => {
            console.error('Failed to open side panel:', error);
          });
        }
      }
    }
    if (message.type === 'SET_QUOTE') {
      // Store quote temporarily for sidepanel to pick up
      browser.storage.local.set({ pendingQuote: message.quote });
    }
    
    // 处理脚本执行请求
    if (message.type === 'EXECUTE_SKILL_SCRIPT') {
      const { tabId, code, args, scriptId } = message;
      executeScriptInTab(tabId, code, args, scriptId)
        .then(result => sendResponse({ success: true, result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // 保持消息通道开放
    }
    
    return true;
  });

  // Set side panel behavior
  (browser as any).sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
});
