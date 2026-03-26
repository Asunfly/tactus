import type { McpServerConfig } from './mcpStorage';

export const PLAYWRIGHT_GATEWAY_DEFAULT_PORT = 8931;
export const PLAYWRIGHT_GATEWAY_BUILTIN_ID = 'builtin-playwright-gateway';
export const PLAYWRIGHT_GATEWAY_DEFAULT_NAME = 'Local Playwright Gateway';
export const PLAYWRIGHT_GATEWAY_DEFAULT_URL = `http://localhost:${PLAYWRIGHT_GATEWAY_DEFAULT_PORT}/mcp`;
export const PLAYWRIGHT_GATEWAY_FALLBACK_URLS = [
  `http://127.0.0.1:${PLAYWRIGHT_GATEWAY_DEFAULT_PORT}/mcp`,
];
export const PLAYWRIGHT_GATEWAY_DEFAULT_DESCRIPTION = 'Connects Tactus to the local Playwright MCP gateway bound to the current browser tab.';
export const PLAYWRIGHT_MCP_BRIDGE_EXTENSION_URL = 'https://chromewebstore.google.com/detail/playwright-mcp-bridge/mmlmfjhmonkocbjadbfplnigmagldckm';
export const PLAYWRIGHT_MCP_EXTENSION_TOKEN_ENV = 'PLAYWRIGHT_MCP_EXTENSION_TOKEN';

export type PlaywrightGatewayPlatform = 'darwin' | 'win32' | 'linux';

export function createPlaywrightGatewayServerConfig(id: string): McpServerConfig {
  return {
    id,
    name: PLAYWRIGHT_GATEWAY_DEFAULT_NAME,
    url: PLAYWRIGHT_GATEWAY_DEFAULT_URL,
    description: PLAYWRIGHT_GATEWAY_DEFAULT_DESCRIPTION,
    authType: 'none',
    enabled: true,
  };
}

export function buildPlaywrightGatewayCommand(port = PLAYWRIGHT_GATEWAY_DEFAULT_PORT): string {
  return `npx -y @playwright/mcp@latest --extension --host localhost --port ${port} --shared-browser-context`;
}

function stripWrappedQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}

export function normalizePlaywrightExtensionToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const tokenLine = trimmed.match(/(?:^|[\s;])(?:export\s+)?PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=\s*(.+)$/);
  return stripWrappedQuotes((tokenLine?.[1] ?? trimmed).trim());
}

function quoteForPosixShell(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildPlaywrightGatewayEnvPrefix(
  platform: PlaywrightGatewayPlatform,
  extensionToken?: string,
): string {
  const token = extensionToken ? normalizePlaywrightExtensionToken(extensionToken) : '';
  if (!token) return '';

  if (platform === 'win32') {
    return `$env:${PLAYWRIGHT_MCP_EXTENSION_TOKEN_ENV}=${quoteForPowerShell(token)}; `;
  }

  return `${PLAYWRIGHT_MCP_EXTENSION_TOKEN_ENV}=${quoteForPosixShell(token)} `;
}

export function buildPlaywrightGatewayLaunchCommand(
  platform: PlaywrightGatewayPlatform,
  port = PLAYWRIGHT_GATEWAY_DEFAULT_PORT,
  extensionToken?: string,
): string {
  return `${buildPlaywrightGatewayEnvPrefix(platform, extensionToken)}${buildPlaywrightGatewayCommand(port)}`;
}

export function buildPlaywrightGatewayBackgroundCommand(
  platform: PlaywrightGatewayPlatform,
  port = PLAYWRIGHT_GATEWAY_DEFAULT_PORT,
  extensionToken?: string,
): string {
  const launchCommand = buildPlaywrightGatewayLaunchCommand(platform, port, extensionToken);

  if (platform === 'win32') {
    return `Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','${launchCommand.replace(/'/g, "''")}'`;
  }

  return `${buildPlaywrightGatewayEnvPrefix(platform, extensionToken)}nohup ${buildPlaywrightGatewayCommand(port)} > ~/playwright-mcp.log 2>&1 &`;
}

export function buildPlaywrightGatewayStopHint(platform: PlaywrightGatewayPlatform): string {
  if (platform === 'win32') {
    return "$pids = Get-NetTCPConnection -LocalPort 8931 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($pids) { $pids | ForEach-Object { Stop-Process -Id $_ } }";
  }

  return 'PID=$(lsof -ti :8931) && [ -n "$PID" ] && kill $PID';
}

export function normalizePlaywrightGatewayServer<
  T extends Pick<McpServerConfig, 'id' | 'name' | 'url' | 'authType' | 'enabled'> & Partial<Pick<McpServerConfig, 'description' | 'authToken' | 'headers'>>
>(server: T): T {
  if (PLAYWRIGHT_GATEWAY_FALLBACK_URLS.includes(server.url)) {
    return {
      ...server,
      url: PLAYWRIGHT_GATEWAY_DEFAULT_URL,
    };
  }

  return server;
}

export function findPlaywrightGatewayServer(
  servers: Array<Pick<McpServerConfig, 'id' | 'name' | 'url' | 'authType' | 'enabled'>>,
): Pick<McpServerConfig, 'id' | 'name' | 'url' | 'authType' | 'enabled'> | undefined {
  return servers.find(server =>
    server.url === PLAYWRIGHT_GATEWAY_DEFAULT_URL
    || PLAYWRIGHT_GATEWAY_FALLBACK_URLS.includes(server.url)
    || server.name === PLAYWRIGHT_GATEWAY_DEFAULT_NAME,
  );
}

export function getPlaywrightGatewayRuntimeServer(
  servers: Array<Pick<McpServerConfig, 'id' | 'name' | 'url' | 'description' | 'authType' | 'enabled'>>,
): Pick<McpServerConfig, 'id' | 'name' | 'url' | 'description' | 'authType' | 'enabled'> | null {
  const existing = findPlaywrightGatewayServer(servers);
  if (existing) {
    return existing.enabled ? normalizePlaywrightGatewayServer(existing) : null;
  }

  return createPlaywrightGatewayServerConfig(PLAYWRIGHT_GATEWAY_BUILTIN_ID);
}
