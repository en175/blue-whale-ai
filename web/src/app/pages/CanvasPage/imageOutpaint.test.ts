// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS,
  IMAGE_OUTPAINT_INPUT_KEYS,
  IMAGE_OUTPAINT_SOURCE,
  IMAGE_OUTPAINT_SOURCE_LIMITS,
  imageOutpaintInputSchema,
} from '@lib/contracts/image-outpaint';
import {
  ZERO_EXPANDS,
  buildImageOutpaintInput,
  clampExpands,
  dragExpandCorner,
  dragExpandEdge,
  expandRatiosOf,
  IMAGE_OUTPAINT_EDGE_ORIGIN,
  IMAGE_OUTPAINT_FILE_SIZE_LIMIT,
  IMAGE_OUTPAINT_LONG_SIDE_LIMIT,
  IMAGE_OUTPAINT_MAX_EXPAND_RATIO,
  maxExpandPerSide,
  matchOutpaintPreset,
  outpaintGateReason,
  outpaintPresetAvailability,
  presetExpands,
  type SourceRect,
} from './imageOutpaint';

const rect: SourceRect = { x: 1000, y: 500, width: 400, height: 300 };
const max = maxExpandPerSide(rect);

describe('IKGOR6 前后端同源防漂移（契约单处定义，本模块只许引用不得本地重写）', () => {
  it('门槛数值与预检文案与契约恒等：门槛判定委托 imageOutpaintSourceGate', () => {
    expect(IMAGE_OUTPAINT_LONG_SIDE_LIMIT).toBe(IMAGE_OUTPAINT_SOURCE_LIMITS.maxLongSide);
    expect(IMAGE_OUTPAINT_FILE_SIZE_LIMIT).toBe(IMAGE_OUTPAINT_SOURCE_LIMITS.maxFileSizeBytes);
    expect(IMAGE_OUTPAINT_MAX_EXPAND_RATIO).toBe(IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS.max);
    expect(outpaintGateReason(undefined, 300, 1000)).toBe(IMAGE_OUTPAINT_SOURCE_LIMITS.missingDimensionsText);
    expect(outpaintGateReason(4161, 300, 1000)).toBe(IMAGE_OUTPAINT_SOURCE_LIMITS.longSideRejectionText);
    expect(outpaintGateReason(400, 300, 10 * 1024 * 1024 + 1)).toBe(IMAGE_OUTPAINT_SOURCE_LIMITS.fileSizeRejectionText);
  });

  it('连线来源标记 = 契约来源值 image_outpaint（纯视觉来源边，不参与参考推导与 @ 编号）', () => {
    expect(IMAGE_OUTPAINT_EDGE_ORIGIN).toBe(IMAGE_OUTPAINT_SOURCE);
    expect(IMAGE_OUTPAINT_SOURCE).toBe('image_outpaint');
  });

  it('buildImageOutpaintInput 键名与契约六键恒等、产出过契约 zod 校验', () => {
    const input = buildImageOutpaintInput('5', 'node-x', { top: 0.1, right: 0.2, bottom: 0, left: 0.4 })!;
    expect(input).toEqual({
      [IMAGE_OUTPAINT_INPUT_KEYS.sourceAssetId]: '5',
      [IMAGE_OUTPAINT_INPUT_KEYS.targetNodeId]: 'node-x',
      [IMAGE_OUTPAINT_INPUT_KEYS.expandTop]: 0.1,
      [IMAGE_OUTPAINT_INPUT_KEYS.expandRight]: 0.2,
      [IMAGE_OUTPAINT_INPUT_KEYS.expandBottom]: 0,
      [IMAGE_OUTPAINT_INPUT_KEYS.expandLeft]: 0.4,
    });
    expect(imageOutpaintInputSchema.parse(input)).toEqual(input);
  });

  it('buildImageOutpaintInput 拒零扩展（契约 refine 同口径）与非法源素材 id', () => {
    expect(buildImageOutpaintInput('5', 'node-x', { top: 0, right: 0, bottom: 0, left: 0 })).toBeNull();
    expect(buildImageOutpaintInput('Asset-abc', 'node-x', { top: 0.1, right: 0, bottom: 0, left: 0 })).toBeNull();
  });
});

describe('IKGOQX 门槛预检 outpaintGateReason', () => {
  it('尺寸缺失置灰：宽高任一未知即不可用', () => {
    expect(outpaintGateReason(undefined, 300, 1000)).toContain('尺寸');
    expect(outpaintGateReason(400, undefined, 1000)).toContain('尺寸');
  });
  it('长边恰 4160 可用、4161 不可用（宽高谁长都算）', () => {
    expect(outpaintGateReason(4160, 300, 1000)).toBeNull();
    expect(outpaintGateReason(300, 4161, 1000)).toContain('4160');
  });
  it('文件恰 10MB 可用、超过不可用；大小未知不拦', () => {
    expect(outpaintGateReason(400, 300, 10 * 1024 * 1024)).toBeNull();
    expect(outpaintGateReason(400, 300, 10 * 1024 * 1024 + 1)).toContain('10MB');
    expect(outpaintGateReason(400, 300, undefined)).toBeNull();
  });
});

describe('IKGOQX 扩展几何', () => {
  it('单方向上限 = 原图短边 40%', () => {
    expect(max).toBeCloseTo(120, 10);
  });

  it('拖边单边跟随：top 边在原内容区上方 50px → top=50，其余方向不动', () => {
    const next = dragExpandEdge('top', rect, { x: 1200, y: 450 }, ZERO_EXPANDS, max);
    expect(next).toEqual({ top: 50, right: 0, bottom: 0, left: 0 });
  });

  it('拖边向内（越进原图内侧）钳到 0：框永远完整包住原图', () => {
    const next = dragExpandEdge('bottom', rect, { x: 1200, y: 700 }, { top: 30, right: 0, bottom: 0, left: 0 }, max);
    expect(next).toEqual({ top: 30, right: 0, bottom: 0, left: 0 });
  });

  it('拖边超 40% 上限钳制：拖到极限拖不动', () => {
    const next = dragExpandEdge('right', rect, { x: 1000 + 400 + 500, y: 650 }, ZERO_EXPANDS, max);
    expect(next.right).toBe(max);
    const next2 = dragExpandEdge('left', rect, { x: 1000 - 999, y: 650 }, ZERO_EXPANDS, max);
    expect(next2.left).toBe(max);
  });

  it('拖角自由改比例：两边独立跟随鼠标', () => {
    const next = dragExpandCorner('se', rect, { x: 1000 + 400 + 60, y: 500 + 300 + 40 }, ZERO_EXPANDS, max, false);
    expect(next).toEqual({ top: 0, right: 60, bottom: 40, left: 0 });
    const nw = dragExpandCorner('nw', rect, { x: 1000 - 25, y: 500 - 70 }, ZERO_EXPANDS, max, false);
    expect(nw).toEqual({ top: 70, right: 0, bottom: 0, left: 25 });
  });

  it('拖角向内钳 0、超限钳 40%：每方向独立钳制', () => {
    const inner = dragExpandCorner('se', rect, { x: 1300, y: 700 }, ZERO_EXPANDS, max, false);
    expect(inner).toEqual(ZERO_EXPANDS);
    const over = dragExpandCorner('se', rect, { x: 1000 + 400 + 999, y: 500 + 300 + 999 }, ZERO_EXPANDS, max, false);
    expect(over).toEqual({ top: 0, right: max, bottom: max, left: 0 });
  });

  it('Shift 拖角锁开始那一刻比例：从零扩展 400×300 起拖，等比外扩保持 4:3', () => {
    const next = dragExpandCorner('se', rect, { x: 1500, y: 920 }, ZERO_EXPANDS, max, true);
    expect(next.right).toBeCloseTo(100, 6);
    expect(next.bottom).toBeCloseTo(75, 6);
    const boxW = 400 + next.right;
    const boxH = 300 + next.bottom;
    expect(boxW / boxH).toBeCloseTo(4 / 3, 6);
  });

  it('Shift 拖角以开始那一刻（非当前帧）比例为基准', () => {
    const start = { top: 0, right: 50, bottom: 50, left: 0 };
    const ratio0 = (400 + 50) / (300 + 50);
    const next = dragExpandCorner('se', rect, { x: 1500, y: 900 }, start, max, true);
    const boxW = 400 + next.right;
    const boxH = 300 + next.bottom;
    expect(boxW / boxH).toBeCloseTo(ratio0, 6);
  });

  it('clampExpands：负值归 0、超限钳上限、不改动范围内的值', () => {
    expect(clampExpands({ top: -30, right: 130, bottom: 50, left: 0 }, 120)).toEqual({
      top: 0, right: 120, bottom: 50, left: 0,
    });
  });
});

describe('IKGOQX 像素扩展量实时换算为四方向比例', () => {
  it('相对原图短边：top 30px / 短边 300 = 0.1', () => {
    expect(expandRatiosOf({ top: 30, right: 60, bottom: 0, left: 120 }, rect)).toEqual({
      top: 0.1, right: 0.2, bottom: 0, left: 0.4,
    });
  });
  it('零扩展全 0', () => {
    expect(expandRatiosOf(ZERO_EXPANDS, rect)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe('IKGOQX 比例预设联动', () => {
  it('原图比例：全零（进入默认、点选即重置）', () => {
    expect(presetExpands(rect, 'original', max)).toEqual(ZERO_EXPANDS);
  });

  it('16:9 最小包含框：以原图中心为锚，高定宽 300×16/9≈533.33，左右各扩 (533.33-400)/2', () => {
    const next = presetExpands(rect, '16:9', max)!;
    expect(next.top).toBeCloseTo(0, 6);
    expect(next.bottom).toBeCloseTo(0, 6);
    expect(next.left).toBeCloseTo((300 * (16 / 9) - 400) / 2, 6);
    expect(next.right).toBeCloseTo(next.left, 6);
    expect(matchOutpaintPreset(next, rect)).toBe('16:9');
  });

  it('1:1 需上下补高：300→400，上下各扩 50', () => {
    const next = presetExpands(rect, '1:1', max)!;
    expect(next.left).toBe(0);
    expect(next.top).toBeCloseTo(50, 6);
    expect(matchOutpaintPreset(next, rect)).toBe('1:1');
  });

  it('不可达预设返回 null：极端窄长图 4:3 需左右各扩 (2400×4/3? )', () => {
    const tall = { width: 800, height: 100 };
    expect(presetExpands(tall, '4:3', 40)).toBeNull();
    expect(presetExpands(tall, '1:1', 40)).toBeNull();
    expect(presetExpands(tall, '9:16', 40)).toBeNull();
    expect(presetExpands(tall, 'original', 40)).toEqual(ZERO_EXPANDS);
  });

  it('outpaintPresetAvailability：original 恒可达，不可达预设带原因文案', () => {
    const tall = { width: 800, height: 100 };
    const av = outpaintPresetAvailability(tall, 40);
    expect(av.original).toBeNull();
    expect(av['1:1']).toContain('40%');
    expect(av['1:1']).toContain('1:1');
    const sq = outpaintPresetAvailability({ width: 300, height: 300 }, 120);
    expect(Object.values(sq).every((r) => r === null)).toBe(true);
  });

  it('matchOutpaintPreset：等比外扩仍命中原图比例；非标准比例返回 null（自定义）', () => {
    expect(matchOutpaintPreset({ top: 30, right: 40, bottom: 30, left: 40 }, rect)).toBe('original');
    expect(matchOutpaintPreset({ top: 0, right: 60, bottom: 0, left: 0 }, rect)).toBeNull();
    const half = (300 * (16 / 9) - 400) / 2;
    expect(matchOutpaintPreset({ top: 0, right: half, bottom: 0, left: half }, rect)).toBe('16:9');
  });

  it('命中容差：手拖落在 0.5% 相对容差内仍高亮预设', () => {
    const half = ((300 * (16 / 9) - 400) / 2) * 1.004;
    expect(matchOutpaintPreset({ top: 0, right: half, bottom: 0, left: half }, rect)).toBe('16:9');
    const far = ((300 * (16 / 9) - 400) / 2) * 1.05;
    expect(matchOutpaintPreset({ top: 0, right: far, bottom: 0, left: far }, rect)).toBeNull();
  });
});
