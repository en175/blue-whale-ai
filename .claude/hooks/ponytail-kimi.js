#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

process.env.PONYTAIL_CLIENT = 'kimi';
const { getDefaultMode } = require('./ponytail-config');
const { readMode, setMode } = require('./ponytail-runtime');
const { getPonytailInstructions } = require('./ponytail-instructions');

const event = process.argv[2];
if (event === 'SessionStart') {
  setMode(getDefaultMode());
} else if (event === 'UserPromptSubmit') {
  const data = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (typeof data.prompt === 'string') {
    data.prompt = data.prompt.replace(/^(\s*)\/skill:(ponytail)(?=[\s-]|$)/i, '$1/$2');
  }
  const output = execFileSync(process.execPath, [path.join(__dirname, 'ponytail-mode-tracker.js')], {
    input: JSON.stringify(data), encoding: 'utf8', timeout: 2000,
  });
  const mode = readMode();
  const body = mode && mode !== 'off' ? getPonytailInstructions(mode) : '';
  process.stdout.write(output);
  if (body && !output.includes(body)) process.stdout.write((output ? '\n\n' : '') + body);
}
