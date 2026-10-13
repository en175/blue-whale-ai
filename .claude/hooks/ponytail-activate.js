#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { getDefaultMode, getClaudeDir } = require('./ponytail-config');
const { getPonytailInstructions } = require('./ponytail-instructions');
const {
  clearMode, cursorRuleNotice, cursorRulePath, isCodex, isCopilot, isCursor,
  isCodeBuddy, setMode, writeHookOutput, projectDir, stateDirectory,
} = require('./ponytail-runtime');

const mode = getDefaultMode();
if (mode === 'off') {
  clearMode();
  process.exit(0);
}
if (isCursor) {
  const rule = cursorRulePath();
  if (rule) {
    writeHookOutput('SessionStart', mode, cursorRuleNotice(rule));
    process.exit(0);
  }
}
try { setMode(mode); } catch (_) {}
let output = getPonytailInstructions(mode);
if (process.env.PONYTAIL_MAP !== '0') try {
  const map = require('./ponytail-map').buildMap(projectDir);
  if (map) output += '\n\n' + map;
} catch (_) {}

if (!isCodex && !isCopilot && !isCursor && !isCodeBuddy &&
    (!process.env.PONYTAIL_CLIENT || process.env.PONYTAIL_CLIENT === 'claude')) try {
  const settingsPath = path.join(getClaudeDir(), 'settings.json');
  let statusLine = null;
  try { statusLine = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '')).statusLine; } catch (_) {}
  const notice = path.join(stateDirectory, '.statusline-notice');
  const script = path.join(__dirname, 'ponytail-statusline.js');
  if (!statusLine && fs.existsSync(script) && !fs.existsSync(notice)) {
    fs.mkdirSync(stateDirectory, { recursive: true });
    fs.writeFileSync(notice, 'v5.1.0');
    const command = 'PONYTAIL_CLIENT=claude node "$(git rev-parse --show-toplevel)/.claude/hooks/ponytail-statusline.js"';
    output += '\n\nPonytail 状态栏配置可选。脚本已随仓库提供，更新仓库后使用新版本。已有状态栏设置保持原样。\n' +
      '需要时手动在 Claude 用户设置中配置：' + JSON.stringify({ statusLine: { type: 'command', command } });
  }
} catch (_) {}

try { writeHookOutput('SessionStart', mode, output); } catch (_) {}
