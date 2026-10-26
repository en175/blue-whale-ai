import { describe, expect, it } from 'vitest';
import { filledKeyValueRows, filledPriceRows, planRows } from './rowPlan';

describe('planRows / filledRows', () => {
  const row = (key: string, value = '') => ({ key, value });

  it('候选集里的行按候选顺序排；目录已有同键的行**原样带过来**', () => {
    const existing = [row('size=2k', '2')];
    const plan = planRows(existing, ['size=1k', 'size=2k'], (key) => row(key));
    expect(plan.rows.map((r) => r.key)).toEqual(['size=1k', 'size=2k']);
    expect(plan.rows[1]).toBe(existing[0]);
    expect(plan.rows[0]?.value).toBe('');
    expect(plan.orphans).toEqual([]);
  });

  it('键的大小写不敏感地对上（库里的 2K 与候选的 2k 是一行）', () => {
    const existing = [row('SIZE=2K', '2')];
    const plan = planRows(existing, ['size=2k'], (key) => row(key));
    expect(plan.rows[0]).toBe(existing[0]);
    expect(plan.orphans).toEqual([]);
  });

  it('★ 候选集里没有的键 → 孤儿（标出来而不是静默删掉）', () => {
    const existing = [row('size=1k', '1'), row('size=4k', '3')];
    const plan = planRows(existing, ['size=1k', 'size=2k'], (key) => row(key));
    expect(plan.rows.map((r) => r.key)).toEqual(['size=1k', 'size=2k']);
    expect(plan.orphans.map((r) => r.key)).toEqual(['size=4k']);
  });

  it('候选集不可得（null）→ 原样返回，调用方退回自由编辑', () => {
    const existing = [row('任意键', '1')];
    const plan = planRows(existing, null, (key) => row(key));
    expect(plan.rows).toBe(existing);
    expect(plan.orphans).toEqual([]);
  });

  it('★ 没填过的候选格子不进表单（否则「打开看一眼、点保存」会把空档位写进目录）', () => {
    const rows = [row('size=1k', '1'), row('size=1.5k', ''), row('size=2k', '3')];
    expect(filledKeyValueRows(rows).map((r) => r.key)).toEqual(['size=1k', 'size=2k']);
  });

  it('价格行多一条「清空 = 不改原值」：有原 mc 的空文本行要留着', () => {
    const rows = [
      { key: 'size=1k', value: '1', originalMc: 4500 },
      { key: 'size=1.5k', value: '', originalMc: null },
      { key: 'size=2k', value: '', originalMc: 9000 },
    ];
    expect(filledPriceRows(rows).map((r) => r.key)).toEqual(['size=1k', 'size=2k']);
  });

  it('键为空的行一律丢掉（派生模式下没有自由键，空键行只是残渣）', () => {
    expect(filledKeyValueRows([row('', '1')])).toEqual([]);
  });
});
