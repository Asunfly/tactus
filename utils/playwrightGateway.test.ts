import { describe, expect, it } from 'vitest';
import {
  PLAYWRIGHT_GATEWAY_DEFAULT_NAME,
  PLAYWRIGHT_GATEWAY_PACKAGE_NAME,
  PLAYWRIGHT_GATEWAY_DEFAULT_URL,
  PLAYWRIGHT_GATEWAY_FALLBACK_URLS,
  PLAYWRIGHT_GATEWAY_DEFAULT_RELAY_PORT,
  buildPlaywrightGatewayBackgroundCommand,
  buildPlaywrightGatewayStopHint,
  buildPlaywrightGatewayCommand,
  createPlaywrightGatewayServerConfig,
  findPlaywrightGatewayServer,
  getPlaywrightGatewayRuntimeServer,
  normalizePlaywrightGatewayServer,
} from './playwrightGateway';

describe('createPlaywrightGatewayServerConfig', () => {
  it('生成默认的本地 Playwright gateway 配置', () => {
    const server = createPlaywrightGatewayServerConfig('server-1');

    expect(server).toMatchObject({
      id: 'server-1',
      name: PLAYWRIGHT_GATEWAY_DEFAULT_NAME,
      url: PLAYWRIGHT_GATEWAY_DEFAULT_URL,
      authType: 'none',
      enabled: true,
    });
  });
});

describe('buildPlaywrightGatewayCommand', () => {
  it('生成默认启动命令', () => {
    expect(buildPlaywrightGatewayCommand()).toBe(`npx -y ${PLAYWRIGHT_GATEWAY_PACKAGE_NAME} --host localhost --port 8931 --relay-port 8932`);
  });

  it('在自定义端口时追加参数', () => {
    expect(buildPlaywrightGatewayCommand(9011, 9012)).toBe(`npx -y ${PLAYWRIGHT_GATEWAY_PACKAGE_NAME} --host localhost --port 9011 --relay-port 9012`);
  });
});

describe('buildPlaywrightGatewayBackgroundCommand', () => {
  it('生成 macOS 后台启动命令', () => {
    expect(buildPlaywrightGatewayBackgroundCommand('darwin')).toBe(`nohup npx -y ${PLAYWRIGHT_GATEWAY_PACKAGE_NAME} --host localhost --port 8931 --relay-port 8932 > ~/playwright-mcp.log 2>&1 &`);
  });

  it('生成 Windows PowerShell 后台启动命令', () => {
    expect(buildPlaywrightGatewayBackgroundCommand('win32')).toBe(`Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','npx -y ${PLAYWRIGHT_GATEWAY_PACKAGE_NAME} --host localhost --port 8931 --relay-port 8932'`);
  });
});

describe('buildPlaywrightGatewayStopHint', () => {
  it('生成 macOS 一键停止命令', () => {
    expect(buildPlaywrightGatewayStopHint('darwin')).toBe('PID=$(lsof -ti :8931 -ti :8932 | sort -u) && [ -n "$PID" ] && kill $PID');
  });

  it('生成 Windows 一键停止命令', () => {
    expect(buildPlaywrightGatewayStopHint('win32')).toBe("$pids = @(Get-NetTCPConnection -LocalPort 8931,8932 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if ($pids) { $pids | ForEach-Object { Stop-Process -Id $_ } }");
  });
});

describe('findPlaywrightGatewayServer', () => {
  it('优先按默认地址识别已存在的 gateway', () => {
    const server = findPlaywrightGatewayServer([
      {
        id: 'custom-1',
        name: 'Local Playwright Gateway',
        url: PLAYWRIGHT_GATEWAY_DEFAULT_URL,
        authType: 'none',
        enabled: true,
      },
      {
        id: 'other',
        name: 'Other',
        url: 'http://127.0.0.1:3000/mcp',
        authType: 'none',
        enabled: true,
      },
    ]);

    expect(server?.id).toBe('custom-1');
  });

  it('兼容识别 127.0.0.1 形式的旧配置', () => {
    const server = findPlaywrightGatewayServer([
      {
        id: 'legacy-127',
        name: 'Legacy',
        url: PLAYWRIGHT_GATEWAY_FALLBACK_URLS[0],
        authType: 'none',
        enabled: true,
      },
    ]);

    expect(server?.id).toBe('legacy-127');
  });
});

describe('playwright relay defaults', () => {
  it('使用固定 relay 端口', () => {
    expect(PLAYWRIGHT_GATEWAY_DEFAULT_RELAY_PORT).toBe(8932);
  });
});

describe('normalizePlaywrightGatewayServer', () => {
  it('会把旧的 127.0.0.1 地址规范到 localhost', () => {
    const server = normalizePlaywrightGatewayServer({
      id: 'legacy-127',
      name: 'Legacy',
      url: PLAYWRIGHT_GATEWAY_FALLBACK_URLS[0],
      authType: 'none',
      enabled: true,
    });

    expect(server.url).toBe(PLAYWRIGHT_GATEWAY_DEFAULT_URL);
  });
});

describe('getPlaywrightGatewayRuntimeServer', () => {
  it('当没有用户配置时返回内置本地 gateway', () => {
    const server = getPlaywrightGatewayRuntimeServer([]);

    expect(server).toMatchObject({
      id: 'builtin-playwright-gateway',
      url: PLAYWRIGHT_GATEWAY_DEFAULT_URL,
      enabled: true,
    });
  });

  it('优先使用用户已配置且启用的 gateway', () => {
    const server = getPlaywrightGatewayRuntimeServer([
      {
        id: 'saved-playwright',
        name: PLAYWRIGHT_GATEWAY_DEFAULT_NAME,
        url: PLAYWRIGHT_GATEWAY_DEFAULT_URL,
        authType: 'none',
        enabled: true,
      },
    ]);

    expect(server?.id).toBe('saved-playwright');
  });

  it('对旧的 127.0.0.1 配置返回规范化后的 localhost 地址', () => {
    const server = getPlaywrightGatewayRuntimeServer([
      {
        id: 'legacy-127',
        name: PLAYWRIGHT_GATEWAY_DEFAULT_NAME,
        url: PLAYWRIGHT_GATEWAY_FALLBACK_URLS[0],
        authType: 'none',
        enabled: true,
      },
    ]);

    expect(server?.url).toBe(PLAYWRIGHT_GATEWAY_DEFAULT_URL);
  });

  it('如果用户显式禁用已配置 gateway，则不启用内置自动接入', () => {
    const server = getPlaywrightGatewayRuntimeServer([
      {
        id: 'saved-playwright',
        name: PLAYWRIGHT_GATEWAY_DEFAULT_NAME,
        url: PLAYWRIGHT_GATEWAY_DEFAULT_URL,
        authType: 'none',
        enabled: false,
      },
    ]);

    expect(server).toBeNull();
  });
});
