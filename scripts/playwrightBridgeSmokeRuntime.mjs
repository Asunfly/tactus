import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { createNpmSpawnSpec } from '../packages/tactus-playwright-gateway/bin/npmLauncher.mjs';

export function createSmokeGatewaySpawnSpec({
  host,
  port,
  relayPort,
  platform,
  nodePath,
  npmExecPath,
  comspec,
  existsSync,
} = {}) {
  return createNpmSpawnSpec({
    args: [
      'run',
      'mcp:playwright',
      '--',
      '--host',
      host,
      '--port',
      String(port),
      '--relay-port',
      String(relayPort),
    ],
    platform,
    nodePath,
    npmExecPath,
    comspec,
    existsSync,
  });
}

function getPathApi(platform = process.platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function buildPlaywrightRuntimeCandidates({
  platform = process.platform,
  repoRoot,
  homeDir = os.homedir(),
  env = process.env,
} = {}) {
  const pathApi = getPathApi(platform);
  const candidates = [];

  if (env.PLAYWRIGHT_SKILL_DIR) {
    candidates.push(env.PLAYWRIGHT_SKILL_DIR);
  }

  if (repoRoot) {
    candidates.push(pathApi.join(repoRoot, '.codex', 'skills', 'playwright-skill'));
    candidates.push(pathApi.join(repoRoot, '.claude', 'skills', 'playwright-skill'));
    candidates.push(pathApi.join(repoRoot, 'node_modules', 'playwright'));
  }

  if (homeDir) {
    candidates.push(pathApi.join(homeDir, '.codex', 'skills', 'playwright-skill'));
    candidates.push(pathApi.join(homeDir, '.claude', 'skills', 'playwright-skill'));
    candidates.push(pathApi.join(homeDir, '.claude', 'plugins', 'marketplaces', 'playwright-skill', 'skills', 'playwright-skill'));
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

export function resolvePlaywrightRuntimeRoot({
  platform = process.platform,
  repoRoot,
  homeDir = os.homedir(),
  env = process.env,
  existsSync = fs.existsSync,
} = {}) {
  const candidates = buildPlaywrightRuntimeCandidates({
    platform,
    repoRoot,
    homeDir,
    env,
  });

  for (const candidate of candidates) {
    if (existsSync(getPathApi(platform).join(candidate, 'package.json'))) {
      return candidate;
    }
  }

  throw new Error(`Unable to locate a Playwright runtime. Checked: ${candidates.join(', ')}`);
}

export function loadPlaywrightChromium({
  platform = process.platform,
  repoRoot,
  homeDir = os.homedir(),
  env = process.env,
  existsSync = fs.existsSync,
  createRequireImpl = createRequire,
} = {}) {
  const runtimeRoot = resolvePlaywrightRuntimeRoot({
    platform,
    repoRoot,
    homeDir,
    env,
    existsSync,
  });
  const requirePlaywright = createRequireImpl(getPathApi(platform).join(runtimeRoot, 'package.json'));
  const { chromium } = requirePlaywright('playwright');
  return {
    runtimeRoot,
    chromium,
  };
}

export function createSmokeGatewayCleanupSpec({
  pid,
  platform = process.platform,
} = {}) {
  if (!pid) {
    return null;
  }

  if (platform === 'win32') {
    return {
      command: 'taskkill',
      args: ['/PID', String(pid), '/T', '/F'],
    };
  }

  return null;
}

export async function stopSmokeGatewayProcess(
  gateway,
  {
    platform = process.platform,
    spawnImpl = spawn,
    timeoutMs = 5_000,
  } = {},
) {
  if (!gateway) {
    return;
  }

  if (gateway.exitCode !== null) {
    return;
  }

  const cleanupSpec = createSmokeGatewayCleanupSpec({
    pid: gateway.pid,
    platform,
  });

  if (cleanupSpec) {
    const killer = spawnImpl(cleanupSpec.command, cleanupSpec.args, {
      stdio: 'ignore',
      windowsHide: true,
    });
    await once(killer, 'exit');
  } else {
    gateway.kill('SIGTERM');
  }

  await Promise.race([
    once(gateway, 'exit'),
    delay(timeoutMs),
  ]);
}
