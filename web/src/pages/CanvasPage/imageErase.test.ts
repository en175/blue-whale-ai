import { describe, expect, it } from 'vitest';
import {
  IMAGE_ERASE_MAX_HEIGHT,
  IMAGE_ERASE_MAX_SIZE_BYTES,
  IMAGE_ERASE_MAX_WIDTH,
  imageEraseFormatOf,
  imageEraseGateReason,
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

  it('恰在边界（2560×1440 / 10MB）放行', () => {
    expect(
      imageEraseGateReason({ width: IMAGE_ERASE_MAX_WIDTH, height: IMAGE_ERASE_MAX_HEIGHT, size: IMAGE_ERASE_MAX_SIZE_BYTES }),
    ).toBeNull();
  });

  it('宽超 2560 或高超 1440 置灰并给出原因', () => {
    expect(imageEraseGateReason({ width: 2561, height: 1440 })).toContain('2560×1440');
    expect(imageEraseGateReason({ width: 2560, height: 1441 })).toContain('2560×1440');
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

  it('尺寸 null 的存量图不拦（onLoad 实测回填后重判）', () => {
    expect(imageEraseGateReason({ size: 1024, mime: 'image/png' })).toBeNull();
    expect(imageEraseGateReason({ width: undefined, height: undefined })).toBeNull();
  });

  it('格式原因优先于尺寸与大小（悬停展示第一条命中的口径）', () => {
    const reason = imageEraseGateReason({ mime: 'image/webp', width: 4000, height: 4000, size: 99 * 1024 * 1024 });
    expect(reason).toContain('webp');
  });
});
