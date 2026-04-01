import { describe, expect, it, vi } from 'vitest';
import { executePlaywrightTool } from './playwrightToolExecutor';
import type { McpToolCallResult } from './mcp';
import type { ToolCall, ToolResult } from './tools';

type ToolScenario = {
  toolName: string;
  args: Record<string, any>;
  expectsSnapshotPreflight?: boolean;
  handledByTabsFacade?: boolean;
};

const COVERED_BROWSER_TOOLS: ToolScenario[] = [
  { toolName: 'browser_click', args: { ref: 'e1', element: 'Save' }, expectsSnapshotPreflight: true },
  { toolName: 'browser_close', args: {} },
  { toolName: 'browser_console_messages', args: { level: 'info' } },
  { toolName: 'browser_drag', args: { startRef: 'e1', endRef: 'e2', startElement: 'Card', endElement: 'Board' }, expectsSnapshotPreflight: true },
  { toolName: 'browser_evaluate', args: { ref: 'e1', element: 'Card', function: '(element) => element.innerText' }, expectsSnapshotPreflight: true },
  { toolName: 'browser_file_upload', args: { ref: 'e1', element: 'Upload', paths: ['/tmp/demo.txt'] }, expectsSnapshotPreflight: true },
  { toolName: 'browser_fill_form', args: { fields: [{ name: 'Email', ref: 'e1', type: 'textbox', value: 'demo@example.com' }] }, expectsSnapshotPreflight: true },
  { toolName: 'browser_handle_dialog', args: { accept: true } },
  { toolName: 'browser_hover', args: { ref: 'e1', element: 'Menu' }, expectsSnapshotPreflight: true },
  { toolName: 'browser_install', args: {} },
  { toolName: 'browser_navigate', args: { url: 'https://example.com' } },
  { toolName: 'browser_navigate_back', args: {} },
  { toolName: 'browser_network_requests', args: { includeStatic: false } },
  { toolName: 'browser_press_key', args: { key: 'Enter' } },
  { toolName: 'browser_resize', args: { width: 1280, height: 800 } },
  { toolName: 'browser_run_code', args: { code: 'async (page) => await page.title()' } },
  { toolName: 'browser_select_option', args: { ref: 'e1', element: 'Country', values: ['CN'] }, expectsSnapshotPreflight: true },
  { toolName: 'browser_snapshot', args: {} },
  { toolName: 'browser_tabs', args: { action: 'list' }, handledByTabsFacade: true },
  { toolName: 'browser_take_screenshot', args: { ref: 'e1', element: 'Hero', type: 'png' }, expectsSnapshotPreflight: true },
  { toolName: 'browser_type', args: { ref: 'e1', element: 'Search', text: 'hello' }, expectsSnapshotPreflight: true },
  { toolName: 'browser_wait_for', args: { text: 'Done' } },
];

function createMcpResult(input: Partial<McpToolCallResult> = {}): McpToolCallResult {
  return {
    success: true,
    content: 'ok',
    ...input,
  };
}

function createToolCall(toolName: string, args: Record<string, any>): ToolCall {
  return {
    id: `tool-${toolName}`,
    name: `mcp__playwright__${toolName}`,
    arguments: args,
  };
}

function createHarness(scenario: ToolScenario) {
  const callTool = vi.fn(async () => createMcpResult({
    content: `${scenario.toolName} ok`,
  }));
  const captureSnapshot = vi.fn(async () => createMcpResult({
    content: '- button "Action" [ref=e1]\n- generic [ref=e2]: Content',
  }));
  const executeInternalTabsTool = vi.fn(async () => {
    if (!scenario.handledByTabsFacade) return null as ToolResult | null;
    return {
      tool_call_id: `tool-${scenario.toolName}`,
      name: `mcp__playwright__${scenario.toolName}`,
      result: '- 0: [Example](https://example.com)',
      success: true,
    };
  });
  const reconnectServer = vi.fn(async () => true);
  const runtimeController = {
    prepareForTool: vi.fn(async () => ({ ok: true, snapshot: {} as any })),
    recoverForSessionError: vi.fn(async () => ({ ok: true, snapshot: {} as any })),
  };

  return {
    callTool,
    captureSnapshot,
    executeInternalTabsTool,
    reconnectServer,
    runtimeController,
    input: {
      language: 'zh-CN' as const,
      serverId: 'builtin-playwright-gateway',
      serverName: 'Local Playwright Gateway',
      toolName: scenario.toolName,
      toolCall: createToolCall(scenario.toolName, scenario.args),
      isInternalGatewayServer: () => true,
      executeInternalTabsTool,
      runtimeController,
      reconnectServer,
      callTool,
      captureSnapshot,
    },
  };
}

describe('playwright bridge coverage matrix', () => {
  it('当前 bridge 覆盖了 MCP 暴露的 22 个 browser 工具场景', async () => {
    expect(COVERED_BROWSER_TOOLS).toHaveLength(22);

    for (const scenario of COVERED_BROWSER_TOOLS) {
      const harness = createHarness(scenario);
      const result = await executePlaywrightTool(harness.input);

      expect(result.success).toBe(true);

      if (scenario.handledByTabsFacade) {
        expect(harness.executeInternalTabsTool).toHaveBeenCalledTimes(1);
        expect(harness.callTool).not.toHaveBeenCalled();
        continue;
      }

      expect(harness.runtimeController.prepareForTool).toHaveBeenCalledWith(scenario.toolName, scenario.args);
      expect(harness.callTool).toHaveBeenCalledTimes(1);

      if (scenario.expectsSnapshotPreflight) {
        expect(harness.captureSnapshot).toHaveBeenCalled();
      }
    }
  });
});
