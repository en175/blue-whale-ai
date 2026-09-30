import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fetchAccountCreditsPage, PLACEHOLDER_PAGE_DATA } from './data';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'data.ts'), 'utf8');

describe('fetchAccountCreditsPage', () => {
  it('仍是 TODO 占位，返回占位数据而不是真实接口', async () => {
    expect(source).toContain('@todo');
    expect(source).toContain('TODO(IKIZNS)');
    expect(source).not.toMatch(/apiRequest|fetch\(/);
    await expect(fetchAccountCreditsPage()).resolves.toEqual(PLACEHOLDER_PAGE_DATA);
  });

  it('占位订单不含支付成功待到账', () => {
    expect(JSON.stringify(PLACEHOLDER_PAGE_DATA)).not.toContain('支付成功待到账');
  });
});
