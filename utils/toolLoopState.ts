import type { ToolResult } from './tools';

export interface ToolLoopState {
  maxSelfHealRounds: number;
  usedSelfHealRounds: number;
  toolUseDisabled: boolean;
}

export interface ToolLoopTransition {
  action: 'continue_with_tools' | 'continue_without_tools';
  nextState: ToolLoopState;
  consumedSelfHealRound: boolean;
  budgetExhausted: boolean;
}

export function createInitialToolLoopState(maxSelfHealRounds = 3): ToolLoopState {
  return {
    maxSelfHealRounds,
    usedSelfHealRounds: 0,
    toolUseDisabled: false,
  };
}

export function applyToolResultToLoopState(
  state: ToolLoopState,
  result: ToolResult,
): ToolLoopTransition {
  if (state.toolUseDisabled) {
    return {
      action: 'continue_without_tools',
      nextState: state,
      consumedSelfHealRound: false,
      budgetExhausted: state.usedSelfHealRounds >= state.maxSelfHealRounds,
    };
  }

  if (result.success) {
    return {
      action: 'continue_with_tools',
      nextState: state,
      consumedSelfHealRound: false,
      budgetExhausted: false,
    };
  }

  const outcome = result.meta?.outcome ?? 'recoverable_error';
  const disableFurtherToolCalls = result.meta?.disableFurtherToolCalls ?? outcome === 'fatal_error';
  const consumesSelfHealRound = result.meta?.consumesSelfHealRound ?? outcome !== 'fatal_error';

  if (disableFurtherToolCalls || outcome === 'fatal_error') {
    return {
      action: 'continue_without_tools',
      nextState: {
        ...state,
        toolUseDisabled: true,
      },
      consumedSelfHealRound: false,
      budgetExhausted: false,
    };
  }

  const nextUsedRounds = consumesSelfHealRound ? state.usedSelfHealRounds + 1 : state.usedSelfHealRounds;
  const budgetExhausted = nextUsedRounds >= state.maxSelfHealRounds;

  return {
    action: budgetExhausted ? 'continue_without_tools' : 'continue_with_tools',
    nextState: {
      ...state,
      usedSelfHealRounds: nextUsedRounds,
      toolUseDisabled: budgetExhausted,
    },
    consumedSelfHealRound: consumesSelfHealRound,
    budgetExhausted,
  };
}

export function buildToolArgumentParseErrorResult(input: {
  toolCallId: string;
  toolName: string;
  rawArguments: string;
  errorMessage: string;
}): ToolResult {
  return {
    tool_call_id: input.toolCallId,
    name: input.toolName,
    result: [
      'Tool execution outcome',
      `- Tool: ${input.toolName}`,
      '- Status: recoverable_error',
      '- Recovery layer: model',
      '- Failure kind: tool_args',
      '- Summary: The model produced invalid tool arguments',
      '- Recommended next actions:',
      '  - fix the arguments based on the schema',
      '  - simplify the tool call if possible',
      '',
      'Details:',
      `Raw arguments: ${input.rawArguments}`,
      `Parse error: ${input.errorMessage}`,
    ].join('\n'),
    success: false,
    meta: {
      outcome: 'recoverable_error',
      recoveryLayer: 'model',
      failureKind: 'tool_args',
      consumesSelfHealRound: true,
    },
  };
}

export function promoteToolResultToBudgetExhausted(
  result: ToolResult,
  state: ToolLoopState,
): ToolResult {
  return {
    ...result,
    result: [
      'Tool execution outcome',
      `- Tool: ${result.name}`,
      '- Status: fatal_error',
      '- Recovery layer: user',
      '- Failure kind: budget_exhausted',
      `- Self-heal budget exhausted: ${state.usedSelfHealRounds}/${state.maxSelfHealRounds}`,
      '- Summary: The runtime will stop issuing more tool calls in this request',
      '',
      'Details:',
      result.result,
      '',
      'Do not call more tools. Explain the failure to the user and ask for guidance.',
    ].join('\n'),
    success: false,
    meta: {
      ...result.meta,
      outcome: 'fatal_error',
      recoveryLayer: 'user',
      failureKind: 'budget_exhausted',
      disableFurtherToolCalls: true,
      consumesSelfHealRound: false,
    },
  };
}
