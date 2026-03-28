import { assessAutomationAction } from './automationRisk';
import type {
  Language,
  ToolCall,
  ToolExecutionContext,
  ToolResult,
} from './tools';

type LogStatus = 'pending_confirmation' | 'running' | 'success' | 'error' | 'cancelled';

export interface ToolExecutionSupervisorInput {
  language: Language;
  toolCall: ToolCall;
  context: ToolExecutionContext;
  createLogEntry: (entry: {
    toolName: string;
    serverName?: string;
    summary: string;
    riskLevel: 'low' | 'medium' | 'high';
    status: LogStatus;
    detail?: string;
  }) => string;
  updateLogEntry: (
    logId: string,
    patch: {
      status?: LogStatus;
      detail?: string;
    },
  ) => void;
  buildAutomationDetail: (detail: string) => string;
  requestAutomationConfirmation?: (
    assessment: ReturnType<typeof assessAutomationAction>,
  ) => Promise<boolean>;
  executeRawTool: (
    toolCall: ToolCall,
    context: ToolExecutionContext,
  ) => Promise<ToolResult>;
}

export async function executeToolWithSupervisor(
  input: ToolExecutionSupervisorInput,
): Promise<ToolResult> {
  const assessment = assessAutomationAction(
    input.toolCall.name,
    input.toolCall.arguments,
    { inSelfHealMode: input.context.inSelfHealMode },
  );

  const logId = input.createLogEntry({
    toolName: input.toolCall.name,
    summary: assessment.summary,
    riskLevel: assessment.riskLevel,
    status: assessment.requiresConfirmation ? 'pending_confirmation' : 'running',
    detail: assessment.reason,
  });

  if (assessment.requiresConfirmation) {
    const confirmed = input.requestAutomationConfirmation
      ? await input.requestAutomationConfirmation(assessment)
      : true;

    if (!confirmed) {
      const rejectedResult: ToolResult = {
        tool_call_id: input.toolCall.id,
        name: input.toolCall.name,
        result: buildFatalObservation({
          toolCall: input.toolCall,
          language: input.language,
          failureKind: 'user_cancelled',
          summary: input.language === 'zh-CN'
            ? '用户拒绝了自愈阶段的二次确认'
            : 'The user rejected the retry confirmation',
          details: input.language === 'zh-CN'
            ? '当前工具位于自愈回合中，用户拒绝再次执行。请不要继续自动重试，直接向用户解释并等待进一步指令。'
            : 'The tool is in a self-healing round and the user rejected the retry. Do not retry automatically; explain the failure and wait for user guidance.',
          riskLevel: assessment.riskLevel,
        }),
        success: false,
        meta: {
          outcome: 'fatal_error',
          recoveryLayer: 'user',
          failureKind: 'user_cancelled',
          disableFurtherToolCalls: true,
          riskLevel: assessment.riskLevel,
        },
      };

      input.updateLogEntry(logId, {
        status: 'cancelled',
        detail: input.buildAutomationDetail(rejectedResult.result),
      });
      return rejectedResult;
    }

    input.updateLogEntry(logId, {
      status: 'running',
      detail: input.language === 'zh-CN' ? '用户已确认，继续执行。' : 'User confirmed. Continuing.',
    });
  }

  const rawResult = await input.executeRawTool(input.toolCall, input.context);
  const normalizedResult = normalizeToolResult(rawResult, input.toolCall, input.context, input.language, assessment);

  input.updateLogEntry(logId, {
    status: normalizedResult.success ? 'success' : 'error',
    detail: input.buildAutomationDetail(normalizedResult.result),
  });

  return normalizedResult;
}

function normalizeToolResult(
  rawResult: ToolResult,
  toolCall: ToolCall,
  context: ToolExecutionContext,
  language: Language,
  assessment: ReturnType<typeof assessAutomationAction>,
): ToolResult {
  if (rawResult.success) {
    return {
      ...rawResult,
      meta: {
        outcome: 'success',
        recoveryLayer: 'runtime',
        riskLevel: assessment.riskLevel,
        ...rawResult.meta,
      },
    };
  }

  if (rawResult.meta?.outcome === 'fatal_error') {
    return {
      ...rawResult,
      meta: {
        riskLevel: assessment.riskLevel,
        ...rawResult.meta,
      },
    };
  }

  return {
    ...rawResult,
    result: buildRecoverableObservation({
      toolCall,
      language,
      context,
      summary: assessment.summary,
      details: rawResult.result,
    }),
    meta: {
      outcome: 'recoverable_error',
      recoveryLayer: 'model',
      failureKind: rawResult.meta?.failureKind ?? 'tool_runtime',
      consumesSelfHealRound: rawResult.meta?.consumesSelfHealRound ?? true,
      requiresRetryConfirmation: assessment.requiresConfirmation,
      riskLevel: assessment.riskLevel,
      ...rawResult.meta,
    },
  };
}

function buildRecoverableObservation(input: {
  toolCall: ToolCall;
  language: Language;
  context: ToolExecutionContext;
  summary: string;
  details: string;
}): string {
  const nextRound = Math.min(input.context.selfHealRound + 1, input.context.maxSelfHealRounds);
  return [
    'Tool execution outcome',
    `- Tool: ${input.toolCall.name}`,
    '- Status: recoverable_error',
    '- Recovery layer: model',
    '- Failure kind: tool_runtime',
    `- Self-heal round: ${nextRound}/${input.context.maxSelfHealRounds}`,
    `- Summary: ${input.summary}`,
    '- Recommended next actions:',
    '  - inspect the latest observation',
    '  - adjust arguments if needed',
    '  - choose a different tool if this tool is no longer suitable',
    '  - request user confirmation before retrying a side-effect action',
    '',
    'Details:',
    input.details,
  ].join('\n');
}

function buildFatalObservation(input: {
  toolCall: ToolCall;
  language: Language;
  failureKind: NonNullable<ToolResult['meta']>['failureKind'];
  summary: string;
  details: string;
  riskLevel: 'low' | 'medium' | 'high';
}): string {
  return [
    'Tool execution outcome',
    `- Tool: ${input.toolCall.name}`,
    '- Status: fatal_error',
    '- Recovery layer: user',
    `- Failure kind: ${input.failureKind}`,
    `- Summary: ${input.summary}`,
    `- Risk level: ${input.riskLevel}`,
    '',
    'Details:',
    input.details,
  ].join('\n');
}
