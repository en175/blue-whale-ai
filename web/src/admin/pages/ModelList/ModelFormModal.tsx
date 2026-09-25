/* ============================================
 * ModelFormModal —— 模型新建 / 编辑弹窗
 *
 * 呈现层全部走 ../../ui 的组件（Modal / Input / Select / Checkbox / Alert / Table …），
 * **本文件没有自己的样式文件**：原先的私有 CSS 已删除，
 * 一个界面元素只有套件里一处定义。行内 style 只剩布局与一次性间距——
 * 颜色、边框、字号一律由套件与设计 token 决定。
 * ============================================ */
import { useState, type CSSProperties, type ReactNode } from 'react';
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
import { Alert, Badge, Button, Checkbox, Chip, Input, Modal, Select, Table, Textarea } from '../../ui';

/* ============ 布局常量（只有布局与一次性间距，零色值、零字号） ============ */
/** 两列字段栅格（原 .grid2）。 */
const GRID2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 20px', marginBottom: 18 };
/** 三列字段栅格（时长范围的最小 / 最大 / 步长）。 */
const GRID3: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 };
/** 字段标签：套件暂无 Label 基元，照 TemplateManage 用一次性间距排布。 */
const LABEL: CSSProperties = { marginBottom: 6 };
/** 分节标题（尺寸选项 / 图片解析器 / 时长范围 …）。 */
const SECTION: CSSProperties = { margin: '24px 0 8px' };
/** 尺寸行：id / label / api_value 三个输入 + 删除按钮。 */
const SIZE_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr auto',
  gap: 8,
  alignItems: 'center',
  marginBottom: 8,
};
/** 任务类型行：任务名 / 已配比例 / 输入 / 添加。 */
const TASK_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '120px 1fr 1fr auto',
  gap: 10,
  alignItems: 'center',
  marginBottom: 8,
};
/** 输入 + 动作按钮的一排（比例草稿、格式草稿）。 */
const INLINE_ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
const CHIP_LIST: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
const FULL: CSSProperties = { width: '100%' };

/** 说明性文字（原 .hint）：套件口径是 Alert tone="info"，不再是自定义灰字小段。 */
function Hint({ children }: { children: ReactNode }) {
  return (
    <div style={{ margin: '8px 0 14px' }}>
      <Alert tone="info">{children}</Alert>
    </div>
  );
}

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

  return (
    <Modal
      open
      title={initial ? '编辑模型' : '新建模型'}
      onClose={onClose}
      width={860}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={saving} onClick={handleSave}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      {initial && (
        <Alert tone="info">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32 }}>
            <div>
              <div style={LABEL}>模型 ID（不可改）</div>
              <div>{initial.model_id}</div>
            </div>
            {/* IKHBDO：类型与供应商是身份字段（后端不接受更新），编辑态只读展示——
                原先编辑态整块不渲染，运营看不到这一行属于哪个供应商。 */}
            <div>
              <div style={LABEL}>类型（不可改）</div>
              <div>{typeName(type)}</div>
            </div>
            <div>
              <div style={LABEL}>供应商 provider_id（不可改）</div>
              <div>{initial.provider_id}</div>
            </div>
          </div>
        </Alert>
      )}

      {!initial && (
        <div style={GRID2}>
          <div>
            <div style={LABEL}>类型</div>
            <Select
              aria-label="类型"
              options={TYPE_TABS.map((t) => ({ value: t.key, label: t.label }))}
              value={type}
              onChange={(next) => {
                setType(next as ModelType);
                setCopyFrom('');
                if (next === 'image' && !sizes.length) setSizes(DEFAULT_IMAGE_SIZES);
                if (next === 'image' && !ratios.length) setRatios(DEFAULT_IMAGE_RATIOS);
              }}
            />
          </div>
          <div>
            <div style={LABEL}>
              复制自某模型 <span>（选填）</span>
            </div>
            <Select
              aria-label="复制自某模型"
              options={[
                { value: '', label: '空白新建' },
                ...copyOptions.map((m) => ({ value: m.id, label: `${m.model_label}（${m.model_id}）` })),
              ]}
              value={copyFrom}
              onChange={handleCopy}
            />
          </div>
        </div>
      )}

      <div style={GRID2}>
        <div>
          <div style={LABEL}>模型 ID model_id</div>
          <Input
            placeholder="如 seed-audio-1.0"
            value={modelId}
            disabled={!!initial}
            onChange={(e) => setModelId(e.target.value)}
            style={FULL}
          />
        </div>
        <div>
          <div style={LABEL}>展示名 model_label</div>
          <Input
            placeholder="如 豆包 Seed Audio 1.0"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={FULL}
          />
        </div>
      </div>

      <div>
        <div style={LABEL}>
          图标 icon <span>（选填）</span>
        </div>
        <Input placeholder="URL 或图标名" value={icon} onChange={(e) => setIcon(e.target.value)} style={FULL} />
      </div>

      {showSizeRatio && (
        <>
          <h3 style={SECTION}>尺寸选项</h3>
          <Hint>id 是能力行内部标识；api_value 是**出站实际提交给上游**的档位值（如 4k），留空则回落用 id。</Hint>
          {sizes.map((size, index) => (
            <div style={SIZE_ROW} key={index}>
              <Input
                placeholder="id，如 1K"
                value={size.id}
                onChange={(e) => updateSize(index, { id: e.target.value })}
                style={FULL}
              />
              <Input
                placeholder="展示名"
                value={size.label ?? ''}
                onChange={(e) => updateSize(index, { label: e.target.value })}
                style={FULL}
              />
              <Input
                placeholder="上游值 api_value，如 4k"
                value={size.apiValue ?? ''}
                onChange={(e) => updateSize(index, { apiValue: e.target.value })}
                style={FULL}
              />
              <Button
                size="sm"
                variant="ghost"
                title="删除尺寸行"
                icon={<X size={14} strokeWidth={2} />}
                onClick={() => removeSize(index)}
              />
            </div>
          ))}
          <div style={{ marginBottom: 18 }}>
            <Button icon={<Plus size={14} strokeWidth={2} />} onClick={addSizeRow}>
              加一个尺寸行
            </Button>
          </div>

          <h3 style={SECTION}>比例选项</h3>
          <div style={CHIP_LIST}>
            {ratios.map((ratio) => (
              <Chip key={ratio} onClick={() => removeRatio(ratio)}>
                {ratio} ×
              </Chip>
            ))}
          </div>
          <div style={INLINE_ROW}>
            <Input
              placeholder="如 16:9"
              value={ratioDraft}
              onChange={(e) => setRatioDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addChip(ratioDraft, ratios, setRatios, setRatioDraft, 'ratio');
                }
              }}
              style={FULL}
            />
            <Button onClick={() => addChip(ratioDraft, ratios, setRatios, setRatioDraft, 'ratio')}>添加比例</Button>
          </div>
        </>
      )}

      {type === 'image' && (
        <>
          <h3 style={SECTION}>图片解析器</h3>
          <Select
            aria-label="图片解析器"
            options={IMAGE_CHANNEL_PARSERS.map((id) => ({ value: id, label: id }))}
            value={parser}
            onChange={(next) => setParser(next as ImageChannelParserId)}
          />

          {/* IKHU8P：矩阵转置成「行=比例、列=尺寸」。原方向是行=尺寸、列=比例，而 gpt 的比例最多 13 个，
              14 列把单元格压到约 40px——下拉框左右 padding 加原生箭头就把正文吃光，值看着是空的。 */}
          {parser === 'gpt' && (
            <div style={{ margin: '12px 0 20px' }}>
              <Hint>行=比例选项，列=尺寸选项，格子填官方 size（含 auto）。1K × 16:9 / 9:16 可留空。</Hint>
              <Table>
                <thead>
                  <tr>
                    <th>比例</th>
                    {sizes.map((size) => (
                      <th key={size.id || size.label}>{size.label || size.id || '—'}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ratios.map((ratio) => (
                    <tr key={ratio}>
                      <td>{ratio}</td>
                      {sizes.map((size) => (
                        <td key={size.id || size.label}>
                          <Select
                            size="sm"
                            aria-label={`${ratio} 行 ${size.label || size.id} 列`}
                            options={[
                              { value: '', label: '留空' },
                              ...GPT_PROVIDER_SIZES.map((item) => ({ value: item, label: item })),
                            ]}
                            value={gptMatrix[size.id]?.[ratio] ?? ''}
                            onChange={(next) =>
                              setGptMatrix((prev) => ({
                                ...prev,
                                [size.id]: { ...(prev[size.id] ?? {}), [ratio]: next },
                              }))
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}

          {parser === 'banana' && (
            <div style={{ margin: '12px 0 20px' }}>
              <Hint>一维映射：尺寸选项 → quality；比例选项 → size（如 1x1）。不要填像素交叉格。</Hint>
              <div style={GRID2}>
                <div>
                  <div style={LABEL}>尺寸 → quality</div>
                  {sizes.map((size) => (
                    <div style={INLINE_ROW} key={size.id}>
                      <Badge tone="neutral">{size.label || size.id}</Badge>
                      <Input
                        placeholder="调用值，如 1k"
                        value={bananaQuality[size.id] ?? ''}
                        onChange={(e) => setBananaQuality((prev) => ({ ...prev, [size.id]: e.target.value }))}
                        style={FULL}
                      />
                    </div>
                  ))}
                </div>
                <div>
                  <div style={LABEL}>比例 → size</div>
                  {ratios.map((ratio) => (
                    <div style={INLINE_ROW} key={ratio}>
                      <Badge tone="neutral">{ratio}</Badge>
                      <Input
                        placeholder="调用值，如 1x1"
                        value={bananaSize[ratio] ?? ''}
                        onChange={(e) => setBananaSize((prev) => ({ ...prev, [ratio]: e.target.value }))}
                        style={FULL}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* IKHU8P：与 gpt 同因同改——转置成「行=比例、列=尺寸」，免得比例一多就把格子压到看不见。 */}
          {parser === 'seedream' && (
            <div style={{ margin: '12px 0 20px' }}>
              <Hint>
                行=比例选项，列=尺寸选项，格子填出站像素尺寸（如 2048x2048）。worker 按「分辨率 × 宽高比」查这张表换算尺寸；
                整张清空会让出站尺寸回落成 provider 原值（上游会 400），所以至少保留一格。
              </Hint>
              <Table>
                <thead>
                  <tr>
                    <th>比例</th>
                    {sizes.map((size) => (
                      <th key={size.id || size.label}>{size.label || size.id || '—'}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ratios.map((ratio) => (
                    <tr key={ratio}>
                      <td>{ratio}</td>
                      {sizes.map((size) => (
                        <td key={size.id || size.label}>
                          <Input
                            size="sm"
                            aria-label={`${ratio} 行 ${size.label || size.id} 列`}
                            placeholder="留空"
                            value={seedreamMatrix[size.id]?.[ratio] ?? ''}
                            onChange={(e) =>
                              setSeedreamMatrix((prev) => ({
                                ...prev,
                                [size.id]: { ...(prev[size.id] ?? {}), [ratio]: e.target.value },
                              }))
                            }
                            style={FULL}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}

      {showDuration && (
        <>
          <h3 style={SECTION}>时长范围</h3>
          <div style={GRID3}>
            <div>
              <div style={LABEL}>最小秒</div>
              <Input value={durationMin} onChange={(e) => setDurationMin(e.target.value)} style={FULL} />
            </div>
            <div>
              <div style={LABEL}>最大秒</div>
              <Input value={durationMax} onChange={(e) => setDurationMax(e.target.value)} style={FULL} />
            </div>
            <div>
              <div style={LABEL}>步长（选填）</div>
              <Input value={durationStep} onChange={(e) => setDurationStep(e.target.value)} style={FULL} />
            </div>
          </div>
        </>
      )}

      {showDefaultDuration && (
        <div style={GRID2}>
          <div>
            <div style={LABEL}>默认时长（秒）</div>
            <Input value={defaultDuration} onChange={(e) => setDefaultDuration(e.target.value)} style={FULL} />
          </div>
        </div>
      )}

      {showFormat && (
        <>
          <h3 style={SECTION}>格式</h3>
          <div style={CHIP_LIST}>
            {formats.map((item) => (
              <Chip key={item} onClick={() => setFormats(formats.filter((x) => x !== item))}>
                {item} ×
              </Chip>
            ))}
          </div>
          <div style={INLINE_ROW}>
            <Input
              placeholder="如 mp3"
              value={formatDraft}
              onChange={(e) => setFormatDraft(e.target.value)}
              style={FULL}
            />
            <Button onClick={() => addChip(formatDraft, formats, setFormats, setFormatDraft, 'format')}>
              添加格式
            </Button>
          </div>
          <div>
            <div style={LABEL}>默认格式</div>
            <Input value={defaultFormat} onChange={(e) => setDefaultFormat(e.target.value)} style={FULL} />
          </div>
        </>
      )}

      {showSizeRatio && (
        <div style={GRID2}>
          <div>
            <div style={LABEL}>默认尺寸</div>
            <Input value={defaultSize} onChange={(e) => setDefaultSize(e.target.value)} style={FULL} />
          </div>
          <div>
            <div style={LABEL}>默认比例</div>
            <Input value={defaultRatio} onChange={(e) => setDefaultRatio(e.target.value)} style={FULL} />
          </div>
        </div>
      )}

      {/* IKHBDO：结构化 features 对所有类型开放。此前 audio / text 被排除在结构化块之外，
          而高级 JSON 兜底又只对 image / video 渲染——两种条件互相抵消，音频行连 JSON 出口都没有。 */}
      <h3 style={SECTION}>特性 features（结构化）</h3>
      {!hasStructuredFeature && <Hint>该类型没有专属的结构化特性键，可直接用下方高级 JSON 配置。</Hint>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        {Object.entries(FEATURE_BOOL_LABELS)
          .filter(([, meta]) => featureApplies(meta, type))
          .map(([key, meta]) => (
            <Checkbox
              key={key}
              checked={!!featureFlags[key]}
              onChange={() => setFeatureFlags((p) => ({ ...p, [key]: !p[key] }))}
              label={meta.label}
            />
          ))}
      </div>
      <div style={GRID2}>
        {Object.entries(FEATURE_NUMBER_LABELS)
          .filter(([, meta]) => featureApplies(meta, type))
          .map(([key, meta]) => (
            <div key={key}>
              <div style={LABEL}>
                {meta.label} <span>（留空不写入）</span>
              </div>
              <Input
                type="number"
                min={0}
                placeholder={meta.placeholder}
                value={featureNumbers[key] ?? ''}
                onChange={(e) => setFeatureNumbers((p) => ({ ...p, [key]: e.target.value }))}
                style={FULL}
              />
            </div>
          ))}
      </div>
      <div style={GRID2}>
        {Object.entries(FEATURE_STRING_LABELS)
          .filter(([, meta]) => featureApplies(meta, type))
          .map(([key, meta]) => (
            <div key={key}>
              <div style={LABEL}>
                {meta.label} <span>（留空不写入）</span>
              </div>
              <Input
                placeholder={meta.placeholder}
                value={featureStrings[key] ?? ''}
                onChange={(e) => setFeatureStrings((p) => ({ ...p, [key]: e.target.value }))}
                style={FULL}
              />
            </div>
          ))}
      </div>

      {/* ADR-0086：按任务类型的比例约束——原先只能在整个 features 的 JSON 里手写。 */}
      {type === 'video' && (
        <>
          <h3 style={SECTION}>任务类型比例约束 task_types</h3>
          <Hint>留空 = 该任务类型沿用基础「比例选项」。只编辑 allowed_ratios，行内其它子键原样保留。</Hint>
          {TASK_TYPE_KEYS.map((taskType) => (
            <div style={TASK_ROW} key={taskType}>
              <Badge tone="neutral">{taskType}</Badge>
              <div style={CHIP_LIST}>
                {(taskTypeRatios[taskType] ?? []).map((ratio) => (
                  <Chip
                    key={ratio}
                    onClick={() =>
                      setTaskTypeRatios((prev) => ({
                        ...prev,
                        [taskType]: (prev[taskType] ?? []).filter((x) => x !== ratio),
                      }))
                    }
                  >
                    {ratio} ×
                  </Chip>
                ))}
              </div>
              <Input
                size="sm"
                placeholder="如 16:9，回车添加"
                value={taskRatioDraft[taskType] ?? ''}
                onChange={(e) => setTaskRatioDraft((prev) => ({ ...prev, [taskType]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTaskRatio(taskType);
                  }
                }}
                style={FULL}
              />
              <Button onClick={() => addTaskRatio(taskType)}>添加</Button>
            </div>
          ))}
        </>
      )}

      <details style={{ marginBottom: 18 }}>
        <summary>高级 JSON（未识别字段 / 映射兜底）</summary>
        <Textarea
          value={extraFeatures}
          onChange={(e) => setExtraFeatures(e.target.value)}
          style={{ marginTop: 8 }}
        />
      </details>

      <div style={{ marginTop: 4 }}>
        <Checkbox checked={enabled} onChange={setEnabled} label="启用" />
      </div>

      <div style={{ marginTop: 12 }}>
        <Hint>供应商由系统写死为 new-api，无需填写。文本类型不展示尺寸 / 比例 / 时长。</Hint>
      </div>
      {error && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Modal>
  );
}
