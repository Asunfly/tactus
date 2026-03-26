import { describe, expect, it } from 'vitest';
import {
  PLAYWRIGHT_GATEWAY_DEFAULT_NAME,
  PLAYWRIGHT_GATEWAY_DEFAULT_URL,
  PLAYWRIGHT_GATEWAY_FALLBACK_URLS,
  PLAYWRIGHT_MCP_BRIDGE_EXTENSION_URL,
  buildPlaywrightGatewayBackgroundCommand,
  buildPlaywrightGatewayLaunchCommand,
  buildPlaywrightGatewayStopHint,
  buildPlaywrightGatewayCommand,
  createPlaywrightGatewayServerConfig,
  findPlaywrightGatewayServer,
  getPlaywrightGatewayRuntimeServer,
  normalizePlaywrightExtensionToken,
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
    expect(buildPlaywrightGatewayCommand()).toBe('npx -y @playwright/mcp@latest --extension --host localhost --port 8931 --shared-browser-context');
  });

  it('在自定义端口时追加参数', () => {
    expect(buildPlaywrightGatewayCommand(9011)).toBe('npx -y @playwright/mcp@latest --extension --host localhost --port 9011 --shared-browser-context');
  });
});

describe('buildPlaywrightGatewayBackgroundCommand', () => {
  it('生成 macOS 后台启动命令', () => {
    expect(buildPlaywrightGatewayBackgroundCommand('darwin')).toBe('nohup npx -y @playwright/mcp@latest --extension --host localhost --port 8931 --shared-browser-context > ~/playwright-mcp.log 2>&1 &');
  });

  it('生成 Windows PowerShell 后台启动命令', () => {
    expect(buildPlaywrightGatewayBackgroundCommand('win32')).toBe('Start-Process powershell -WindowStyle Hidden -ArgumentList \'-NoProfile\',\'-Command\',\'npx -y @playwright/mcp@latest --extension --host localhost --port 8931 --shared-browser-context\'');
  });

  it('在 macOS 后台命令中注入扩展 token', () => {
    expect(buildPlaywrightGatewayBackgroundCommand('darwin', 8931, 'PLAYWRIGHT_MCP_EXTENSION_TOKEN=abc123')).toBe(
      "PLAYWRIGHT_MCP_EXTENSION_TOKEN='abc123' nohup npx -y @playwright/mcp@latest --extension --host localhost --port 8931 --shared-browser-context > ~/playwright-mcp.log 2>&1 &",
    );
  });

  it('在 Windows 后台命令中注入扩展 token', () => {
    expect(buildPlaywrightGatewayBackgroundCommand('win32', 8931, 'abc123')).toBe(
      "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','$env:PLAYWRIGHT_MCP_EXTENSION_TOKEN=''abc123''; npx -y @playwright/mcp@latest --extension --host localhost --port 8931 --shared-browser-context'",
    );
  });
});

describe('buildPlaywrightGatewayLaunchCommand', () => {
  it('生成 macOS 前台启动命令并带上扩展 token', () => {
    expect(buildPlaywrightGatewayLaunchCommand('darwin', 8931, 'PLAYWRIGHT_MCP_EXTENSION_TOKEN=abc123')).toBe(
      "PLAYWRIGHT_MCP_EXTENSION_TOKEN='abc123' npx -y @playwright/mcp@latest --extension --host localhost --port 8931 --shared-browser-context",
    );
  });

  it('生成 Windows 前台启动命令并带上扩展 token', () => {
    expect(buildPlaywrightGatewayLaunchCommand('win32', 9011, 'abc123')).toBe(
      "$env:PLAYWRIGHT_MCP_EXTENSION_TOKEN='abc123'; npx -y @playwright/mcp@latest --extension --host localhost --port 9011 --shared-browser-context",
    );
  });
});

describe('normalizePlaywrightExtensionToken', () => {
  it('支持直接粘贴扩展给出的整行环境变量', () => {
    expect(normalizePlaywrightExtensionToken('PLAYWRIGHT_MCP_EXTENSION_TOKEN=abc123')).toBe('abc123');
  });

  it('会去掉首尾空白和包裹引号', () => {
    expect(normalizePlaywrightExtensionToken('  \"abc123\"  ')).toBe('abc123');
  });
});

describe('buildPlaywrightGatewayStopHint', () => {
  it('生成 macOS 一键停止命令', () => {
    expect(buildPlaywrightGatewayStopHint('darwin')).toBe('PID=$(lsof -ti :8931) && [ -n "$PID" ] && kill $PID');
  });

  it('生成 Windows 一键停止命令', () => {
    expect(buildPlaywrightGatewayStopHint('win32')).toBe("$pids = Get-NetTCPConnection -LocalPort 8931 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($pids) { $pids | ForEach-Object { Stop-Process -Id $_ } }");
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

describe('playwright bridge extension url', () => {
  it('使用官方 Chrome Web Store 地址', () => {
    expect(PLAYWRIGHT_MCP_BRIDGE_EXTENSION_URL).toBe('https://chromewebstore.google.com/detail/playwright-mcp-bridge/mmlmfjhmonkocbjadbfplnigmagldckm');
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
