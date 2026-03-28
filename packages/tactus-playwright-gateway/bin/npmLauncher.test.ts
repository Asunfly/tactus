import { describe, expect, it } from 'vitest';
// @ts-ignore Local ESM helper used by gateway wrapper tests.
import { createNpmSpawnSpec } from './npmLauncher.mjs';

describe('createNpmSpawnSpec', () => {
  it('在 Windows 上优先通过 node 直接执行 npm-cli.js，避免直接 spawn npm.cmd', () => {
    const spec = createNpmSpawnSpec({
      platform: 'win32',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['exec', '--yes', '--package=@playwright/mcp@latest', 'playwright-mcp', '--', '--help'],
      existsSync(filePath: string) {
        return filePath === 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
      },
    });

    expect(spec).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [
        'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
        'exec',
        '--yes',
        '--package=@playwright/mcp@latest',
        'playwright-mcp',
        '--',
        '--help',
      ],
    });
  });

  it('找不到 npm-cli.js 时，Windows 会退回 cmd /c npm ... 调用', () => {
    const spec = createNpmSpawnSpec({
      platform: 'win32',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      comspec: 'C:\\Windows\\System32\\cmd.exe',
      args: ['exec', '--yes', '--package=@playwright/mcp@latest', 'playwright-mcp', '--', '--help'],
      existsSync() {
        return false;
      },
    });

    expect(spec).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        'npm exec --yes --package=@playwright/mcp@latest playwright-mcp -- --help',
      ],
    });
  });

  it('在非 Windows 平台上保持直接调用 npm', () => {
    const spec = createNpmSpawnSpec({
      platform: 'linux',
      nodePath: '/usr/local/bin/node',
      args: ['exec', '--yes'],
      existsSync() {
        return false;
      },
    });

    expect(spec).toEqual({
      command: 'npm',
      args: ['exec', '--yes'],
    });
  });
});
