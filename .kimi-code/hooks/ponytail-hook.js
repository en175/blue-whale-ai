#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function main() {
  const event = process.argv[2];
  if (!['SessionStart', 'UserPromptSubmit'].includes(event)) return;
  const input = fs.readFileSync(0, 'utf8');
  const data = JSON.parse(input);
  let root;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: typeof data.cwd === 'string' ? data.cwd : process.cwd(),
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000,
    }).trim();
  } catch (_) { return; }
  const entry = path.join(root, '.claude/hooks/ponytail-kimi.js');
  if (!fs.existsSync(path.join(root, '.kimi-code/hooks.toml')) || !fs.existsSync(entry)) return;
  process.stdout.write(execFileSync(process.execPath, [entry, event], {
    cwd: root, input, encoding: 'utf8', timeout: 4000,
    env: { ...process.env, PONYTAIL_CLIENT: 'kimi', PONYTAIL_PROJECT_DIR: root },
  }));
}

main();
