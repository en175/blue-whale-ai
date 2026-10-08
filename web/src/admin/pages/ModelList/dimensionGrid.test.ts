import { describe, expect, it } from 'vitest';
import { buildDimensionGrid, gridSpecKey, setGridCell } from './dimensionGrid';

describe('buildDimensionGrid 扁平表 → 矩阵', () => {
  const row = (key: string, value: string) => ({ key, value });
  const size = (id: string) => ({ id, label: id.toUpperCase() });

  it('行列就位：行=比例、列=尺寸档，格子取库里的值', () => {
    const grid = buildDimensionGrid(
      [size('480p'), size('720p')],
      ['16:9', '9:16'],
      [row('resolution=480p|aspect_ratio=16:9', '864x496')],
    );
    expect(grid.columns.map((c) => c.label)).toEqual(['480P', '720P']);
    expect(grid.rows.map((r) => r.ratio)).toEqual(['16:9', '9:16']);
    expect(grid.rows[0]?.cells.map((c) => c.value)).toEqual(['864x496', '']);
    expect(grid.orphans).toEqual([]);
  });

  it('★ 档位大小写不一致时格子照样显示得出值（`4K` 列不会整列空掉）', () => {
    const stored = row('resolution=4k|aspect_ratio=16:9', '3840x2160');
    const grid = buildDimensionGrid([size('4K')], ['16:9'], [stored]);
    expect(grid.rows[0]?.cells[0]?.value).toBe('3840x2160');
    expect(grid.rows[0]?.cells[0]?.originalKey).toBe(stored.key);
  });

  it('键里的轴序反过来也认（后端 parseSpecKey 同样顺序无关）', () => {
    const grid = buildDimensionGrid(
      [size('480p')],
      ['16:9'],
      [row('aspect_ratio=16:9|resolution=480p', '864x496')],
    );
    expect(grid.rows[0]?.cells[0]?.value).toBe('864x496');
    expect(grid.orphans).toEqual([]);
  });

  it('★ 档位 / 比例里没有的键是孤儿（不静默丢掉）', () => {
    const stored = row('resolution=4k|aspect_ratio=16:9', '3840x2160');
    const grid = buildDimensionGrid([size('480p')], ['16:9'], [stored]);
    expect(grid.rows[0]?.cells[0]?.value).toBe('');
    expect(grid.orphans.map((r) => r.key)).toEqual([stored.key]);
  });

  it('空 id 的档位行不占列（运营正在填的那一行）', () => {
    const grid = buildDimensionGrid([size(''), size('480p')], ['16:9'], []);
    expect(grid.columns.map((c) => c.id)).toEqual(['480p']);
  });
});

describe('setGridCell 矩阵 → 扁平表', () => {
  const row = (key: string, value: string) => ({ key, value });
  const size = (id: string) => ({ id, label: id.toUpperCase() });

  it('★ 恒等写回：没动过的格子用库里原来的键（`4k` 不被一次保存改成 `4K`）', () => {
    const stored = row('resolution=4k|aspect_ratio=16:9', '3840x2160');
    const grid = buildDimensionGrid([size('4K')], ['16:9', '9:16'], [stored]);
    expect(setGridCell(grid, 1, 0, '2160x3840')).toEqual([
      { key: 'resolution=4k|aspect_ratio=16:9', value: '3840x2160' },
      { key: 'resolution=4K|aspect_ratio=9:16', value: '2160x3840' },
    ]);
  });

  it('★ 新建一格的键按本行的档位 id 拼', () => {
    const grid = buildDimensionGrid([size('480p')], ['16:9'], []);
    expect(setGridCell(grid, 0, 0, '864x496')).toEqual([
      { key: 'resolution=480p|aspect_ratio=16:9', value: '864x496' },
    ]);
  });

  it('格子被清空 = 这条组合不能用：键随之从表里消失（不写空值）', () => {
    const stored = row('resolution=480p|aspect_ratio=16:9', '864x496');
    const grid = buildDimensionGrid([size('480p')], ['16:9'], [stored]);
    expect(setGridCell(grid, 0, 0, '')).toEqual([]);
  });

  it('没填过的候选格子不进表单（与 filledKeyValueRows 同口径）', () => {
    const grid = buildDimensionGrid([size('480p'), size('720p')], ['16:9'], []);
    expect(setGridCell(grid, 0, 0, '864x496')).toEqual([
      { key: 'resolution=480p|aspect_ratio=16:9', value: '864x496' },
    ]);
  });

  it('孤儿原样带着走：改一格不会把它写没', () => {
    const orphan = row('resolution=4k|aspect_ratio=16:9', '3840x2160');
    const grid = buildDimensionGrid([size('480p')], ['16:9'], [orphan]);
    expect(setGridCell(grid, 0, 0, '864x496')).toEqual([
      { key: 'resolution=480p|aspect_ratio=16:9', value: '864x496' },
      orphan,
    ]);
  });

  it('两列派生出同一个键时不写第二遍（一个键只能有一个值）', () => {
    const stored = row('resolution=480p|aspect_ratio=16:9', '864x496');
    const grid = buildDimensionGrid(
      [size('480p'), size('480P')],
      ['16:9'],
      [stored],
    );
    expect(setGridCell(grid, 0, 0, '999x999')).toEqual([
      { key: 'resolution=480p|aspect_ratio=16:9', value: '999x999' },
    ]);
  });
});

describe('gridSpecKey', () => {
  it('与 backend specKeyOf 逐字同形', () => {
    expect(gridSpecKey('1080p', 'adaptive')).toBe('resolution=1080p|aspect_ratio=adaptive');
  });
});
