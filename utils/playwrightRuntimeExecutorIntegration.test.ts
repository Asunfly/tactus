import { describe, expect, it, vi } from 'vitest';
import { executePlaywrightTool } from './playwrightToolExecutor';
import type { ToolCall } from './tools';

function createToolCall(name: string, args: Record<string, any> = {}): ToolCall {
  return {
    id: 'tool-1',
    name: `mcp__playwright__${name}`,
    arguments: args,
  };
}

describe('playwright runtime controller integration', () => {
  it('内置 gateway 在执行前会通过 runtime controller 做统一准备', async () => {
    const runtimeController = {
      prepareForTool: vi.fn(async () => ({
        ok: true,
        note: 'runtime ready',
        snapshot: {
          phase: 'ready' as const,
          boundTabId: 11,
          lockedTabId: 11,
          targetTabId: 11,
          targetWindowId: 1,
          lastToolName: 'browser_snapshot',
          reason: 'prepare',
        },
      })),
      recoverForSessionError: vi.fn(),
    };

    const result = await executePlaywrightTool({
      language: 'zh-CN',
      serverId: 'builtin-playwright-gateway',
      serverName: 'Local Playwright Gateway',
      toolName: 'browser_snapshot',
      toolCall: createToolCall('browser_snapshot', {}),
      isInternalGatewayServer: () => true,
      executeInternalTabsTool: async () => null,
      reconnectServer: async () => true,
      callTool: async () => ({
        success: true,
        content: 'snapshot ok',
      }),
      captureSnapshot: async () => ({
        success: true,
        content: '- generic [ref=e1]: Snapshot',
      }),
      runtimeController,
    });

    expect(result.success).toBe(true);
    expect(runtimeController.prepareForTool).toHaveBeenCalledWith('browser_snapshot', {});
  });

  it('命中 page/context 关闭错误时会让 runtime controller 决定恢复，而不是 sidepanel 自己拼恢复动作', async () => {
    const runtimeController = {
      prepareForTool: vi.fn(async () => ({
        ok: true,
        snapshot: {
          phase: 'ready' as const,
          boundTabId: 11,
          lockedTabId: 11,
          targetTabId: 11,
          targetWindowId: 1,
          lastToolName: 'browser_navigate_back',
          reason: 'prepare',
        },
      })),
      recoverForSessionError: vi.fn(async () => ({
        ok: true,
        note: 'runtime recovered',
        snapshot: {
          phase: 'ready' as const,
          boundTabId: 22,
          lockedTabId: 22,
          targetTabId: 22,
          targetWindowId: 2,
          lastToolName: 'browser_navigate_back',
          reason: 'missing_page',
        },
      })),
    };

    const result = await executePlaywrightTool({
      language: 'zh-CN',
      serverId: 'builtin-playwright-gateway',
      serverName: 'Local Playwright Gateway',
      toolName: 'browser_navigate_back',
      toolCall: createToolCall('browser_navigate_back', {}),
      isInternalGatewayServer: () => true,
      executeInternalTabsTool: async () => null,
      reconnectServer: async () => true,
      callTool: vi.fn()
        .mockResolvedValueOnce({
          success: false,
          content: 'Error: browserContext.newPage: Target page, context or browser has been closed',
          isError: true,
        })
        .mockResolvedValueOnce({
          success: true,
          content: 'went back',
        }),
      captureSnapshot: async () => ({
        success: true,
        content: '- generic [ref=e1]: Snapshot',
      }),
      runtimeController,
    });

    expect(result.success).toBe(true);
    expect(runtimeController.recoverForSessionError).toHaveBeenCalledWith(
      'browser_navigate_back',
      {},
      'Error: browserContext.newPage: Target page, context or browser has been closed',
    );
  });
});
