import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_ID,
  buildCreateParams,
  type FormSnapshot,
} from './model-form';

function snapshot(overrides: Partial<FormSnapshot> = {}): FormSnapshot {
  return {
    type: 'image',
    modelId: 'gpt-image-2',
    label: 'GPT Image 2',
    icon: '',
    sizes: [
      { id: '1K', label: '1K' },
      { id: '2K', label: '2K' },
    ],
    ratios: ['1:1', '16:9', '9:16'],
    durationMin: '',
    durationMax: '',
    durationStep: '',
    formats: ['png'],
    defaultSize: '1K',
    defaultRatio: '1:1',
    defaultFormat: 'png',
    defaultDuration: '',
    enabled: true,
    features: {},
    parser: 'gpt',
    gptMatrix: {
      '1K': { '1:1': '1024x1024', '16:9': '', '9:16': '' },
      '2K': { '1:1': '2048x2048', '16:9': '2048x1152', '9:16': '2160x3840' },
    },
    bananaQuality: {},
    bananaSize: {},
    ...overrides,
  };
}

describe('buildCreateParams', () => {
  it('新建不填供应商，系统写死 new-api', () => {
    const result = buildCreateParams(snapshot());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provider_id).toBe(DEFAULT_PROVIDER_ID);
    expect(result.value.channel_parser).toBe('gpt');
  });

  it('文本模型不提交尺寸/比例/时长', () => {
    const result = buildCreateParams(
      snapshot({
        type: 'text',
        modelId: 'MiniMax-M3',
        label: 'MiniMax',
        parser: 'seedream',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supported_sizes).toEqual([]);
    expect(result.value.supported_aspect_ratios).toEqual([]);
    expect(result.value.supported_durations).toBeNull();
    expect(result.value.channel_parser).toBeUndefined();
    expect(result.value.default_duration).toBeNull();
  });

  it('音频模型提交时长范围与格式，不提交尺寸矩阵', () => {
    const result = buildCreateParams(
      snapshot({
        type: 'audio',
        modelId: 'seed-audio-1.0',
        label: '豆包 Seed Audio 1.0',
        parser: 'seedream',
        durationMin: '1',
        durationMax: '120',
        formats: ['mp3'],
        defaultFormat: 'mp3',
        defaultDuration: '8',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.capability_type).toBe('audio');
    expect(result.value.supported_durations).toEqual([1, 120]);
    expect(result.value.supported_formats).toEqual(['mp3']);
    expect(result.value.supported_sizes).toEqual([]);
    expect(result.value.channel_parser).toBeUndefined();
  });
});

describe('gpt / banana mapping', () => {
  it('GPT 交叉格留空组合不写入 mapping', () => {
    const result = buildCreateParams(snapshot());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request_mapping).toEqual({
      matrix: {
        '1K': { '1:1': '1024x1024' },
        '2K': { '1:1': '2048x2048', '16:9': '2048x1152', '9:16': '2160x3840' },
      },
    });
  });

  it('GPT 交叉格拒绝非官方枚举', () => {
    const result = buildCreateParams(
      snapshot({ gptMatrix: { '1K': { '1:1': '1K' } } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/官方 size 枚举/);
  });

  it('banana 是两列一维映射，不是像素交叉格', () => {
    const result = buildCreateParams(
      snapshot({
        parser: 'banana',
        bananaQuality: { '1K': '1k', '2K': '2k' },
        bananaSize: { '1:1': '1x1', '16:9': '16x9' },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request_mapping).toEqual({
      quality: { '1K': '1k', '2K': '2k' },
      size: { '1:1': '1x1', '16:9': '16x9' },
    });
    expect(result.value.request_mapping).not.toHaveProperty('matrix');
  });

  it('seedream 不提交映射表', () => {
    const result = buildCreateParams(snapshot({ parser: 'seedream' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request_mapping).toBeNull();
  });
});
