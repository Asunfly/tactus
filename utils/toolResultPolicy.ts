import type { ToolResult } from './tools';

export function shouldContinueAfterToolResult(result: ToolResult): boolean {
  return result.name.startsWith('browser_') || result.success;
}

export function rollbackToolIterationMessages<T>(messages: T[], assistantMessageIndex: number): T[] {
  if (assistantMessageIndex < 0 || assistantMessageIndex >= messages.length) {
    return [...messages];
  }

  return messages.slice(0, assistantMessageIndex);
}
