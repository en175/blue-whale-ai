import { describe, expect, it } from 'vitest';
import {
  applySubtitleBox,
  canAddSubtitleBox,
  canRedoSubtitleBoxEdit,
  canUndoSubtitleBoxEdit,
  displayBoxToNormalized,
  EMPTY_SUBTITLE_BOX_EDIT,
  redoSubtitleBoxEdit,
  resetSubtitleBoxes,
  subtitleBoxesToPayload,
  undoSubtitleBoxEdit,
  type SubtitleBoxOp,
} from './subtitleEraseBoxes';
import { VIDEO_SUBTITLE_ERASE_MAX_BOXES } from '@lib/contracts/video-subtitle-erase';

/** 便捷构造：显示坐标对角框图元 */
function box(x1: number, y1: number, x2: number, y2: number): SubtitleBoxOp {
  return { kind: 'box', from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
}

describe('IKGZ83 框集合：增删与撤销重做小栈', () => {
  it('落笔即固化进撤销栈；新落笔清空重做栈（撤销后旧分支不可重做）', () => {
    let state = EMPTY_SUBTITLE_BOX_EDIT;
    expect(canUndoSubtitleBoxEdit(state)).toBe(false);
    state = applySubtitleBox(state, box(10, 20, 100, 80));
    state = applySubtitleBox(state, box(20, 30, 120, 90));
    expect(state.boxes.length).toBe(2);
    expect(canUndoSubtitleBoxEdit(state)).toBe(true);
    expect(canRedoSubtitleBoxEdit(state)).toBe(false);
    state = undoSubtitleBoxEdit(state);
    expect(state.boxes.length).toBe(1);
    expect(canRedoSubtitleBoxEdit(state)).toBe(true);
    // 撤销后落新框：重做栈被清空
    state = applySubtitleBox(state, box(0, 0, 10, 10));
    expect(canRedoSubtitleBoxEdit(state)).toBe(false);
    expect(state.boxes.length).toBe(2);
  });

  it('撤销弹栈压重做栈；重做弹重做栈压撤销栈；空栈原样返回不崩', () => {
    let state = applySubtitleBox(EMPTY_SUBTITLE_BOX_EDIT, box(1, 1, 2, 2));
    const undone = undoSubtitleBoxEdit(state);
    expect(undone.boxes).toEqual([]);
    expect(undone.redoStack.length).toBe(1);
    const redone = redoSubtitleBoxEdit(undone);
    expect(redone.boxes.length).toBe(1);
    expect(redone.redoStack).toEqual([]);
    // 空栈幂等
    expect(undoSubtitleBoxEdit(EMPTY_SUBTITLE_BOX_EDIT)).toBe(EMPTY_SUBTITLE_BOX_EDIT);
    expect(redoSubtitleBoxEdit(EMPTY_SUBTITLE_BOX_EDIT)).toBe(EMPTY_SUBTITLE_BOX_EDIT);
  });

  it('20 个上限：canAdd 判定翻转、apply 超限原样返回不截断', () => {
    let state = EMPTY_SUBTITLE_BOX_EDIT;
    for (let i = 0; i < VIDEO_SUBTITLE_ERASE_MAX_BOXES; i += 1) {
      state = applySubtitleBox(state, box(i, 0, i + 1, 10));
    }
    expect(state.boxes.length).toBe(VIDEO_SUBTITLE_ERASE_MAX_BOXES);
    expect(canAddSubtitleBox(state)).toBe(false);
    const rejected = applySubtitleBox(state, box(0, 0, 5, 5));
    expect(rejected).toBe(state);
    expect(rejected.boxes.length).toBe(VIDEO_SUBTITLE_ERASE_MAX_BOXES);
    // 撤销一个后可再加
    const afterUndo = undoSubtitleBoxEdit(state);
    expect(canAddSubtitleBox(afterUndo)).toBe(true);
  });

  it('零面积框（单击未拖拽的误触）不进栈', () => {
    const clicked = applySubtitleBox(EMPTY_SUBTITLE_BOX_EDIT, box(30, 30, 30, 30));
    expect(clicked).toBe(EMPTY_SUBTITLE_BOX_EDIT);
    const dragged = applySubtitleBox(EMPTY_SUBTITLE_BOX_EDIT, box(30, 30, 30, 31));
    expect(dragged.boxes.length).toBe(1);
  });
});

describe('IKH3OV 重置：清空全部框且一步可撤销（undo/redo 从逐框增删扩为逐框增删+整批清空）', () => {
  it('重置清空全部框并可撤销；无框时原样返回不产生空步骤', () => {
    expect(resetSubtitleBoxes(EMPTY_SUBTITLE_BOX_EDIT)).toBe(EMPTY_SUBTITLE_BOX_EDIT);
    let state = applySubtitleBox(EMPTY_SUBTITLE_BOX_EDIT, box(1, 1, 2, 2));
    state = applySubtitleBox(state, box(3, 3, 4, 4));
    const cleared = resetSubtitleBoxes(state);
    expect(cleared.boxes).toEqual([]);
    // 重置本身是撤销栈里的一步：框清了但仍可撤销
    expect(canUndoSubtitleBoxEdit(cleared)).toBe(true);
    expect(canRedoSubtitleBoxEdit(cleared)).toBe(false);
    expect(canAddSubtitleBox(cleared)).toBe(true);
    // 已无框可清：不产生第二次 reset 步骤（避免用无效操作污染撤销栈）
    expect(resetSubtitleBoxes(cleared)).toBe(cleared);
  });

  it('撤销重置：把清空前的框集合整批还原（顺序不变）；重做再次清空', () => {
    const first = box(10, 20, 100, 80);
    const second = box(20, 30, 120, 90);
    let state = applySubtitleBox(EMPTY_SUBTITLE_BOX_EDIT, first);
    state = applySubtitleBox(state, second);
    const restored = undoSubtitleBoxEdit(resetSubtitleBoxes(state));
    expect(restored.boxes).toEqual([first, second]);
    expect(canRedoSubtitleBoxEdit(restored)).toBe(true);
    const reCleared = redoSubtitleBoxEdit(restored);
    expect(reCleared.boxes).toEqual([]);
    expect(canRedoSubtitleBoxEdit(reCleared)).toBe(false);
  });

  it('逐步撤销跨过重置步骤：先整批还原，再逐框回退到空栈', () => {
    let state = applySubtitleBox(EMPTY_SUBTITLE_BOX_EDIT, box(1, 1, 2, 2));
    state = applySubtitleBox(state, box(3, 3, 4, 4));
    state = resetSubtitleBoxes(state);
    state = undoSubtitleBoxEdit(state);
    expect(state.boxes.length).toBe(2);
    state = undoSubtitleBoxEdit(state);
    expect(state.boxes.length).toBe(1);
    state = undoSubtitleBoxEdit(state);
    expect(state.boxes.length).toBe(0);
    expect(canUndoSubtitleBoxEdit(state)).toBe(false);
  });

  it('重置后落新框清空重做栈：被清空的旧框分支不可再重做', () => {
    let state = applySubtitleBox(EMPTY_SUBTITLE_BOX_EDIT, box(1, 1, 2, 2));
    state = resetSubtitleBoxes(state);
    state = applySubtitleBox(state, box(5, 5, 6, 6));
    expect(state.boxes.length).toBe(1);
    expect(canRedoSubtitleBoxEdit(state)).toBe(false);
  });
});

describe('IKGZ83 显示坐标 → 归一化坐标换算（官方 Location 语义）', () => {
  it('对角归一：反向拉框（右下→左上）产出 top_left ≤ bottom_right 的同区域', () => {
    const forward = displayBoxToNormalized(box(10, 20, 100, 80), 200, 100);
    const backward = displayBoxToNormalized(box(100, 80, 10, 20), 200, 100);
    expect(forward).toEqual(backward);
    expect(forward).toEqual({ top_left_x: 0.05, top_left_y: 0.2, bottom_right_x: 0.5, bottom_right_y: 0.8 });
  });

  it('越界钳位 [0,1]：拖出显示区域的坐标收进画面边界', () => {
    expect(displayBoxToNormalized(box(-30, -10, 260, 120), 200, 100)).toEqual({
      top_left_x: 0, top_left_y: 0, bottom_right_x: 1, bottom_right_y: 1,
    });
  });

  it('零尺寸防御：显示尺寸缺失按 1 换算（钳位兜底不产生 NaN/Infinity）', () => {
    const result = displayBoxToNormalized(box(10, 10, 50, 50), 0, 0);
    expect(Number.isFinite(result.top_left_x)).toBe(true);
    expect(result.bottom_right_x).toBeLessThanOrEqual(1);
  });

  it('subtitleBoxesToPayload 保持落笔顺序；空集合产空数组（契约合法值）', () => {
    expect(subtitleBoxesToPayload([], 200, 100)).toEqual([]);
    const payload = subtitleBoxesToPayload([box(0, 0, 100, 50), box(100, 50, 200, 100)], 200, 100);
    expect(payload.length).toBe(2);
    expect(payload[0]).toMatchObject({ top_left_x: 0, top_left_y: 0, bottom_right_x: 0.5, bottom_right_y: 0.5 });
    expect(payload[1]).toMatchObject({ top_left_x: 0.5, top_left_y: 0.5, bottom_right_x: 1, bottom_right_y: 1 });
    // 契约 zod 形态自查：四键齐、值域 [0,1]
    for (const item of payload) {
      for (const value of Object.values(item)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});
