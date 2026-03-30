#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLocalBuildTime(date) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

const wxtBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'wxt.cmd' : 'wxt');
const args = process.argv.slice(2);
const child = spawn(wxtBin, args, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    WXT_APP_VERSION: packageJson.version,
    WXT_BUILD_TIME: formatLocalBuildTime(new Date()),
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
