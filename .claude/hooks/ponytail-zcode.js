#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');
const { getConfigDir } = require('./ponytail-config');

const scripts = {
  SessionStart: 'ponytail-activate.js',
  UserPromptSubmit: 'ponytail-mode-tracker.js',
};
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const event = process.argv[2];
  let payload;
  try { payload = JSON.parse(input.replace(/^\uFEFF/, '')); } catch (_) {
    process.stdout.write('{}');
    return;
  }
  if (!scripts[event] || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    process.stdout.write('{}');
    return;
  }
  const root = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd :
    process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const result = spawnSync(process.execPath, [path.join(__dirname, scripts[event])], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 4000,
    env: {
      ...process.env,
      PONYTAIL_CLIENT: 'zcode',
      PONYTAIL_PROJECT_DIR: root,
      PONYTAIL_STATE_DIR: process.env.PONYTAIL_STATE_DIR || path.join(getConfigDir(), 'zcode'),
    },
  });
  if (result.error || result.status !== 0) {
    process.stderr.write('Ponytail ZCode 上下文生成失败，当前注入未通过验收。\n');
    process.stdout.write('{}');
    return;
  }
  if (result.stderr) process.stderr.write(result.stderr);
  const output = result.stdout ? {
    hookSpecificOutput: { hookEventName: event, additionalContext: result.stdout },
  } : {};
  process.stdout.write(JSON.stringify(output));
});
