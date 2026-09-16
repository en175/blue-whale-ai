import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_ID,
  buildCreateParams,
  durationsFromModel,
  type FormSnapshot,
} from './model-form';
import type { AdminModel } from '@/api/admin';

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
    durationShape: 'object',
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
    // IKG4UR：音频没有可配时长——上游是 TTS 式接口（请求无 duration），库里该列已置 NULL。
    // 表单也不再渲染时长控件；即便传了值也不落库，维持「非空 ⟺ 可配」不变式。
    expect(result.value.supported_durations).toBeNull();
    expect(result.value.supported_formats).toEqual(['mp3']);
    expect(result.value.supported_sizes).toEqual([]);
    expect(result.value.channel_parser).toBeUndefined();
  });
});

// IKG4UR：库中 supported_durations 有数组（管理端写入）与对象（消费端契约/种子写入）两种形态。
// 只认数组时，打开对象行会读成空、保存把整列覆盖成 null——静默数据损坏。
describe('durationsFromModel 兼容两种形态（IKG4UR）', () => {
  const model = (durations: unknown) =>
    ({ supported_durations: durations }) as unknown as AdminModel;

  it('数组形态（管理端写入）→ 三项回显', () => {
    expect(durationsFromModel(model([5, 10, 1]))).toEqual({ min: '5', max: '10', step: '1' });
  });

  it('对象形态（消费端契约/种子写入）→ 三项回显，不再读成空', () => {
    expect(durationsFromModel(model({ min: 4, max: 30, step: 1 }))).toEqual({
      min: '4',
      max: '30',
      step: '1',
    });
    // step 可缺省
    expect(durationsFromModel(model({ min: 5, max: 10 }))).toEqual({
      min: '5',
      max: '10',
      step: '',
    });
  });

  it('null / 空数组 → 三项为空', () => {
    expect(durationsFromModel(model(null))).toEqual({ min: '', max: '', step: '' });
    expect(durationsFromModel(model([]))).toEqual({ min: '', max: '', step: '' });
  });

  it('对象行往返不丢值也不改形态：回显 → 提交仍是等值对象，而不是 null 或数组', () => {
    const shown = durationsFromModel(model({ min: 4, max: 30, step: 1 }));
    const result = buildCreateParams(
      snapshot({
        type: 'video',
        durationMin: shown.min,
        durationMax: shown.max,
        durationStep: shown.step,
        durationShape: 'object',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 形态必须保持：写成数组会让 durationInRange 把它当档位列表，4–30 缩成 {1,4,30}
    expect(result.value.supported_durations).toEqual({ min: 4, max: 30, step: 1 });
  });

  it('数组行往返保持数组形态（不擅自改成对象）', () => {
    const shown = durationsFromModel(model([5, 10]));
    const result = buildCreateParams(
      snapshot({
        type: 'video',
        durationMin: shown.min,
        durationMax: shown.max,
        durationStep: shown.step,
        durationShape: 'array',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supported_durations).toEqual([5, 10]);
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
