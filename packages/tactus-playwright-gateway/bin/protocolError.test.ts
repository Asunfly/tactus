import { describe, expect, it } from 'vitest';
// @ts-ignore Local ESM helper used by gateway wrapper tests.
import { normalizePlaywrightProtocolError } from './protocolError.mjs';

describe('normalizePlaywrightProtocolError', () => {
  it('把上下文已失效的协议错误降级为 Playwright 可忽略的 -32001', () => {
    expect(normalizePlaywrightProtocolError(
      new Error('{"code":-32000,"message":"Cannot find context with specified id"}'),
    )).toEqual({
      code: -32001,
      message: 'Cannot find context with specified id',
    });
  });

  it('保留其他已结构化协议错误的原始 code', () => {
    expect(normalizePlaywrightProtocolError(
      new Error('{"code":-32601,"message":"Method not found"}'),
    )).toEqual({
      code: -32601,
      message: 'Method not found',
    });
  });

  it('普通错误保持 message 透传', () => {
    expect(normalizePlaywrightProtocolError(new Error('boom'))).toEqual({
      message: 'boom',
    });
  });
});
