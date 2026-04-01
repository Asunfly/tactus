import type { McpToolCallResult } from './mcp';
import {
  appendPlaywrightSnapshotHint,
  buildPlaywrightInteractionRecoveryMessage,
  buildPlaywrightStaleRefRecoveryMessage,
  collectPlaywrightToolRefs,
  findMissingPlaywrightSnapshotRefs,
  isPlaywrightInteractionTimeoutError,
  isPlaywrightRecoverableSessionError,
  isPlaywrightStaleRefError,
  shouldPreflightPlaywrightSnapshot,
} from './playwrightToolRecovery';
import type { PlaywrightRuntimePrepareResult } from './playwrightRuntimeController';
import type { Language } from './storage';
import type { ToolCall, ToolResult } from './tools';

export interface PlaywrightToolExecutorInput {
  language: Language;
  serverId: string;
  serverName: string;
  toolName: string;
  toolCall: ToolCall;
  isInternalGatewayServer: (serverId: string) => boolean;
  executeInternalTabsTool: (serverId: string, toolCall: ToolCall) => Promise<ToolResult | null>;
  runtimeController: {
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
  reconnectServer: (serverId: string) => Promise<boolean>;
  callTool: (serverId: string, toolName: string, args: Record<string, any>) => Promise<McpToolCallResult>;
  captureSnapshot: (serverId: string) => Promise<McpToolCallResult>;
}

/**
 * Executes a Playwright browser tool.
 *
 * Responsibilities (after supervisor handles risk/logging):
 * 1. Bridge preparation (internal gateway only)
 * 2. Preflight snapshot check for stale refs
 * 3. Tool execution via MCP
 * 4. Error recovery: session error → stale ref → timeout
 */
export async function executePlaywrightTool(input: PlaywrightToolExecutorInput): Promise<ToolResult> {
  const {
    language,
    serverId,
    toolName,
    toolCall,
    isInternalGatewayServer,
    executeInternalTabsTool,
    runtimeController,
    reconnectServer,
    callTool,
    captureSnapshot,
  } = input;

  // --- Phase 1: Internal tabs tool shortcut ---
  if (isInternalGatewayServer(serverId)) {
    const tabsResult = await executeInternalTabsTool(serverId, toolCall);
    if (tabsResult) {
      return tabsResult;
    }
  }

  // --- Phase 2: Bridge preparation ---
  let internalBridgeNote: string | null = null;
  if (isInternalGatewayServer(serverId)) {
    const preparation = await runtimeController.prepareForTool(toolName, toolCall.arguments);
    if (!preparation.ok) {
      const detail = preparation.detail || preparation.note || (language === 'zh-CN'
        ? '当前 Playwright bridge 不可用。'
        : 'Playwright bridge is unavailable.');
      return {
        tool_call_id: toolCall.id,
        name: toolCall.name,
        result: detail,
        success: false,
      };
    }
    internalBridgeNote = preparation.note ?? null;
  }

  // --- Phase 3: Preflight snapshot check ---
  const referencedRefs = collectPlaywrightToolRefs(toolName, toolCall.arguments);
  if (shouldPreflightPlaywrightSnapshot(toolName, toolCall.arguments)) {
    const snapshotResult = await captureSnapshot(serverId);
    if (snapshotResult.success) {
      const missingRefs = findMissingPlaywrightSnapshotRefs(snapshotResult.content, referencedRefs);
      if (missingRefs.length > 0) {
        return {
          tool_call_id: toolCall.id,
          name: toolCall.name,
          result: buildPlaywrightStaleRefRecoveryMessage({
            toolName,
            staleRefs: missingRefs,
            snapshot: snapshotResult.content,
            language,
            stage: 'preflight',
          }),
          success: true,
        };
      }
    }
  }

  // --- Phase 4: Execute tool ---
  let mcpResult = await callTool(serverId, toolName, toolCall.arguments);

  // --- Phase 5: Error recovery chain ---
  mcpResult = await recoverSessionError(input, mcpResult, internalBridgeNote);
  const staleRefResult = await recoverStaleRef(input, mcpResult, referencedRefs);
  if (staleRefResult) return staleRefResult;
  const timeoutResult = await recoverTimeout(input, mcpResult);
  if (timeoutResult) return timeoutResult;

  // --- Phase 6: Build final result ---
  const finalContentBase = mcpResult.success
    ? appendPlaywrightSnapshotHint(toolName, mcpResult.content, language)
    : mcpResult.content;
  const finalContent = internalBridgeNote && mcpResult.success
    ? `${internalBridgeNote}\n\n${finalContentBase}`
    : finalContentBase;

  return {
    tool_call_id: toolCall.id,
    name: toolCall.name,
    result: finalContent,
    success: mcpResult.success,
  };
}

async function recoverSessionError(
  input: PlaywrightToolExecutorInput,
  mcpResult: McpToolCallResult,
  internalBridgeNote: string | null,
): Promise<McpToolCallResult> {
  if (mcpResult.success || !isPlaywrightRecoverableSessionError(mcpResult.content)) {
    return mcpResult;
  }

  const { language, serverId, toolName, toolCall, isInternalGatewayServer, runtimeController, reconnectServer, callTool } = input;

  try {
    let reconnected = false;
    if (isInternalGatewayServer(serverId)) {
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
      reconnected = true;
    } else {
      reconnected = await reconnectServer(serverId);
    }

    if (!reconnected) {
      throw new Error(language === 'zh-CN' ? '未找到可用于重连的 MCP 配置。' : 'No MCP configuration available for reconnect.');
    }

    return await callTool(serverId, toolName, toolCall.arguments);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      content: `${mcpResult.content}\n\n${language === 'zh-CN' ? '自动重连失败' : 'Automatic reconnect failed'}: ${message}`,
      isError: true,
    };
  }
}

async function recoverStaleRef(
  input: PlaywrightToolExecutorInput,
  mcpResult: McpToolCallResult,
  referencedRefs: string[],
): Promise<ToolResult | null> {
  if (mcpResult.success || !isPlaywrightStaleRefError(mcpResult.content)) {
    return null;
  }

  const snapshotResult = await input.captureSnapshot(input.serverId);
  if (!snapshotResult.success) return null;

  const staleRefMatch = mcpResult.content.match(/Ref\s+([^\s]+)\s+not found in the current page snapshot/i);
  const staleRefs = referencedRefs.length > 0
    ? referencedRefs
    : (staleRefMatch?.[1] ? [staleRefMatch[1]] : ['stale-ref']);

  return {
    tool_call_id: input.toolCall.id,
    name: input.toolCall.name,
    result: buildPlaywrightStaleRefRecoveryMessage({
      toolName: input.toolName,
      staleRefs,
      snapshot: snapshotResult.content,
      language: input.language,
      stage: 'fallback',
    }),
    success: true,
  };
}

async function recoverTimeout(
  input: PlaywrightToolExecutorInput,
  mcpResult: McpToolCallResult,
): Promise<ToolResult | null> {
  if (mcpResult.success || !isPlaywrightInteractionTimeoutError(mcpResult.content)) {
    return null;
  }

  const snapshotResult = await input.captureSnapshot(input.serverId);
  if (!snapshotResult.success) return null;

  return {
    tool_call_id: input.toolCall.id,
    name: input.toolCall.name,
    result: buildPlaywrightInteractionRecoveryMessage({
      toolName: input.toolName,
      errorMessage: mcpResult.content,
      snapshot: snapshotResult.content,
      language: input.language,
      stage: 'timeout',
    }),
    success: true,
  };
}
