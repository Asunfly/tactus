import { describe, expect, it } from 'vitest';
import type { ToolResult } from './tools';
import {
  applyToolResultToLoopState,
  buildToolArgumentParseErrorResult,
  createInitialToolLoopState,
  promoteToolResultToBudgetExhausted,
} from './toolLoopState';

function createToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    tool_call_id: 'tc-1',
    name: 'test_tool',
    result: 'ok',
    success: true,
    ...overrides,
  };
}

describe('toolLoopState', () => {
  it('成功结果不会消耗 self-heal 预算，也不会禁用工具', () => {
    const state = createInitialToolLoopState(3);
    const transition = applyToolResultToLoopState(state, createToolResult());

    expect(transition.action).toBe('continue_with_tools');
    expect(transition.nextState.usedSelfHealRounds).toBe(0);
    expect(transition.nextState.toolUseDisabled).toBe(false);
    expect(transition.consumedSelfHealRound).toBe(false);
  });

  it('recoverable error 会消耗一次 self-heal 预算，但在预算内仍允许继续调工具', () => {
    const state = createInitialToolLoopState(3);
    const transition = applyToolResultToLoopState(state, createToolResult({
      success: false,
      result: 'recoverable failure',
      meta: {
        outcome: 'recoverable_error',
        recoveryLayer: 'model',
        consumesSelfHealRound: true,
      },
    }));

    expect(transition.action).toBe('continue_with_tools');
    expect(transition.nextState.usedSelfHealRounds).toBe(1);
    expect(transition.nextState.toolUseDisabled).toBe(false);
    expect(transition.consumedSelfHealRound).toBe(true);
  });

  it('fatal error 会立即禁用后续工具调用，切到只允许模型解释', () => {
    const state = createInitialToolLoopState(3);
    const transition = applyToolResultToLoopState(state, createToolResult({
      success: false,
      result: 'fatal failure',
      meta: {
        outcome: 'fatal_error',
        recoveryLayer: 'user',
        disableFurtherToolCalls: true,
      },
    }));

    expect(transition.action).toBe('continue_without_tools');
    expect(transition.nextState.toolUseDisabled).toBe(true);
    expect(transition.nextState.usedSelfHealRounds).toBe(0);
  });

  it('recoverable error 超过预算后会禁用工具，交给模型做最终解释', () => {
    const state = createInitialToolLoopState(2);
    const first = applyToolResultToLoopState(state, createToolResult({
      success: false,
      result: 'first recoverable failure',
      meta: {
        outcome: 'recoverable_error',
        recoveryLayer: 'model',
      },
    }));
    const second = applyToolResultToLoopState(first.nextState, createToolResult({
      success: false,
      result: 'second recoverable failure',
      meta: {
        outcome: 'recoverable_error',
        recoveryLayer: 'model',
      },
    }));

    expect(second.action).toBe('continue_without_tools');
    expect(second.nextState.usedSelfHealRounds).toBe(2);
    expect(second.nextState.toolUseDisabled).toBe(true);
    expect(second.budgetExhausted).toBe(true);
  });

  it('参数解析失败会生成模型可见的 recoverable observation', () => {
    const result = buildToolArgumentParseErrorResult({
      toolCallId: 'tool-1',
      toolName: 'mcp__remote__search_docs',
      rawArguments: '{"q":',
      errorMessage: 'Unexpected end of JSON input',
    });

    expect(result.success).toBe(false);
    expect(result.meta?.outcome).toBe('recoverable_error');
    expect(result.meta?.failureKind).toBe('tool_args');
    expect(result.result).toContain('Tool execution outcome');
    expect(result.result).toContain('Unexpected end of JSON input');
  });

  it('预算耗尽后会把失败结果提升为 fatal budget exhausted observation', () => {
    const result = promoteToolResultToBudgetExhausted(createToolResult({
      success: false,
      result: 'transport failed',
      meta: {
        outcome: 'recoverable_error',
        recoveryLayer: 'model',
      },
    }), createInitialToolLoopState(3));

    expect(result.success).toBe(false);
    expect(result.meta?.outcome).toBe('fatal_error');
    expect(result.meta?.failureKind).toBe('budget_exhausted');
    expect(result.meta?.disableFurtherToolCalls).toBe(true);
    expect(result.result).toContain('Self-heal budget exhausted');
  });
});
