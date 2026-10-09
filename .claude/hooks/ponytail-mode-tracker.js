#!/usr/bin/env node

const { getDefaultMode, isDeactivationCommand, writeDefaultMode } = require('./ponytail-config');
const {
  clearMode,
  cursorRuleNotice,
  cursorRulePath,
  isCursor,
  isQoder,
  readMode,
  setMode,
  writeHookOutput,
} = require('./ponytail-runtime');
const { getPonytailInstructions } = require('./ponytail-instructions');

let input = '';
let done = false;

function finish() {
  if (done) return;
  done = true;
  try {
    const data = JSON.parse(input.replace(/^\uFEFF/, ''));
    const prompt = (data.prompt || '').trim().toLowerCase();

    if (isCursor && (/^[/@$]ponytail/.test(prompt) || isDeactivationCommand(prompt))) {
      const rule = cursorRulePath();
      if (rule) {
        writeHookOutput('UserPromptSubmit', readMode() || 'off', cursorRuleNotice(rule));
        return;
      }
    }

    let modeSwitched = false;
    let deactivated = false;
    if (/^[/@$]ponytail/.test(prompt)) {
      const parts = prompt.split(/\s+/);
      const cmd = parts[0].replace(/^[@$]/, '/');
      const arg = parts[1] || '';

      let mode = null;
      let isReportOnly = false;

      if (cmd === '/ponytail-review' || cmd === '/ponytail:ponytail-review') {
        mode = 'review';
      } else if (cmd === '/ponytail' || cmd === '/ponytail:ponytail') {
        if (arg === 'default') {
          const dmode = parts[2];
          if (dmode === 'off' || dmode === 'lite' || dmode === 'full' || dmode === 'ultra') {
            writeDefaultMode(dmode);
            writeHookOutput('UserPromptSubmit', dmode, 'PONYTAIL DEFAULT SET — new sessions start in ' + dmode + '.');
          }
          return;
        }
        if (arg === 'lite') mode = 'lite';
        else if (arg === 'full') mode = 'full';
        else if (arg === 'ultra') mode = 'ultra';
        else if (arg === 'off') mode = 'off';
        else if (arg === '') {
          isReportOnly = true;
          mode = readMode() || getDefaultMode();
        } else {
          mode = getDefaultMode();
        }
      }

      if (isReportOnly) {
        writeHookOutput(
          'UserPromptSubmit',
          mode,
          'PONYTAIL MODE ACTIVE — level: ' + mode,
        );
      } else if (mode && mode !== 'off') {
        setMode(mode);
        modeSwitched = true;
        if (!isQoder) {
          const header = 'PONYTAIL MODE CHANGED — level: ' + mode;
          writeHookOutput(
            'UserPromptSubmit',
            mode,
            isCursor ? header + '\n\n' + getPonytailInstructions(mode) : header,
          );
        }
      } else if (mode === 'off') {
        clearMode();
        deactivated = true;
        writeHookOutput('UserPromptSubmit', 'off', 'PONYTAIL MODE OFF');
      }
    }

    if (!modeSwitched && !deactivated && isDeactivationCommand(prompt)) {
      clearMode();
      deactivated = true;
      writeHookOutput('UserPromptSubmit', 'off', 'PONYTAIL MODE OFF');
    }

    if (isQoder && !deactivated) {
      let currentMode = readMode();
      if (!currentMode) {
        currentMode = getDefaultMode();
        if (currentMode !== 'off') {
          try { setMode(currentMode); } catch (e) {}
        }
      }
      if (currentMode && currentMode !== 'off') {
        const header = modeSwitched
          ? 'PONYTAIL MODE CHANGED — level: ' + currentMode + '\n\n'
          : '';
        writeHookOutput('UserPromptSubmit', currentMode, header + getPonytailInstructions(currentMode));
      }
    }
  } catch (e) {
  }
}

process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', finish);

process.stdin.on('error', () => { finish(); process.exit(0); });
setTimeout(() => { finish(); process.exit(0); }, 1000).unref();
