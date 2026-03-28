import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
}));

vi.mock('openai', () => {
  class MockAPIError extends Error {
    status?: number;

    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }

  class MockOpenAI {
    static APIError = MockAPIError;

    chat = {
      completions: {
        create: createMock,
      },
    };
  }

  return {
    default: MockOpenAI,
  };
});

import { getLastApiMessages, streamChat } from './api';
import type { ToolExecutor } from './api';
import type { ChatMessage } from './db';

function createProvider() {
  return {
    id: 'provider-1',
    name: 'Test Provider',
    providerType: 'custom',
    baseUrl: 'https://example.com',
    apiKey: 'test-key',
    models: ['gpt-test'],
    selectedModel: 'gpt-test',
    visionModelSupport: {},
  } as any;
}

function createUserMessages(): ChatMessage[] {
  return [
    {
      role: 'user',
      content: 'Search the docs',
      timestamp: Date.now(),
    },
  ];
}

function createToolCallChunk() {
  return {
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id: 'call_1',
          function: {
            name: 'mcp__remote__search_docs',
            arguments: '{"query":"test"}',
          },
        }],
      },
    }],
  };
}

function createContentChunk(content: string) {
  return {
    choices: [{
      delta: {
        content,
      },
    }],
  };
}

async function* createStream(chunks: any[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function collectEvents(input: Parameters<typeof streamChat>) {
  const events: any[] = [];
  for await (const event of streamChat(...input)) {
    events.push(event);
  }
  return events;
}

describe('streamChat self-healing tool loop', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('会把 recoverable tool result 保留给下一轮模型，而不是剔除上下文盲重试', async () => {
    createMock
      .mockResolvedValueOnce(createStream([createToolCallChunk()]))
      .mockResolvedValueOnce(createStream([createContentChunk('I saw the failure and will adjust.')]));;

    const toolExecutor: ToolExecutor = vi.fn(async () => ({
      tool_call_id: 'call_1',
      name: 'mcp__remote__search_docs',
      result: 'Tool execution outcome\n- Status: recoverable_error\n\nDetails:\nFailed to fetch',
      success: false,
      meta: {
        outcome: 'recoverable_error' as const,
        recoveryLayer: 'model' as const,
        failureKind: 'transport' as const,
        consumesSelfHealRound: true,
      },
    }));

    await collectEvents([
      createProvider(),
      createUserMessages(),
      undefined,
      {
        enableTools: true,
        toolExecutor,
        maxIterations: 4,
        maxToolCalls: 5,
        maxSelfHealRounds: 3,
      },
    ]);

    expect(createMock).toHaveBeenCalledTimes(2);
    const secondRequest = createMock.mock.calls[1][0];
    const secondMessages = secondRequest.messages as Array<{ role: string; content?: unknown }>;
    expect(secondMessages.some(message =>
      message.role === 'tool' && String(message.content).includes('recoverable_error'),
    )).toBe(true);
    expect(getLastApiMessages().some(message =>
      message.role === 'tool' && String(message.content).includes('recoverable_error'),
    )).toBe(true);
  });

  it('自愈预算耗尽后下一轮会禁用工具，只允许模型输出解释', async () => {
    createMock
      .mockResolvedValueOnce(createStream([createToolCallChunk()]))
      .mockResolvedValueOnce(createStream([createContentChunk('Tool budget exhausted, please review the failure.')]));;

    const toolExecutor: ToolExecutor = vi.fn(async () => ({
      tool_call_id: 'call_1',
      name: 'mcp__remote__search_docs',
      result: 'Tool execution outcome\n- Status: recoverable_error\n\nDetails:\nFailed to fetch',
      success: false,
      meta: {
        outcome: 'recoverable_error' as const,
        recoveryLayer: 'model' as const,
        failureKind: 'transport' as const,
        consumesSelfHealRound: true,
      },
    }));

    await collectEvents([
      createProvider(),
      createUserMessages(),
      undefined,
      {
        enableTools: true,
        toolExecutor,
        maxIterations: 4,
        maxToolCalls: 5,
        maxSelfHealRounds: 1,
      },
    ]);

    expect(createMock).toHaveBeenCalledTimes(2);
    const secondRequest = createMock.mock.calls[1][0];
    expect(secondRequest.tools).toBeUndefined();
    const secondMessages = secondRequest.messages as Array<{ role: string; content?: unknown }>;
    expect(secondMessages.some(message =>
      message.role === 'tool' && String(message.content).includes('budget_exhausted'),
    )).toBe(true);
  });
});
