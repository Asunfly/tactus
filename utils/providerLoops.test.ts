import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolExecutor } from './api';
import type { ChatMessage } from './db';
import { streamChatAnthropic } from './anthropic';
import { streamChatGemini } from './gemini';

function createProvider(providerType: 'anthropic' | 'gemini') {
  return {
    id: `${providerType}-provider`,
    name: providerType,
    providerType,
    baseUrl: 'https://example.com',
    apiKey: 'test-key',
    models: ['model-test'],
    selectedModel: 'model-test',
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

function createAnthropicSseResponse(events: Array<{ event: string; data: Record<string, any> }>) {
  const payload = events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(payload, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
    },
  });
}

function createGeminiSseResponse(chunks: Record<string, any>[]) {
  const payload = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('');
  return new Response(payload, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
    },
  });
}

async function collectEvents<T>(generator: AsyncGenerator<T, void, unknown>) {
  const events: T[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('provider tool loops', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Anthropic 会把 recoverable tool result 保留给下一轮模型，并在预算耗尽时禁用工具', async () => {
    fetchMock
      .mockResolvedValueOnce(createAnthropicSseResponse([
        {
          event: 'content_block_start',
          data: { index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'mcp__remote__search_docs' } },
        },
        {
          event: 'content_block_delta',
          data: { index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"test"}' } },
        },
        {
          event: 'content_block_stop',
          data: { index: 0 },
        },
      ]))
      .mockResolvedValueOnce(createAnthropicSseResponse([
        {
          event: 'content_block_delta',
          data: { index: 0, delta: { type: 'text_delta', text: 'Budget exhausted, explain to the user.' } },
        },
      ]));

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

    await collectEvents(streamChatAnthropic(
      createProvider('anthropic'),
      createUserMessages(),
      undefined,
      {
        enableTools: true,
        toolExecutor,
        maxIterations: 4,
        maxToolCalls: 5,
        maxSelfHealRounds: 1,
      },
    ));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(secondBody.tools).toBeUndefined();
    expect(JSON.stringify(secondBody.messages)).toContain('recoverable_error');
    expect(JSON.stringify(secondBody.messages)).toContain('budget_exhausted');
  });

  it('Gemini 会把 recoverable tool result 保留给下一轮模型，并在预算耗尽时禁用工具', async () => {
    fetchMock
      .mockResolvedValueOnce(createGeminiSseResponse([
        {
          candidates: [{
            content: {
              role: 'model',
              parts: [{
                functionCall: {
                  name: 'mcp__remote__search_docs',
                  args: { query: 'test' },
                },
              }],
            },
          }],
        },
      ]))
      .mockResolvedValueOnce(createGeminiSseResponse([
        {
          candidates: [{
            content: {
              role: 'model',
              parts: [{ text: 'Budget exhausted, explain to the user.' }],
            },
          }],
        },
      ]));

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

    await collectEvents(streamChatGemini(
      createProvider('gemini'),
      createUserMessages(),
      undefined,
      {
        enableTools: true,
        toolExecutor,
        maxIterations: 4,
        maxToolCalls: 5,
        maxSelfHealRounds: 1,
      },
    ));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(secondBody.tools).toBeUndefined();
    expect(JSON.stringify(secondBody.contents)).toContain('recoverable_error');
    expect(JSON.stringify(secondBody.contents)).toContain('budget_exhausted');
  });
});
