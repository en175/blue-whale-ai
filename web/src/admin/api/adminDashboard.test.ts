import { describe, expect, it } from 'vitest';
import { beijingToday } from './adminDashboard';

describe('beijingToday', () => {
  it('产出 YYYY-MM-DD', () => {
    expect(beijingToday(new Date('2026-09-30T02:00:00Z'))).toBe('2026-09-30');
  });

  it('按北京日切，不按进程/浏览器本地时区', () => {
    expect(beijingToday(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10-01');
    expect(beijingToday(new Date('2026-09-30T15:59:59Z'))).toBe('2026-09-30');
  });
});
