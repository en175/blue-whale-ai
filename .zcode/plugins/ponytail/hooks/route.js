#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const event = process.argv[2];
  let payload;
  let root;
  try {
    payload = JSON.parse(input.replace(/^\uFEFF/, ''));
    if (!payload || typeof payload.cwd !== 'string' ||
        !['SessionStart', 'UserPromptSubmit'].includes(event)) {
      process.stdout.write('{}');
      return;
    }
    root = execFileSync('git', ['-C', payload.cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000,
    }).trim();
    const config = JSON.parse(fs.readFileSync(path.join(root, '.zcode/ponytail.json'), 'utf8'));
    if (!config || config.enabled !== true) {
      process.stdout.write('{}');
      return;
    }
  } catch (_) {
    process.stdout.write('{}');
    return;
  }
  const result = spawnSync(process.execPath,
    [path.join(root, '.claude/hooks/ponytail-zcode.js'), event], {
      input: JSON.stringify(payload), encoding: 'utf8', timeout: 4500,
    });
  if (result.error || result.status !== 0) {
    process.stderr.write('Ponytail ZCode 工作树适配缺失或执行失败，当前注入未通过验收。\n');
    process.stdout.write('{}');
    return;
  }
  if (result.stderr) process.stderr.write(result.stderr);
  process.stdout.write(result.stdout || '{}');
});
