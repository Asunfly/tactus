import {
  INTERNAL_PLAYWRIGHT_BRIDGE_BIND_MESSAGE_TYPE,
} from '../utils/internalPlaywrightBridge';
import {
  InternalPlaywrightBridgeBackground,
  type BridgeDebuggerApi,
} from '../utils/internalPlaywrightBridgeBackground';

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

function createChromeDebuggerApi(): BridgeDebuggerApi | null {
  const chromeApi = (globalThis as any).chrome;
  const chromeDebugger = chromeApi?.debugger;
  if (!chromeDebugger) return null;

  const withChromeCallback = <T>(register: (callback: (result?: T) => void) => void): Promise<T> => {
    return new Promise((resolve, reject) => {
      register((result?: T) => {
        const runtimeError = chromeApi?.runtime?.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(result as T);
      });
    });
  };

  return {
    attach(debuggee, version) {
      return withChromeCallback<void>((callback) => {
        chromeDebugger.attach(debuggee, version, callback);
      });
    },
    sendCommand(debuggee, method, params) {
      return withChromeCallback<any>((callback) => {
        chromeDebugger.sendCommand(debuggee, method, params, callback);
      });
    },
    detach(debuggee) {
      return withChromeCallback<void>((callback) => {
        chromeDebugger.detach(debuggee, callback);
      });
    },
    onEvent: {
      addListener(listener) {
        chromeDebugger.onEvent.addListener(listener);
      },
      removeListener(listener) {
        chromeDebugger.onEvent.removeListener(listener);
      },
    },
    onDetach: {
      addListener(listener) {
        chromeDebugger.onDetach.addListener(listener);
      },
      removeListener(listener) {
        chromeDebugger.onDetach.removeListener(listener);
      },
    },
  };
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
  const internalPlaywrightBridge = !import.meta.env.FIREFOX
    ? (() => {
        const debuggerApi = createChromeDebuggerApi();
        if (!debuggerApi) return null;
        return new InternalPlaywrightBridgeBackground({
          createSocket: (url) => new WebSocket(url),
          debuggerApi,
        });
      })()
    : null;

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

    if (message.type === INTERNAL_PLAYWRIGHT_BRIDGE_BIND_MESSAGE_TYPE) {
      if (!internalPlaywrightBridge) {
        sendResponse({ success: false, error: '当前浏览器不支持内置 Playwright bridge。' });
        return false;
      }

      internalPlaywrightBridge.ensureBinding(message)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      return true;
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
