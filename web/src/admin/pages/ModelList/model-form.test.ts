import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_ID,
  buildCreateParams,
  buildTaskTypes,
  camelFeatureKey,
  channelFromModel,
  channelOf,
  channelsForMedia,
  diffUpdateParams,
  durationsFromModel,
  featureValueTypeOk,
  hasFeatureKey,
  mergeMatrix,
  parseGptMatrix,
  pickTaskTypeRatios,
  pickTaskTypeEnabled,
  pickTaskTypeDuration,
  ratiosFromModel,
  readFeature,
  sizesFromModel,
  type FormSnapshot,
  type RatioForm,
} from './model-form';
import type { AdminModel } from '@/admin/api/adminModels';

function ratioRows(...ids: string[]): RatioForm[] {
  return ids.map((id) => ({ id }));
}

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
    ratios: ratioRows('1:1', '16:9', '9:16'),
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
    channel: 'gpt-image',
    originalChannel: 'gpt-image',
    originalHadRequestMapping: true,
    gptMatrix: {
      '1K': { '1:1': '1024x1024', '16:9': '', '9:16': '' },
      '2K': { '1:1': '2048x2048', '16:9': '2048x1152', '9:16': '2160x3840' },
    },
    seedreamMatrix: {},
    bananaQuality: {},
    bananaSize: {},
    ...overrides,
  };
}

const modelRow = (overrides: Partial<AdminModel> = {}): AdminModel => ({
  id: '9',
  provider_id: 'new-api',
  model_id: 'seedream-4-0',
  capability_type: 'image',
  model_label: 'Seedream 4.0',
  icon: null,
  supported_sizes: [{ id: '1K', label: '1K' }],
  supported_aspect_ratios: [{ id: '1:1', label: '1:1' }],
  supported_durations: null,
  supported_formats: [],
  default_size: '1K',
  default_format: null,
  default_aspect_ratio: '1:1',
  default_duration: null,
  features: {},
  channel: 'seedream-image',
  request_mapping: { matrix: { '1K': { '1:1': '1024x1024' } } },
  enabled: true,
  sort_order: 1,
  is_default: false,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

describe('buildCreateParams', () => {
  it('新建不填供应商，系统写死 new-api', () => {
    const result = buildCreateParams(snapshot());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provider_id).toBe(DEFAULT_PROVIDER_ID);
    expect(result.value.channel).toBe('gpt-image');
  });

  it('文本模型不提交尺寸/比例/时长', () => {
    const result = buildCreateParams(
      snapshot({
        type: 'text',
        modelId: 'MiniMax-M3',
        label: 'MiniMax',
        channel: 'seedream-text',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supported_sizes).toEqual([]);
    expect(result.value.supported_aspect_ratios).toEqual([]);
    expect(result.value.supported_durations).toBeNull();
    expect(result.value.channel).toBeUndefined();
    expect(result.value.default_duration).toBeNull();
  });

  it('音频模型提交时长范围与格式，不提交尺寸矩阵', () => {
    const result = buildCreateParams(
      snapshot({
        type: 'audio',
        modelId: 'seed-audio-1.0',
        label: '豆包 Seed Audio 1.0',
        channel: 'seedream-audio',
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
    expect(result.value.supported_durations).toBeNull();
    expect(result.value.supported_formats).toEqual(['mp3']);
    expect(result.value.supported_sizes).toEqual([]);
    expect(result.value.channel).toBeUndefined();
  });
});

describe('NOT NULL 尺寸/比例列：提交空串而非 null（IKHEXG）', () => {
  const audioSnapshot = () =>
    snapshot({
      type: 'audio',
      modelId: 'seed-audio-1.0',
      label: '豆包 Seed Audio 1.0',
      channel: 'seedream-audio',
      sizes: [],
      ratios: [],
    });

  it('音频行 create 提交空串（旧逻辑发 null，被写闸门拒）', () => {
    const result = buildCreateParams(audioSnapshot());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.default_size).toBe('');
    expect(result.value.default_aspect_ratio).toBe('');
  });

  it('音频行：库里空串 vs 提交空串 → 不产生伪变更', () => {
    const initial = modelRow({
      capability_type: 'audio',
      default_size: '',
      default_aspect_ratio: '',
      supported_sizes: [],
      supported_aspect_ratios: [],
    });
    const result = buildCreateParams(audioSnapshot());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changes = diffUpdateParams(initial, result.value);
    expect('default_size' in changes).toBe(false);
    expect('default_aspect_ratio' in changes).toBe(false);
  });

  it('图片行：清空尺寸/比例框 → 提交空串（旧逻辑发 null）', () => {
    const result = buildCreateParams(snapshot({ type: 'image', defaultSize: '', defaultRatio: '' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.default_size).toBe('');
    expect(result.value.default_aspect_ratio).toBe('');
  });

  it('图片行：真的改了尺寸/比例 → 原样提交（正向往返）', () => {
    const initial = modelRow({ default_size: '1K', default_aspect_ratio: '1:1' });
    const result = buildCreateParams(snapshot({ type: 'image', defaultSize: '2K', defaultRatio: '16:9' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changes = diffUpdateParams(initial, result.value);
    expect(changes.default_size).toBe('2K');
    expect(changes.default_aspect_ratio).toBe('16:9');
  });
});

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
        channel: 'banana-image',
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

  it('seedream 且本来就是 seedream 的行：矩阵按原样提交，diff 层不产生变更', () => {
    const result = buildCreateParams(
      snapshot({
        channel: 'seedream-image',
        originalChannel: 'seedream-image',
        seedreamMatrix: { '1K': { '1:1': '1024x1024' } },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request_mapping).toEqual({ matrix: { '1K': { '1:1': '1024x1024' } } });
  });

  it('seedream 且矩阵编辑器为空、库里本来也没有矩阵：不提交该字段', () => {
    const result = buildCreateParams(
      snapshot({ channel: 'seedream-image', originalChannel: 'seedream-image', originalHadRequestMapping: false }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request_mapping).toBeUndefined();
  });

  it('seedream：矩阵编辑器改动后按新矩阵提交', () => {
    const result = buildCreateParams(
      snapshot({
        channel: 'seedream-image',
        originalChannel: 'seedream-image',
        seedreamMatrix: { '1K': { '1:1': '2048x2048', '16:9': '' } },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request_mapping).toEqual({ matrix: { '1K': { '1:1': '2048x2048' } } });
  });

  it('seedream：提交时矩阵键就是档位 id（api_value 恒等于 id，不再换写拼写）', () => {
    const result = buildCreateParams(
      snapshot({
        channel: 'seedream-image',
        originalChannel: 'seedream-image',
        sizes: [
          { id: '1k', label: '1K' },
          { id: '1.5k', label: '1.5K' },
        ],
        seedreamMatrix: { '1k': { '1:1': '1024x1024' }, '1.5k': { '1:1': '1536x1536' } },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request_mapping).toEqual({
      matrix: { '1k': { '1:1': '1024x1024' }, '1.5k': { '1:1': '1536x1536' } },
    });
  });

  it('★ 无操作保存：矩阵键与 api_value 一起归一到 id 拼写，不留错位（IKHTVR）', () => {
    const stored = modelRow({
      supported_sizes: [{ id: '1k', label: '1K' }],
      request_mapping: { matrix: { '1K': { '1:1': '2048x2048' } } },
    });
    const sizes = sizesFromModel(stored.supported_sizes);
    const result = buildCreateParams(
      snapshot({
        channel: 'seedream-image',
        originalChannel: 'seedream-image',
        sizes,
        ratios: ratioRows('1:1'),
        seedreamMatrix: parseGptMatrix(stored.request_mapping, sizes, ratioRows('1:1')),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changes = diffUpdateParams(stored, result.value);
    expect(changes.supported_sizes).toEqual([{ id: '1k', api_value: '1k', label: '1K' }]);
    expect(changes.request_mapping).toEqual({ matrix: { '1k': { '1:1': '2048x2048' } } });
  });

  it('★ 存量裸字符串行：原样保存不提交 supported_aspect_ratios（ADR-0123）', () => {
    const stored = modelRow({ supported_aspect_ratios: ['1:1'] });
    const sizes = sizesFromModel(stored.supported_sizes);
    const ratios = ratiosFromModel(stored.supported_aspect_ratios);
    const result = buildCreateParams(
      snapshot({
        channel: 'seedream-image',
        originalChannel: 'seedream-image',
        sizes,
        ratios,
        seedreamMatrix: parseGptMatrix(stored.request_mapping, sizes, ratios),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changes = diffUpdateParams(stored, result.value);
    expect('supported_aspect_ratios' in changes).toBe(false);
    expect('request_mapping' in changes).toBe(false);
  });

  it('★ 展示名改动会提交，且只写 label 键（ADR-0123）', () => {
    const stored = modelRow();
    const sizes = sizesFromModel(stored.supported_sizes);
    const ratios = ratiosFromModel(stored.supported_aspect_ratios);
    const result = buildCreateParams(
      snapshot({
        channel: 'seedream-image',
        originalChannel: 'seedream-image',
        sizes,
        ratios: ratios.map((ratio) => ({ ...ratio, label: '方形' })),
        seedreamMatrix: parseGptMatrix(stored.request_mapping, sizes, ratios),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changes = diffUpdateParams(stored, result.value);
    expect(changes.supported_aspect_ratios).toEqual([{ id: '1:1', label: '方形' }]);
  });

  it('★ 展示名与 id 相同不写 label 键（ADR-0123）', () => {
    const stored = modelRow({ supported_aspect_ratios: ['1:1'] });
    const sizes = sizesFromModel(stored.supported_sizes);
    const ratios = ratiosFromModel(stored.supported_aspect_ratios);
    const result = buildCreateParams(
      snapshot({
        channel: 'seedream-image',
        originalChannel: 'seedream-image',
        sizes,
        ratios: ratios.map((ratio) => ({ ...ratio, label: ratio.id })),
        seedreamMatrix: parseGptMatrix(stored.request_mapping, sizes, ratios),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supported_aspect_ratios).toEqual([{ id: '1:1' }]);
  });

  it('从别的解析器切到 seedream：显式提交 null 清掉旧族矩阵', () => {
    const result = buildCreateParams(
      snapshot({ channel: 'seedream-image', originalChannel: 'gpt-image', seedreamMatrix: {} }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request_mapping).toBeNull();
  });

  it('seedream：矩阵整张被清空（原本有矩阵）→ 拦下而不是静默保留 / 清空', () => {
    const result = buildCreateParams(
      snapshot({
        channel: 'seedream-image',
        originalChannel: 'seedream-image',
        originalHadRequestMapping: true,
        seedreamMatrix: {},
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/不能整张清空/);
  });

  it('seedream：矩阵格必须是像素尺寸', () => {
    const result = buildCreateParams(
      snapshot({ channel: 'seedream-image', originalChannel: 'seedream-image', seedreamMatrix: { '1K': { '1:1': '1k' } } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/像素尺寸/);
  });

  it('seedream 行原样保存不会清掉库里的矩阵（diff 里没有 request_mapping）', () => {
    const initial = modelRow();
    const sizes = sizesFromModel(initial.supported_sizes);
    const result = buildCreateParams(
      snapshot({
        channel: 'seedream-image',
        originalChannel: 'seedream-image',
        originalHadRequestMapping: true,
        sizes,
        ratios: ratiosFromModel(initial.supported_aspect_ratios),
        seedreamMatrix: parseGptMatrix(initial.request_mapping, sizes, ratiosFromModel(initial.supported_aspect_ratios)),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changes = diffUpdateParams(initial, result.value);
    expect(changes).not.toHaveProperty('request_mapping');
  });

  it('gpt → seedream 切换：diff 里带 null，把旧矩阵清掉', () => {
    const initial = modelRow({ capability_type: 'image', channel: 'gpt-image' });
    const result = buildCreateParams(
      snapshot({ channel: 'seedream-image', originalChannel: 'gpt-image', seedreamMatrix: {} }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changes = diffUpdateParams(initial, result.value);
    expect(changes.channel).toBe('seedream-image');
    expect(changes.request_mapping).toBeNull();
  });
});

describe('尺寸行字段收敛（IKHTVR）', () => {
  it('读回只取 id / label，忽略 api_value / width / height（含 camelCase 写法）', () => {
    expect(
      sizesFromModel([
        { id: '1k', label: '1K' },
        { id: '2k', label: '2K', api_value: '2k', width: 2048, height: 1152 },
        { id: '3k', label: '3K', apiValue: '3k' },
      ]),
    ).toEqual([
      { id: '1k', label: '1K' },
      { id: '2k', label: '2K' },
      { id: '3k', label: '3K' },
    ]);
  });

  it('提交时 api_value 按 id 重建，不写 width / height', () => {
    const result = buildCreateParams(
      snapshot({
        sizes: [
          { id: '4k', label: '4K' },
          { id: '2k', label: '' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supported_sizes).toEqual([
      { id: '4k', api_value: '4k', label: '4K' },
      { id: '2k', api_value: '2k' },
    ]);
  });
});

describe('时长区间解析（IKHBDO）', () => {
  it('只填最小 + 步长、留空最大 → 拒绝，而不是把步长顶成最大', () => {
    const result = buildCreateParams(
      snapshot({ type: 'video', durationMin: '4', durationMax: '', durationStep: '1', durationShape: 'object' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/成对/);
  });

  it('最小大于最大 → 拒绝（后端也会拒，先在表单里说清楚）', () => {
    const result = buildCreateParams(
      snapshot({ type: 'video', durationMin: '30', durationMax: '4', durationStep: '', durationShape: 'object' }),
    );
    expect(result.ok).toBe(false);
  });

  it('三项齐全 → 按原形态（对象）写回', () => {
    const result = buildCreateParams(
      snapshot({ type: 'video', durationMin: '4', durationMax: '30', durationStep: '1', durationShape: 'object' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supported_durations).toEqual({ min: 4, max: 30, step: 1 });
  });

  it('数组形态无步长 → 数组，不夹带 undefined', () => {
    const result = buildCreateParams(
      snapshot({ type: 'video', durationMin: '5', durationMax: '10', durationStep: '', durationShape: 'array' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supported_durations).toEqual([5, 10]);
  });
});

describe('渠道：读侧归一', () => {
  const row = (channel: string | null, capability_type: AdminModel['capability_type'] = 'image') =>
    modelRow({ channel, capability_type });

  it('★ gpt-image 与 gpt-image-openai 是两个不同渠道（同一解析器两种协议，换协议 = 新渠道）', () => {
    expect(channelFromModel(row('gpt-image'))).toBe('gpt-image');
    expect(channelFromModel(row('gpt-image-openai'))).toBe('gpt-image-openai');
  });

  it('★ 大小写 / 空白归一后认得出（读侧宽容，归一只用于比对）', () => {
    expect(channelFromModel(row('  GPT-Image  '))).toBe('gpt-image');
  });

  it('★ 认不出的取值 / NULL 按**行的媒介**回落，不静默落到别的媒介的渠道', () => {
    expect(channelFromModel(row('随便写的'))).toBe('seedream-image');
    expect(channelFromModel(row('随便写的', 'video'))).toBe('seedream-video');
    expect(channelFromModel(row(null, 'audio'))).toBe('seedream-audio');
    expect(channelFromModel(row(null, 'text'))).toBe('seedream-text');
  });

  it('新建行（没有库里的行）= 该媒介的缺省渠道', () => {
    expect(channelFromModel(undefined)).toBe('seedream-image');
  });

  it('渠道 → 解析器与协议：两个 gpt 渠道共用交叉格，协议各不相同；非图片渠道两项皆无', () => {
    expect(channelOf('seedream-image')).toMatchObject({ media: 'image', parser: 'seedream', protocol: 'inline-image' });
    expect(channelOf('gpt-image')).toMatchObject({ media: 'image', parser: 'gpt', protocol: 'inline-image' });
    expect(channelOf('gpt-image-openai')).toMatchObject({ media: 'image', parser: 'gpt', protocol: 'openai-images' });
    expect(channelOf('banana-image')).toMatchObject({ media: 'image', parser: 'banana', protocol: 'inline-image' });
    for (const id of ['seedream-video', 'seedream-audio', 'seedream-text'] as const) {
      expect(channelOf(id)).toMatchObject({ parser: null, protocol: null });
    }
  });

  it('下拉只列该媒介自己的渠道（跨媒介的渠道过不了后端媒体闸门）', () => {
    expect(channelsForMedia('image').map((c) => c.id)).toEqual([
      'seedream-image',
      'gpt-image',
      'gpt-image-openai',
      'banana-image',
    ]);
    expect(channelsForMedia('video').map((c) => c.id)).toEqual(['seedream-video']);
  });
});


describe('features 键形与类型（IKHBDO）', () => {
  it('读侧回落 camelCase（后端 toFeatures 优先认 camel）', () => {
    expect(readFeature({ imageReferenceMax: 4 }, 'image_reference_max')).toBe(4);
    expect(readFeature({ image_reference_max: 6 }, 'image_reference_max')).toBe(6);
    expect(readFeature({ sequentialImageGeneration: true }, 'sequential_image_generation')).toBe(true);
    expect(hasFeatureKey({ imageReferenceMax: 4 }, 'image_reference_max')).toBe(true);
    expect(camelFeatureKey('max_prompt_length')).toBe('maxPromptLength');
  });

  it('类型不符的脏值不归结构化控件管（会留在未识别字段里回写，而不是被删掉）', () => {
    expect(featureValueTypeOk('image_reference_max', 4)).toBe(true);
    expect(featureValueTypeOk('image_reference_max', '4')).toBe(false);
    expect(featureValueTypeOk('tools', true)).toBe(true);
    expect(featureValueTypeOk('tools', 'yes')).toBe(false);
    expect(featureValueTypeOk('image_protocol', 'openai-images')).toBe(false);
  });
});

describe('task_types 结构化编辑（IKHBDO）', () => {
  it('读回每个任务类型的 allowed_ratios', () => {
    const features = {
      task_types: {
        first_frame: { allowed_ratios: ['16:9', '9:16'] },
        extend: { allowed_ratios: 'not-an-array' },
      },
    };
    const ratios = pickTaskTypeRatios(features);
    expect(ratios.first_frame).toEqual(['16:9', '9:16']);
    expect(ratios.text2video).toEqual([]);
    expect(ratios.extend).toEqual([]);
  });

  it('写回只动 allowed_ratios / allowed_durations：模式内的其它子键保留', () => {
    const base = {
      first_frame: { allowed_ratios: ['1:1'], allowed_durations: [5, 10], note: 'x' },
    };
    expect(buildTaskTypes(base, { first_frame: ['16:9'] }, { first_frame: true })).toEqual({
      first_frame: { allowed_ratios: ['16:9'], note: 'x' },
    });
  });

  it('未知模式键不再带回：带退役键的行保存一次就恢复合法', () => {
    const base = {
      prolong: { allowed_ratios: ['adaptive'] },
      edit: { allowed_ratios: ['adaptive'] },
    };
    expect(buildTaskTypes(base, { edit: ['adaptive'] }, { edit: true }, { edit: 'follow' })).toEqual({
      edit: { allowed_ratios: ['adaptive'], allowed_durations: [-1] },
    });
  });

  it('未勾选已知模式：该键被移除（键不在 = 该模式不开放）', () => {
    expect(
      buildTaskTypes({ text2video: { allowed_ratios: ['1:1'] } }, { text2video: [] }, {}),
    ).toEqual({});
  });

  it('三态时长策略写回：指定删键 / 仅自动写 [-1] / 自动或指定写 allow_auto_duration', () => {
    const base = { omni: { allowed_durations: [-1], allow_auto_duration: true } };
    expect(buildTaskTypes(base, {}, { omni: true }, { omni: 'specified' })).toEqual({ omni: {} });
    expect(buildTaskTypes(base, {}, { omni: true }, { omni: 'follow' })).toEqual({
      omni: { allowed_durations: [-1] },
    });
    expect(buildTaskTypes(base, {}, { omni: true }, { omni: 'auto-or-specified' })).toEqual({
      omni: { allow_auto_duration: true },
    });
  });

  it('从能力行读回三态', () => {
    expect(pickTaskTypeDuration({
      task_types: {
        edit: { allowed_durations: [-1] },
        extend: { allow_auto_duration: true },
        omni: {},
        text2video: { allowed_durations: [5] },
        image_reference: { allowed_durations: [-1, 5] },
      },
    })).toMatchObject({
      edit: 'follow',
      extend: 'auto-or-specified',
      omni: 'specified',
      text2video: 'specified',
      image_reference: 'specified',
    });
  });

  it('勾选但比例留空 → 保留空对象（键在 = 开放且无额外约束）', () => {
    expect(
      buildTaskTypes({}, { text2video: [] }, { text2video: true }),
    ).toEqual({ text2video: {} });
  });
});

describe('mergeMatrix：集合变化时保住其它格（IKHBDO）', () => {
  const prev = {
    '1K': { '1:1': '1024x1024', '16:9': '1536x864' },
    '2K': { '1:1': '2048x2048' },
  };

  it('删一个尺寸行 → 其余行保留', () => {
    expect(mergeMatrix(prev, [{ id: '1K', label: '1K' }], ratioRows('1:1', '16:9'))).toEqual({
      '1K': { '1:1': '1024x1024', '16:9': '1536x864' },
    });
  });

  it('删一个比例 chip → 其余列保留，被删列不复活', () => {
    expect(mergeMatrix(prev, [{ id: '1K' }, { id: '2K' }], ratioRows('1:1'))).toEqual({
      '1K': { '1:1': '1024x1024' },
      '2K': { '1:1': '2048x2048' },
    });
  });
});

describe('parseGptMatrix：库中键大小写与表单 id 不一致（IKHTL0）', () => {
  const sizes = [
    { id: '1k', label: '1K' },
    { id: '2k', label: '2K' },
  ];
  const ratios = ratioRows('1:1');

  it('库里键大写、表单 id 小写 → 归一到表单 id，格子有值', () => {
    expect(parseGptMatrix({ matrix: { '1K': { '1:1': '1024x1024' } } }, sizes, ratios)).toEqual({
      '1k': { '1:1': '1024x1024' },
      '2k': { '1:1': '' },
    });
  });

  it('库里键小写、表单 id 大写 → 同样归一到表单 id', () => {
    expect(
      parseGptMatrix(
        { matrix: { '1k': { '1:1': '1024x1024' } } },
        [{ id: '1K', label: '1K' }],
        ratios,
      ),
    ).toEqual({ '1K': { '1:1': '1024x1024' } });
  });

  it('比例键大小写不同也归一', () => {
    expect(parseGptMatrix({ matrix: { '1k': { auto: '1024x1024' } } }, sizes, ratioRows('Auto'))).toEqual({
      '1k': { Auto: '1024x1024' },
      '2k': { Auto: '' },
    });
  });

  it('表单里没有的库键原样保留——保存时不得静默抹掉', () => {
    expect(parseGptMatrix({ matrix: { '4K': { '1:1': '4096x4096' } } }, sizes, ratios)).toEqual({
      '1k': { '1:1': '' },
      '2k': { '1:1': '' },
      '4K': { '1:1': '4096x4096' },
    });
  });
});

describe('音频 / 文本行（IKHBDO）', () => {
  it('音频行：默认时长可提交，supported_durations 仍为 null（不可配时长）', () => {
    const result = buildCreateParams(
      snapshot({
        type: 'audio',
        modelId: 'seed-audio-1.0',
        label: '音频',
        channel: 'seedream-audio',
        originalChannel: 'seedream-audio',
        durationMin: '1',
        durationMax: '120',
        defaultDuration: '12',
        formats: ['mp3'],
        defaultFormat: 'mp3',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supported_durations).toBeNull();
    expect(result.value.default_duration).toBe(12);
  });
});


it('IKLUVP 三态策略保留扩展配置', () => {
  expect(buildTaskTypes({ extend: { extra: 7 } }, { extend: ['adaptive'] }, { extend: true }, { extend: 'auto-or-specified' })).toEqual({
    extend: { extra: 7, allowed_ratios: ['adaptive'], allow_auto_duration: true },
  });
});


it('IKLUVP 配置保存往返保持不变', () => {
  const task_types = { extend: { allow_auto_duration: true }, edit: { allowed_durations: [-1] }, omni: {} };
  const features = { task_types };
  expect(buildTaskTypes(task_types, {}, pickTaskTypeEnabled(features), pickTaskTypeDuration(features))).toEqual(task_types);
});
