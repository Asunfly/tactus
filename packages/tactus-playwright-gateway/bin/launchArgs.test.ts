import { describe, expect, it } from 'vitest';
// @ts-ignore Local ESM helper used by gateway wrapper tests.
import { buildGatewayForwardedArgs } from './launchArgs.mjs';

describe('buildGatewayForwardedArgs', () => {
  it('默认不会强制注入 shared browser context', () => {
    const args = buildGatewayForwardedArgs({
      rawArgs: [],
      cdpEndpoint: 'ws://127.0.0.1:8932/cdp',
      mcpPort: '8931',
      host: 'localhost',
    });

    expect(args).toEqual([
      '--host',
      'localhost',
      '--port',
      '8931',
      '--cdp-endpoint',
      'ws://127.0.0.1:8932/cdp',
    ]);
    expect(args).not.toContain('--shared-browser-context');
  });

  it('保留调用方显式传入的 shared browser context 参数', () => {
    const args = buildGatewayForwardedArgs({
      rawArgs: ['--shared-browser-context'],
      cdpEndpoint: 'ws://127.0.0.1:8932/cdp',
      mcpPort: '8931',
      host: 'localhost',
    });

    expect(args).toContain('--shared-browser-context');
  });
});
