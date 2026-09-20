import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import type { AdminModel, CreateAdminModelParams } from '@/api/admin';
import { isApiError } from '@/api/http';
import {
  DEFAULT_IMAGE_RATIOS,
  DEFAULT_IMAGE_SIZES,
  GPT_PROVIDER_SIZES,
  IMAGE_CHANNEL_PARSERS,
  KNOWN_FEATURE_KEYS,
  TASK_TYPE_KEYS,
  TYPE_TABS,
  buildCreateParams,
  buildTaskTypes,
  camelFeatureKey,
  diffUpdateParams,
  durationsFromModel,
  featureValueTypeOk,
  mergeMatrix,
  parseBananaMaps,
  parseGptMatrix,
  parserFromModel,
  pickTaskTypeRatios,
  readFeature,
  sizesFromModel,
  typeName,
  type FormSnapshot,
  type GptMatrix,
  type ImageChannelParserId,
  type ModelType,
  type SizeForm,
} from './model-form';
import styles from './index.module.css';

const FEATURE_BOOL_LABELS: Record<string, { label: string; types?: ModelType[] }> = {
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

const FEATURE_NUMBER_LABELS: Record<string, { label: string; types?: ModelType[]; placeholder: string }> = {
  max_reference_images: { label: '参考图上限 max_reference_images', types: ['image', 'video'], placeholder: '如 10' },
  quantity_max: { label: '单次生成数量 quantity_max', types: ['image'], placeholder: '如 1' },
  // IKHBDO：补上 text——TextGenDialog 就是按 `features.max_prompt_length ?? 缺省` 卡文本输入长度的，
  // 而表单只对 image / video 渲染这个键，文本行因此永远配不了自己的提示词上限。
  max_prompt_length: {
    label: '提示词上限 max_prompt_length',
    types: ['image', 'video', 'text'],
    placeholder: '如 32000',
  },
  /** ADR-0086：普通参考中视频素材上限。 */
  video_reference_max: { label: '视频参考上限 video_reference_max', types: ['video'], placeholder: '如 3' },
  /** ADR-0086：音频生成中音频参考上限。 */
  audio_reference_max: { label: '音频参考上限 audio_reference_max', types: ['audio', 'video'], placeholder: '如 3' },
  /** ADR-0086：音频生成中图片参考上限。 */
  image_reference_max: { label: '音频图参考上限 image_reference_max', types: ['audio'], placeholder: '如 1' },
  /** ADR-0086：输入参考素材总时长上限（秒；2.0=15 / 2.5=30；空=不限）。 */
  max_reference_duration_sec: { label: '参考素材总时长上限秒 max_reference_duration_sec', types: ['video', 'audio'], placeholder: '如 15（留空 = 不限）' },
};

/** ADR-0085（IKESD9）：字符串型能力键——i2i_model_name 存的是上游模型名，非行 id。 */
const FEATURE_STRING_LABELS: Record<string, { label: string; types?: ModelType[]; placeholder: string }> = {
  i2i_model_name: {
    label: '图生图上游模型名 i2i_model_name',
    types: ['image'],
    placeholder: '如 gpt-image-2-edit（留空 = 不分流）',
  },
  /** IKHBDO：出站图片协议（worker-java 分支：openai-images / inline-image）。
   *  用自由文本而非下拉：写侧只卡「非空字符串」，认不出时 worker 告警回落 inline-image——
   *  下拉会把库里已有的未知取值读成空白，保存时又把它删掉。 */
  image_protocol: {
    label: '出站图片协议 image_protocol',
    types: ['image'],
    placeholder: 'openai-images / inline-image（留空 = inline-image）',
  },
};

/** camelCase → snake_case 反查表：读侧优先认 camelCase，表单只认 snake_case 时必须双向对齐。 */
const FEATURE_KEY_BY_CAMEL = new Map(KNOWN_FEATURE_KEYS.map((key) => [camelFeatureKey(key), key]));

const pretty = (raw: unknown) => {
  try {
    return JSON.stringify(raw ?? {}, null, 2);
  } catch {
    return '{}';
  }
};

const pickFeatureBooleans = (features: Record<string, unknown> = {}): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(FEATURE_BOOL_LABELS)) out[key] = readFeature(features, key) === true;
  return out;
};

const pickFeatureNumbers = (features: Record<string, unknown> = {}): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of Object.keys(FEATURE_NUMBER_LABELS)) {
    const v = readFeature(features, key);
    out[key] = typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  }
  return out;
};

const pickFeatureStrings = (features: Record<string, unknown> = {}): Record<string, string> => {
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
const dropKnownFeatures = (features: Record<string, unknown> = {}): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(features)) {
    const known = (KNOWN_FEATURE_KEYS as readonly string[]).includes(k) ? k : FEATURE_KEY_BY_CAMEL.get(k);
    if (known === 'task_types') {
      // 合法对象由结构化控件承载；非对象脏值留在 JSON 里（后端闸门会拒）
      if (v == null || (typeof v === 'object' && !Array.isArray(v))) continue;
    } else if (known && (v == null || featureValueTypeOk(known, v))) {
      continue;
    }
    out[k] = v;
  }
  return out;
};

const readTaskTypesBase = (features?: Record<string, unknown>): Record<string, unknown> => {
  const raw = readFeature(features, 'task_types');
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
};

const omitEmptyStrings = (strs: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(strs)) {
    if (v.trim() !== '') out[k] = v.trim();
  }
  return out;
};

const omitEmpty = (nums: Record<string, string>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(nums)) {
    if (v.trim() === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
};

/** 该能力类型是否展示某个结构化特性键（未标 types = 所有类型都展示）。 */
const featureApplies = (meta: { types?: ModelType[] }, type: ModelType) => !meta.types || meta.types.includes(type);

interface ModelFormModalProps {
  initial?: AdminModel;
  models: AdminModel[];
  defaultType: ModelType;
  onClose: () => void;
  onSubmit: (params: Partial<CreateAdminModelParams>, id?: string) => Promise<void>;
}

export default function ModelFormModal({ initial, models, defaultType, onClose, onSubmit }: ModelFormModalProps) {
  const [type, setType] = useState<ModelType>(initial?.capability_type ?? defaultType);
  const [copyFrom, setCopyFrom] = useState('');
  const [modelId, setModelId] = useState(initial?.model_id ?? '');
  const [label, setLabel] = useState(initial?.model_label ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? '');
  // IKHBDO：尺寸行按库里的完整字段集读回（id / label / api_value / width / height）——
  // 只读 id+label 时，保存会把出站值（如 4k）与像素宽高整包抹掉。
  const [sizes, setSizes] = useState<SizeForm[]>(() => {
    const stored = sizesFromModel(initial?.supported_sizes);
    if (stored.length) return stored;
    return type === 'image' ? DEFAULT_IMAGE_SIZES : [];
  });
  const [ratios, setRatios] = useState<string[]>(
    initial?.supported_aspect_ratios?.length
      ? initial.supported_aspect_ratios
      : type === 'image'
        ? DEFAULT_IMAGE_RATIOS
        : [],
  );
  const initialDurations = durationsFromModel(initial);
  const [durationMin, setDurationMin] = useState(initialDurations.min);
  const [durationMax, setDurationMax] = useState(initialDurations.max);
  const [durationStep, setDurationStep] = useState(initialDurations.step);
  const [formats, setFormats] = useState<string[]>(initial?.supported_formats ?? []);
  const [featureFlags, setFeatureFlags] = useState(initial ? pickFeatureBooleans(initial.features) : {});
  const [featureNumbers, setFeatureNumbers] = useState(initial ? pickFeatureNumbers(initial.features) : {});
  const [featureStrings, setFeatureStrings] = useState(initial ? pickFeatureStrings(initial.features) : {});
  const [taskTypeRatios, setTaskTypeRatios] = useState<Record<string, string[]>>(() =>
    pickTaskTypeRatios(initial?.features),
  );
  const [taskTypesBase, setTaskTypesBase] = useState<Record<string, unknown>>(() =>
    readTaskTypesBase(initial?.features),
  );
  const [extraFeatures, setExtraFeatures] = useState(
    initial ? pretty(dropKnownFeatures(initial.features)) : '{}',
  );
  const [defaultSize, setDefaultSize] = useState(initial?.default_size ?? '');
  const [defaultRatio, setDefaultRatio] = useState(initial?.default_aspect_ratio ?? '');
  const [defaultFormat, setDefaultFormat] = useState(initial?.default_format ?? '');
  const [defaultDuration, setDefaultDuration] = useState(
    initial?.default_duration != null ? String(initial.default_duration) : '',
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const originalParser = parserFromModel(initial);
  const [parser, setParser] = useState<ImageChannelParserId>(originalParser);
  const [gptMatrix, setGptMatrix] = useState(() => parseGptMatrix(initial?.request_mapping, sizes, ratios));
  // seedream 矩阵只在「打开时就是该行的解析器」时回填：从 gpt 行切到 seedream 时若把 gpt 的
  // 矩阵预填进来，运营一保存就把上一族的矩阵当 seedream 尺寸表写回去了（正是后端注释里
  // 「旧族矩阵残留」的场景）。切过来时留空 → 保存提交 null，明确清掉。
  const [seedreamMatrix, setSeedreamMatrix] = useState<GptMatrix>(() =>
    originalParser === 'seedream' ? parseGptMatrix(initial?.request_mapping, sizes, ratios) : {},
  );
  const bananaInit = parseBananaMaps(initial?.request_mapping);
  const [bananaQuality, setBananaQuality] = useState(bananaInit.quality);
  const [bananaSize, setBananaSize] = useState(bananaInit.size);
  const [ratioDraft, setRatioDraft] = useState('');
  const [formatDraft, setFormatDraft] = useState('');
  const [taskRatioDraft, setTaskRatioDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const copyOptions = models.filter((m) => m.capability_type === type);
  const showSizeRatio = type === 'image' || type === 'video';
  // IKG4UR：时长**范围**只对视频可配。音频上游是 TTS 式接口（请求无 duration），
  // 库里音频行的 supported_durations 已置 NULL——放开表单只会让运营把死配置加回来。
  const showDuration = type === 'video';
  // IKHBDO：默认时长对视频与音频都可配（列表页「默认参数」列对音频行显示的就是它）。
  const showDefaultDuration = type === 'video' || type === 'audio';
  const showFormat = type === 'audio' || type === 'video';
  const hasStructuredFeature = [
    ...Object.values(FEATURE_BOOL_LABELS),
    ...Object.values(FEATURE_NUMBER_LABELS),
    ...Object.values(FEATURE_STRING_LABELS),
  ].some((meta) => featureApplies(meta, type));

  const applySource = (src: AdminModel, nextType: ModelType) => {
    const srcSizes = sizesFromModel(src.supported_sizes);
    const nextSizes = srcSizes.length ? srcSizes : nextType === 'image' ? DEFAULT_IMAGE_SIZES : [];
    const nextRatios = src.supported_aspect_ratios?.length
      ? src.supported_aspect_ratios
      : nextType === 'image'
        ? DEFAULT_IMAGE_RATIOS
        : [];
    setSizes(nextSizes);
    setRatios(nextRatios);
    const d = durationsFromModel(src);
    setDurationMin(d.min);
    setDurationMax(d.max);
    setDurationStep(d.step);
    setFormats(src.supported_formats ?? []);
    setFeatureFlags(pickFeatureBooleans(src.features));
    setFeatureNumbers(pickFeatureNumbers(src.features));
    setFeatureStrings(pickFeatureStrings(src.features));
    setTaskTypeRatios(pickTaskTypeRatios(src.features));
    setTaskTypesBase(readTaskTypesBase(src.features));
    setExtraFeatures(pretty(dropKnownFeatures(src.features)));
    setDefaultSize(src.default_size ?? '');
    setDefaultRatio(src.default_aspect_ratio ?? '');
    setDefaultFormat(src.default_format ?? '');
    setDefaultDuration(src.default_duration != null ? String(src.default_duration) : '');
    const nextParser = parserFromModel(src);
    setParser(nextParser);
    setGptMatrix(parseGptMatrix(src.request_mapping, nextSizes, nextRatios));
    setSeedreamMatrix(nextParser === 'seedream' ? parseGptMatrix(src.request_mapping, nextSizes, nextRatios) : {});
    const banana = parseBananaMaps(src.request_mapping);
    setBananaQuality(banana.quality);
    setBananaSize(banana.size);
  };

  const handleCopy = (id: string) => {
    setCopyFrom(id);
    const src = models.find((m) => m.id === id);
    if (src) applySource(src, type);
  };

  const addSizeRow = () => {
    const next = [...sizes, { id: '', label: '', apiValue: '', width: '', height: '' }];
    setSizes(next);
    setGptMatrix((prev) => mergeMatrix(prev, next, ratios));
    setSeedreamMatrix((prev) => mergeMatrix(prev, next, ratios));
  };

  const updateSize = (index: number, patch: Partial<SizeForm>) => {
    const next = sizes.map((item, i) => (i === index ? { ...item, ...patch } : item));
    setSizes(next);
    setGptMatrix((prev) => mergeMatrix(prev, next, ratios));
    setSeedreamMatrix((prev) => mergeMatrix(prev, next, ratios));
  };

  const removeSize = (index: number) => {
    const next = sizes.filter((_, i) => i !== index);
    setSizes(next);
    // IKHBDO：合并而非重建——重建会把整张交叉格清零（其余尺寸行的映射全丢）。
    setGptMatrix((prev) => mergeMatrix(prev, next, ratios));
    setSeedreamMatrix((prev) => mergeMatrix(prev, next, ratios));
  };

  const removeRatio = (ratio: string) => {
    const next = ratios.filter((item) => item !== ratio);
    setRatios(next);
    setGptMatrix((prev) => mergeMatrix(prev, sizes, next));
    setSeedreamMatrix((prev) => mergeMatrix(prev, sizes, next));
  };

  const addChip = (
    draft: string,
    list: string[],
    setList: (v: string[]) => void,
    setDraft: (v: string) => void,
    kind?: 'ratio' | 'format',
  ) => {
    const value = draft.trim();
    if (!value || list.includes(value)) return;
    const next = [...list, value];
    setList(next);
    setDraft('');
    if (kind === 'ratio') {
      setGptMatrix((prev) => mergeMatrix(prev, sizes, next));
      setSeedreamMatrix((prev) => mergeMatrix(prev, sizes, next));
    }
  };

  const addTaskRatio = (taskType: string) => {
    const value = (taskRatioDraft[taskType] ?? '').trim();
    if (!value) return;
    const list = taskTypeRatios[taskType] ?? [];
    if (list.includes(value)) {
      setTaskRatioDraft((prev) => ({ ...prev, [taskType]: '' }));
      return;
    }
    setTaskTypeRatios((prev) => ({ ...prev, [taskType]: [...list, value] }));
    setTaskRatioDraft((prev) => ({ ...prev, [taskType]: '' }));
  };

  const snapshot = (): FormSnapshot => {
    let extra: Record<string, unknown> = {};
    try {
      extra = JSON.parse(extraFeatures || '{}') as Record<string, unknown>;
    } catch {
      extra = {};
    }
    const taskTypes = buildTaskTypes(taskTypesBase, taskTypeRatios);
    return {
      type,
      modelId,
      label,
      icon,
      sizes,
      ratios,
      durationMin,
      durationMax,
      durationStep,
      // IKG4UR：按该行原本的形态写回。数组与对象在读侧语义不同（档位列表 vs 区间），
      // 保存时改形态会把时长约束悄悄改掉；新建行用对象（区间语义无歧义）。
      durationShape: Array.isArray(initial?.supported_durations) ? 'array' : 'object',
      formats,
      defaultSize,
      defaultRatio,
      defaultFormat,
      defaultDuration,
      enabled,
      features: {
        ...extra,
        ...omitEmpty(featureNumbers),
        ...omitEmptyStrings(featureStrings),
        ...Object.fromEntries(
          // 关掉的布尔位要显式写 false（否则「取消勾选」永远落不了库）。但只在**库里那一份
          // 本来就归结构化控件管**时才写：脏值（如 tools: "yes"）留在高级 JSON 里原样回写，
          // 不能被一个 false 悄悄改写成合法值。开关打开时是明确意图，直接写 true。
          Object.entries(featureFlags).filter(([k, v]) => {
            if (v) return true;
            const stored = readFeature(initial?.features, k);
            return stored !== undefined && (stored === null || featureValueTypeOk(k, stored));
          }),
        ),
        ...(Object.keys(taskTypes).length ? { task_types: taskTypes } : {}),
      },
      parser,
      originalParser,
      originalHadRequestMapping: initial?.request_mapping != null,
      gptMatrix,
      seedreamMatrix,
      bananaQuality,
      bananaSize,
    };
  };

  const handleSave = async () => {
    if (saving) return;
    try {
      JSON.parse(extraFeatures || '{}');
    } catch {
      setError('其他特性 JSON 解析失败，请检查格式。');
      return;
    }
    const built = buildCreateParams(snapshot());
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError('');
    setSaving(true);
    try {
      if (initial) {
        const changes = diffUpdateParams(initial, built.value);
        if (!Object.keys(changes).length) {
          setError('未检测到任何变更。');
          setSaving(false);
          return;
        }
        await onSubmit(changes, initial.id);
      } else {
        await onSubmit(built.value);
      }
    } catch (e) {
      setError(isApiError(e) ? e.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>{initial ? '编辑模型' : '新建模型'}</h2>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {initial && (
            <div className={styles.summaryBox}>
              <div>
                <div className={styles.summaryLabel}>模型 ID（不可改）</div>
                <div className={`${styles.summaryValue} ${styles.mono}`}>{initial.model_id}</div>
              </div>
              {/* IKHBDO：类型与供应商是身份字段（后端不接受更新），编辑态只读展示——
                  原先编辑态整块不渲染，运营看不到这一行属于哪个供应商。 */}
              <div>
                <div className={styles.summaryLabel}>类型（不可改）</div>
                <div className={styles.summaryValue}>{typeName(type)}</div>
              </div>
              <div>
                <div className={styles.summaryLabel}>供应商 provider_id（不可改）</div>
                <div className={`${styles.summaryValue} ${styles.mono}`}>{initial.provider_id}</div>
              </div>
            </div>
          )}

          {!initial && (
            <div className={styles.grid2}>
              <div>
                <div className={styles.label}>类型</div>
                <select
                  className={styles.selectNarrow}
                  value={type}
                  onChange={(e) => {
                    const next = e.target.value as ModelType;
                    setType(next);
                    setCopyFrom('');
                    if (next === 'image' && !sizes.length) setSizes(DEFAULT_IMAGE_SIZES);
                    if (next === 'image' && !ratios.length) setRatios(DEFAULT_IMAGE_RATIOS);
                  }}
                >
                  {TYPE_TABS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className={styles.label}>
                  复制自某模型 <span className={styles.labelSub}>（选填）</span>
                </div>
                <select className={styles.select} value={copyFrom} onChange={(e) => handleCopy(e.target.value)}>
                  <option value="">空白新建</option>
                  {copyOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.model_label}（{m.model_id}）
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className={styles.grid2}>
            <div>
              <div className={styles.label}>模型 ID model_id</div>
              <input
                className={styles.input}
                placeholder="如 seed-audio-1.0"
                value={modelId}
                disabled={!!initial}
                onChange={(e) => setModelId(e.target.value)}
              />
            </div>
            <div>
              <div className={styles.label}>展示名 model_label</div>
              <input
                className={styles.input}
                placeholder="如 豆包 Seed Audio 1.0"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
          </div>

          <div>
            <div className={styles.label}>
              图标 icon <span className={styles.labelSub}>（选填）</span>
            </div>
            <input
              className={styles.input}
              placeholder="URL 或图标名"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
            />
          </div>

          {showSizeRatio && (
            <>
              <div className={styles.sectionTitle}>尺寸选项</div>
              <p className={styles.hint}>
                id 是能力行内部标识；api_value 是**出站实际提交给上游**的档位值（如 4k），留空则回落用 id；
                宽 / 高只被 generation worker 消费（留空 = 不写）。
              </p>
              {sizes.map((size, index) => (
                <div className={styles.sizeRow} key={index}>
                  <input
                    className={styles.input}
                    placeholder="id，如 1K"
                    value={size.id}
                    onChange={(e) => updateSize(index, { id: e.target.value })}
                  />
                  <input
                    className={styles.input}
                    placeholder="展示名"
                    value={size.label ?? ''}
                    onChange={(e) => updateSize(index, { label: e.target.value })}
                  />
                  <input
                    className={styles.input}
                    placeholder="上游值 api_value，如 4k"
                    value={size.apiValue ?? ''}
                    onChange={(e) => updateSize(index, { apiValue: e.target.value })}
                  />
                  <input
                    className={styles.input}
                    placeholder="宽"
                    value={size.width ?? ''}
                    onChange={(e) => updateSize(index, { width: e.target.value })}
                  />
                  <input
                    className={styles.input}
                    placeholder="高"
                    value={size.height ?? ''}
                    onChange={(e) => updateSize(index, { height: e.target.value })}
                  />
                  <button className={styles.iconBtn} onClick={() => removeSize(index)} title="删除尺寸行">
                    <X size={14} strokeWidth={2} />
                  </button>
                </div>
              ))}
              <button className={styles.addRowBtn} onClick={addSizeRow}>
                <Plus size={14} strokeWidth={2} />
                加一个尺寸行
              </button>

              <div className={styles.sectionTitle}>比例选项</div>
              <div className={styles.chipList}>
                {ratios.map((ratio) => (
                  <span className={styles.chip} key={ratio}>
                    {ratio}
                    <button onClick={() => removeRatio(ratio)}>×</button>
                  </span>
                ))}
              </div>
              <div className={styles.chipRow}>
                <input
                  className={styles.input}
                  placeholder="如 16:9"
                  value={ratioDraft}
                  onChange={(e) => setRatioDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addChip(ratioDraft, ratios, setRatios, setRatioDraft, 'ratio');
                    }
                  }}
                />
                <button className={styles.addRowBtn} onClick={() => addChip(ratioDraft, ratios, setRatios, setRatioDraft, 'ratio')}>
                  添加比例
                </button>
              </div>
            </>
          )}

          {type === 'image' && (
            <>
              <div className={styles.sectionTitle}>图片解析器</div>
              <select
                className={styles.select}
                value={parser}
                onChange={(e) => setParser(e.target.value as ImageChannelParserId)}
              >
                {IMAGE_CHANNEL_PARSERS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>

              {parser === 'gpt' && (
                <div className={styles.mapWrap}>
                  <p className={styles.hint}>行=尺寸选项，列=比例选项，格子填官方 size（含 auto）。1K × 16:9 / 9:16 可留空。</p>
                  <div className={styles.mapScroll}>
                    <table className={styles.mapTable}>
                      <thead>
                        <tr>
                          <th>尺寸</th>
                          {ratios.map((ratio) => (
                            <th key={ratio}>{ratio}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sizes.map((size) => (
                          <tr key={size.id || size.label}>
                            <td>{size.label || size.id || '—'}</td>
                            {ratios.map((ratio) => (
                              <td key={ratio}>
                                <select
                                  className={styles.select}
                                  value={gptMatrix[size.id]?.[ratio] ?? ''}
                                  onChange={(e) =>
                                    setGptMatrix((prev) => ({
                                      ...prev,
                                      [size.id]: { ...(prev[size.id] ?? {}), [ratio]: e.target.value },
                                    }))
                                  }
                                >
                                  <option value="">留空</option>
                                  {GPT_PROVIDER_SIZES.map((item) => (
                                    <option key={item} value={item}>
                                      {item}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {parser === 'banana' && (
                <div className={styles.mapWrap}>
                  <p className={styles.hint}>一维映射：尺寸选项 → quality；比例选项 → size（如 1x1）。不要填像素交叉格。</p>
                  <div className={styles.grid2}>
                    <div>
                      <div className={styles.label}>尺寸 → quality</div>
                      {sizes.map((size) => (
                        <div className={styles.chipRow} key={size.id}>
                          <span className={styles.chip}>{size.label || size.id}</span>
                          <input
                            className={styles.input}
                            placeholder="调用值，如 1k"
                            value={bananaQuality[size.id] ?? ''}
                            onChange={(e) => setBananaQuality((prev) => ({ ...prev, [size.id]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className={styles.label}>比例 → size</div>
                      {ratios.map((ratio) => (
                        <div className={styles.chipRow} key={ratio}>
                          <span className={styles.chip}>{ratio}</span>
                          <input
                            className={styles.input}
                            placeholder="调用值，如 1x1"
                            value={bananaSize[ratio] ?? ''}
                            onChange={(e) => setBananaSize((prev) => ({ ...prev, [ratio]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {parser === 'seedream' && (
                <div className={styles.mapWrap}>
                  <p className={styles.hint}>
                    行=尺寸选项，列=比例选项，格子填出站像素尺寸（如 2048x2048）。worker 按「分辨率 × 宽高比」查这张表换算尺寸；
                    整张清空会让出站尺寸回落成 provider 原值（上游会 400），所以至少保留一格。
                  </p>
                  <div className={styles.mapScroll}>
                    <table className={styles.mapTable}>
                      <thead>
                        <tr>
                          <th>尺寸</th>
                          {ratios.map((ratio) => (
                            <th key={ratio}>{ratio}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sizes.map((size) => (
                          <tr key={size.id || size.label}>
                            <td>{size.label || size.id || '—'}</td>
                            {ratios.map((ratio) => (
                              <td key={ratio}>
                                <input
                                  className={`${styles.input} ${styles.inputSm}`}
                                  placeholder="留空"
                                  value={seedreamMatrix[size.id]?.[ratio] ?? ''}
                                  onChange={(e) =>
                                    setSeedreamMatrix((prev) => ({
                                      ...prev,
                                      [size.id]: { ...(prev[size.id] ?? {}), [ratio]: e.target.value },
                                    }))
                                  }
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {showDuration && (
            <>
              <div className={styles.sectionTitle}>时长范围</div>
              <div className={styles.grid3}>
                <div>
                  <div className={styles.label}>最小秒</div>
                  <input className={styles.input} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
                </div>
                <div>
                  <div className={styles.label}>最大秒</div>
                  <input className={styles.input} value={durationMax} onChange={(e) => setDurationMax(e.target.value)} />
                </div>
                <div>
                  <div className={styles.label}>步长（选填）</div>
                  <input className={styles.input} value={durationStep} onChange={(e) => setDurationStep(e.target.value)} />
                </div>
              </div>
            </>
          )}

          {showDefaultDuration && (
            <div className={styles.grid2}>
              <div>
                <div className={styles.label}>默认时长（秒）</div>
                <input className={styles.input} value={defaultDuration} onChange={(e) => setDefaultDuration(e.target.value)} />
              </div>
            </div>
          )}

          {showFormat && (
            <>
              <div className={styles.sectionTitle}>格式</div>
              <div className={styles.chipList}>
                {formats.map((item) => (
                  <span className={styles.chip} key={item}>
                    {item}
                    <button onClick={() => setFormats(formats.filter((x) => x !== item))}>×</button>
                  </span>
                ))}
              </div>
              <div className={styles.chipRow}>
                <input
                  className={styles.input}
                  placeholder="如 mp3"
                  value={formatDraft}
                  onChange={(e) => setFormatDraft(e.target.value)}
                />
                <button className={styles.addRowBtn} onClick={() => addChip(formatDraft, formats, setFormats, setFormatDraft, 'format')}>
                  添加格式
                </button>
              </div>
              <div>
                <div className={styles.label}>默认格式</div>
                <input className={styles.input} value={defaultFormat} onChange={(e) => setDefaultFormat(e.target.value)} />
              </div>
            </>
          )}

          {showSizeRatio && (
            <div className={styles.grid2}>
              <div>
                <div className={styles.label}>默认尺寸</div>
                <input className={styles.input} value={defaultSize} onChange={(e) => setDefaultSize(e.target.value)} />
              </div>
              <div>
                <div className={styles.label}>默认比例</div>
                <input className={styles.input} value={defaultRatio} onChange={(e) => setDefaultRatio(e.target.value)} />
              </div>
            </div>
          )}

  // IKHBDO：结构化 features 对所有类型开放。此前 audio / text 被排除在结构化块之外，
              而高级 JSON 兜底又只对 image / video 渲染——两种条件互相抵消，音频行连 JSON 出口都没有。
          <div className={styles.sectionTitle}>特性 features（结构化）</div>
          {!hasStructuredFeature && (
            <p className={styles.hint}>该类型没有专属的结构化特性键，可直接用下方高级 JSON 配置。</p>
          )}
          <div className={styles.featureGroup}>
            {Object.entries(FEATURE_BOOL_LABELS)
              .filter(([, meta]) => featureApplies(meta, type))
              .map(([key, meta]) => (
                <div className={styles.switchRow} key={key}>
                  <span className={styles.switchLabel}>{meta.label}</span>
                  <button
                    className={`${styles.switch} ${featureFlags[key] ? styles.switchOn : ''}`}
                    onClick={() => setFeatureFlags((p) => ({ ...p, [key]: !p[key] }))}
                  >
                    <span className={styles.knob} />
                  </button>
                </div>
              ))}
          </div>
          <div className={styles.grid2}>
            {Object.entries(FEATURE_NUMBER_LABELS)
              .filter(([, meta]) => featureApplies(meta, type))
              .map(([key, meta]) => (
                <div key={key}>
                  <div className={styles.label}>
                    {meta.label} <span className={styles.labelSub}>（留空不写入）</span>
                  </div>
                  <input
                    className={styles.input}
                    type="number"
                    min={0}
                    placeholder={meta.placeholder}
                    value={featureNumbers[key] ?? ''}
                    onChange={(e) => setFeatureNumbers((p) => ({ ...p, [key]: e.target.value }))}
                  />
                </div>
              ))}
          </div>
          <div className={styles.grid2}>
            {Object.entries(FEATURE_STRING_LABELS)
              .filter(([, meta]) => featureApplies(meta, type))
              .map(([key, meta]) => (
                <div key={key}>
                  <div className={styles.label}>
                    {meta.label} <span className={styles.labelSub}>（留空不写入）</span>
                  </div>
                  <input
                    className={styles.input}
                    placeholder={meta.placeholder}
                    value={featureStrings[key] ?? ''}
                    onChange={(e) => setFeatureStrings((p) => ({ ...p, [key]: e.target.value }))}
                  />
                </div>
              ))}
          </div>

          {/* ADR-0086：按任务类型的比例约束——原先只能在整个 features 的 JSON 里手写。 */}
          {type === 'video' && (
            <>
              <div className={styles.sectionTitle}>任务类型比例约束 task_types</div>
              <p className={styles.hint}>
                留空 = 该任务类型沿用基础「比例选项」。只编辑 allowed_ratios，行内其它子键原样保留。
              </p>
              {TASK_TYPE_KEYS.map((taskType) => (
                <div className={styles.taskRow} key={taskType}>
                  <span className={styles.chip}>{taskType}</span>
                  <div className={styles.chipList}>
                    {(taskTypeRatios[taskType] ?? []).map((ratio) => (
                      <span className={styles.chip} key={ratio}>
                        {ratio}
                        <button
                          onClick={() =>
                            setTaskTypeRatios((prev) => ({
                              ...prev,
                              [taskType]: (prev[taskType] ?? []).filter((x) => x !== ratio),
                            }))
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <input
                    className={`${styles.input} ${styles.inputSm}`}
                    placeholder="如 16:9，回车添加"
                    value={taskRatioDraft[taskType] ?? ''}
                    onChange={(e) => setTaskRatioDraft((prev) => ({ ...prev, [taskType]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTaskRatio(taskType);
                      }
                    }}
                  />
                  <button className={styles.addRowBtn} onClick={() => addTaskRatio(taskType)}>
                    添加
                  </button>
                </div>
              ))}
            </>
          )}

          <details className={styles.featureExtra}>
            <summary>高级 JSON（未识别字段 / 映射兜底）</summary>
            <textarea className={styles.textareaSm} value={extraFeatures} onChange={(e) => setExtraFeatures(e.target.value)} />
          </details>

          <div className={styles.switchRow}>
            <span className={styles.switchLabel}>启用</span>
            <button className={`${styles.switch} ${enabled ? styles.switchOn : ''}`} onClick={() => setEnabled(!enabled)}>
              <span className={styles.knob} />
            </button>
          </div>

          <p className={styles.hint}>供应商由系统写死为 new-api，无需填写。文本类型不展示尺寸 / 比例 / 时长。</p>
          {error && <p className={styles.error}>{error}</p>}
        </div>

        <div className={styles.modalFoot}>
          <button className={styles.cancelBtn} onClick={onClose}>
            取消
          </button>
          <button className={styles.saveBtn} disabled={saving} onClick={handleSave}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
