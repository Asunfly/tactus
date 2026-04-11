import { describe, expect, it } from 'vitest';

import { shouldRetryEmptyAssistantResponse } from './assistantResponsePolicy';

describe('assistantResponsePolicy', () => {
  it('retries when the assistant turn is completely empty', () => {
    expect(shouldRetryEmptyAssistantResponse({
      content: '',
      reasoning: '',
      toolCallCount: 0,
      retryCount: 0,
      maxRetries: 2,
    })).toBe(true);
  });

  it('does not retry once empty-response retries are exhausted', () => {
    expect(shouldRetryEmptyAssistantResponse({
      content: '',
      reasoning: '',
      toolCallCount: 0,
      retryCount: 2,
      maxRetries: 2,
    })).toBe(false);
  });

  it('does not retry when the assistant already produced content, reasoning, or tool calls', () => {
    expect(shouldRetryEmptyAssistantResponse({
      content: 'done',
      reasoning: '',
      toolCallCount: 0,
      retryCount: 0,
      maxRetries: 2,
    })).toBe(false);

    expect(shouldRetryEmptyAssistantResponse({
      content: '',
      reasoning: 'thinking',
      toolCallCount: 0,
      retryCount: 0,
      maxRetries: 2,
    })).toBe(false);

    expect(shouldRetryEmptyAssistantResponse({
      content: '',
      reasoning: '',
      toolCallCount: 1,
      retryCount: 0,
      maxRetries: 2,
    })).toBe(false);
  });
});
