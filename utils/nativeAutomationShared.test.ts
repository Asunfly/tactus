import { describe, expect, it } from 'vitest';

import {
  formatNativeAutomationBrowserState,
  isNativeAutomationAllowedUrl,
  renderNativeAutomationTabsMarkdown,
  resolveNativeAutomationTabAction,
} from './nativeAutomationShared';

describe('isNativeAutomationAllowedUrl', () => {
  it('allows normal web pages', () => {
    expect(isNativeAutomationAllowedUrl('https://example.com')).toBe(true);
    expect(isNativeAutomationAllowedUrl('http://localhost:3000')).toBe(true);
  });

  it('blocks restricted browser URLs', () => {
    expect(isNativeAutomationAllowedUrl('about:blank')).toBe(false);
    expect(isNativeAutomationAllowedUrl('chrome://settings')).toBe(false);
    expect(isNativeAutomationAllowedUrl('chrome-extension://abc/index.html')).toBe(false);
    expect(isNativeAutomationAllowedUrl('file:///tmp/test.html')).toBe(false);
    expect(isNativeAutomationAllowedUrl('devtools://devtools/bundled')).toBe(false);
  });
});

describe('renderNativeAutomationTabsMarkdown', () => {
  it('renders current tabs as markdown list', () => {
    expect(
      renderNativeAutomationTabsMarkdown([
        {
          id: 11,
          title: 'Example',
          url: 'https://example.com',
          current: true,
          active: true,
        },
        {
          id: 22,
          title: 'Docs',
          url: 'https://docs.example.com',
          current: false,
          active: false,
        },
      ]),
    ).toContain('- 0: (current) [Example](https://example.com)');
  });

  it('shows an explicit empty state', () => {
    expect(renderNativeAutomationTabsMarkdown([])).toContain('No automatable tabs available.');
  });
});

describe('resolveNativeAutomationTabAction', () => {
  it('defaults to list when action is omitted', () => {
    expect(resolveNativeAutomationTabAction({})).toEqual({ action: 'list' });
  });

  it('parses new action with url', () => {
    expect(
      resolveNativeAutomationTabAction({
        action: 'new',
        url: 'https://example.com',
      }),
    ).toEqual({
      action: 'new',
      url: 'https://example.com',
    });
  });

  it('parses select and close actions with index', () => {
    expect(resolveNativeAutomationTabAction({ action: 'select', index: 1 })).toEqual({
      action: 'select',
      index: 1,
    });
    expect(resolveNativeAutomationTabAction({ action: 'close', index: 2 })).toEqual({
      action: 'close',
      index: 2,
    });
  });

  it('returns null for unsupported actions', () => {
    expect(resolveNativeAutomationTabAction({ action: 'invalid' })).toBeNull();
  });
});

describe('formatNativeAutomationBrowserState', () => {
  it('formats tab summary and browser state into one observation', () => {
    const text = formatNativeAutomationBrowserState({
      tabsMarkdown: '- 0: (current) [Example](https://example.com)',
      browserState: {
        url: 'https://example.com',
        title: 'Example',
        header: 'Header',
        content: 'Content',
        footer: 'Footer',
      },
    });

    expect(text).toContain('## Browser Tabs');
    expect(text).toContain('## Current Page');
    expect(text).toContain('Header');
    expect(text).toContain('Content');
    expect(text).toContain('Footer');
  });
});
