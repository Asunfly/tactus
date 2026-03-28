#!/usr/bin/env node

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  createSmokeGatewaySpawnSpec,
  loadPlaywrightChromium,
  stopSmokeGatewayProcess,
} from './playwrightBridgeSmokeRuntime.mjs';

const REPO_ROOT = process.cwd();
const { chromium, runtimeRoot: PLAYWRIGHT_RUNTIME_ROOT } = loadPlaywrightChromium({
  repoRoot: REPO_ROOT,
});

const HOST = '127.0.0.1';
const MCP_HOST = 'localhost';
const SERVER_PORT = 3900 + Math.floor(Math.random() * 400);
const GATEWAY_PORT = 8900 + Math.floor(Math.random() * 500);
const RELAY_PORT = GATEWAY_PORT + 1;
const MCP_URL = `http://${MCP_HOST}:${GATEWAY_PORT}/mcp`;
const EXTENSION_ENDPOINT = `ws://${HOST}:${RELAY_PORT}/extension`;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createSmokeHtml(baseUrl) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Bridge Smoke</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; }
      .row { margin: 16px 0; }
      #hover-panel[hidden] { display: none; }
      #drag-source, #drag-target {
        width: 160px;
        height: 56px;
        border: 1px solid #999;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-right: 12px;
      }
    </style>
  </head>
  <body>
    <h1>Bridge Smoke</h1>
    <div class="row">
      <label>
        Name
        <input aria-label="Name" type="text" />
      </label>
    </div>
    <div class="row">
      <label>
        Search
        <input aria-label="Search" type="text" />
      </label>
    </div>
    <div class="row">
      <label>
        Country
        <select aria-label="Country">
          <option value="China">China</option>
          <option value="United States">United States</option>
        </select>
      </label>
    </div>
    <div class="row">
      <label>
        Upload file
        <input aria-label="Upload file" type="file" />
      </label>
      <div id="upload-result">No file</div>
    </div>
    <div class="row">
      <button aria-label="Show dialog" id="show-dialog">Show dialog</button>
      <button aria-label="Show delayed text" id="show-delayed">Show delayed text</button>
      <button aria-label="Go details" id="go-details">Go details</button>
    </div>
    <div class="row">
      <button aria-label="Hover target" id="hover-target">Hover target</button>
      <div id="hover-panel" hidden>Hover panel</div>
    </div>
    <div class="row">
      <div id="drag-source" draggable="true" aria-label="Drag source">Drag source</div>
      <div id="drag-target" aria-label="Drag target">Drag target</div>
      <div id="drag-result">Waiting</div>
    </div>
    <div class="row">
      <div id="delayed-text">Pending</div>
    </div>
    <script>
      console.log('smoke:page-loaded');
      fetch('${baseUrl}/api/data?source=load').then(r => r.json()).then(data => {
        console.info('smoke:data', data.ok);
      });

      document.querySelector('input[aria-label="Upload file"]').addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        document.getElementById('upload-result').textContent = file ? file.name : 'No file';
      });

      document.getElementById('show-dialog').addEventListener('click', () => {
        const value = prompt('Bridge smoke dialog', 'default');
        document.getElementById('delayed-text').textContent = value ? 'Dialog accepted' : 'Dialog cancelled';
      });

      document.getElementById('show-delayed').addEventListener('click', () => {
        setTimeout(() => {
          document.getElementById('delayed-text').textContent = 'Done waiting';
        }, 500);
      });

      document.getElementById('go-details').addEventListener('click', () => {
        location.href = '${baseUrl}/details';
      });

      document.getElementById('hover-target').addEventListener('mouseenter', () => {
        document.getElementById('hover-panel').hidden = false;
      });

      document.getElementById('drag-source').addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', 'drag-source');
      });
      document.getElementById('drag-target').addEventListener('dragover', (event) => event.preventDefault());
      document.getElementById('drag-target').addEventListener('drop', (event) => {
        event.preventDefault();
        document.getElementById('drag-result').textContent = 'Dropped';
      });
    </script>
  </body>
</html>`;
}

function createDetailsHtml(baseUrl) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Bridge Details</title>
  </head>
  <body>
    <h1>Bridge Details</h1>
    <a href="${baseUrl}/">Back home</a>
  </body>
</html>`;
}

function startSmokeServer(port) {
  const baseUrl = `http://${HOST}:${port}`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', baseUrl);
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(createSmokeHtml(baseUrl));
      return;
    }
    if (url.pathname === '/details') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(createDetailsHtml(baseUrl));
      return;
    }
    if (url.pathname === '/api/data') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, source: url.searchParams.get('source') || 'unknown' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve({ server, baseUrl }));
  });
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status >= 200) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function createMcpClient() {
  const client = new Client({ name: 'bridge-smoke', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  await client.connect(transport);
  return client;
}

function extractText(result) {
  return (result.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

async function callTool(client, name, args = {}) {
  log(`→ ${name}`);
  const result = await client.callTool({ name, arguments: args });
  const text = extractText(result);
  if (result.isError) {
    throw new Error(`${name} failed: ${text}`);
  }
  log(`✓ ${name}`);
  return { result, text };
}

function parseRef(snapshotText, pattern, label) {
  const match = snapshotText.match(pattern);
  assert(match?.[1], `Failed to locate ref for ${label}\n${snapshotText}`);
  return match[1];
}

async function launchExtensionContext(userDataDir, extensionDir) {
  let mode = 'headless';
  let context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });

  try {
    await waitForServiceWorker(context, 5_000);
    return { context, mode };
  } catch {
    await context.close();
    mode = 'offscreen';
    context = await chromium.launchPersistentContext(`${userDataDir}-headed`, {
      headless: false,
      args: [
        '--window-position=3000,3000',
        '--window-size=1280,900',
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    });
    await waitForServiceWorker(context, 15_000);
    return { context, mode };
  }
}

async function waitForServiceWorker(context, timeoutMs = 15_000) {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent('serviceworker', { timeout: timeoutMs });
}

async function main() {
  const sourceExtensionDir = path.join(REPO_ROOT, '.output/chrome-mv3');
  await fs.access(sourceExtensionDir);

  const smokeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tactus-bridge-smoke-'));
  const extensionDir = path.join(smokeDir, 'extension');
  const userDataDir = path.join(smokeDir, 'profile');
  const outputDir = path.join(smokeDir, 'artifacts');
  const uploadFile = path.join(REPO_ROOT, '.tmp-playwright-smoke-upload.txt');
  await fs.cp(sourceExtensionDir, extensionDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const serverInfo = await startSmokeServer(SERVER_PORT);
  const gatewaySpawnSpec = createSmokeGatewaySpawnSpec({
    host: HOST,
    port: GATEWAY_PORT,
    relayPort: RELAY_PORT,
  });
  const gateway = spawn(gatewaySpawnSpec.command, gatewaySpawnSpec.args, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TACTUS_PLAYWRIGHT_DEBUG: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  gateway.stdout.on('data', (chunk) => process.stdout.write(chunk.toString()));
  gateway.stderr.on('data', (chunk) => process.stderr.write(chunk.toString()));

  let context;
  let client;
  try {
    await waitForHttp(MCP_URL);
    log('Gateway ready');
    log(`Using Playwright runtime: ${PLAYWRIGHT_RUNTIME_ROOT}`);

    const launched = await launchExtensionContext(userDataDir, extensionDir);
    context = launched.context;
    log(`Browser mode: ${launched.mode}`);

    const page = await context.newPage();
    await page.goto(serverInfo.baseUrl);
    log('Smoke page opened');

    const worker = await waitForServiceWorker(context, 15_000);
    log(`Worker ready: ${worker.url()}`);

    const bindResult = await worker.evaluate(async ({ pageUrl, endpoint }) => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find((tab) => typeof tab.url === 'string' && tab.url.startsWith(pageUrl));
      if (!target?.id) {
        throw new Error('No target tab found for smoke page');
      }
      const response = await globalThis.__TACTUS_TEST_HOOKS__.ensureInternalPlaywrightBridgeBinding({
        type: 'ENSURE_INTERNAL_PLAYWRIGHT_BRIDGE',
        tabId: target.id,
        extensionEndpoint: endpoint,
      });
      return { tabId: target.id, response };
    }, {
      pageUrl: serverInfo.baseUrl,
      endpoint: EXTENSION_ENDPOINT,
    });
    assert(bindResult?.response?.success, `Bridge binding failed: ${JSON.stringify(bindResult)}`);
    log(`Bridge bound to tab: ${bindResult.tabId}`);

    client = await createMcpClient();
    log('MCP client connected');

    const toolList = await client.listTools();
    const toolNames = (toolList.tools || []).map((tool) => tool.name).sort();
    assert(toolNames.length === 22, `Expected 22 tools, received ${toolNames.length}`);
    log(`Tool count verified: ${toolNames.length}`);

    await callTool(client, 'browser_install', {});
    await callTool(client, 'browser_tabs', { action: 'list' });
    await callTool(client, 'browser_navigate', { url: serverInfo.baseUrl });
    await callTool(client, 'browser_console_messages', { level: 'info' });
    await callTool(client, 'browser_network_requests', { includeStatic: false });
    await callTool(client, 'browser_resize', { width: 1280, height: 900 });

    let snapshot = await callTool(client, 'browser_snapshot', {});
    const nameRef = parseRef(snapshot.text, /textbox "Name" \[ref=([^\]]+)\]/, 'Name input');
    const searchRef = parseRef(snapshot.text, /textbox "Search" \[ref=([^\]]+)\]/, 'Search input');
    const countryRef = parseRef(snapshot.text, /combobox "Country" \[ref=([^\]]+)\]/, 'Country select');
    const uploadRef = parseRef(snapshot.text, /button "Upload file" \[ref=([^\]]+)\]/, 'Upload input');
    const hoverRef = parseRef(snapshot.text, /button "Hover target" \[ref=([^\]]+)\]/, 'Hover target');
    const dialogRef = parseRef(snapshot.text, /button "Show dialog" \[ref=([^\]]+)\]/, 'Dialog button');
    const delayedRef = parseRef(snapshot.text, /button "Show delayed text" \[ref=([^\]]+)\]/, 'Delayed button');
    const detailsRef = parseRef(snapshot.text, /button "Go details" \[ref=([^\]]+)\]/, 'Details button');
    const dragSourceRef = parseRef(snapshot.text, /generic "Drag source" \[ref=([^\]]+)\]/, 'Drag source');
    const dragTargetRef = parseRef(snapshot.text, /generic "Drag target" \[ref=([^\]]+)\]/, 'Drag target');

    await callTool(client, 'browser_type', { ref: searchRef, element: 'Search', text: 'bridge smoke' });
    await callTool(client, 'browser_press_key', { key: 'Enter' });
    await callTool(client, 'browser_fill_form', {
      fields: [
        { name: 'Name', ref: nameRef, type: 'textbox', value: 'Tactus Smoke' },
      ],
    });
    await callTool(client, 'browser_select_option', {
      ref: countryRef,
      element: 'Country',
      values: ['United States'],
    });
    await callTool(client, 'browser_click', {
      ref: uploadRef,
      element: 'Upload file',
    });
    await fs.writeFile(uploadFile, 'bridge smoke upload');
    await callTool(client, 'browser_file_upload', {
      ref: uploadRef,
      element: 'Upload file',
      paths: [uploadFile],
    });
    await callTool(client, 'browser_hover', {
      ref: hoverRef,
      element: 'Hover target',
    });
    await callTool(client, 'browser_drag', {
      startRef: dragSourceRef,
      endRef: dragTargetRef,
      startElement: 'Drag source',
      endElement: 'Drag target',
    });
    await callTool(client, 'browser_click', {
      ref: delayedRef,
      element: 'Show delayed text',
    });
    await callTool(client, 'browser_wait_for', { text: 'Done waiting' });
    await callTool(client, 'browser_evaluate', {
      ref: nameRef,
      element: 'Name',
      function: '(element) => element.value',
    });
    await callTool(client, 'browser_take_screenshot', {
      ref: hoverRef,
      element: 'Hover target',
      type: 'png',
      filename: path.join(outputDir, 'hover.png'),
    });
    await callTool(client, 'browser_run_code', {
      code: `async (page) => {
        await page.evaluate(() => {
          setTimeout(() => {
            alert('Bridge smoke dialog');
          }, 100);
        });
        return 'dialog scheduled';
      }`,
    });
    await delay(300);
    await callTool(client, 'browser_handle_dialog', { accept: false });
    await callTool(client, 'browser_navigate', {
      url: `${serverInfo.baseUrl}/details`,
    });
    await callTool(client, 'browser_navigate_back', {});
    await callTool(client, 'browser_run_code', {
      code: `async (page) => ({ title: await page.title(), url: page.url() })`,
    });
    await callTool(client, 'browser_tabs', { action: 'new' });
    await callTool(client, 'browser_tabs', { action: 'list' });
    await callTool(client, 'browser_close', {});
    await callTool(client, 'browser_tabs', { action: 'list' });

    log(`Smoke E2E completed. Artifacts: ${smokeDir}`);
  } finally {
    await client?.close().catch(() => {});
    await context?.close().catch(() => {});
    await stopSmokeGatewayProcess(gateway).catch(() => {});
    await delay(500);
    await new Promise((resolve) => serverInfo.server.close(resolve));
    await fs.rm(uploadFile, { force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
