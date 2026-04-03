export interface NativeAutomationTabSummary {
  id: number;
  title: string;
  url: string;
  current: boolean;
  active: boolean;
}

export const NATIVE_AUTOMATION_PAGE_CONTROL_MESSAGE = 'AUTOMATION_PAGE_CONTROL';
export const NATIVE_AUTOMATION_TAB_CONTROL_MESSAGE = 'AUTOMATION_TAB_CONTROL';

export interface NativeAutomationBrowserState {
  url: string;
  title: string;
  header: string;
  content: string;
  footer: string;
}

export type NativeAutomationTabsAction = 'list' | 'new' | 'select' | 'close';

export interface ResolvedNativeAutomationTabsAction {
  action: NativeAutomationTabsAction;
  index?: number;
  url?: string;
}

export function isNativeAutomationAllowedUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  return ![
    'about:',
    'chrome://',
    'chrome-extension://',
    'devtools://',
    'edge://',
    'brave://',
    'opera://',
    'vivaldi://',
    'file://',
    'view-source:',
  ].some(prefix => url.startsWith(prefix));
}

export function renderNativeAutomationTabsMarkdown(tabs: NativeAutomationTabSummary[]): string {
  if (!tabs.length) {
    return 'No automatable tabs available.';
  }

  return tabs.map((tab, index) => {
    const current = tab.current ? ' (current)' : '';
    return `- ${index}:${current} [${tab.title}](${tab.url})`;
  }).join('\n');
}

export function resolveNativeAutomationTabAction(
  args: Record<string, unknown> | undefined,
): ResolvedNativeAutomationTabsAction | null {
  const rawAction = typeof args?.action === 'string' ? args.action : 'list';
  if (!['list', 'new', 'select', 'close'].includes(rawAction)) {
    return null;
  }

  const resolved: ResolvedNativeAutomationTabsAction = {
    action: rawAction as NativeAutomationTabsAction,
  };

  if (typeof args?.index === 'number') {
    resolved.index = args.index;
  }
  if (typeof args?.url === 'string' && args.url.trim()) {
    resolved.url = args.url.trim();
  }

  return resolved;
}

export function formatNativeAutomationBrowserState(input: {
  tabsMarkdown: string;
  browserState: NativeAutomationBrowserState;
}): string {
  return [
    '## Browser Tabs',
    input.tabsMarkdown,
    '',
    '## Current Page',
    `Title: ${input.browserState.title}`,
    `URL: ${input.browserState.url}`,
    '',
    input.browserState.header,
    '',
    input.browserState.content,
    '',
    input.browserState.footer,
  ].join('\n');
}

export function extractIndexedElementHint(content: string, index: number): string | null {
  const lines = content.split('\n');
  const prefix = `[${index}]`;
  return lines.find(line => line.trimStart().startsWith(prefix)) ?? null;
}
