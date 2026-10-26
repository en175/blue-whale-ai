const fs = require('fs');
const path = require('path');
const os = require('os');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');
const { getClaudeDir, getConfigDir, normalizeMode, getDefaultMode } = require('./ponytail-config');

const STATE_FILE = '.ponytail-active';

function isVsCodeCopilotRoot(pluginRoot) {
  if (!pluginRoot) return false;
  return pluginRoot.split(/[\\/]+/).includes('agent-plugins') &&
    pluginRoot.toLowerCase().includes('.vscode');
}

const explicitClient = process.env.PONYTAIL_CLIENT;
const isCopilot = !explicitClient && (Boolean(process.env.COPILOT_PLUGIN_DATA) ||
  isVsCodeCopilotRoot(process.env.CLAUDE_PLUGIN_ROOT));
const isCodex = explicitClient ? explicitClient === 'codex' : !isCopilot && Boolean(process.env.PLUGIN_DATA);
const isQoder = explicitClient ? explicitClient === 'qoder' : !isCopilot && !isCodex && Boolean(process.env.QODER_SESSION_ID);

const isCodeBuddy = explicitClient ? explicitClient === 'codebuddy' : !isCopilot && !isCodex && !isQoder && Boolean(process.env.CODEBUDDY_PLUGIN_ROOT);

const isCursor = explicitClient ? explicitClient === 'cursor' : !isCopilot && !isCodex && !isQoder && !isCodeBuddy && Boolean(process.env.CURSOR_VERSION);

let stateDir = getClaudeDir();
if (isCodex) stateDir = process.env.PLUGIN_DATA || getConfigDir();

if (isCopilot) stateDir = process.env.COPILOT_PLUGIN_DATA || getClaudeDir();
if (isQoder) stateDir = path.join(os.homedir(), '.qoder');
if (isCodeBuddy) stateDir = process.env.CODEBUDDY_CONFIG_DIR || path.join(os.homedir(), '.codebuddy');
if (isCursor) stateDir = path.join(os.homedir(), '.cursor');

function getProjectDir() {
  let root = path.resolve(process.env.PONYTAIL_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000,
    }).trim();
  } catch (_) {}
  root = path.resolve(root || process.cwd());
  try { return fs.realpathSync(root); } catch (_) { return root; }
}

const projectDir = getProjectDir();
const client = explicitClient || (isCodex ? 'codex' : isCopilot ? 'copilot' : isQoder ? 'qoder' :
  isCodeBuddy ? 'codebuddy' : isCursor ? 'cursor' : 'claude');
const stateRoot = process.env.PONYTAIL_STATE_DIR || (explicitClient ? getConfigDir() : stateDir);
const statePath = path.join(stateRoot, 'ponytail-modes',
  createHash('sha256').update(client + '\0' + projectDir).digest('hex'), STATE_FILE);

function setMode(mode) {
  const normalized = normalizeMode(mode);
  if (!normalized) return;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, normalized);
}

function clearMode() {
  try { fs.unlinkSync(statePath); } catch (_) {}
}

function readMode() {
  try {
    const mode = fs.readFileSync(statePath, 'utf8').trim();
    return normalizeMode(mode) || (mode === 'review' ? getDefaultMode() : null);
  } catch (e) {
    return null;
  }
}

function cursorRulePath() {
  const root = process.env.CURSOR_PROJECT_DIR || process.cwd();
  const rule = path.join(root, '.cursor', 'rules', 'ponytail.mdc');
  return fs.existsSync(rule) ? rule : null;
}

function cursorRuleNotice(rule) {
  return 'Ponytail 当前由 Cursor 常驻规则 ' + rule + ' 管理，Hook 未追加规则。' +
    '需要切档或关闭时，先移除该常驻规则，再由项目 Hook 管理档位。';
}

function writeHookOutput(event, mode, context = '') {
  if (isCopilot) {

    process.stdout.write(JSON.stringify(
      event === 'SessionStart' && context ? { additionalContext: context } : {}));
    return;
  }
  if (isCodex) {

    const output = {};
    if (context) {
      output.hookSpecificOutput = {
        hookEventName: event,
        additionalContext: context,
      };
    }
    fs.writeSync(1, JSON.stringify(output));
    return;
  }
  if (isQoder || isCodeBuddy) {

    const output = {};
    if (context) {
      output.hookSpecificOutput = {
        hookEventName: event,
        additionalContext: context,
      };
    }
    process.stdout.write(JSON.stringify(output));
    return;
  }
  if (isCursor) {

    if (!context) return;
    const output = { additional_context: context };
    if (event === 'UserPromptSubmit') output.continue = true;
    process.stdout.write(JSON.stringify(output));
    return;
  }

  if (event === 'SubagentStart') {
    process.stdout.write(JSON.stringify(
      { hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
    return;
  }
  process.stdout.write(context);
}

module.exports = {
  clearMode,
  cursorRuleNotice,
  cursorRulePath,
  isCodeBuddy,
  isCodex,
  isCopilot,
  isCursor,
  isQoder,
  projectDir,
  stateDirectory: path.dirname(statePath),
  readMode,
  setMode,
  writeHookOutput,
};
