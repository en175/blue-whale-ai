#!/usr/bin/env node

const path = require('path');
const { getDefaultMode, isDeactivationCommand, writeDefaultMode, normalizeMode } = require('./ponytail-config');
const {
  clearMode,
  cursorRuleNotice,
  cursorRulePath,
  isCodex,
  isCursor,
  isQoder,
  projectDir,
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
    let prompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
    if (isCodex) {
      const reference = '[$ponytail](' + path.join(projectDir, '.agents/skills/ponytail/SKILL.md') + ')';
      const suffix = prompt.slice(reference.length);
      if (prompt.startsWith(reference) && /^(?:\s|$)/.test(suffix)) prompt = '$ponytail' + suffix;
    }
    prompt = prompt.toLowerCase();

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

      if (cmd === '/ponytail' || cmd === '/ponytail:ponytail') {

        if (arg === 'default') {
          const dmode = normalizeMode(parts[2]);
          if (parts.length === 3 && dmode) {
            writeDefaultMode(dmode);
            writeHookOutput('UserPromptSubmit', dmode, 'Ponytail 默认值已设置为 ' + dmode + '，新会话生效，当前档位保持不变。');
          }
          return;
        }
        if (parts.length > 2) return;
        if (arg) mode = normalizeMode(arg);
        else {

          const live = readMode();
          if (live && live !== 'off') {
            isReportOnly = true;
            mode = live;
          } else {
            mode = getDefaultMode() === 'off' ? 'full' : getDefaultMode();
          }
        }
      }

      if (isReportOnly) {

        if (!isQoder) {
          writeHookOutput(
            'UserPromptSubmit',
            mode,
            'PONYTAIL MODE ACTIVE，level: ' + mode,
          );
        }
      } else if (mode && mode !== 'off') {
        setMode(mode);
        modeSwitched = true;

        if (!isQoder) {

          const header = 'PONYTAIL MODE CHANGED，level: ' + mode;
          writeHookOutput(
            'UserPromptSubmit',
            mode,
            header + '\n\n' + getPonytailInstructions(mode),
          );
        }
      } else if (mode === 'off') {
        if (isQoder) setMode('off');
        else clearMode();

        deactivated = true;
        writeHookOutput('UserPromptSubmit', 'off', 'PONYTAIL MODE OFF');
      }
    }

    if (!modeSwitched && !deactivated && isDeactivationCommand(prompt)) {
      if (isQoder) setMode('off');
      else clearMode();

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
          ? 'PONYTAIL MODE CHANGED，level: ' + currentMode + '\n\n'
          : '';
        writeHookOutput('UserPromptSubmit', currentMode, header + getPonytailInstructions(currentMode));
      }
    }
  } catch (e) {

  }
}

process.stdin.on('data', chunk => { input += chunk; });

process.stdin.on('end', () => { finish(); process.exit(0); });

process.stdin.on('error', () => { finish(); process.exit(0); });
setTimeout(() => { finish(); process.exit(0); }, 1000);
