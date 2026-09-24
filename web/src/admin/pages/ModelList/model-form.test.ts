import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_ID,
  buildCreateParams,
  buildTaskTypes,
  camelFeatureKey,
  diffUpdateParams,
  durationsFromModel,
  featureValueTypeOk,
  hasFeatureKey,
  mergeMatrix,
  parseGptMatrix,
  pickTaskTypeRatios,
  readFeature,
  sizesFromModel,
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
    originalParser: 'gpt',
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
  supported_aspect_ratios: ['1:1'],
  supported_durations: null,
  supported_formats: [],
  default_size: '1K',
  default_format: null,
  default_aspect_ratio: '1:1',
  default_duration: null,
  features: {},
  channel_parser: 'seedream',
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

// IKHEXG：`default_size` / `default_aspect_ratio` 在后端是 **NOT NULL**（VarChar）列，「未配」的形态
// 是**空串**。表单曾把它们序列化成 null（`form.defaultSize.trim() || null`），写闸门又只收字符串
// → 非图片/视频行（音频 / 文生文）从后台保存**必然 400**（实测：`PUT /api/admin/models/23` 报
// 「默认尺寸(default_size)须为字符串且≤32字符」）。
// 另一层：diff 比对两侧都套 `?? null`，库里是 `''` 而提交侧是 `null`，会把「其实等价」判成变更。
describe('NOT NULL 尺寸/比例列：提交空串而非 null（IKHEXG）', () => {
  const audioSnapshot = () =>
    snapshot({
      type: 'audio',
      modelId: 'seed-audio-1.0',
      label: '豆包 Seed Audio 1.0',
      parser: 'seedream',
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

  // 上面三条都在证「不要多提交」；这条证反向——真的改了就必须提交。
  // 少了它，日后把 diff 的归一写过头（比如恒判相等）会静默吞掉真实修改，而测试全绿。
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

  it('seedream 且本来就是 seedream 的行：矩阵按原样提交，diff 层不产生变更', () => {
    const result = buildCreateParams(
      snapshot({
        parser: 'seedream',
        originalParser: 'seedream',
        seedreamMatrix: { '1K': { '1:1': '1024x1024' } },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request_mapping).toEqual({ matrix: { '1K': { '1:1': '1024x1024' } } });
  });

  it('seedream 且矩阵编辑器为空、库里本来也没有矩阵：不提交该字段', () => {
    const result = buildCreateParams(
      snapshot({ parser: 'seedream', originalParser: 'seedream', originalHadRequestMapping: false }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // IKHBDO：`undefined` = 不提交该字段。原先无条件写死 null——虽然后端对
    // seedream 行的 null 当「不改」，但前端不该依赖这条宽容规则来表达「我什么都没说」。
    expect(result.value.request_mapping).toBeUndefined();
  });

  it('seedream：矩阵编辑器改动后按新矩阵提交', () => {
    const result = buildCreateParams(
      snapshot({
        parser: 'seedream',
        originalParser: 'seedream',
        seedreamMatrix: { '1K': { '1:1': '2048x2048', '16:9': '' } },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request_mapping).toEqual({ matrix: { '1K': { '1:1': '2048x2048' } } });
  });

  it('seedream：提交时矩阵键换回 api_value 拼写（worker 的查找键），不是 size.id', () => {
    // IKHTL0：表单内部按 size.id 存键（渲染要按 id 取格），但 worker 查表用的是该档位的
    // api_value。若按 id 提交，一次「什么都没改」的保存就会把库里 `1K` 的键改写成 `1k`，
    // 靠 worker 的大小写兜底才不出事——隐性不变式被悄悄写坏。无 api_value 的档位回落用 id。
    const result = buildCreateParams(
      snapshot({
        parser: 'seedream',
        originalParser: 'seedream',
        sizes: [
          { id: '1k', label: '1K', apiValue: '1K' },
          { id: '1.5k', label: '1.5K' },
        ],
        seedreamMatrix: { '1k': { '1:1': '1024x1024' }, '1.5k': { '1:1': '1536x1536' } },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request_mapping).toEqual({
      matrix: { '1K': { '1:1': '1024x1024' }, '1.5k': { '1:1': '1536x1536' } },
    });
  });

  it('从别的解析器切到 seedream：显式提交 null 清掉旧族矩阵', () => {
    const result = buildCreateParams(
      snapshot({ parser: 'seedream', originalParser: 'gpt', seedreamMatrix: {} }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // null 是「旧族的矩阵不再适用」的唯一表达；当成「不改」会把 gpt 矩阵留在库里，
    // worker 会拿它去算 seedream 尺寸，而界面上再也清不掉。
    expect(result.value.request_mapping).toBeNull();
  });

  it('seedream：矩阵整张被清空（原本有矩阵）→ 拦下而不是静默保留 / 清空', () => {
    const result = buildCreateParams(
      snapshot({
        parser: 'seedream',
        originalParser: 'seedream',
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
      snapshot({ parser: 'seedream', originalParser: 'seedream', seedreamMatrix: { '1K': { '1:1': '1k' } } }),
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
        parser: 'seedream',
        originalParser: 'seedream',
        originalHadRequestMapping: true,
        sizes,
        ratios: initial.supported_aspect_ratios,
        seedreamMatrix: parseGptMatrix(initial.request_mapping, sizes, initial.supported_aspect_ratios),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changes = diffUpdateParams(initial, result.value);
    expect(changes).not.toHaveProperty('request_mapping');
  });

  it('gpt → seedream 切换：diff 里带 null，把旧矩阵清掉', () => {
    const initial = modelRow({ channel_parser: 'gpt' });
    const result = buildCreateParams(
      snapshot({ parser: 'seedream', originalParser: 'gpt', seedreamMatrix: {} }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changes = diffUpdateParams(initial, result.value);
    expect(changes.channel_parser).toBe('seedream');
    expect(changes.request_mapping).toBeNull();
  });
});

// IKHBDO：库里 supported_sizes 元素除 id/label 外还带 api_value / width / height。
// 表单只认 id+label 时，任何一次保存都会把这三个字段整包抹掉（api_value 正是出站真实取值）。
describe('尺寸行扩展字段（IKHBDO）', () => {
  it('读回 id / label / api_value / width / height（兼容 camelCase apiValue）', () => {
    expect(
      sizesFromModel([
        { id: '1K', label: '1K' },
        { id: '2k', label: '2K', api_value: '2k', width: 2048, height: 1152 },
        { id: '3k', label: '3K', apiValue: '3k' },
      ]),
    ).toEqual([
      { id: '1K', label: '1K', apiValue: '', width: '', height: '' },
      { id: '2k', label: '2K', apiValue: '2k', width: '2048', height: '1152' },
      { id: '3k', label: '3K', apiValue: '3k', width: '', height: '' },
    ]);
  });

  it('提交时写回 api_value / width / height，留空的键不写', () => {
    const result = buildCreateParams(
      snapshot({
        sizes: [
          { id: '4K', label: '4K', apiValue: '4k', width: '4096', height: '4096' },
          { id: '2K', label: '2K', apiValue: '', width: '', height: '' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supported_sizes).toEqual([
      { id: '4K', label: '4K', width: 4096, height: 4096, api_value: '4k' },
      { id: '2K', label: '2K' },
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

describe('features 键形与类型（IKHBDO）', () => {
  it('读侧回落 camelCase（后端 toFeatures 优先认 camel）', () => {
    expect(readFeature({ imageReferenceMax: 4 }, 'image_reference_max')).toBe(4);
    expect(readFeature({ image_reference_max: 6 }, 'image_reference_max')).toBe(6);
    expect(readFeature({ sequentialImageGeneration: true }, 'sequential_image_generation')).toBe(true);
    expect(hasFeatureKey({ imageReferenceMax: 4 }, 'image_reference_max')).toBe(true);
    expect(camelFeatureKey('image_protocol')).toBe('imageProtocol');
  });

  it('类型不符的脏值不归结构化控件管（会留在高级 JSON 里回写，而不是被删掉）', () => {
    expect(featureValueTypeOk('image_reference_max', 4)).toBe(true);
    expect(featureValueTypeOk('image_reference_max', '4')).toBe(false);
    expect(featureValueTypeOk('tools', true)).toBe(true);
    expect(featureValueTypeOk('tools', 'yes')).toBe(false);
    expect(featureValueTypeOk('image_protocol', 'openai-images')).toBe(true);
  });
});

describe('task_types 结构化编辑（IKHBDO）', () => {
  it('读回每个任务类型的 allowed_ratios', () => {
    const features = {
      task_types: {
        first_frame: { allowed_ratios: ['16:9', '9:16'] },
        prolong: { allowed_ratios: 'not-an-array' },
      },
    };
    const ratios = pickTaskTypeRatios(features);
    expect(ratios.first_frame).toEqual(['16:9', '9:16']);
    expect(ratios.default).toEqual([]);
    expect(ratios.prolong).toEqual([]);
  });

  it('写回只动 allowed_ratios：其它子键与未知任务类型原样保留', () => {
    const base = {
      first_frame: { allowed_ratios: ['1:1'], allowed_durations: [5, 10] },
      custom_type: { allowed_ratios: ['4:3'] },
    };
    expect(buildTaskTypes(base, { first_frame: ['16:9'] })).toEqual({
      first_frame: { allowed_ratios: ['16:9'], allowed_durations: [5, 10] },
      custom_type: { allowed_ratios: ['4:3'] },
    });
  });

  it('清空某任务类型的比例 → 该键被移除（而不是留下空数组让约束形同虚设）', () => {
    expect(buildTaskTypes({ default: { allowed_ratios: ['1:1'] } }, { default: [] })).toEqual({});
  });
});

describe('mergeMatrix：集合变化时保住其它格（IKHBDO）', () => {
  const prev = {
    '1K': { '1:1': '1024x1024', '16:9': '1536x864' },
    '2K': { '1:1': '2048x2048' },
  };

  it('删一个尺寸行 → 其余行保留', () => {
    expect(mergeMatrix(prev, [{ id: '1K', label: '1K' }], ['1:1', '16:9'])).toEqual({
      '1K': { '1:1': '1024x1024', '16:9': '1536x864' },
    });
  });

  it('删一个比例 chip → 其余列保留，被删列不复活', () => {
    expect(mergeMatrix(prev, [{ id: '1K' }, { id: '2K' }], ['1:1'])).toEqual({
      '1K': { '1:1': '1024x1024' },
      '2K': { '1:1': '2048x2048' },
    });
  });
});

// IKHTL0：库里 matrix 的键与 supported_sizes 的 id 由两次迁移分别写入，大小写可能不一致
// （IKDBYY 写 id 小写 `1k`，IK629 写矩阵键大写 `1K`）。读侧原本精确匹配 → 这些 seedream 行的
// 矩阵整张显空白；而 worker 查表本来就大小写不敏感（ImageChannelMapper.resolveSeedreamSize
// 有显式兜底），所以线上生成一直正常，坏的只有管理端显示。读侧必须与 worker 同口径。
describe('parseGptMatrix：库中键大小写与表单 id 不一致（IKHTL0）', () => {
  const sizes = [
    { id: '1k', label: '1K' },
    { id: '2k', label: '2K' },
  ];
  const ratios = ['1:1'];

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
    expect(parseGptMatrix({ matrix: { '1k': { auto: '1024x1024' } } }, sizes, ['Auto'])).toEqual({
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
        parser: 'seedream',
        originalParser: 'seedream',
        // 表单不再渲染音频的时长范围控件；即便快照里带了值也不落库（IKG4UR 不变式）
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
