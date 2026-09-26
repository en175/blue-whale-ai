/* ============================================
 * `features` 的**结构化字段表**与取值整理 —— 从 `ModelFormModal.tsx` 拆出来
 * （那个文件已顶到 `max-lines` 上限）。
 *
 * 这里只有纯函数与常量：哪些键归结构化控件管、怎么读回、怎么整理成提交形态。
 * 「这些控件长什么样」在 `SizeMaterialTab`。
 *
 * ── 一条贯穿全文件的取舍 ──────────────────────────────────────────────────────
 *
 * **不认识 / 类型不符的键原样留在高级 JSON 里**。整包提交时静默删掉一个键，
 * 比让运营在 JSON 里看到它危险得多（后端写侧闸门会给出可读报错）。
 * ============================================ */
import {
  KNOWN_FEATURE_KEYS,
  camelFeatureKey,
  featureValueTypeOk,
  readFeature,
  type ModelType,
} from './model-form';
import type { KeyValueRow } from '../../lib/billing-catalog/catalogDraft';

export const FEATURE_BOOL_LABELS: Record<string, { label: string; types?: ModelType[] }> = {
  reference_image: { label: '参考图 reference_image', types: ['image', 'video'] },
  watermark: { label: '水印 watermark', types: ['image', 'video'] },
  stream: { label: '流式输出 stream', types: ['image'] },
  sequential_image_generation: { label: '顺序生成 sequential_image_generation', types: ['image'] },
  first_frame: { label: '首帧 first_frame', types: ['video'] },
  last_frame: { label: '尾帧 last_frame', types: ['video'] },
  first_last_frame: { label: '首尾帧 first_last_frame', types: ['video'] },
  audio: { label: '音频 audio', types: ['video'] },
  /** ADR-0086：视频生成是否接受视频素材作普通参考（替代 seedance-2 前缀特判）。 */
  video_reference: { label: '视频素材参考 video_reference', types: ['video'] },
  /** ADR-0086：视频生成是否接受音频素材作参考（2.0 关 / 2.5 开）。 */
  audio_reference: { label: '音频素材参考 audio_reference', types: ['video'] },
  /** IKHBDO：模型是否开放工具调用（web_search 等）。写侧闸门对四种类型都收布尔值。 */
  tools: { label: '工具调用 tools' },
};

export const FEATURE_NUMBER_LABELS: Record<string, { label: string; types?: ModelType[]; placeholder: string }> = {
  quantity_max: { label: '单次生成数量 quantity_max', types: ['image'], placeholder: '如 1' },
  // IKHBDO：补上 text——TextGenDialog 就是按 `features.max_prompt_length ?? 缺省` 卡文本输入长度的，
  // 而表单只对 image / video 渲染这个键，文本行因此永远配不了自己的提示词上限。
  max_prompt_length: {
    label: '提示词上限 max_prompt_length',
    types: ['image', 'video', 'text'],
    placeholder: '如 32000',
  },
  /** ADR-0086：视频生成普通参考中的视频素材上限。 */
  video_reference_max: { label: '视频参考上限 video_reference_max', types: ['video'], placeholder: '如 3' },
  /** ADR-0086：视频 / 音频生成中的音频素材参考上限。 */
  audio_reference_max: { label: '音频参考上限 audio_reference_max', types: ['audio', 'video'], placeholder: '如 3' },
  /** 图片 / 视频 / 音频三种生成共用的图参考上限。
   *  IKHEXG：合并了旧的 `max_reference_images`——两者字面几乎一样、语义却不同
   *  （旧键当时管图片/视频生成、本键管音频生成），运营与研发都误判过。
   *  现在键名只表达媒介，作用域由行的 capability_type 决定，故三种类型都可编辑。 */
  image_reference_max: { label: '图片参考上限 image_reference_max', types: ['image', 'video', 'audio'], placeholder: '如 10' },
  /** ADR-0086：输入参考素材总时长上限（秒；2.0=15 / 2.5=30；空=不限）。
   *  IKHEXG：音频链路此前漏读该键，本次已补上校验（见 model-reference-limits.ts / reference-limits.ts）。 */
  max_reference_duration_sec: { label: '参考素材总时长上限秒 max_reference_duration_sec', types: ['video', 'audio'], placeholder: '如 15（留空 = 不限）' },
};

/** 字符串型能力键——**这一表就是「渲染成自由文本框」的清单**。
 *
 *  ⚠️ IKHBDO 的 `image_protocol` 一度在本表里，现**整键退役**：出站协议由**渠道**决定
 *  （渠道是唯一来源，见 `CHANNELS`），那个键已被迁移清掉，代码里也没有读方了。
 *  两处可编辑正是当初要消灭的毛病——从下拉选一个协议、再去文本框改一次，谁最后写谁生效。 */
export const FEATURE_STRING_LABELS: Record<string, { label: string; types?: ModelType[]; placeholder: string }> = {
  i2i_model_name: {
    label: '图生图上游模型名 i2i_model_name',
    types: ['image'],
    placeholder: '如 gpt-image-2-edit（留空 = 不分流）',
  },
};

/** camelCase → snake_case 反查表：读侧优先认 camelCase，表单只认 snake_case 时必须双向对齐。 */
const FEATURE_KEY_BY_CAMEL = new Map(KNOWN_FEATURE_KEYS.map((key) => [camelFeatureKey(key), key]));

/**
 * `features` 里取值是**对象**（不是标量）的键：整块由结构化控件承载，不进高级 JSON。
 *
 * <p>判据与标量键不同：标量键看「类型是否合法」，对象键看「是不是一个普通对象」——
 * 数组 / 字符串这类脏值仍留在高级 JSON 里原样回写（结构化控件表达不了它，
 * 而把它悄悄删掉等于在一次无关的保存里丢配置）。
 */
export const OBJECT_FEATURE_KEYS: ReadonlySet<string> = new Set(['task_types', 'video_dimensions']);

export const pretty = (raw: unknown) => {
  try {
    return JSON.stringify(raw ?? {}, null, 2);
  } catch {
    return '{}';
  }
};

export const pickFeatureBooleans = (features: Record<string, unknown> = {}): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(FEATURE_BOOL_LABELS)) out[key] = readFeature(features, key) === true;
  return out;
};

export const pickFeatureNumbers = (features: Record<string, unknown> = {}): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of Object.keys(FEATURE_NUMBER_LABELS)) {
    const v = readFeature(features, key);
    out[key] = typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  }
  return out;
};

export const pickFeatureStrings = (features: Record<string, unknown> = {}): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of Object.keys(FEATURE_STRING_LABELS)) {
    const v = readFeature(features, key);
    out[key] = typeof v === 'string' ? v : '';
  }
  return out;
};

/** 非结构化键 → 高级 JSON。已知键（含 camelCase 写法）且取值类型正常 / 为 null 时归结构化控件，
 *  其余（未知键、类型不符的脏值）原样留在 JSON 里：整包提交时静默删掉一个键，比让运营在
 *  JSON 里看到它危险得多（写侧闸门会给出可读报错）。 */
export const dropKnownFeatures = (features: Record<string, unknown> = {}): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(features)) {
    const known = (KNOWN_FEATURE_KEYS as readonly string[]).includes(k) ? k : FEATURE_KEY_BY_CAMEL.get(k);
    if (known !== undefined && OBJECT_FEATURE_KEYS.has(known)) {
      // 合法对象由结构化控件承载；非对象脏值留在 JSON 里（后端闸门会拒）
      if (v == null || (typeof v === 'object' && !Array.isArray(v))) continue;
    } else if (known && (v == null || featureValueTypeOk(known, v))) {
      continue;
    }
    out[k] = v;
  }
  return out;
};

export const readTaskTypesBase = (features?: Record<string, unknown>): Record<string, unknown> => {
  const raw = readFeature(features, 'task_types');
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
};

/** `features.video_dimensions` → 表单行。
 *
 *  <p>候选键（`resolution=X|aspect_ratio=Y`）由调用方从**本行的档位 × 比例**派生——
 *  与定价页那套「候选集来自模型配置」同一口径（见 `lib/billing-catalog/sizeCandidates.ts`）。
 *  ⚠️ 值是字符串（`864x496`），不是数：因此这里用 `KeyValueRow` 而不是价格行。 */
export const pickVideoDimensions = (features?: Record<string, unknown>): KeyValueRow[] => {
  const raw = readFeature(features, 'video_dimensions');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : String(value ?? ''),
  }));
};

/** 表单行 → `features.video_dimensions`；**一行都没填就整个不写这个键**
 *  （`"video_dimensions": {}` 与不写同义，但会在 diff 里多出一行噪音）。 */
export const buildVideoDimensions = (rows: KeyValueRow[]): Record<string, string> | undefined => {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
};

export const omitEmptyStrings = (strs: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(strs)) {
    if (v.trim() !== '') out[k] = v.trim();
  }
  return out;
};

export const omitEmpty = (nums: Record<string, string>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(nums)) {
    if (v.trim() === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
};

/** 该能力类型是否展示某个结构化特性键（未标 types = 所有类型都展示）。 */
export const featureApplies = (meta: { types?: ModelType[] }, type: ModelType) =>
  !meta.types || meta.types.includes(type);
