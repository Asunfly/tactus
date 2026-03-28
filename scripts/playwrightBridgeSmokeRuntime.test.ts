import { describe, expect, it } from 'vitest';
// @ts-ignore Local ESM helper used by smoke script tests.
import { createSmokeGatewayCleanupSpec, createSmokeGatewaySpawnSpec, resolvePlaywrightRuntimeRoot } from './playwrightBridgeSmokeRuntime.mjs';

describe('createSmokeGatewaySpawnSpec', () => {
  it('在 Windows 上为 smoke 脚本生成可执行的 gateway 启动命令', () => {
    const spec = createSmokeGatewaySpawnSpec({
      platform: 'win32',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      host: '127.0.0.1',
      port: 9101,
      relayPort: 9102,
      existsSync(filePath: string) {
        return filePath === 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
      },
    });

    expect(spec).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [
        'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
        'run',
        'mcp:playwright',
        '--',
        '--host',
        '127.0.0.1',
        '--port',
        '9101',
        '--relay-port',
        '9102',
      ],
    });
  });

  it('在 Windows 上为 smoke 脚本生成整棵进程树的清理命令', () => {
    expect(createSmokeGatewayCleanupSpec({
      platform: 'win32',
      pid: 2860,
    })).toEqual({
      command: 'taskkill',
      args: ['/PID', '2860', '/T', '/F'],
    });
  });

  it('优先使用显式配置的 PLAYWRIGHT_SKILL_DIR', () => {
    const root = resolvePlaywrightRuntimeRoot({
      platform: 'win32',
      repoRoot: 'F:\\repo\\tactus',
      homeDir: 'C:\\Users\\sunfl',
      env: {
        PLAYWRIGHT_SKILL_DIR: 'D:\\custom\\playwright-skill',
      },
      existsSync(filePath: string) {
        return filePath === 'D:\\custom\\playwright-skill\\package.json';
      },
    });

    expect(root).toBe('D:\\custom\\playwright-skill');
  });

  it('没有 skill 目录时会回退到仓库本地 playwright 包', () => {
    const root = resolvePlaywrightRuntimeRoot({
      platform: 'win32',
      repoRoot: 'F:\\repo\\tactus',
      homeDir: 'C:\\Users\\sunfl',
      env: {},
      existsSync(filePath: string) {
        return filePath === 'F:\\repo\\tactus\\node_modules\\playwright\\package.json';
      },
    });

    expect(root).toBe('F:\\repo\\tactus\\node_modules\\playwright');
  });

  it('本地依赖缺失时会回退到用户目录下的 codex playwright-skill', () => {
    const root = resolvePlaywrightRuntimeRoot({
      platform: 'win32',
      repoRoot: 'F:\\repo\\tactus',
      homeDir: 'C:\\Users\\sunfl',
      env: {},
      existsSync(filePath: string) {
        return filePath === 'C:\\Users\\sunfl\\.codex\\skills\\playwright-skill\\package.json';
      },
    });

    expect(root).toBe('C:\\Users\\sunfl\\.codex\\skills\\playwright-skill');
  });
});
