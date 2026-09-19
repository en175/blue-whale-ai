/* IKGGCT T2：拖拽 change 流吸附改写——主拖卡修正、多选统一偏移、被拖集合互不为
 * 参考、开关/Alt 短路、组框参考块、zoom 换算、非位移帧与未知尺寸原样透传、
 * guides 与 snapAlignment 计算一致 */
import { describe, expect, it } from 'vitest';
import type { NodeChange } from '@xyflow/react';
import { collectSnapTargets, computeSnapAlignment, type SnapGuide, type SnapNodeLike } from './snapAlignment';
import { EMPTY_SNAP_GUIDES, snapDragChanges } from './snapDragChanges';

function node(id: string, x: number, y: number, size?: { w: number; h: number; measured?: boolean }): SnapNodeLike {
  const base: SnapNodeLike = { id, position: { x, y } };
  if (!size) return base;
  return size.measured
    ? { ...base, measured: { width: size.w, height: size.h } }
    : { ...base, width: size.w, height: size.h };
}

function posChange(id: string, x: number, y: number, dragging = true): NodeChange {
  return { id, type: 'position', position: { x, y }, dragging };
}

/** 100×80 的静止参考卡，左上角在原点（左边 0、中心 x 50） */
const REF_C = node('ref-c', 0, 0, { w: 100, h: 80 });
/** 主拖卡 A：100×80，尺寸走 measured 分支 */
const MAIN_A = node('main-a', 0, 0, { w: 100, h: 80, measured: true });

describe('snapDragChanges：位置改写', () => {
  it('主拖卡 position change 被改写为吸附后位置（left 贴 left，dx 施加到 change.position）', () => {
    // 参考卡宽 60（中心 x=30，距主拖卡中心 23px 不命中）：唯一命中 left——
    // 与 centerX 并列时 T1 约定取前者，此处让关系唯一以便断言
    const ref = node('ref-c', 0, 0, { w: 60, h: 80 });
    // 主拖卡本帧原始位置 (3,100)：左边距参考卡左边 3px，命中吸附被拉到 0
    const { changes, guides } = snapDragChanges(
      [posChange('main-a', 3, 100)],
      [MAIN_A, ref],
      [],
      'main-a',
      ['main-a'],
    );
    expect(changes[0]).toMatchObject({ id: 'main-a', type: 'position', position: { x: 0, y: 100 } });
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ orientation: 'vertical', relation: 'left', targetId: 'ref-c', pos: 0 });
  });

  it('收尾帧（dragging:false）同样改写，保证松手落点与拖拽显示一致', () => {
    const { changes } = snapDragChanges(
      [posChange('main-a', 3, 100, false)],
      [MAIN_A, REF_C],
      [],
      'main-a',
      ['main-a'],
    );
    expect(changes[0]).toMatchObject({ position: { x: 0, y: 100 }, dragging: false });
  });

  it('多选拖拽：被拖成员与主拖卡施加同一修正量（相对位置不变）', () => {
    const member = node('member-b', 203, 500, { w: 60, h: 50 });
    const { changes } = snapDragChanges(
      [posChange('main-a', 3, 100), posChange('member-b', 203, 500)],
      [MAIN_A, member, REF_C],
      [],
      'main-a',
      ['main-a', 'member-b'],
    );
    expect(changes[0]).toMatchObject({ id: 'main-a', position: { x: 0, y: 100 } });
    expect(changes[1]).toMatchObject({ id: 'member-b', position: { x: 200, y: 500 } });
  });

  it('被拖集合互不为参考块：与主拖卡完全对齐的被拖成员不产生命中，修正由静止参考卡决定', () => {
    // member-b 与主拖卡同 x=3：若未被排除，其 dx=0 会抢先命中（targetId=member-b 且无修正）
    const aligned = node('member-b', 3, 500, { w: 100, h: 80 });
    const { changes, guides } = snapDragChanges(
      [posChange('main-a', 3, 100), posChange('member-b', 3, 500)],
      [MAIN_A, aligned, REF_C],
      [],
      'main-a',
      ['main-a', 'member-b'],
    );
    expect(guides).toHaveLength(1);
    expect(guides[0].targetId).toBe('ref-c');
    expect(changes[0]).toMatchObject({ position: { x: 0, y: 100 } });
    expect(changes[1]).toMatchObject({ position: { x: 0, y: 500 } });
  });

  it('组框伪节点作为参考块参与对齐（尺寸由调用侧从 groups[].box 转换）', () => {
    const frame = { id: 'group-1', type: 'groupFrame', position: { x: 500, y: 200 }, width: 300, height: 200 };
    const { changes, guides } = snapDragChanges(
      [posChange('main-a', 503, 900)],
      [MAIN_A],
      [frame],
      'main-a',
      ['main-a'],
    );
    expect(changes[0]).toMatchObject({ position: { x: 500, y: 900 } });
    expect(guides[0]).toMatchObject({ targetId: 'group-1', relation: 'left' });
  });

  it('zoom 换算屏幕阈值：zoom=2 时画布阈值减半，5px 偏移不再命中', () => {
    const opts = [{ zoom: 1 }, { zoom: 2 }];
    const [plain, zoomed] = opts.map((o) =>
      snapDragChanges([posChange('main-a', 5, 100)], [MAIN_A, REF_C], [], 'main-a', ['main-a'], o),
    );
    expect(plain.changes[0]).toMatchObject({ position: { x: 0, y: 100 } });
    expect(zoomed.changes[0]).toMatchObject({ position: { x: 5, y: 100 } });
    expect(zoomed.guides).toEqual(EMPTY_SNAP_GUIDES);
  });
});

describe('snapDragChanges：短路透传', () => {
  const changes: NodeChange[] = [posChange('main-a', 3, 100)];

  it('enabled:false 不改写、无对齐线', () => {
    const res = snapDragChanges(changes, [MAIN_A, REF_C], [], 'main-a', ['main-a'], { enabled: false });
    expect(res.changes).toBe(changes);
    expect(res.guides).toEqual(EMPTY_SNAP_GUIDES);
  });

  it('altDisabled:true（Alt/Option 按住）不改写、无对齐线', () => {
    const res = snapDragChanges(changes, [MAIN_A, REF_C], [], 'main-a', ['main-a'], { altDisabled: true });
    expect(res.changes).toBe(changes);
    expect(res.guides).toEqual(EMPTY_SNAP_GUIDES);
  });

  it('primaryDragId 为 null（未记录主拖卡）不改写', () => {
    const res = snapDragChanges(changes, [MAIN_A, REF_C], [], null, []);
    expect(res.changes).toBe(changes);
  });

  it('本帧无带坐标的 position change（select/dimension 混合帧）原样透传', () => {
    const idle: NodeChange[] = [
      { id: 'main-a', type: 'select', selected: true },
      { id: 'main-a', type: 'position', dragging: false },
      { id: 'main-a', type: 'dimensions', resizing: false },
    ];
    const res = snapDragChanges(idle, [MAIN_A, REF_C], [], 'main-a', ['main-a']);
    expect(res.changes).toBe(idle);
    expect(res.guides).toEqual(EMPTY_SNAP_GUIDES);
  });

  it('主拖卡本帧没有 position change（其余成员位移帧）不改写', () => {
    const res = snapDragChanges(
      [posChange('member-b', 3, 500)],
      [MAIN_A, node('member-b', 0, 500, { w: 100, h: 80 }), REF_C],
      [],
      'main-a',
      ['main-a', 'member-b'],
    );
    expect(res.changes[0]).toMatchObject({ position: { x: 3, y: 500 } });
    expect(res.guides).toEqual(EMPTY_SNAP_GUIDES);
  });

  it('主拖卡尺寸未知（measured 与 width/height 均缺）不改写', () => {
    const res = snapDragChanges(
      [posChange('ghost', 3, 100)],
      [node('ghost', 3, 100), REF_C],
      [],
      'ghost',
      ['ghost'],
    );
    expect(res.changes[0]).toMatchObject({ position: { x: 3, y: 100 } });
    expect(res.guides).toEqual(EMPTY_SNAP_GUIDES);
  });
});

describe('snapDragChanges：guides 与 snapAlignment 一致', () => {
  it('改写帧的 guides 等于 computeSnapAlignment(collectSnapTargets(...)) 的输出', () => {
    const draggingIds = ['main-a', 'member-b'];
    const nodes = [MAIN_A, node('member-b', 203, 500, { w: 60, h: 50 }), REF_C];
    const frames = [{ id: 'group-1', type: 'groupFrame', position: { x: 500, y: 200 }, width: 300, height: 200 }];
    const { guides } = snapDragChanges(
      [posChange('main-a', 3, 96), posChange('member-b', 203, 496)],
      nodes,
      frames,
      'main-a',
      draggingIds,
      { zoom: 1.5 },
    );
    const targets = collectSnapTargets([...nodes, ...frames], [...draggingIds, 'main-a', 'member-b']);
    const expected: SnapGuide[] = computeSnapAlignment(
      { x: 3, y: 96, width: 100, height: 80 },
      targets,
      { zoom: 1.5 },
    ).guides;
    expect(guides).toEqual(expected);
  });
});
