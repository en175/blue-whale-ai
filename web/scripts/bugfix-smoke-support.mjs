import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function fixtureForRequest(fixtures, key) {
  const fixture = fixtures[key];
  if (!fixture) throw new Error(`Undeclared fixture: ${key}`);
  if (!Array.isArray(fixture.allowedStatuses) || !fixture.allowedStatuses.includes(fixture.status)) {
    throw new Error(`Fixture does not allow response status ${fixture.status}: ${key}`);
  }
  return fixture;
}

export function smokeFailures({ consoleErrors, unexpectedRequests, failedResponses }) {
  return [
    ...consoleErrors.map((message) => `console.error: ${message}`),
    ...unexpectedRequests.map((request) => `undeclared API request: ${request}`),
    ...failedResponses.map((response) => `static resource failure: ${response}`),
  ];
}

export function prerequisiteFailures({ releaseIndex, chromiumExecutable }) {
  return [
    ...(existsSync(releaseIndex) ? [] : [`Missing release build artifact: ${releaseIndex}`]),
    ...(existsSync(chromiumExecutable) ? [] : [`Missing Chromium executable: ${chromiumExecutable}`]),
  ];
}

export function writeSmokeEvidence(webRoot, head, name, content) {
  const evidenceDir = resolve(webRoot, '.bugfix-evidence', head);
  mkdirSync(evidenceDir, { recursive: true });
  const path = resolve(evidenceDir, name);
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
  return { evidenceDir, path };
}
