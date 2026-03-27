import { isPlaywrightBrowserTool } from './automationRisk';
import { isMcpTool, parseMcpToolName, type ToolCall } from './tools';

export function isPlaywrightMcpBrowserToolCall(toolName: string): boolean {
  if (!isMcpTool(toolName)) {
    return false;
  }

  const parsed = parseMcpToolName(toolName);
  return parsed ? isPlaywrightBrowserTool(parsed.toolName) : false;
}

export function shouldBlindRetryToolExecutionFailure(toolCall: ToolCall): boolean {
  return !isPlaywrightMcpBrowserToolCall(toolCall.name);
}
