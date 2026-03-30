import { assessAutomationAction, type AutomationActionAssessment, type AutomationRiskLevel } from './automationRisk';
import type { McpToolCallResult } from './mcp';
import {
  appendPlaywrightSnapshotHint,
  buildPlaywrightInteractionRecoveryMessage,
  buildPlaywrightStaleRefRecoveryMessage,
  collectPlaywrightToolRefs,
  findMissingPlaywrightSnapshotRefs,
  isPlaywrightInteractionTimeoutError,
  isPlaywrightMissingPageError,
  isPlaywrightRecoverableSessionError,
  isPlaywrightStaleRefError,
  shouldPreflightPlaywrightSnapshot,
} from './playwrightToolRecovery';
import type { PlaywrightRuntimePrepareResult } from './playwrightRuntimeController';
import type { Language } from './storage';
import type { ToolCall, ToolExecutionContext, ToolResult } from './tools';

export type PlaywrightAutomationLogStatus =
  | 'pending_confirmation'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled';

export interface PlaywrightAutomationLogEntryInput {
  toolName: string;
  serverName: string;
  summary: string;
  riskLevel: AutomationRiskLevel;
  status: PlaywrightAutomationLogStatus;
  detail: string;
}

export interface PlaywrightAutomationLogEntryPatch {
  status?: PlaywrightAutomationLogStatus;
  detail?: string;
}

export interface PlaywrightInternalBridgePreparation {
  ok: boolean;
  note?: string;
  detail?: string;
}

export interface PlaywrightToolExecutorInput {
  language: Language;
  executionContext?: ToolExecutionContext;
  serverId: string;
  serverName: string;
  toolName: string;
  toolCall: ToolCall;
  createLogEntry: (entry: PlaywrightAutomationLogEntryInput) => string;
  updateLogEntry: (logId: string, patch: PlaywrightAutomationLogEntryPatch) => void;
  buildAutomationDetail: (detail: string) => string;
  requestAutomationConfirmation?: (assessment: AutomationActionAssessment) => Promise<boolean>;
  isInternalGatewayServer: (serverId: string) => boolean;
  executeInternalTabsTool: (serverId: string, toolCall: ToolCall, logId: string) => Promise<ToolResult | null>;
  ensureInternalBridgeForTool: (
    toolName: string,
    toolArguments?: Record<string, any>,
  ) => Promise<PlaywrightInternalBridgePreparation | void>;
  runtimeController?: {
    prepareForTool: (
      toolName: string,
      toolArguments?: Record<string, any>,
    ) => Promise<PlaywrightRuntimePrepareResult>;
    recoverForSessionError: (
      toolName: string,
      toolArguments: Record<string, any> | undefined,
      errorMessage: string,
    ) => Promise<PlaywrightRuntimePrepareResult>;
  };
  ensureInternalGatewayReady: (forceReconnect: boolean) => Promise<void>;
  recoverMissingPage: () => Promise<void>;
  reconnectServer: (serverId: string) => Promise<boolean>;
  callTool: (serverId: string, toolName: string, args: Record<string, any>) => Promise<McpToolCallResult>;
  captureSnapshot: (serverId: string) => Promise<McpToolCallResult>;
}

export async function executePlaywrightTool(input: PlaywrightToolExecutorInput): Promise<ToolResult> {
  const {
    language,
    executionContext,
    serverId,
    serverName,
    toolName,
    toolCall,
    createLogEntry,
    updateLogEntry,
    buildAutomationDetail,
    requestAutomationConfirmation,
    isInternalGatewayServer,
    executeInternalTabsTool,
    ensureInternalBridgeForTool,
    runtimeController,
    ensureInternalGatewayReady,
    recoverMissingPage,
    reconnectServer,
    callTool,
    captureSnapshot,
  } = input;

  const assessment = assessAutomationAction(toolName, toolCall.arguments, {
    inSelfHealMode: executionContext?.inSelfHealMode ?? false,
  });
  const logId = createLogEntry({
    toolName,
    serverName,
    summary: assessment.summary,
    riskLevel: assessment.riskLevel,
    status: assessment.requiresConfirmation ? 'pending_confirmation' : 'running',
    detail: assessment.reason,
  });

  if (assessment.requiresConfirmation) {
    const confirmed = requestAutomationConfirmation
      ? await requestAutomationConfirmation(assessment)
      : true;
    if (!confirmed) {
      updateLogEntry(logId, {
        status: 'cancelled',
        detail: language === 'zh-CN' ? '用户取消了该高风险操作。' : 'User cancelled this high-risk action.',
      });
      return {
        tool_call_id: toolCall.id,
        name: toolCall.name,
        result: language === 'zh-CN'
          ? '用户取消了该高风险自动化操作，请不要自动重试，除非用户再次明确要求继续。'
          : 'User cancelled this high-risk automation action. Do not retry unless the user explicitly asks to continue.',
        success: true,
      };
    }

    updateLogEntry(logId, {
      status: 'running',
      detail: language === 'zh-CN' ? '用户已确认，正在执行。' : 'User confirmed. Running now.',
    });
  }

  let internalBridgeNote: string | null = null;
  if (isInternalGatewayServer(serverId)) {
    try {
      const tabsResult = await executeInternalTabsTool(serverId, toolCall, logId);
      if (tabsResult) {
        return tabsResult;
      }
      const preparation = runtimeController
        ? await runtimeController.prepareForTool(toolName, toolCall.arguments)
        : await ensureInternalBridgeForTool(toolName, toolCall.arguments);
      if (preparation && preparation.ok === false) {
        const detail = preparation.detail || preparation.note || (language === 'zh-CN'
          ? '当前 Playwright bridge 不可用。'
          : 'Playwright bridge is unavailable.');
        updateLogEntry(logId, {
          status: 'error',
          detail,
        });
        return {
          tool_call_id: toolCall.id,
          name: toolCall.name,
          result: detail,
          success: false,
        };
      }
      internalBridgeNote = preparation?.note ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateLogEntry(logId, {
        status: 'error',
        detail: message,
      });
      return {
        tool_call_id: toolCall.id,
        name: toolCall.name,
        result: `工具调用失败: ${message}`,
        success: false,
      };
    }
  }

  const referencedRefs = collectPlaywrightToolRefs(toolName, toolCall.arguments);
  if (shouldPreflightPlaywrightSnapshot(toolName, toolCall.arguments)) {
    const snapshotResult = await captureSnapshot(serverId);
    if (snapshotResult.success) {
      const missingRefs = findMissingPlaywrightSnapshotRefs(snapshotResult.content, referencedRefs);
      if (missingRefs.length > 0) {
        const recoveryMessage = buildPlaywrightStaleRefRecoveryMessage({
          toolName,
          staleRefs: missingRefs,
          snapshot: snapshotResult.content,
          language,
          stage: 'preflight',
        });
        updateLogEntry(logId, {
          status: 'success',
          detail: language === 'zh-CN'
            ? '检测到旧 ref 已过期，已返回最新页面快照供后续继续。'
            : 'Detected stale refs before execution and returned the latest page snapshot.',
        });
        return {
          tool_call_id: toolCall.id,
          name: toolCall.name,
          result: recoveryMessage,
          success: true,
        };
      }
    }
  }

  let mcpResult = await callTool(serverId, toolName, toolCall.arguments);
  let recoveredSession = false;

  if (!mcpResult.success && isPlaywrightRecoverableSessionError(mcpResult.content)) {
    try {
      let reconnected = false;
      if (isInternalGatewayServer(serverId)) {
        if (runtimeController) {
          const recovery = await runtimeController.recoverForSessionError(
            toolName,
            toolCall.arguments,
            mcpResult.content,
          );
          if (!recovery.ok) {
            throw new Error(recovery.detail || (language === 'zh-CN'
              ? '当前 Playwright runtime 无法恢复执行。'
              : 'The Playwright runtime could not recover execution.'));
          }
          internalBridgeNote = recovery.note ?? internalBridgeNote;
        } else {
          if (isPlaywrightMissingPageError(mcpResult.content)) {
            await recoverMissingPage();
          }
          await ensureInternalGatewayReady(true);
        }
        reconnected = true;
      } else {
        reconnected = await reconnectServer(serverId);
      }
      if (!reconnected) {
        throw new Error(language === 'zh-CN' ? '未找到可用于重连的 MCP 配置。' : 'No MCP configuration available for reconnect.');
      }
      mcpResult = await callTool(serverId, toolName, toolCall.arguments);
      recoveredSession = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mcpResult = {
        success: false,
        content: `${mcpResult.content}\n\n${language === 'zh-CN' ? '自动重连失败' : 'Automatic reconnect failed'}: ${message}`,
        isError: true,
      };
    }
  }

  if (!mcpResult.success && isPlaywrightStaleRefError(mcpResult.content)) {
    const snapshotResult = await captureSnapshot(serverId);
    if (snapshotResult.success) {
      const staleRefMatch = mcpResult.content.match(/Ref\s+([^\s]+)\s+not found in the current page snapshot/i);
      const staleRefs = referencedRefs.length > 0
        ? referencedRefs
        : (staleRefMatch?.[1] ? [staleRefMatch[1]] : ['stale-ref']);
      const recoveryMessage = buildPlaywrightStaleRefRecoveryMessage({
        toolName,
        staleRefs,
        snapshot: snapshotResult.content,
        language,
        stage: 'fallback',
      });
      updateLogEntry(logId, {
        status: 'success',
        detail: language === 'zh-CN'
          ? '命中 stale ref，已自动补抓最新页面快照供后续继续。'
          : 'Recovered from a stale ref by capturing the latest page snapshot.',
      });
      return {
        tool_call_id: toolCall.id,
        name: toolCall.name,
        result: recoveryMessage,
        success: true,
      };
    }
  }

  if (!mcpResult.success && isPlaywrightInteractionTimeoutError(mcpResult.content)) {
    const snapshotResult = await captureSnapshot(serverId);
    if (snapshotResult.success) {
      const recoveryMessage = buildPlaywrightInteractionRecoveryMessage({
        toolName,
        errorMessage: mcpResult.content,
        snapshot: snapshotResult.content,
        language,
        stage: 'timeout',
      });
      updateLogEntry(logId, {
        status: 'success',
        detail: language === 'zh-CN'
          ? '检测到交互超时，已返回最新页面快照供模型重新判断下一步。'
          : 'Detected an interaction timeout and returned the latest page snapshot for re-planning.',
      });
      return {
        tool_call_id: toolCall.id,
        name: toolCall.name,
        result: recoveryMessage,
        success: true,
      };
    }
  }

  const finalContentBase = mcpResult.success
    ? appendPlaywrightSnapshotHint(toolName, mcpResult.content, language)
    : mcpResult.content;
  const finalContent = internalBridgeNote && mcpResult.success
    ? `${internalBridgeNote}\n\n${finalContentBase}`
    : finalContentBase;

  updateLogEntry(logId, {
    status: mcpResult.success ? 'success' : 'error',
    detail: buildAutomationDetail(
      recoveredSession && mcpResult.success
        ? `${language === 'zh-CN' ? '已自动重连后继续执行。' : 'Automatically reconnected before continuing.'}\n${finalContent}`
        : finalContent,
    ),
  });

  return {
    tool_call_id: toolCall.id,
    name: toolCall.name,
    result: finalContent,
    success: mcpResult.success,
  };
}
