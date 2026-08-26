import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { prerequisiteFailures, writeSmokeEvidence } from './bugfix-smoke-support.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
const { chromium } = await import('playwright');

const args = process.argv.slice(2);
const scenarioIndex = args.indexOf('--scenario');
const scenario = scenarioIndex === -1 ? null : args[scenarioIndex + 1];
if (!scenario || !['home-to-canvas'].includes(scenario)) {
  throw new Error('usage: npm run smoke:bugfix -- --scenario home-to-canvas');
}

const webRoot = resolve(import.meta.dirname, '..');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: webRoot, encoding: 'utf8' }).trim();
const evidenceDir = writeSmokeEvidence(webRoot, head, 'started.json', { scenario }).evidenceDir;
const build = spawnSync('npm', ['run', 'build:release'], { cwd: webRoot, encoding: 'utf8' });
const result = {
  command: 'npm run build:release',
  exitCode: build.status ?? 1,
  stdout: build.stdout,
  stderr: build.stderr,
};
writeSmokeEvidence(webRoot, head, 'build.json', result);
const prerequisiteErrors = prerequisiteFailures({
  releaseIndex: resolve(webRoot, 'dist', 'index.html'),
  chromiumExecutable: chromium.executablePath(),
});
if (result.exitCode !== 0 || prerequisiteErrors.length > 0) {
  writeSmokeEvidence(webRoot, head, 'smoke.json', { prerequisiteErrors });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.stderr.write(`${prerequisiteErrors.join('\n')}\n`);
  process.exit(result.exitCode || 1);
}

const smokeCommand = `npx playwright test e2e/${scenario}.e2e.ts --config playwright.bugfix.config.ts`;
const smoke = spawnSync('npx', ['playwright', 'test', `e2e/${scenario}.e2e.ts`, '--config', 'playwright.bugfix.config.ts'], {
  cwd: webRoot,
  encoding: 'utf8',
  env: { ...process.env, BUGFIX_EVIDENCE_DIR: evidenceDir, PLAYWRIGHT_BROWSERS_PATH: '0' },
});
writeSmokeEvidence(webRoot, head, 'smoke.json', {
  command: smokeCommand,
  exitCode: smoke.status ?? 1,
  stdout: smoke.stdout,
  stderr: smoke.stderr,
});
process.stdout.write(smoke.stdout ?? '');
process.stderr.write(smoke.stderr ?? '');
process.exit(smoke.status ?? 1);
