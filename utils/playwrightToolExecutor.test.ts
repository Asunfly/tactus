import { describe, expect, it, vi } from 'vitest';
import type { McpToolCallResult } from './mcp';
import type { ToolCall, ToolResult } from './tools';
import { executePlaywrightTool } from './playwrightToolExecutor';

function createToolCall(name: string, args: Record<string, any> = {}): ToolCall {
  return {
    id: 'tool-1',
    name: `mcp__playwright__${name}`,
    arguments: args,
  };
}

function createMcpResult(input: Partial<McpToolCallResult> = {}): McpToolCallResult {
  return {
    success: true,
    content: 'ok',
    ...input,
  };
}

function createExecutorHarness(overrides: Partial<Parameters<typeof executePlaywrightTool>[0]> = {}) {
  const callTool = vi.fn(async () => createMcpResult());
  const captureSnapshot = vi.fn(async () => createMcpResult({
    content: '- button "Save" [ref=e1]',
  }));
  const executeInternalTabsTool = vi.fn(async () => null as ToolResult | null);
  const reconnectServer = vi.fn(async () => true);
  const runtimeController = {
    prepareForTool: vi.fn(async () => ({ ok: true, snapshot: {} as any })),
    recoverForSessionError: vi.fn(async () => ({ ok: true, snapshot: {} as any })),
  };

  const defaults: Parameters<typeof executePlaywrightTool>[0] = {
    language: 'zh-CN',
    serverId: 'playwright',
    serverName: 'Playwright',
    toolName: 'browser_click',
    toolCall: createToolCall('browser_click', { ref: 'e1', element: 'Save' }),
    isInternalGatewayServer: () => false,
    executeInternalTabsTool,
    runtimeController,
    reconnectServer,
    callTool,
    captureSnapshot,
  };

  const input: Parameters<typeof executePlaywrightTool>[0] = {
    ...defaults,
    ...overrides,
  };

  return {
    input,
    callTool: input.callTool,
    captureSnapshot: input.captureSnapshot,
    executeInternalTabsTool: input.executeInternalTabsTool,
    reconnectServer: input.reconnectServer,
    runtimeController: input.runtimeController,
  };
}

describe('playwrightToolExecutor', () => {
  it('在执行前发现 stale ref 时直接返回最新 snapshot', async () => {
    const harness = createExecutorHarness({
      captureSnapshot: vi.fn(async () => createMcpResult({
        content: '- button "Retry" [ref=e200]',
      })),
    });

    const result = await executePlaywrightTool(harness.input);

    expect(result.success).toBe(true);
    expect(result.result).toContain('browser_click 未执行');
    expect(result.result).toContain('ref=e200');
    expect(harness.callTool).not.toHaveBeenCalled();
  });

  it('命中可恢复会话错误时会自动重连并重试一次', async () => {
    const harness = createExecutorHarness({
      callTool: vi.fn()
        .mockResolvedValueOnce(createMcpResult({
          success: false,
          content: 'Error: browserType.connectOverCDP: Target page, context or browser has been closed',
          isError: true,
        }))
        .mockResolvedValueOnce(createMcpResult({
          success: true,
          content: 'done',
        })),
      captureSnapshot: vi.fn(async () => createMcpResult({
        content: '- button "Save" [ref=e1]',
      })),
    });

    const result = await executePlaywrightTool(harness.input);

    expect(result.success).toBe(true);
    expect(harness.reconnectServer).toHaveBeenCalledWith('playwright');
    expect(harness.callTool).toHaveBeenCalledTimes(2);
    expect(result.result).toContain('最新页面快照中的 ref');
  });

  it('命中 Failed to fetch 时会按第一层 transport 错误尝试重连一次', async () => {
    const harness = createExecutorHarness({
      callTool: vi.fn()
        .mockResolvedValueOnce(createMcpResult({
          success: false,
          content: '工具调用失败: Failed to fetch',
          isError: true,
        }))
        .mockResolvedValueOnce(createMcpResult({
          success: true,
          content: 'recovered',
        })),
    });

    const result = await executePlaywrightTool(harness.input);

    expect(result.success).toBe(true);
    expect(harness.reconnectServer).toHaveBeenCalledWith('playwright');
    expect(harness.callTool).toHaveBeenCalledTimes(2);
  });

  it('内置 gateway 命中 newPage 错误时通过 runtimeController 恢复', async () => {
    const runtimeController = {
      prepareForTool: vi.fn(async () => ({ ok: true, snapshot: {} as any })),
      recoverForSessionError: vi.fn(async () => ({ ok: true, snapshot: {} as any, note: '已恢复' })),
    };
    const harness = createExecutorHarness({
      serverId: 'builtin-playwright-gateway',
      isInternalGatewayServer: () => true,
      runtimeController,
      callTool: vi.fn()
        .mockResolvedValueOnce(createMcpResult({
          success: false,
          content: 'Error: browserContext.newPage: Target page, context or browser has been closed',
          isError: true,
        }))
        .mockResolvedValueOnce(createMcpResult({
          success: true,
          content: 'navigated',
        })),
      captureSnapshot: vi.fn(async () => createMcpResult({
        content: '- paragraph [ref=e1]: Empty',
      })),
      toolName: 'browser_navigate',
      toolCall: createToolCall('browser_navigate', { url: 'https://example.com' }),
    });

    const result = await executePlaywrightTool(harness.input);

    expect(result.success).toBe(true);
    expect(runtimeController.recoverForSessionError).toHaveBeenCalledTimes(1);
  });

  it('browser_tabs 被内置 gateway 接管时直接返回 tabs 结果', async () => {
    const tabsResult: ToolResult = {
      tool_call_id: 'tool-1',
      name: 'mcp__playwright__browser_tabs',
      result: '- 0: [Example](https://example.com)',
      success: true,
    };
    const harness = createExecutorHarness({
      serverId: 'builtin-playwright-gateway',
      isInternalGatewayServer: () => true,
      toolName: 'browser_tabs',
      toolCall: createToolCall('browser_tabs', { action: 'list' }),
      executeInternalTabsTool: vi.fn(async () => tabsResult),
    });

    const result = await executePlaywrightTool(harness.input);

    expect(result).toEqual(tabsResult);
    expect(harness.callTool).not.toHaveBeenCalled();
  });

  it('内置 gateway 前置守卫阻断时直接返回错误，不再调用 MCP 工具', async () => {
    const runtimeController = {
      prepareForTool: vi.fn(async () => ({
        ok: false,
        detail: '当前页面是浏览器内部页，且当前窗口里没有可调试的网页标签页。请切到普通网页后再试。',
        snapshot: {} as any,
      })),
      recoverForSessionError: vi.fn(async () => ({ ok: true, snapshot: {} as any })),
    };
    const harness = createExecutorHarness({
      serverId: 'builtin-playwright-gateway',
      isInternalGatewayServer: () => true,
      runtimeController,
    });

    const result = await executePlaywrightTool(harness.input);

    expect(result.success).toBe(false);
    expect(result.result).toContain('当前页面是浏览器内部页');
    expect(harness.callTool).not.toHaveBeenCalled();
  });

  it('内置 gateway 自动切换目标 tab 时会把提示附加到成功结果前面', async () => {
    const runtimeController = {
      prepareForTool: vi.fn(async () => ({
        ok: true,
        note: '当前页面不可调试，已自动切换到"Example"继续执行。',
        snapshot: {} as any,
      })),
      recoverForSessionError: vi.fn(async () => ({ ok: true, snapshot: {} as any })),
    };
    const harness = createExecutorHarness({
      serverId: 'builtin-playwright-gateway',
      isInternalGatewayServer: () => true,
      runtimeController,
      callTool: vi.fn(async () => createMcpResult({
        content: 'done',
      })),
      toolName: 'browser_navigate',
      toolCall: createToolCall('browser_navigate', { url: 'https://example.com' }),
    });

    const result = await executePlaywrightTool(harness.input);

    expect(result.success).toBe(true);
    expect(result.result).toContain('当前页面不可调试，已自动切换到"Example"继续执行。');
    expect(result.result).toContain('done');
  });

  it('交互超时时会返回最新页面快照给模型重新判断，而不是把失败继续向上冒泡', async () => {
    const harness = createExecutorHarness({
      toolName: 'browser_wait_for',
      toolCall: createToolCall('browser_wait_for', { text: 'Done' }),
      callTool: vi.fn(async () => createMcpResult({
        success: false,
        content: 'TimeoutError: locator.click: Timeout 5000ms exceeded.',
        isError: true,
      })),
      captureSnapshot: vi.fn(async () => createMcpResult({
        content: '- button "Retry" [ref=e200]',
      })),
    });

    const result = await executePlaywrightTool(harness.input);

    expect(result.success).toBe(true);
    expect(result.result).toContain('browser_wait_for 未执行成功');
    expect(result.result).toContain('ref=e200');
  });
});
