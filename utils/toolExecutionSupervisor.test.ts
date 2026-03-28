import { describe, expect, it, vi } from 'vitest';
import type { ToolCall, ToolExecutionContext, ToolResult } from './tools';
import { executeToolWithSupervisor } from './toolExecutionSupervisor';

function createToolCall(name: string, args: Record<string, any> = {}): ToolCall {
  return {
    id: 'tool-1',
    name,
    arguments: args,
  };
}

function createContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    selfHealRound: 0,
    maxSelfHealRounds: 3,
    inSelfHealMode: false,
    ...overrides,
  };
}

function createToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    tool_call_id: 'tool-1',
    name: 'extract_page_content',
    result: 'ok',
    success: true,
    ...overrides,
  };
}

function createHarness(overrides: Partial<Parameters<typeof executeToolWithSupervisor>[0]> = {}) {
  const logEntries: any[] = [];
  const logUpdates: Array<{ id: string; patch: any }> = [];
  const requestAutomationConfirmation = vi.fn(async () => true);
  const executeRawTool = vi.fn(async () => createToolResult());

  const input: Parameters<typeof executeToolWithSupervisor>[0] = {
    language: 'zh-CN',
    toolCall: createToolCall('extract_page_content'),
    context: createContext(),
    createLogEntry(entry) {
      logEntries.push(entry);
      return `log-${logEntries.length}`;
    },
    updateLogEntry(id, patch) {
      logUpdates.push({ id, patch });
    },
    buildAutomationDetail(detail) {
      return detail;
    },
    requestAutomationConfirmation,
    executeRawTool,
    ...overrides,
  };

  return {
    input,
    logEntries,
    logUpdates,
    requestAutomationConfirmation,
    executeRawTool: input.executeRawTool,
  };
}

describe('toolExecutionSupervisor', () => {
  it('普通 MCP 失败会被包装成 recoverable observation，而不是裸错误字符串', async () => {
    const harness = createHarness({
      toolCall: createToolCall('mcp__remote__search_docs', { query: 'test' }),
      executeRawTool: vi.fn(async () => createToolResult({
        name: 'mcp__remote__search_docs',
        success: false,
        result: '工具调用失败: Failed to fetch',
      })),
    });

    const result = await executeToolWithSupervisor(harness.input);

    expect(result.success).toBe(false);
    expect(result.meta?.outcome).toBe('recoverable_error');
    expect(result.result).toContain('Tool execution outcome');
    expect(result.result).toContain('Failed to fetch');
  });

  it('execute_skill_script 在自愈回合会要求二次确认', async () => {
    const harness = createHarness({
      toolCall: createToolCall('execute_skill_script', {
        skill_name: 'demo-skill',
        script_path: 'scripts/run.js',
      }),
      context: createContext({
        selfHealRound: 1,
        inSelfHealMode: true,
      }),
    });

    await executeToolWithSupervisor(harness.input);

    expect(harness.requestAutomationConfirmation).toHaveBeenCalledTimes(1);
    expect(harness.executeRawTool).toHaveBeenCalledTimes(1);
  });

  it('只读工具在自愈回合可自动执行，不触发二次确认', async () => {
    const harness = createHarness({
      toolCall: createToolCall('read_skill_file', {
        skill_name: 'demo-skill',
        file_path: 'references/guide.md',
      }),
      context: createContext({
        selfHealRound: 1,
        inSelfHealMode: true,
      }),
    });

    await executeToolWithSupervisor(harness.input);

    expect(harness.requestAutomationConfirmation).not.toHaveBeenCalled();
    expect(harness.executeRawTool).toHaveBeenCalledTimes(1);
  });

  it('fatal error 会保持 fatal meta，并要求后续禁用工具', async () => {
    const harness = createHarness({
      toolCall: createToolCall('unknown_tool'),
      executeRawTool: vi.fn(async () => createToolResult({
        name: 'unknown_tool',
        success: false,
        result: '未知工具: unknown_tool',
        meta: {
          outcome: 'fatal_error',
          recoveryLayer: 'user',
          disableFurtherToolCalls: true,
        },
      })),
    });

    const result = await executeToolWithSupervisor(harness.input);

    expect(result.success).toBe(false);
    expect(result.meta?.outcome).toBe('fatal_error');
    expect(result.meta?.disableFurtherToolCalls).toBe(true);
  });
});
