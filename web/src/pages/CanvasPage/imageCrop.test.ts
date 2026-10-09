import { describe, expect, it } from 'vitest';
import {
  CROP_PRESET_LABELS,
  CROP_PRESET_ORDER,
  IMAGE_CROP_EDGE_ORIGIN,
  IMAGE_CROP_JPEG_QUALITY,
  IMAGE_CROP_MIN_NATURAL_SIDE,
  clampCropRect,
  cropOutputFormat,
  cropPresetRatio,
  cropRectToNatural,
  dragCropCorner,
  dragCropEdge,
  fullCropRect,
  inscribeCropRect,
  minCropSideDisplay,
  moveCropRect,
  type CropCoordinateSpace,
  type CropRect,
} from './imageCrop';

const bounds: CropRect = { x: 1000, y: 500, width: 400, height: 300 };
const space: CropCoordinateSpace = { displayWidth: 400, displayHeight: 300, naturalWidth: 800, naturalHeight: 600 };
const minSide = minCropSideDisplay(space);

describe('IKGW1G 公共常量与预设防漂移（后续组件票对接面，本文件即单源）', () => {
  it('短边下限恒 64 自然分辨率像素、JPEG 质量恒 0.92（规格 Implementation Decisions）', () => {
    expect(IMAGE_CROP_MIN_NATURAL_SIDE).toBe(64);
    expect(IMAGE_CROP_JPEG_QUALITY).toBe(0.92);
  });

  it('来源边标记恒 image-crop（纯视觉来源连线，不占参考位）', () => {
    expect(IMAGE_CROP_EDGE_ORIGIN).toBe('image-crop');
  });

  it('六选项顺序与文案恒定：自由 + 五个默认比例', () => {
    expect(CROP_PRESET_ORDER).toEqual(['free', '1:1', '4:3', '3:4', '16:9', '9:16']);
    expect(CROP_PRESET_LABELS).toEqual({
      free: '自由',
      '1:1': '1:1',
      '4:3': '4:3',
      '3:4': '3:4',
      '16:9': '16:9',
      '9:16': '9:16',
    });
  });

  it('预设比例值：free 为 null（自由），其余为宽/高数值', () => {
    expect(cropPresetRatio('free')).toBeNull();
    expect(cropPresetRatio('1:1')).toBe(1);
    expect(cropPresetRatio('4:3')).toBeCloseTo(4 / 3, 10);
    expect(cropPresetRatio('3:4')).toBeCloseTo(3 / 4, 10);
    expect(cropPresetRatio('16:9')).toBeCloseTo(16 / 9, 10);
    expect(cropPresetRatio('9:16')).toBeCloseTo(9 / 16, 10);
  });

  it('进入模式默认框 = 整个内容区（自由比例、全幅起点）', () => {
    expect(fullCropRect(bounds)).toEqual(bounds);
  });
});

describe('IKGW1G 64 像素自然分辨率下限换算 minCropSideDisplay', () => {
  it('2 倍显示（display 400 / natural 800）：64 自然像素 → 32 显示像素', () => {
    expect(minSide).toBeCloseTo(32, 10);
  });

  it('1 倍显示：显示下限 = 64；显示盒大于自然分辨率时按横轴比例放大', () => {
    expect(minCropSideDisplay({ displayWidth: 300, displayHeight: 400, naturalWidth: 300, naturalHeight: 400 })).toBe(64);
    expect(minCropSideDisplay({ displayWidth: 280, displayHeight: 280, naturalWidth: 128, naturalHeight: 128 })).toBeCloseTo(140, 10);
  });
});

describe('IKGW1G 内收拖边 dragCropEdge（单边跟随、对边不动）', () => {
  it('拖 top 边向内收：指针 y=560 → 框顶收到 560，底边与其余两边不动', () => {
    const next = dragCropEdge('top', fullCropRect(bounds), bounds, { x: 1200, y: 560 }, minSide);
    expect(next).toEqual({ x: 1000, y: 560, width: 400, height: 240 });
  });

  it('拖边不越过对边：指针拉过「底边 - 最小短边」时钳到最小框，对边仍不动', () => {
    const next = dragCropEdge('top', fullCropRect(bounds), bounds, { x: 1200, y: 790 }, minSide);
    expect(next).toEqual({ x: 1000, y: 768, width: 400, height: 32 });
  });

  it('拖边不超出内容区：指针拖到内容区外时钳回边界', () => {
    const next = dragCropEdge('top', fullCropRect(bounds), bounds, { x: 1200, y: 450 }, minSide);
    expect(next).toEqual(bounds);
  });

  it('拖 bottom 边：仅高度跟随指针，顶边与左右不动', () => {
    const start: CropRect = { x: 1000, y: 560, width: 400, height: 240 };
    const next = dragCropEdge('bottom', start, bounds, { x: 1200, y: 700 }, minSide);
    expect(next).toEqual({ x: 1000, y: 560, width: 400, height: 140 });
  });

  it('拖 left / right 边：宽度单边跟随、对边不动', () => {
    const left = dragCropEdge('left', fullCropRect(bounds), bounds, { x: 1100, y: 650 }, minSide);
    expect(left).toEqual({ x: 1100, y: 500, width: 300, height: 300 });
    const right = dragCropEdge('right', fullCropRect(bounds), bounds, { x: 1250, y: 650 }, minSide);
    expect(right).toEqual({ x: 1000, y: 500, width: 250, height: 300 });
  });

  it('clampCropRect 兜底：负尺寸/超界框归位到内容区内且短边不小于下限', () => {
    expect(clampCropRect({ x: 900, y: 450, width: -50, height: 1000 }, bounds, minSide)).toEqual({ x: 1000, y: 500, width: 32, height: 300 });
    expect(clampCropRect({ x: 1390, y: 790, width: 10, height: 10 }, bounds, minSide)).toEqual({ x: 1368, y: 768, width: 32, height: 32 });
  });
});

describe('IKGW1G 拖角自由换算 dragCropCorner（lockedRatio=null，对角锚定）', () => {
  it('拖 se 角：nw 对角不动，宽高独立跟随指针', () => {
    const next = dragCropCorner('se', fullCropRect(bounds), bounds, { x: 1300, y: 760 }, minSide, null);
    expect(next).toEqual({ x: 1000, y: 500, width: 300, height: 260 });
  });

  it('拖 nw 角：se 对角（内容区右下）为锚，框向左上收缩', () => {
    const next = dragCropCorner('nw', fullCropRect(bounds), bounds, { x: 1100, y: 600 }, minSide, null);
    expect(next).toEqual({ x: 1100, y: 600, width: 300, height: 200 });
  });

  it('拖 ne / sw 角：各自以对角为锚', () => {
    const ne = dragCropCorner('ne', fullCropRect(bounds), bounds, { x: 1200, y: 560 }, minSide, null);
    expect(ne).toEqual({ x: 1000, y: 560, width: 200, height: 240 });
    const sw = dragCropCorner('sw', fullCropRect(bounds), bounds, { x: 1120, y: 700 }, minSide, null);
    expect(sw).toEqual({ x: 1120, y: 500, width: 280, height: 200 });
  });

  it('指针越过对角（负宽高期望）钳到最小短边，不翻负', () => {
    const next = dragCropCorner('se', fullCropRect(bounds), bounds, { x: 1020, y: 510 }, minSide, null);
    expect(next).toEqual({ x: 1000, y: 500, width: 32, height: 32 });
  });

  it('指针拖出内容区：框钳制在内容区内（锚随墙让位，框不出界）', () => {
    const next = dragCropCorner('se', fullCropRect(bounds), bounds, { x: 1500, y: 900 }, minSide, null);
    expect(next).toEqual(bounds);
  });
});

describe('IKGW1G 锁比例对角锚等比缩放 dragCropCorner（lockedRatio）', () => {
  it('面板锁定 1:1：以对角为锚等比缩放，宽高恒相等', () => {
    const next = dragCropCorner('se', fullCropRect(bounds), bounds, { x: 1250, y: 830 }, minSide, cropPresetRatio('1:1'));
    expect(next).toEqual({ x: 1000, y: 500, width: 250, height: 250 });
  });

  it('Shift 临时锁比例：锁拖动开始那一刻的框比例（非当前指针位置比例）', () => {
    const start: CropRect = { x: 1000, y: 500, width: 200, height: 300 };
    const ratio0 = start.width / start.height;
    const next = dragCropCorner('se', start, bounds, { x: 1400, y: 700 }, minSide, ratio0);
    expect(next.width).toBeCloseTo((200 / 300) * 200, 6);
    expect(next.height).toBeCloseTo(200, 6);
    expect(next.width / next.height).toBeCloseTo(ratio0, 6);
    expect(next.x).toBe(1000);
    expect(next.y).toBe(500);
  });

  it('等比内切不越过指针期望框：boxW ≤ 期望宽且 boxH ≤ 期望高', () => {
    const next = dragCropCorner('se', fullCropRect(bounds), bounds, { x: 1250, y: 830 }, minSide, cropPresetRatio('16:9'));
    expect(next.width).toBeLessThanOrEqual(250);
    expect(next.height).toBeLessThanOrEqual(330);
    expect(next.width / next.height).toBeCloseTo(16 / 9, 6);
  });

  it('nw 角锁比例：以右下对角为锚向左上等比缩放', () => {
    const next = dragCropCorner('nw', fullCropRect(bounds), bounds, { x: 1150, y: 625 }, minSide, cropPresetRatio('1:1'));
    expect(next).toEqual({ x: 1225, y: 625, width: 175, height: 175 });
  });

  it('锁比例缩到最小短边以下时钳住下限（比例让位于 64 像素硬下限）', () => {
    const next = dragCropCorner('se', fullCropRect(bounds), bounds, { x: 1010, y: 510 }, minSide, 1);
    expect(next).toEqual({ x: 1000, y: 500, width: 32, height: 32 });
  });
});

describe('IKGW1G 框内整体平移 moveCropRect（钳制在内容区内）', () => {
  it('整体平移：尺寸不变，位置随位移', () => {
    const rect: CropRect = { x: 1100, y: 550, width: 200, height: 150 };
    expect(moveCropRect(rect, 50, -30, bounds)).toEqual({ x: 1150, y: 520, width: 200, height: 150 });
  });

  it('撞右下界停在边界：位移越界不裁出内容区', () => {
    const rect: CropRect = { x: 1100, y: 550, width: 200, height: 150 };
    expect(moveCropRect(rect, 500, 500, bounds)).toEqual({ x: 1200, y: 650, width: 200, height: 150 });
  });

  it('撞左上界停在边界（负位移）；全幅框无余量恒不动', () => {
    const rect: CropRect = { x: 1100, y: 550, width: 200, height: 150 };
    expect(moveCropRect(rect, -999, -999, bounds)).toEqual({ x: 1000, y: 500, width: 200, height: 150 });
    expect(moveCropRect(bounds, 100, 100, bounds)).toEqual(bounds);
  });
});

describe('IKGW1G 内容区内最大内接指定比例矩形 inscribeCropRect（居中）', () => {
  it('16:9 内接 400×300：宽定 400×225，上下各留 37.5', () => {
    expect(inscribeCropRect(bounds, cropPresetRatio('16:9')!)).toEqual({ x: 1000, y: 537.5, width: 400, height: 225 });
  });

  it('1:1 内接 400×300：高定 300×300，左右各留 50', () => {
    expect(inscribeCropRect(bounds, cropPresetRatio('1:1')!)).toEqual({ x: 1050, y: 500, width: 300, height: 300 });
  });

  it('9:16 内接 400×300：高定 168.75×300，左右各留 115.625', () => {
    expect(inscribeCropRect(bounds, cropPresetRatio('9:16')!)).toEqual({ x: 1115.625, y: 500, width: 168.75, height: 300 });
  });

  it('比例与内容区一致时内接框 = 全幅', () => {
    expect(inscribeCropRect(bounds, 4 / 3)).toEqual(bounds);
  });

  it('内接框恒居中且完整落在内容区内（两侧余量相等）', () => {
    for (const key of ['1:1', '4:3', '3:4', '16:9', '9:16'] as const) {
      const rect = inscribeCropRect(bounds, cropPresetRatio(key)!);
      expect(rect.x - bounds.x).toBeCloseTo(bounds.x + bounds.width - (rect.x + rect.width), 10);
      expect(rect.y - bounds.y).toBeCloseTo(bounds.y + bounds.height - (rect.y + rect.height), 10);
      expect(rect.x).toBeGreaterThanOrEqual(bounds.x);
      expect(rect.y).toBeGreaterThanOrEqual(bounds.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });
});

describe('IKGW1G 显示坐标 → 自然分辨率换算 cropRectToNatural（裁切执行口径）', () => {
  it('2 倍图换算：显示矩形 ×2 为自然分辨率整数像素矩形（相对内容区原点）', () => {
    expect(cropRectToNatural({ x: 1100, y: 560, width: 200, height: 120 }, bounds, space)).toEqual({
      x: 200,
      y: 120,
      width: 400,
      height: 240,
    });
  });

  it('全幅框 → 整张自然分辨率图（裁切按自然分辨率执行，恒不放大）', () => {
    expect(cropRectToNatural(fullCropRect(bounds), bounds, space)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('小数显示矩形四舍五入到整数像素（先乘比例再取整两端，宽高为差；口径同擦除 displayRectToNatural）', () => {
    const next = cropRectToNatural({ x: 1100.4, y: 560.5, width: 199.7, height: 119.8 }, bounds, space);
    expect(next).toEqual({ x: 201, y: 121, width: 399, height: 240 });
  });

  it('内接比例框回环：16:9 内接框换算后短边 = 800×600 图上 16:9 的最大内接短边', () => {
    const rect = inscribeCropRect(bounds, cropPresetRatio('16:9')!);
    const natural = cropRectToNatural(rect, bounds, space);
    expect(natural).toEqual({ x: 0, y: 75, width: 800, height: 450 });
  });

  it('越界矩形钳位到 [0, 自然分辨率]（防御性：调用方保证界内，越界不产出非法裁切区）', () => {
    const next = cropRectToNatural({ x: 1380, y: 780, width: 100, height: 100 }, bounds, space);
    expect(next).toEqual({ x: 760, y: 560, width: 40, height: 40 });
  });
});

describe('IKGW1G 产出格式决策 cropOutputFormat（跟随源图）', () => {
  it('JPEG 源出 JPEG：mime image/jpeg → 质量 0.92、扩展名 jpg', () => {
    expect(cropOutputFormat({ mime: 'image/jpeg', src: 'https://x/a.png', fileName: 'b.png' })).toEqual({
      mime: 'image/jpeg',
      quality: 0.92,
      ext: 'jpg',
    });
  });

  it('JPEG 分支的 mime 缺失兜底链：src / fileName 扩展名 jpg、jpeg 均判 JPEG（大小写归一）', () => {
    expect(cropOutputFormat({ src: 'https://x/photo.jpg' }).mime).toBe('image/jpeg');
    expect(cropOutputFormat({ src: 'https://x/photo.JPEG' }).mime).toBe('image/jpeg');
    expect(cropOutputFormat({ fileName: 'photo.jpeg' }).mime).toBe('image/jpeg');
    expect(cropOutputFormat({ src: 'https://x/photo.jpg?sign=abc' }).mime).toBe('image/jpeg');
  });

  it('PNG 源出 PNG：mime image/png 与 png 扩展名均判 PNG（无损重编码）', () => {
    expect(cropOutputFormat({ mime: 'image/png', src: 'https://x/a.jpg' })).toEqual({ mime: 'image/png', quality: 1, ext: 'png' });
    expect(cropOutputFormat({ src: 'https://x/a.png' })).toEqual({ mime: 'image/png', quality: 1, ext: 'png' });
    expect(cropOutputFormat({ fileName: '截图.PNG' })).toEqual({ mime: 'image/png', quality: 1, ext: 'png' });
  });

  it('判得出但不属于 JPEG/PNG（webp/gif）：PNG 兜底（canvas 重编码取无损通用格式）', () => {
    expect(cropOutputFormat({ mime: 'image/webp' })).toEqual({ mime: 'image/png', quality: 1, ext: 'png' });
    expect(cropOutputFormat({ mime: 'image/gif' })).toEqual({ mime: 'image/png', quality: 1, ext: 'png' });
    expect(cropOutputFormat({ src: 'https://x/a.webp' })).toEqual({ mime: 'image/png', quality: 1, ext: 'png' });
  });

  it('判不出格式（无 mime 无扩展名）PNG 兜底：恒有可编码产出', () => {
    expect(cropOutputFormat({})).toEqual({ mime: 'image/png', quality: 1, ext: 'png' });
    expect(cropOutputFormat({ src: 'https://x/no-ext', fileName: 'noext' })).toEqual({ mime: 'image/png', quality: 1, ext: 'png' });
  });
});
