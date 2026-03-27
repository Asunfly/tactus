import { describe, expect, it } from 'vitest';
import type { ToolCall } from './tools';
import {
  isPlaywrightMcpBrowserToolCall,
  shouldBlindRetryToolExecutionFailure,
} from './toolExecutionPolicy';

function createToolCall(name: string): ToolCall {
  return {
    id: 'tool-1',
    name,
    arguments: {},
  };
}

describe('toolExecutionPolicy', () => {
  it('识别 MCP 里的 Playwright browser 工具', () => {
    expect(isPlaywrightMcpBrowserToolCall('mcp__playwright__browser_click')).toBe(true);
    expect(isPlaywrightMcpBrowserToolCall('mcp__playwright__browser_snapshot')).toBe(true);
    expect(isPlaywrightMcpBrowserToolCall('mcp__playwright__foo')).toBe(false);
    expect(isPlaywrightMcpBrowserToolCall('extract_page_content')).toBe(false);
  });

  it('对 Playwright browser 工具失败禁用外层盲重试', () => {
    expect(shouldBlindRetryToolExecutionFailure(createToolCall('mcp__playwright__browser_click'))).toBe(false);
    expect(shouldBlindRetryToolExecutionFailure(createToolCall('mcp__playwright__browser_wait_for'))).toBe(false);
    expect(shouldBlindRetryToolExecutionFailure(createToolCall('mcp__local__search_docs'))).toBe(true);
    expect(shouldBlindRetryToolExecutionFailure(createToolCall('extract_page_content'))).toBe(true);
  });
});
