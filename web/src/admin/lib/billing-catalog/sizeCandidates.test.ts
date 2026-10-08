import { describe, expect, it } from 'vitest';
import type { AdminModel } from '@/api/adminModels';
import {
  axisValueInKey,
  buildCapabilityIndex,
  candidateSpecKeys,
  configuredSizePixels,
  defaultAxesForBaseUnit,
  describePixels,
  dimensionTableCandidates,
  parsePixels,
  prefillDimensionValue,
  priceTableCandidates,
  sizeOfSpecKey,
} from './sizeCandidates';

/** 一个档位在 **wire 上的**真实形态（含出站值与像素宽高）。
 *
 *  `AdminModel['supported_sizes']` 只声明 id/label（见 `api/admin.ts` 那条 ⚠️ 的取舍），
 *  而库里这几列确实在——所以夹具按 wire 造，收口时收窄成 `AdminModel`。
 *  本模块读的正是 wire 形态（`toCapabilitySize(raw: unknown)`），这条缝本身就是被测对象。 */
type SizeWire = {
  id: string;
  label?: string;
  api_value?: string;
  apiValue?: string;
  width?: number;
  height?: number;
};

/** 能力行夹具：只填本模块读的字段，其余给中性值（模块也不读别的）。 */
function model(
  partial: Omit<Partial<AdminModel>, 'supported_sizes'> & {
    model_id: string;
    supported_sizes?: SizeWire[];
  },
): AdminModel {
  const { supported_sizes, ...rest } = partial;
  return {
    id: '1',
    provider_id: 'volcengine',
    capability_type: 'image',
    model_label: partial.model_id,
    icon: null,
    supported_aspect_ratios: [],
    supported_durations: null,
    supported_formats: [],
    default_size: null,
    default_format: null,
    default_aspect_ratio: null,
    default_duration: null,
    features: {},
    request_mapping: null,
    enabled: true,
    sort_order: 0,
    is_default: false,
    created_at: '',
    updated_at: '',
    ...rest,
    supported_sizes: (supported_sizes ?? []) as unknown as AdminModel['supported_sizes'],
  };
}

/** 线上形态的 5.0 Pro：id 与 api_value 只有大小写差异，矩阵键 = api_value。 */
const SEEDREAM_PRO = model({
  model_id: 'doubao-seedream-5-0-pro-260628',
  supported_sizes: [
    { id: '1k', label: '1K', api_value: '1K' },
    { id: '1.5k', label: '1.5K', api_value: '1.5K' },
    { id: '2k', label: '2K', api_value: '2K' },
  ],
  supported_aspect_ratios: [{ id: '1:1', label: '1:1' }, { id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }],
  default_aspect_ratio: '1:1',
  request_mapping: {
    matrix: {
      // ⚠️ 故意写成 api_value 的大写拼写：读侧必须大小写不敏感（与 worker 同口径）
      '1K': { '1:1': '1024x1024', '16:9': '1424x800' },
      '2K': { '1:1': '2048x2048', '16:9': '2816x1584' },
    },
  },
});

const seedreamPro = buildCapabilityIndex([SEEDREAM_PRO]).get('doubao-seedream-5-0-pro-260628')!;

/** 视频 2.5：能力行只有分辨率档与比例；宽高**不在**能力行里（视频矩阵是 null）。 */
const seedance25 = buildCapabilityIndex([
  model({
    model_id: 'doubao-seedance-2-5-260628',
    capability_type: 'video',
    supported_sizes: [
      { id: '480p', label: '480P', api_value: '480p' },
      { id: '720p', label: '720P', api_value: '720p' },
    ],
    supported_aspect_ratios: [{ id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }],
  }),
]).get('doubao-seedance-2-5-260628')!;

describe('buildCapabilityIndex', () => {
  it('按 model_id 索引；停用行不覆盖启用行', () => {
    const index = buildCapabilityIndex([
      model({ model_id: 'm', enabled: false, supported_sizes: [{ id: '停用档' }] }),
      model({ model_id: 'm', enabled: true, supported_sizes: [{ id: '在用小档' }] }),
    ]);
    expect(index.get('m')?.sizes.map((s) => s.id)).toEqual(['在用小档']);
  });

  it('兼容 camelCase apiValue（与 backend toSizes 同口径）', () => {
    const index = buildCapabilityIndex([
      model({ model_id: 'm', supported_sizes: [{ id: 'k', apiValue: 'K' }] }),
    ]);
    expect(index.get('m')?.sizes[0]?.apiValue).toBe('K');
  });
});

describe('candidateSpecKeys', () => {
  it('轴序规范化为「档位 → 比例 → video」', () => {
    expect(
      candidateSpecKeys([
        { name: 'aspect_ratio', values: ['16:9'] },
        { name: 'resolution', values: ['720p'] },
        { name: 'video', values: ['0', '1'] },
      ]),
    ).toEqual(['resolution=720p|aspect_ratio=16:9|video=0', 'resolution=720p|aspect_ratio=16:9|video=1']);
  });

  it('任一轴取不到取值 → null（不返回空数组：那是「这个模型一档都没有」的意思）', () => {
    expect(candidateSpecKeys([{ name: 'size', values: [] }])).toBeNull();
    expect(candidateSpecKeys([])).toBeNull();
  });

  it('能力行取不到该轴 → null，调用方据此退回自由编辑', () => {
    expect(priceTableCandidates(seedance25, ['duration'], [])).toBeNull();
  });
});

/* ⚠️ 这一组就是用户那句「模型尺寸表，模型配置里面有啊」的落点：尺寸表的候选键
 *   = supported_sizes × supported_aspect_ratios，运营不再手敲。 */
describe('尺寸表候选键 = 分辨率档 × 宽高比', () => {
  it('★ 视频：候选集就是能力行的两个字段做笛卡尔积', () => {
    expect(dimensionTableCandidates(seedance25)).toEqual([
      'resolution=480p|aspect_ratio=16:9',
      'resolution=480p|aspect_ratio=9:16',
      'resolution=720p|aspect_ratio=16:9',
      'resolution=720p|aspect_ratio=9:16',
    ]);
  });

  it('★ 视频的能力行里没有宽高 → 预填为空（宽高只能在定价目录里填）', () => {
    expect(prefillDimensionValue(seedance25, 'resolution=720p|aspect_ratio=16:9')).toBe('');
  });

  it('★ 图片的能力行里有矩阵 → 按 api_value 预填（大小写不敏感）', () => {
    expect(prefillDimensionValue(seedreamPro, 'resolution=2k|aspect_ratio=16:9')).toBe(
      '2816x1584',
    );
  });

  it('比例没配的能力行 → 派生不出来，退回自由编辑', () => {
    const noRatio = buildCapabilityIndex([
      model({ model_id: 'm', supported_sizes: [{ id: '1k' }] }),
    ]).get('m')!;
    expect(dimensionTableCandidates(noRatio)).toBeNull();
  });
});

describe('价格表候选键', () => {
  it('图片按尺寸档：`by:["size"]` → 每个档位一个键', () => {
    expect(priceTableCandidates(seedreamPro, ['size'], [])).toEqual([
      'size=1k',
      'size=1.5k',
      'size=2k',
    ]);
  });

  it('★ 视频按 token：分辨率档 × video 两档', () => {
    expect(priceTableCandidates(seedance25, ['resolution', 'video'], [])).toEqual([
      'resolution=480p|video=0',
      'resolution=480p|video=1',
      'resolution=720p|video=0',
      'resolution=720p|video=1',
    ]);
  });

  it('目录没声明 by 时从既有键抽轴（也是目录自己说的话，不是页面猜的）', () => {
    expect(priceTableCandidates(seedance25, [], ['resolution=720p|video=1'])).toEqual([
      'resolution=480p|video=0',
      'resolution=480p|video=1',
      'resolution=720p|video=0',
      'resolution=720p|video=1',
    ]);
  });
});

describe('defaultAxesForBaseUnit（新建规则的初值）', () => {
  it('按 token 计价 → 分辨率档 × 视频输入档；按张 → 尺寸档', () => {
    expect(defaultAxesForBaseUnit('usage.c')).toEqual(['resolution', 'video']);
    expect(defaultAxesForBaseUnit('usage.succeededSlots')).toEqual(['size']);
    expect(defaultAxesForBaseUnit('constant:1')).toEqual([]);
  });
});

describe('像素：图片按像素分档定价时运营要看得见的那个数', () => {
  it('★ 2K 的 2048² = 419 万 —— 261 万像素分界的判据', () => {
    const size2k = seedreamPro.sizes.find((s) => s.id === '2k')!;
    const pixels = configuredSizePixels(seedreamPro, size2k);
    expect(pixels).toEqual({ width: 2048, height: 2048 });
    expect(describePixels(pixels)).toBe('2048x2048（419 万像素）');
  });

  it('默认比例那格取不到时回落矩阵里第一格；都取不到 → null', () => {
    const noDefault = buildCapabilityIndex([
      model({
        model_id: 'm',
        supported_sizes: [{ id: '1k' }],
        request_mapping: { matrix: { '1k': { '16:9': '1424x800' } } },
      }),
    ]).get('m')!;
    expect(configuredSizePixels(noDefault, noDefault.sizes[0]!)).toEqual({
      width: 1424,
      height: 800,
    });
    expect(configuredSizePixels(seedance25, seedance25.sizes[0]!)).toBeNull();
    expect(describePixels(null)).toBe('');
  });

  it('能力行自己写了 width/height 就用它', () => {
    const withWh = buildCapabilityIndex([
      model({ model_id: 'm', supported_sizes: [{ id: '480p', width: 854, height: 480 }] }),
    ]).get('m')!;
    expect(configuredSizePixels(withWh, withWh.sizes[0]!)).toEqual({ width: 854, height: 480 });
  });

  it('parsePixels 只认「宽x高」', () => {
    expect(parsePixels('1248x704')).toEqual({ width: 1248, height: 704 });
    expect(parsePixels('1248×704')).toEqual({ width: 1248, height: 704 });
    expect(parsePixels('auto')).toBeNull();
    expect(parsePixels('0x0')).toBeNull();
  });
});

describe('规格键的小工具', () => {
  it('axisValueInKey 取某一根轴的值', () => {
    expect(axisValueInKey('resolution=720p|video=1', 'video')).toBe('1');
    expect(axisValueInKey('resolution=720p|video=1', 'size')).toBe('');
  });

  it('sizeOfSpecKey 大小写不敏感地找档位', () => {
    expect(sizeOfSpecKey(seedreamPro, 'size=2K')?.id).toBe('2k');
    // 能力行里没有的档位（就是那个漂移出来的 4k）→ null
    expect(sizeOfSpecKey(seedreamPro, 'size=4k')).toBeNull();
  });
});
