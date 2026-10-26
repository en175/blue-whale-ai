#!/usr/bin/env node

let input = '';
let done = false;
function finish() {
  if (done) return;
  done = true;
  try {
    const data = JSON.parse(input || '{}');
    const root = data.workspace?.current_dir || data.cwd || data.workspace?.project_dir;
    if (typeof root === 'string') process.env.PONYTAIL_PROJECT_DIR = root;
    process.env.PONYTAIL_CLIENT = 'claude';
    const { readMode } = require('./ponytail-runtime');
    const { getHideStatus } = require('./ponytail-config');
    const mode = readMode();
    if (mode && mode !== 'off' && !getHideStatus()) {
      process.stdout.write(mode === 'full' ? '[PONYTAIL]' : '[PONYTAIL:' + mode.toUpperCase() + ']');
    }
  } catch (_) {}
}
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => { finish(); process.exit(0); });
process.stdin.on('error', () => { finish(); process.exit(0); });
setTimeout(() => { finish(); process.exit(0); }, 1000);
