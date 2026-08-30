import { describe, expect, it } from 'vitest';
import {
  galleryCoverSrc,
  mediaKindFromTagCode,
  shouldShowVideoChrome,
} from './galleryCardModel';

describe('mediaKindFromTagCode', () => {
  it('picture 一律是图片，不看 images 是否为空', () => {
    expect(mediaKindFromTagCode('picture')).toBe('image');
    expect(shouldShowVideoChrome(mediaKindFromTagCode('picture'))).toBe(false);
  });

  it('video 才是视频形态', () => {
    expect(mediaKindFromTagCode('video')).toBe('video');
    expect(shouldShowVideoChrome(mediaKindFromTagCode('video'))).toBe(true);
  });

  it('未知 tagCode 不落到视频', () => {
    expect(mediaKindFromTagCode('')).toBe('image');
    expect(mediaKindFromTagCode('social')).toBe('image');
  });
});

describe('galleryCoverSrc', () => {
  it('空 images 得到空封面，而不是视频判定', () => {
    expect(galleryCoverSrc([])).toBe('');
    expect(galleryCoverSrc(undefined)).toBe('');
    expect(galleryCoverSrc(null)).toBe('');
  });

  it('第二张优先，否则第一张', () => {
    expect(galleryCoverSrc(['a.jpg'])).toBe('a.jpg');
    expect(galleryCoverSrc(['a.jpg', 'b.jpg', 'c.jpg'])).toBe('b.jpg');
  });
});
