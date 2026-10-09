#!/usr/bin/env node

const { getPonytailInstructions } = require('./ponytail-instructions');
const { readMode, writeHookOutput } = require('./ponytail-runtime');

const mode = readMode();

if (!mode || mode === 'off') {
  process.exit(0);
}

function inject() {
  try {
    writeHookOutput('SubagentStart', mode, getPonytailInstructions(mode));
  } catch (e) {
  }
}

let matcherRe = null;
try {
  if (process.env.PONYTAIL_SUBAGENT_MATCHER) {
    matcherRe = new RegExp(process.env.PONYTAIL_SUBAGENT_MATCHER, 'i');
  }
} catch (e) {
  matcherRe = null;
}

if (!matcherRe) {
  inject();
  process.exit(0);
}

let input = '';
let done = false;

function finish() {
  if (done) return;
  done = true;

  let agentType = '';
  try {
    agentType = String(JSON.parse(input.replace(/^\uFEFF/, '')).agent_type || '').trim();
  } catch (e) {
  }
  if (agentType && !matcherRe.test(agentType)) {
    process.exit(0);
  }
  inject();
}

process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', finish);
process.stdin.on('error', () => { finish(); process.exit(0); });
setTimeout(() => { finish(); process.exit(0); }, 1000).unref();
