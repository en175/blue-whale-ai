import { describe, expect, it } from 'vitest';
import { assetsPickerMediaTypes } from './assetsPickerTargets';
import { PANEL_REF_MEDIA_TYPES } from './refSourceTypes';

describe('assetsPickerMediaTypes（资产库弹窗媒体类型派生）', () => {
  it('toolbar 目标不限定媒体类型', () => {
    expect(assetsPickerMediaTypes('toolbar', 'reference', 'video')).toBeUndefined();
  });

  it('imageDialog → 图片类型', () => {
    expect(assetsPickerMediaTypes('imageDialog', 'reference', 'video')).toEqual([...PANEL_REF_MEDIA_TYPES.image.types]);
    expect(assetsPickerMediaTypes('imageDialog', 'reference', 'video')).toEqual(['image']);
  });

  it('audioDialog → 图片与音频', () => {
    expect(assetsPickerMediaTypes('audioDialog', 'reference', 'video')).toEqual(['image', 'audio']);
  });

  it('videoDraft 首帧/尾帧槽位 → 仅图片', () => {
    expect(assetsPickerMediaTypes('videoDraft', 'first', 'video')).toEqual(['image']);
    expect(assetsPickerMediaTypes('videoDraft', 'last', 'video')).toEqual(['image']);
  });

  it('videoDraft 参考槽位按素材类型分流', () => {
    expect(assetsPickerMediaTypes('videoDraft', 'reference', 'image')).toEqual(['image']);
    expect(assetsPickerMediaTypes('videoDraft', 'reference', 'video')).toEqual(['image', 'video', 'audio']);
  });

  it('agentPanel → 图片与视频', () => {
    expect(assetsPickerMediaTypes('agentPanel', 'reference', 'video')).toEqual(['image', 'video']);
  });
});
