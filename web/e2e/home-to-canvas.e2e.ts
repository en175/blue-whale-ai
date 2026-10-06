import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureForRequest, smokeFailures } from '../scripts/bugfix-smoke-support.mjs';

type Fixture = { status: number; body: unknown; headers?: Record<string, string> };

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'home-to-canvas.json'), 'utf8'),
) as Record<string, Fixture>;

test('home-to-canvas', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'bw-auth',
      JSON.stringify({
        state: {
          isNewUser: false,
          user: {
            userId: 101,
            username: 'smoke-user',
            email: 'smoke@example.com',
            phone: '',
            hasPassword: true,
            isAdmin: false,
          },
        },
        version: 0,
      }),
    );
  });
  const evidenceDir = process.env.BUGFIX_EVIDENCE_DIR;
  const consoleErrors: string[] = [];
  const unexpectedRequests: string[] = [];
  const failedResponses: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400 && !url.pathname.startsWith('/api/')) {
      failedResponses.push(`${response.status()} ${url.pathname}${url.search}`);
    }
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}${url.search}`;
    let response: Fixture;
    try {
      response = fixtureForRequest(fixture, key);
    } catch (error) {
      unexpectedRequests.push(key);
      await route.fulfill({ status: 599, body: JSON.stringify({ error: String(error) }) });
      return;
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      headers: response.headers,
      body: JSON.stringify(response.body),
    });
  });

  try {
    const meResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/me');
    await page.goto('/');
    await meResponse;
    await expect(page.getByRole('button', { name: 'smoke-user' })).toBeVisible();
    await page.locator('textarea').first().fill('为产品制作一个视频');
    await page.locator('button[class*="sendBtn"]').click();

    await expect(page).toHaveURL(/\/canvas(\?.*)?$/);
    await expect(page.locator('.react-flow')).toBeVisible();
    await expect(page.getByText('Smoke 项目', { exact: true })).toBeVisible();
    expect(smokeFailures({ consoleErrors, unexpectedRequests, failedResponses })).toEqual([]);
  } finally {
    if (evidenceDir) {
      await page.screenshot({ path: join(evidenceDir, `${testInfo.title}.png`), fullPage: true }).catch(() => undefined);
      writeFileSync(
        join(evidenceDir, 'network-and-console.json'),
        `${JSON.stringify({ consoleErrors, unexpectedRequests, failedResponses }, null, 2)}\n`,
      );
    }
  }
});
