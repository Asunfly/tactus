export function shouldRetryEmptyAssistantResponse(input: {
  content: string;
  reasoning: string;
  toolCallCount: number;
  retryCount: number;
  maxRetries: number;
}): boolean {
  const hasContent = input.content.trim().length > 0;
  const hasReasoning = input.reasoning.trim().length > 0;
  const hasToolCalls = input.toolCallCount > 0;

  return !hasContent
    && !hasReasoning
    && !hasToolCalls
    && input.retryCount < input.maxRetries;
}
