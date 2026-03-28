import fs from 'node:fs';
import path from 'node:path';

function looksLikeNpmCliScript(filePath) {
  return /(^|[\\/])npm-cli\.js$/i.test(filePath);
}

export function resolveNpmCliPath({
  nodePath = process.execPath,
  npmExecPath = process.env.npm_execpath,
  existsSync = fs.existsSync,
} = {}) {
  const nodeDir = path.dirname(nodePath);
  const candidates = [
    npmExecPath,
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!looksLikeNpmCliScript(candidate)) {
      continue;
    }
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function quoteWindowsShellArg(value) {
  if (!value.length) {
    return '""';
  }
  if (!/[\s"&()<>^|]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function createNpmSpawnSpec({
  args,
  platform = process.platform,
  nodePath = process.execPath,
  npmExecPath = process.env.npm_execpath,
  comspec = process.env.ComSpec || 'cmd.exe',
  existsSync = fs.existsSync,
} = {}) {
  const npmCliPath = resolveNpmCliPath({ nodePath, npmExecPath, existsSync });
  if (npmCliPath) {
    return {
      command: nodePath,
      args: [npmCliPath, ...args],
    };
  }

  if (platform === 'win32') {
    return {
      command: comspec,
      args: ['/d', '/s', '/c', ['npm', ...args].map(quoteWindowsShellArg).join(' ')],
    };
  }

  return {
    command: 'npm',
    args,
  };
}
