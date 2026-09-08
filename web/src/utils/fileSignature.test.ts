import { describe, expect, it } from 'vitest';

import { checkFileBeforeUpload, sniffFileSignature } from './fileSignature';

/** 测试站 `asset_id=6012` 的真实字节（`corrupt.jpg`，524 字节，头四字节 AB CD EF 12）。 */
const CORRUPT_JPG =
  'q83vEgAQSkZJRgABV/iHIa5uRGaJSzcfNe1eD+g2D0V+zGEHgkfsy+tYlmoQ4oCSe2T5+pG6zMbVihWRdvSG8HRL1xk8/kN0pfdh' +
  'mQ3W9hAe5sHFPQ184XP/W9tzxkhV2inNMRPIGKm0Ig9J8Q/FJ8SU7Wmv88O3rP7uuvHbB9urrR/2SbAq8zwt6DjMqv2uqYAKoGm4' +
  'MC8jnllqv0ZWtB+ShUNJII0tYy/bCy6w5HkSlrNQPxcozZFIdBG308wdHEWx7Z811N3hIono8nUn8itsKzepeUaWA00V+3qv6XDo' +
  'zbUJavTPpow14AyuKidsXG3iF9yawUTS0sORuTgcYJlyRRY1yZ2bMlSaCHu++PP8tsSuWKeev/61f5JrB457ah5jqvCYxdCf5Wco' +
  '09GRtuSxvyQieysWZckegfh27pP7ICDI/vDtSQC44IFyVK6HXvo/ipWBGeZ7xB/XuC6qs3YRYnglArzMiAsPJDasPpWo4Gz0NRaL' +
  'uDTgd/7tPVQX0rdfi/FGJikWWTOnBo7PrV0KUeK+ixt8Oh0eChEwp1qBwQvzOIh1JqLqAuzyqhFj3MMrhB7Nq0E8D8JmBn0jNbag' +
  'WkiW/eMokrewvUkqwoQ7geLm1/QFiMLXjIhw9FVR5qddy52btVFNX2UfNhwxS9vcLVsRl/VybdnU6peiV2zSoAfy0WzDzeclyrU=';

const corruptBytes = Uint8Array.from(atob(CORRUPT_JPG), (c) => c.charCodeAt(0));
const fileOf = (bytes: Uint8Array, name: string, type: string) =>
  new File([bytes.slice().buffer as ArrayBuffer], name, { type });
const withHeader = (values: number[], length = 32) => {
  const head = new Uint8Array(length);
  head.set(values);
  return head;
};
const asciiHeader = (text: string, offset = 0, length = 32) => {
  const head = new Uint8Array(length);
  head.set(new TextEncoder().encode(text), offset);
  return head;
};

describe('sniffFileSignature', () => {
  it('认不出 2026-09-08 那份坏文件——它不是任何一种媒体容器', () => {
    expect([...corruptBytes.subarray(0, 4)]).toEqual([0xab, 0xcd, 0xef, 0x12]);
    expect(sniffFileSignature(corruptBytes.subarray(0, 32))).toBeNull();
  });

  it('认出常见图片', () => {
    expect(sniffFileSignature(withHeader([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      kind: 'image',
      format: 'jpeg',
    });
    expect(
      sniffFileSignature(withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toEqual({ kind: 'image', format: 'png' });
  });

  // 这一层不是格式白名单：heic 是 iPhone 拍照的默认格式，后端转得动，挡它是错的。
  it('heic 认得出，不是「坏文件」', () => {
    expect(sniffFileSignature(asciiHeader('ftypheic', 4))).toEqual({
      kind: 'image',
      format: 'heic',
    });
  });

  it('ftyp 盒子按 brand 分图片和视频', () => {
    expect(sniffFileSignature(asciiHeader('ftypisom', 4))).toEqual({
      kind: 'video',
      format: 'isom',
    });
  });
});

describe('checkFileBeforeUpload', () => {
  it('坏文件在选中的当下就被拦下', async () => {
    const message = await checkFileBeforeUpload(fileOf(corruptBytes, 'corrupt.jpg', 'image/jpeg'), 'image');
    expect(message).toContain('corrupt.jpg');
    expect(message).toContain('打不开');
  });

  it('空文件也拦，不让用户看到一次失败的网络请求才知道', async () => {
    const message = await checkFileBeforeUpload(fileOf(new Uint8Array(0), 'empty.jpg', 'image/jpeg'), 'image');
    expect(message).toContain('空文件');
  });

  it('真的 JPEG 放行', async () => {
    const jpeg = withHeader([0xff, 0xd8, 0xff, 0xe0]);
    await expect(
      checkFileBeforeUpload(fileOf(jpeg, 'real.jpg', 'image/jpeg'), 'image'),
    ).resolves.toBeNull();
  });

  it('声明是图片、字节是视频，按字节说的算', async () => {
    const message = await checkFileBeforeUpload(
      fileOf(asciiHeader('ftypisom', 4), 'fake.jpg', 'image/jpeg'),
      'image',
    );
    expect(message).toContain('视频');
  });
});
