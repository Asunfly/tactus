#!/usr/bin/env node

import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { InternalCDPRelayRuntime } from './relayRuntime.mjs';
import { normalizePlaywrightProtocolError } from './protocolError.mjs';
import { createNpmSpawnSpec } from './npmLauncher.mjs';

const MCP_DEFAULT_PORT = process.env.PLAYWRIGHT_GATEWAY_PORT || '8931';
const RELAY_DEFAULT_PORT = process.env.PLAYWRIGHT_RELAY_PORT || '8932';
const RELAY_HOST = '127.0.0.1';
const CDP_PATH = '/cdp';
const EXTENSION_PATH = '/extension';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function readOptionValue(args, name) {
  const withEquals = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      return args[index + 1];
    }
    if (arg.startsWith(withEquals)) {
      return arg.slice(withEquals.length);
    }
  }
  return undefined;
}

function stripWrapperArgs(args) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--relay-port') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--relay-port=')) {
      continue;
    }
    if (arg === '--extension') {
      continue;
    }
    result.push(arg);
  }
  return result;
}

class ExtensionConnection {
  constructor(ws) {
    this.ws = ws;
    this.callbacks = new Map();
    this.lastId = 0;
    this.onmessage = null;
    this.onclose = null;

    ws.on('message', (payload) => this.handleMessage(payload.toString()));
    ws.on('close', (_code, reasonBuffer) => {
      this.dispose(new Error(`Extension disconnected: ${reasonBuffer.toString() || 'unknown reason'}`));
      this.onclose?.(reasonBuffer.toString());
    });
    ws.on('error', (error) => {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    });
  }

  async send(method, params) {
    if (this.ws.readyState !== 1) {
      throw new Error(`Unexpected extension websocket state: ${this.ws.readyState}`);
    }
    const id = ++this.lastId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return await new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject, error: new Error(`Protocol error: ${method}`) });
    });
  }

  close(reason) {
    if (this.ws.readyState === 1) {
      this.ws.close(1000, reason);
    }
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      this.close('Malformed extension message');
      return;
    }

    if (message.id && this.callbacks.has(message.id)) {
      const callback = this.callbacks.get(message.id);
      this.callbacks.delete(message.id);
      if (message.error) {
        callback.error.message = message.error;
        callback.reject(callback.error);
      } else {
        callback.resolve(message.result);
      }
      return;
    }

    if (!message.id && message.method) {
      this.onmessage?.(message.method, message.params);
    }
  }

  dispose(error) {
    for (const callback of this.callbacks.values()) {
      callback.reject(error);
    }
    this.callbacks.clear();
  }
}

class InternalCDPRelayServer {
  constructor({ relayPort, relayHost }) {
    this.relayPort = relayPort;
    this.relayHost = relayHost;
    this.playwrightConnection = null;
    this.extensionConnection = null;
    this.extensionWaiter = createDeferred();
    this.runtime = new InternalCDPRelayRuntime({
      waitForExtensionConnection: () => this.waitForExtensionConnection(),
      callExtension: async (method, params) => {
        if (!this.extensionConnection) {
          throw new Error('Internal Playwright bridge is not connected');
        }
        return this.extensionConnection.send(method, params);
      },
      sendToPlaywright: (message) => this.sendToPlaywright(message),
    });

    this.httpServer = http.createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws, request) => this.handleConnection(ws, request));
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(this.relayPort, this.relayHost, () => {
        this.httpServer.off('error', reject);
        resolve();
      });
    });
  }

  cdpEndpoint() {
    return `ws://${this.relayHost}:${this.relayPort}${CDP_PATH}`;
  }

  extensionEndpoint() {
    return `ws://${this.relayHost}:${this.relayPort}${EXTENSION_PATH}`;
  }

  stop(reason = 'Relay server stopped') {
    this.closeConnections(reason);
    this.wss.close();
    this.httpServer.close();
  }

  closeConnections(reason) {
    if (this.playwrightConnection?.readyState === 1) {
      this.playwrightConnection.close(1000, reason);
    }
    this.playwrightConnection = null;
    this.closeExtensionConnection(reason);
  }

  resetExtensionConnection() {
    this.extensionConnection = null;
    this.extensionWaiter = createDeferred();
    this.extensionWaiter.promise.catch(() => {});
  }

  closeExtensionConnection(reason) {
    this.extensionConnection?.close(reason);
    this.extensionWaiter.reject(new Error(reason));
    this.resetExtensionConnection();
  }

  handleConnection(ws, request) {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname === CDP_PATH) {
      this.handlePlaywrightConnection(ws);
      return;
    }
    if (url.pathname === EXTENSION_PATH) {
      this.handleExtensionConnection(ws);
      return;
    }
    ws.close(4004, 'Invalid relay path');
  }

  handlePlaywrightConnection(ws) {
    if (this.playwrightConnection) {
      ws.close(1000, 'Another CDP client already connected');
      return;
    }

    this.playwrightConnection = ws;
    ws.on('message', async (payload) => {
      try {
        const message = JSON.parse(payload.toString());
        const result = await this.handlePlaywrightMessage(message);
        this.sendToPlaywright({
          id: message.id,
          sessionId: message.sessionId,
          result,
        });
      } catch (error) {
        this.sendToPlaywright({
          id: (() => {
            try {
              return JSON.parse(payload.toString()).id;
            } catch {
              return undefined;
            }
          })(),
          error: normalizePlaywrightProtocolError(error),
        });
      }
    });

    ws.on('close', () => {
      if (this.playwrightConnection !== ws) return;
      this.playwrightConnection = null;
      this.closeExtensionConnection('Playwright client disconnected');
    });
  }

  handleExtensionConnection(ws) {
    if (this.extensionConnection) {
      ws.close(1000, 'Another extension connection already established');
      return;
    }

    const connection = new ExtensionConnection(ws);
    connection.onmessage = (method, params) => {
      void this.runtime.handleExtensionMessage(method, params);
    };
    connection.onclose = (reason) => {
      if (this.extensionConnection !== connection) return;
      this.resetExtensionConnection();
      if (this.playwrightConnection?.readyState === 1) {
        this.playwrightConnection.close(1000, `Extension disconnected: ${reason}`);
      }
      this.playwrightConnection = null;
    };

    this.extensionConnection = connection;
    this.extensionWaiter.resolve();
  }

  async waitForExtensionConnection(timeoutMs = 30000) {
    if (this.extensionConnection) {
      return;
    }
    await Promise.race([
      this.extensionWaiter.promise,
      new Promise((_, reject) => setTimeout(() => {
        reject(new Error('Internal Playwright bridge connection timeout.'));
      }, timeoutMs)),
    ]);
  }

  async handlePlaywrightMessage(message) {
    return await this.runtime.handlePlaywrightMessage(message);
  }

  sendToPlaywright(message) {
    if (this.playwrightConnection?.readyState === 1) {
      this.playwrightConnection.send(JSON.stringify(message));
    }
  }
}

const rawArgs = process.argv.slice(2);
const passThroughOnly = rawArgs.includes('--help')
  || rawArgs.includes('-h')
  || rawArgs.includes('--version')
  || rawArgs.includes('-V');

if (passThroughOnly) {
  const npmSpawnSpec = createNpmSpawnSpec({
    args: ['exec', '--yes', '--package=@playwright/mcp@latest', 'playwright-mcp', '--', ...rawArgs],
  });
  const child = spawn(npmSpawnSpec.command, npmSpawnSpec.args, {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
} else {
  const mcpPort = readOptionValue(rawArgs, '--port') || MCP_DEFAULT_PORT;
  const relayPort = readOptionValue(rawArgs, '--relay-port') || RELAY_DEFAULT_PORT;
  const host = readOptionValue(rawArgs, '--host') || '127.0.0.1';
  const relay = new InternalCDPRelayServer({
    relayPort: Number(relayPort),
    relayHost: RELAY_HOST,
  });

  await relay.start();

  const forwardedArgs = stripWrapperArgs(rawArgs);
  const hasPortFlag = readOptionValue(forwardedArgs, '--port');
  const hasHostFlag = readOptionValue(forwardedArgs, '--host');
  const hasSharedContextFlag = forwardedArgs.includes('--shared-browser-context');
  const hasCdpEndpointFlag = readOptionValue(forwardedArgs, '--cdp-endpoint');

  if (!hasCdpEndpointFlag) {
    forwardedArgs.unshift(relay.cdpEndpoint());
    forwardedArgs.unshift('--cdp-endpoint');
  }
  if (!hasSharedContextFlag) {
    forwardedArgs.unshift('--shared-browser-context');
  }
  if (!hasPortFlag) {
    forwardedArgs.unshift(mcpPort);
    forwardedArgs.unshift('--port');
  }
  if (!hasHostFlag) {
    forwardedArgs.unshift(host);
    forwardedArgs.unshift('--host');
  }

  const npmSpawnSpec = createNpmSpawnSpec({
    args: ['exec', '--yes', '--package=@playwright/mcp@latest', 'playwright-mcp', '--', ...forwardedArgs],
  });
  const child = spawn(npmSpawnSpec.command, npmSpawnSpec.args, {
    stdio: 'inherit',
    env: process.env,
  });

  console.log('[tactus-playwright-gateway] relay:', relay.extensionEndpoint());
  console.log('[tactus-playwright-gateway] launching:', `${npmSpawnSpec.command} ${npmSpawnSpec.args.join(' ')}`);

  const stopChild = (signal) => {
    relay.stop(`Gateway stopped by ${signal}`);
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on('SIGINT', () => stopChild('SIGINT'));
  process.on('SIGTERM', () => stopChild('SIGTERM'));

  child.on('exit', (code, signal) => {
    relay.stop(signal ? `Gateway child exited via ${signal}` : 'Gateway child exited');
    if (signal) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 0;
  });
}
