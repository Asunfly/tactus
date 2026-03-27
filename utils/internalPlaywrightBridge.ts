export const INTERNAL_PLAYWRIGHT_RELAY_DEFAULT_PORT = 8932;
export const INTERNAL_PLAYWRIGHT_BRIDGE_BIND_MESSAGE_TYPE = 'ENSURE_INTERNAL_PLAYWRIGHT_BRIDGE';

export interface InternalPlaywrightRelayEndpoints {
  cdpEndpoint: string;
  extensionEndpoint: string;
}

export interface InternalPlaywrightTabCandidate {
  id?: number;
  windowId?: number;
  active?: boolean;
  url?: string | null;
  title?: string | null;
}

export type InternalPlaywrightTargetResolution =
  | {
      status: 'ready';
      source: 'bound' | 'locked' | 'active' | 'fallback';
      tab: Required<Pick<InternalPlaywrightTabCandidate, 'id'>> & InternalPlaywrightTabCandidate;
      activeTab: (Required<Pick<InternalPlaywrightTabCandidate, 'id'>> & InternalPlaywrightTabCandidate) | null;
    }
  | {
      status: 'blocked';
      activeTab: (Required<Pick<InternalPlaywrightTabCandidate, 'id'>> & InternalPlaywrightTabCandidate) | null;
    };

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

export function isInternalPlaywrightBridgeAllowedUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return !url.startsWith('chrome://')
    && !url.startsWith('chrome-extension://')
    && !url.startsWith('devtools://')
    && !url.startsWith('edge://')
    && !url.startsWith('about:blank');
}

export function resolveInternalPlaywrightBridgeTarget(input: {
  boundTabId: number | null;
  lockedTabId: number | null;
  tabs: InternalPlaywrightTabCandidate[];
}): InternalPlaywrightTargetResolution {
  const normalizedTabs = input.tabs.filter(
    (tab): tab is Required<Pick<InternalPlaywrightTabCandidate, 'id'>> & InternalPlaywrightTabCandidate =>
      typeof tab.id === 'number' && tab.id > 0,
  );
  const tabsById = new Map(normalizedTabs.map(tab => [tab.id, tab]));
  const activeTab = normalizedTabs.find(tab => Boolean(tab.active)) ?? null;

  const preferredCandidates: Array<{
    source: 'bound' | 'locked' | 'active';
    tabId: number | null;
  }> = [
    { source: 'bound', tabId: input.boundTabId },
    { source: 'locked', tabId: input.lockedTabId },
    { source: 'active', tabId: activeTab?.id ?? null },
  ];

  for (const candidate of preferredCandidates) {
    if (!candidate.tabId) continue;
    const tab = tabsById.get(candidate.tabId);
    if (tab && isInternalPlaywrightBridgeAllowedUrl(tab.url)) {
      return {
        status: 'ready',
        source: candidate.source,
        tab,
        activeTab,
      };
    }
  }

  const fallbackTab = normalizedTabs.find(tab => isInternalPlaywrightBridgeAllowedUrl(tab.url)) ?? null;
  if (fallbackTab) {
    return {
      status: 'ready',
      source: 'fallback',
      tab: fallbackTab,
      activeTab,
    };
  }

  return {
    status: 'blocked',
    activeTab,
  };
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
