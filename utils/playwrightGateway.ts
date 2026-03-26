import type { McpServerConfig } from './mcpStorage';
import { INTERNAL_PLAYWRIGHT_RELAY_DEFAULT_PORT } from './internalPlaywrightBridge';

export const PLAYWRIGHT_GATEWAY_DEFAULT_PORT = 8931;
export const PLAYWRIGHT_GATEWAY_DEFAULT_RELAY_PORT = INTERNAL_PLAYWRIGHT_RELAY_DEFAULT_PORT;
export const PLAYWRIGHT_GATEWAY_BUILTIN_ID = 'builtin-playwright-gateway';
export const PLAYWRIGHT_GATEWAY_DEFAULT_NAME = 'Local Playwright Gateway';
export const PLAYWRIGHT_GATEWAY_DEFAULT_URL = `http://localhost:${PLAYWRIGHT_GATEWAY_DEFAULT_PORT}/mcp`;
export const PLAYWRIGHT_GATEWAY_PACKAGE_NAME = 'tactus-playwright-gateway';
export const PLAYWRIGHT_GATEWAY_FALLBACK_URLS = [
  `http://127.0.0.1:${PLAYWRIGHT_GATEWAY_DEFAULT_PORT}/mcp`,
];
export const PLAYWRIGHT_GATEWAY_DEFAULT_DESCRIPTION = 'Connects Tactus to the local Playwright MCP gateway using the built-in current-tab bridge.';

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

export function buildPlaywrightGatewayCommand(
  port = PLAYWRIGHT_GATEWAY_DEFAULT_PORT,
  relayPort = PLAYWRIGHT_GATEWAY_DEFAULT_RELAY_PORT,
): string {
  return `npx -y ${PLAYWRIGHT_GATEWAY_PACKAGE_NAME} --host localhost --port ${port} --relay-port ${relayPort}`;
}

export function buildPlaywrightGatewayBackgroundCommand(
  platform: PlaywrightGatewayPlatform,
  port = PLAYWRIGHT_GATEWAY_DEFAULT_PORT,
  relayPort = PLAYWRIGHT_GATEWAY_DEFAULT_RELAY_PORT,
): string {
  const launchCommand = buildPlaywrightGatewayCommand(port, relayPort);

  if (platform === 'win32') {
    return `Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','${launchCommand}'`;
  }

  return `nohup ${launchCommand} > ~/playwright-mcp.log 2>&1 &`;
}

export function buildPlaywrightGatewayStopHint(platform: PlaywrightGatewayPlatform): string {
  if (platform === 'win32') {
    return "$pids = @(Get-NetTCPConnection -LocalPort 8931,8932 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if ($pids) { $pids | ForEach-Object { Stop-Process -Id $_ } }";
  }

  return 'PID=$(lsof -ti :8931 -ti :8932 | sort -u) && [ -n "$PID" ] && kill $PID';
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
