#!/usr/bin/env node

import { spawn } from 'node:child_process';

const rawArgs = process.argv.slice(2);
const passThroughOnly = rawArgs.includes('--help')
  || rawArgs.includes('-h')
  || rawArgs.includes('--version')
  || rawArgs.includes('-V');

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const forwardedArgs = ['@playwright/mcp@latest'];

if (passThroughOnly) {
  forwardedArgs.push(...rawArgs);
} else {
  const effectiveArgs = [...rawArgs];
  const hasPortFlag = effectiveArgs.includes('--port');
  const hasHostFlag = effectiveArgs.includes('--host');
  const hasExtensionFlag = effectiveArgs.includes('--extension');
  const hasSharedContextFlag = effectiveArgs.includes('--shared-browser-context');

  if (!hasExtensionFlag) {
    effectiveArgs.unshift('--extension');
  }
  if (!hasHostFlag) {
    effectiveArgs.unshift('127.0.0.1');
    effectiveArgs.unshift('--host');
  }
  if (!hasPortFlag) {
    effectiveArgs.unshift(process.env.PLAYWRIGHT_GATEWAY_PORT || '8931');
    effectiveArgs.unshift('--port');
  }
  if (!hasSharedContextFlag) {
    effectiveArgs.unshift('--shared-browser-context');
  }

  forwardedArgs.push(...effectiveArgs);
}

console.log('[local-playwright-gateway] launching:', `${npxCommand} ${forwardedArgs.join(' ')}`);

const child = spawn(npxCommand, forwardedArgs, {
  stdio: 'inherit',
  env: process.env,
});

const stopChild = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on('SIGINT', () => stopChild('SIGINT'));
process.on('SIGTERM', () => stopChild('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 0;
});
