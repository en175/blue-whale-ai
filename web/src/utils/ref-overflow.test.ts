// web/src/utils/ref-overflow.test.ts
import { describe, expect, it } from 'vitest';
import { classifyRefOverflow } from './ref-overflow';

describe('classifyRefOverflow', () => {
  it('图片超限返回 image', () => {
    expect(
      classifyRefOverflow({ selectedImages: 4, selectedVideos: 0, acceptedImages: 2, acceptedVideos: 0 }),
    ).toBe('image');
  });

  it('视频超限返回 video', () => {
    expect(
      classifyRefOverflow({ selectedImages: 0, selectedVideos: 4, acceptedImages: 0, acceptedVideos: 3 }),
    ).toBe('video');
  });

  it('未超限返回 null', () => {
    expect(
      classifyRefOverflow({ selectedImages: 2, selectedVideos: 1, acceptedImages: 2, acceptedVideos: 1 }),
    ).toBe(null);
  });

  it('图片与视频同时超限优先 image', () => {
    expect(
      classifyRefOverflow({ selectedImages: 10, selectedVideos: 4, acceptedImages: 9, acceptedVideos: 3 }),
    ).toBe('image');
  });

  it('图片未超限但视频超限才报 video', () => {
    expect(
      classifyRefOverflow({ selectedImages: 1, selectedVideos: 5, acceptedImages: 1, acceptedVideos: 3 }),
    ).toBe('video');
  });
});
