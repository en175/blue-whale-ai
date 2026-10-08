#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { getDefaultMode, getClaudeDir, isShellSafe } = require('./ponytail-config');
const { getPonytailInstructions } = require('./ponytail-instructions');
const {
  clearMode,
  cursorRuleNotice,
  cursorRulePath,
  isCodex,
  isCopilot,
  isCursor,
  setMode,
  writeHookOutput,
} = require('./ponytail-runtime');

const claudeDir = getClaudeDir();
const settingsPath = path.join(claudeDir, 'settings.json');

const mode = getDefaultMode();

if (mode === 'off') {
  clearMode();
  const hookOutput = (isCodex || isCopilot || isCursor) ? '' : 'OK';
  writeHookOutput('SessionStart', 'off', hookOutput);
  process.exit(0);
}

if (isCursor) {
  const rule = cursorRulePath();
  if (rule) {
    try {
      writeHookOutput('SessionStart', mode, cursorRuleNotice(rule));
    } catch (e) {
    }
    process.exit(0);
  }
}

try {
  setMode(mode);
} catch (e) {
}

let output = getPonytailInstructions(mode);

if (!isCodex && !isCopilot && !isCursor) try {
  let hasStatusline = false;
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
    const settings = JSON.parse(raw);
    if (settings.statusLine) {
      hasStatusline = true;
    }
  }

  const nudgeFlagPath = path.join(claudeDir, '.ponytail-statusline-nudged');
  if (!hasStatusline && !fs.existsSync(nudgeFlagPath)) {
    try { fs.writeFileSync(nudgeFlagPath, ''); } catch (e) {  }
    const isWindows = process.platform === 'win32';
    const scriptName = isWindows ? 'ponytail-statusline.ps1' : 'ponytail-statusline.sh';
    const scriptPath = path.join(__dirname, scriptName);
    if (isShellSafe(scriptPath)) {
      const command = isWindows
        ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`
        : `bash "${scriptPath}"`;
      const statusLineSnippet =
        '"statusLine": { "type": "command", "command": ' + JSON.stringify(command) + ' }';
      output += "\n\n" +
        "STATUSLINE SETUP NEEDED: The ponytail plugin includes a statusline badge showing active mode " +
        "(e.g. [PONYTAIL], [PONYTAIL:ULTRA]). It is not configured yet. " +
        "To enable, add this to " + settingsPath + ": " +
        statusLineSnippet + " " +
        "Proactively offer to set this up for the user on first interaction.";
    } else {
      output += "\n\n" +
        "STATUSLINE SETUP NEEDED: The ponytail plugin includes a statusline badge showing active mode. " +
        "Its install path contains characters unsafe to embed in a shell command, so configure it manually: " +
        "add a statusLine command of type \"command\" that runs " + scriptName +
        " from the plugin's hooks directory to " + settingsPath + ", quoting/escaping the path for your shell. " +
        "Proactively offer to set this up for the user on first interaction.";
    }
  }
} catch (e) {
}

try {
  writeHookOutput('SessionStart', mode, output);
} catch (e) {
}
