import { describe, expect, it } from 'vitest';
import {
  IMAGE_ERASE_MAX_LONG_SIDE,
  IMAGE_ERASE_MAX_SHORT_SIDE,
  IMAGE_ERASE_MAX_SIZE_BYTES,
  IMAGE_ERASE_MIN_SIDE,
  imageEraseFormatOf,
  imageEraseGateReason,
  maskHasPaintArea,
} from './imageErase';

describe('imageEraseFormatOf', () => {
  it('mime 优先：image/webp 与 image/gif 命中，大小写不敏感', () => {
    expect(imageEraseFormatOf({ mime: 'image/webp' })).toBe('webp');
    expect(imageEraseFormatOf({ mime: 'image/GIF' })).toBe('gif');
    expect(imageEraseFormatOf({ mime: 'image/png' })).toBe('png');
  });

  it('mime 缺失时从 src 扩展名推断（去 query/hash）', () => {
    expect(imageEraseFormatOf({ src: 'http://tos/x/y.webp?token=1' })).toBe('webp');
    expect(imageEraseFormatOf({ src: 'http://tos/x/y.gif#frag' })).toBe('gif');
    expect(imageEraseFormatOf({ src: 'http://tos/x/y.png' })).toBe('png');
  });

  it('再缺失时从 fileName 扩展名推断；全无返回 null', () => {
    expect(imageEraseFormatOf({ fileName: 'photo.webp' })).toBe('webp');
    expect(imageEraseFormatOf({})).toBeNull();
    expect(imageEraseFormatOf({ src: 'blob:test', fileName: '无扩展名' })).toBeNull();
  });
});

describe('imageEraseGateReason（擦除门槛预检，IKGOT7）', () => {
  it('门槛内正常图放行', () => {
    expect(
      imageEraseGateReason({ width: 1600, height: 900, size: 2 * 1024 * 1024, mime: 'image/png' }),
    ).toBeNull();
  });

  it('恰在边界（横图 2560×1440 / 竖图 1440×2560 / 10MB）放行', () => {
    expect(
      imageEraseGateReason({ width: IMAGE_ERASE_MAX_LONG_SIDE, height: IMAGE_ERASE_MAX_SHORT_SIDE, size: IMAGE_ERASE_MAX_SIZE_BYTES }),
    ).toBeNull();
    // 竖图长短边对调同样合法（短边/长边语义，不是宽高绑定）
    expect(
      imageEraseGateReason({ width: IMAGE_ERASE_MAX_SHORT_SIDE, height: IMAGE_ERASE_MAX_LONG_SIDE }),
    ).toBeNull();
  });

  it('长边超 2560 或短边超 1440 置灰并给出原因（横竖图同判）', () => {
    expect(imageEraseGateReason({ width: 2561, height: 1440 })).toContain('2560');
    expect(imageEraseGateReason({ width: 2560, height: 1441 })).toContain('1440');
    // 竖图：宽 1440 高 2561 长边超；宽 1441 高 2000 短边超
    expect(imageEraseGateReason({ width: 1440, height: 2561 })).toContain('2560');
    expect(imageEraseGateReason({ width: 1441, height: 2000 })).toContain('1440');
  });

  it('宽或高小于 10px 置灰并给出原因（与后端复核同口径）', () => {
    expect(imageEraseGateReason({ width: 9, height: 100 })).toContain('10×10');
    expect(imageEraseGateReason({ width: 100, height: 9 })).toContain('10×10');
  });

  it('恰在最小边界（10×10）放行', () => {
    expect(imageEraseGateReason({ width: IMAGE_ERASE_MIN_SIDE, height: IMAGE_ERASE_MIN_SIDE })).toBeNull();
  });

  it('超过 10MB 置灰并给出原因', () => {
    expect(imageEraseGateReason({ size: IMAGE_ERASE_MAX_SIZE_BYTES + 1 })).toContain('10MB');
  });

  it('webp/gif 三来源（mime/src/fileName）均置灰并说明格式不支持', () => {
    expect(imageEraseGateReason({ mime: 'image/webp' })).toContain('webp');
    expect(imageEraseGateReason({ src: 'http://tos/a.gif?x=1' })).toContain('gif');
    expect(imageEraseGateReason({ fileName: 'a.webp' })).toContain('不支持擦除');
  });

  it('擦除结果格式 png / jpeg / heic 放行', () => {
    expect(imageEraseGateReason({ mime: 'image/png' })).toBeNull();
    expect(imageEraseGateReason({ mime: 'image/jpeg' })).toBeNull();
    expect(imageEraseGateReason({ mime: 'image/heic' })).toBeNull();
  });

  it('契约白名单外的可识别格式同样置灰（jpg 大小写归一，bmp/tiff 等不在白名单）', () => {
    expect(imageEraseGateReason({ mime: 'image/jpg' })).toBeNull(); // jpg 归一小写在白名单
    expect(imageEraseGateReason({ mime: 'image/bmp' })).toContain('不支持擦除');
    expect(imageEraseGateReason({ src: 'http://tos/a.tif?x=1' })).toContain('不支持擦除');
  });

  it('尺寸 null 的存量图不拦（onLoad 实测回填后重判）', () => {
    expect(imageEraseGateReason({ size: 1024, mime: 'image/png' })).toBeNull();
    expect(imageEraseGateReason({ width: undefined, height: undefined })).toBeNull();
  });

  it('格式原因优先于尺寸与大小（悬停展示第一条命中的口径）', () => {
    const reason = imageEraseGateReason({ mime: 'image/webp', width: 4000, height: 4000, size: 99 * 1024 * 1024 });
    expect(reason).toContain('webp');
  });
});

describe('maskHasPaintArea（涂区存在性探测，IKGOTB 发送门）', () => {
  const W = 280;
  const H = 158;

  it('无图元 / 仅橡皮：无涂区', () => {
    expect(maskHasPaintArea([], W, H)).toBe(false);
    expect(
      maskHasPaintArea([{ kind: 'stroke', erase: true, points: [{ x: 50, y: 50 }], radius: 20 }], W, H),
    ).toBe(false);
  });

  it('涂一笔 / 拉一框：有涂区', () => {
    expect(
      maskHasPaintArea([{ kind: 'stroke', erase: false, points: [{ x: 50, y: 50 }], radius: 6 }], W, H),
    ).toBe(true);
    expect(
      maskHasPaintArea([{ kind: 'rect', erase: false, from: { x: 10, y: 10 }, to: { x: 100, y: 90 } }], W, H),
    ).toBe(true);
  });

  it('涂了又被橡皮整段盖掉：最终并集为空（不可发送）', () => {
    const ops = [
      { kind: 'rect', erase: false, from: { x: 10, y: 10 }, to: { x: 100, y: 90 } } as const,
      { kind: 'rect', erase: true, from: { x: 0, y: 0 }, to: { x: 280, y: 158 } } as const,
    ];
    expect(maskHasPaintArea(ops, W, H)).toBe(false);
  });

  it('橡皮只盖住一部分：仍有涂区', () => {
    const ops = [
      { kind: 'rect', erase: false, from: { x: 10, y: 10 }, to: { x: 200, y: 140 } } as const,
      { kind: 'rect', erase: true, from: { x: 0, y: 0 }, to: { x: 50, y: 50 } } as const,
    ];
    expect(maskHasPaintArea(ops, W, H)).toBe(true);
  });

  it('涂→擦→再涂（后写覆盖先写）：有涂区', () => {
    const ops = [
      { kind: 'rect', erase: false, from: { x: 10, y: 10 }, to: { x: 100, y: 90 } } as const,
      { kind: 'rect', erase: true, from: { x: 0, y: 0 }, to: { x: 280, y: 158 } } as const,
      { kind: 'rect', erase: false, from: { x: 60, y: 40 }, to: { x: 120, y: 110 } } as const,
    ];
    expect(maskHasPaintArea(ops, W, H)).toBe(true);
  });
});
