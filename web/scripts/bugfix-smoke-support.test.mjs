import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import {
  fixtureForRequest,
  prerequisiteFailures,
  smokeFailures,
  writeSmokeEvidence,
} from './bugfix-smoke-support.mjs';

test('fixture responses require an explicit allowed status', () => {
  const fixture = fixtureForRequest(
    { 'GET /api/me': { status: 200, allowedStatuses: [200], body: {} } },
    'GET /api/me',
  );
  assert.equal(fixture.status, 200);
  assert.throws(
    () => fixtureForRequest({ 'GET /api/me': { status: 500, allowedStatuses: [200] } }, 'GET /api/me'),
    /does not allow response status 500/,
  );
  assert.throws(() => fixtureForRequest({}, 'GET /api/me'), /Undeclared fixture/);
});

test('smoke observations reject console, API, and static-resource failures', () => {
  assert.deepEqual(smokeFailures({ consoleErrors: [], unexpectedRequests: [], failedResponses: [] }), []);
  assert.deepEqual(
    smokeFailures({
      consoleErrors: ['unexpected error'],
      unexpectedRequests: ['GET /api/unknown'],
      failedResponses: ['404 /assets/missing.svg'],
    }),
    [
      'console.error: unexpected error',
      'undeclared API request: GET /api/unknown',
      'static resource failure: 404 /assets/missing.svg',
    ],
  );
});

test('runner prerequisites require release output and Chromium', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bugfix-smoke-'));
  const releaseIndex = join(directory, 'dist', 'index.html');
  const chromium = join(directory, 'chromium');
  assert.equal(prerequisiteFailures({ releaseIndex, chromiumExecutable: chromium }).length, 2);
  mkdirSync(join(directory, 'dist'));
  writeFileSync(releaseIndex, '');
  writeFileSync(chromium, '');
  assert.deepEqual(prerequisiteFailures({ releaseIndex, chromiumExecutable: chromium }), []);
});

test('evidence writer creates an ignored run directory for summaries and screenshots', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bugfix-evidence-'));
  const result = writeSmokeEvidence(directory, 'head-sha', 'network-and-console.json', { consoleErrors: [] });
  assert.ok(existsSync(result.evidenceDir));
  assert.deepEqual(JSON.parse(readFileSync(result.path, 'utf8')), { consoleErrors: [] });
});
