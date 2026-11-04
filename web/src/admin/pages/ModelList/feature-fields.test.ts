import { describe, expect, it } from 'vitest';
import {
  FEATURE_BOOL_LABELS,
  FEATURE_NUMBER_LABELS,
  FEATURE_STRING_LABELS,
} from '@/admin/enums';
import { buildVideoDimensions, dropKnownFeatures, pickVideoDimensions } from './feature-fields';
import { KNOWN_FEATURE_KEYS } from './model-form';

describe('结构化控件与 KNOWN 键集合必须对齐', () => {
  it('每个有控件的键都在 KNOWN_FEATURE_KEYS 里，否则会重复出现在「未识别字段」', () => {
    const known = new Set<string>(KNOWN_FEATURE_KEYS);
    const controlled = [
      ...Object.keys(FEATURE_BOOL_LABELS),
      ...Object.keys(FEATURE_NUMBER_LABELS),
      ...Object.keys(FEATURE_STRING_LABELS),
    ];
    expect(controlled.filter((key) => !known.has(key))).toEqual([]);
  });

  it('无消费方的键不提供结构化控件', () => {
    const controlled = new Set([
      ...Object.keys(FEATURE_BOOL_LABELS),
      ...Object.keys(FEATURE_NUMBER_LABELS),
      ...Object.keys(FEATURE_STRING_LABELS),
    ]);
    const inert = ['watermark', 'tools', 'stream', 'sequential_image_generation', 'quantity_max'];
    expect(inert.filter((key) => controlled.has(key))).toEqual([]);
  });
});

describe('输出像素表 video_dimensions', () => {
  it('读回：认 snake_case 与 camelCase 两种写法', () => {
    expect(pickVideoDimensions({ video_dimensions: { 'resolution=480p|aspect_ratio=16:9': '864x496' } })).toEqual([
      { key: 'resolution=480p|aspect_ratio=16:9', value: '864x496' },
    ]);
    expect(pickVideoDimensions({ videoDimensions: { 'a=1|b=2': '10x20' } })).toEqual([
      { key: 'a=1|b=2', value: '10x20' },
    ]);
  });

  it('读回：不是对象（数组 / 字符串）时当没有，不猜', () => {
    expect(pickVideoDimensions({ video_dimensions: ['x'] })).toEqual([]);
    expect(pickVideoDimensions({ video_dimensions: 'oops' })).toEqual([]);
    expect(pickVideoDimensions({})).toEqual([]);
  });

  it('写回：空键 / 空值的行丢掉；一行都没有时整个不写这个键', () => {
    expect(
      buildVideoDimensions([
        { key: 'resolution=480p|aspect_ratio=16:9', value: '864x496' },
        { key: '', value: '' },
        { key: 'resolution=720p|aspect_ratio=16:9', value: ' ' },
      ]),
    ).toEqual({ 'resolution=480p|aspect_ratio=16:9': '864x496' });
    expect(buildVideoDimensions([])).toBeUndefined();
  });
});

describe('结构化控件与未识别字段的边界', () => {
  it('★ 归结构化控件管的键不进未识别字段（对象键与标量键都是）', () => {
    const extra = dropKnownFeatures({
      video_dimensions: { 'resolution=480p|aspect_ratio=16:9': '864x496' },
      videoDimensions: { 'resolution=480p|aspect_ratio=16:9': '864x496' },
      task_types: { first_frame: { allowed_ratios: ['16:9'] } },
      reference_image: true,
      max_prompt_length: 4000,
    });
    expect(extra).toEqual({});
  });

  it('★ 类型不符的脏值留在未识别字段里原样回写（静默删掉比让人看到它更危险）', () => {
    const extra = dropKnownFeatures({
      video_dimensions: ['oops'],
      task_types: 'oops',
      tools: 'yes',
      something_unknown: 42,
    });
    expect(extra).toEqual({
      video_dimensions: ['oops'],
      task_types: 'oops',
      tools: 'yes',
      something_unknown: 42,
    });
  });
});
