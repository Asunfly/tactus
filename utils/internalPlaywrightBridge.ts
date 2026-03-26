export const INTERNAL_PLAYWRIGHT_RELAY_DEFAULT_PORT = 8932;
export const INTERNAL_PLAYWRIGHT_BRIDGE_BIND_MESSAGE_TYPE = 'ENSURE_INTERNAL_PLAYWRIGHT_BRIDGE';

export interface InternalPlaywrightRelayEndpoints {
  cdpEndpoint: string;
  extensionEndpoint: string;
}

export interface InternalPlaywrightBridgeBindMessage {
  type: typeof INTERNAL_PLAYWRIGHT_BRIDGE_BIND_MESSAGE_TYPE;
  tabId: number;
  windowId?: number;
  extensionEndpoint: string;
}

export type InternalPlaywrightTabsAction = 'list' | 'new' | 'close' | 'select';

export function createInternalPlaywrightRelayEndpoints(
  port = INTERNAL_PLAYWRIGHT_RELAY_DEFAULT_PORT,
): InternalPlaywrightRelayEndpoints {
  return {
    cdpEndpoint: `ws://127.0.0.1:${port}/cdp`,
    extensionEndpoint: `ws://127.0.0.1:${port}/extension`,
  };
}

export function createInternalPlaywrightBridgeBindMessage(input: {
  tabId: number;
  windowId?: number;
  relayPort?: number;
}): InternalPlaywrightBridgeBindMessage {
  return {
    type: INTERNAL_PLAYWRIGHT_BRIDGE_BIND_MESSAGE_TYPE,
    tabId: input.tabId,
    ...(input.windowId ? { windowId: input.windowId } : {}),
    extensionEndpoint: createInternalPlaywrightRelayEndpoints(input.relayPort).extensionEndpoint,
  };
}

export function getInternalPlaywrightBridgeTargetTabId(
  boundTabId: number | null,
  lockedTabId: number | null,
  activeTabId: number | null,
): number | null {
  return boundTabId ?? lockedTabId ?? activeTabId ?? null;
}

export function getInternalPlaywrightTabsAction(
  toolName: string,
  args: Record<string, unknown> | undefined,
): InternalPlaywrightTabsAction | null {
  if (toolName !== 'browser_tabs') {
    return null;
  }
  const action = args?.action;
  if (action === 'list' || action === 'new' || action === 'close' || action === 'select') {
    return action;
  }
  return null;
}

export function renderInternalPlaywrightTabsMarkdown(
  tabs: Array<{ title: string; url: string; current: boolean }>,
): string[] {
  if (!tabs.length) {
    return ['No open tabs. Navigate to a URL to create one.'];
  }

  return tabs.map((tab, index) => {
    const current = tab.current ? ' (current)' : '';
    return `- ${index}:${current} [${tab.title}](${tab.url})`;
  });
}
