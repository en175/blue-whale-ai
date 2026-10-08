/* ============================================
 * ModelFormModal —— 模型新建 / 编辑弹窗
 *
 * 呈现层全部走 ../../ui 的组件（Modal / Tabs / Input / Select / Checkbox / Alert / Table …），
 * **本文件没有自己的样式文件**：原先的私有 CSS 已删除，
 * 一个界面元素只有套件里一处定义。行内 style 只剩布局与一次性间距——
 * 颜色、边框、字号一律由套件与设计 token 决定。
 *
 * ── 为什么是 tab 而不是一条长滚动（用户口径）─────────────────────────────────
 *
 * 「模型列表的配置，可以做一个 table 切换，不要一直往下加内容」。原先约 1000 行的长滚动里，
 * 改了就会影响出站请求的「高级」项与日常的「展示名」混在一起，越加越难找。现在四块：
 *
 *   · 基础        身份字段（只读）+ 类型 / 复制自 / model_id / 展示名 / 图标 / 启用
 *   · 尺寸与素材  尺寸档位 / 比例 / 出站尺寸映射（渠道类型 + 映射表）/ 输出像素表 /
 *                 默认值 / 时长 / 格式 / 特性 features / task_types
 *   · 定价        该行的一条计价规则（原「模型计费」页的定价编辑收进这里）
 *   · 高级        未识别字段 / 映射兜底的 JSON（逃生舱）
 *
 * 每个 tab 各自一个文件（本文件再加就超 `max-lines` 上限）：`BasicsTab` / `SizeMaterialTab` /
 * `PricingTab` / `AdvancedTab`。**状态仍全部住在这里**（保存要拼一整个提交体），
 * tab 只负责渲染。
 *
 * ── 定价：从「发布整份目录」改成「一次 PUT」──────────────────────────────────
 *
 * 定价数据长在能力行上（`generation_model_capability.pricing`）。于是保存就是一次普通的
 * 能力行更新 —— 没有「目录与能力行两个存储」的半失败问题。
 * （它**曾经**与定价目录里 `document.models.<model_id>.<capability_type>` 那条逐字相同；
 *  目录那段已随这次搬迁**整段退场**，现在规则只有能力行这一处。两条纪律：
 *
 *   · **没碰过定价 tab 就完全不提交该字段**（`undefined` = 库里那份原样保留）：
 *     「打开看一眼、点保存」不会用一份从空表单拼出来的规则把已有的价覆盖掉；
 *   · **单价按「元」填、按 mc 存**，且没改过的价**原值写回**（`MoneyField.originalMc`，
 *     详见 `lib/billing-catalog/catalogDraft.ts` 文件头第 2 条）——改的是钱，换算的舍入
 *     一旦落在没动过的栏上，没人看得见。
 *
 * ⚠️ 换算率（1 元 = 多少积分）仍住**定价目录**里，这一页只读它：目录还活着，它为全局参数而存在。
 * ============================================ */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdminModel, CreateAdminModelParams } from '@/api/adminModels';
import { billingCatalogOptions } from '@/api/adminBillingCatalog';
import { isApiError } from '@/api/http';
import {
  formFromRule,
  parseCatalog,
  readCreditsPerYuan,
  ruleFormError,
  ruleFromForm,
  type CatalogRuleView,
  type KeyValueRow,
  type RuleForm,
} from '../../lib/billing-catalog/catalogDraft';
import type { ModelCapabilityView } from '../../lib/billing-catalog/sizeCandidates';
import { dimensionTableCandidates } from '../../lib/billing-catalog/sizeCandidates';
import {
  DEFAULT_IMAGE_RATIOS,
  DEFAULT_IMAGE_SIZES,
  buildCreateParams,
  buildTaskTypes,
  channelFromModel,
  channelOf,
  defaultChannelFor,
  diffUpdateParams,
  durationsFromModel,
  featureValueTypeOk,
  mergeMatrix,
  parseBananaMaps,
  parseGptMatrix,
  pickTaskTypeRatios,
  ratiosFromModel,
  readFeature,
  sizesFromModel,
  type ChannelId,
  type FormSnapshot,
  type GptMatrix,
  type ModelType,
  type RatioForm,
  type SizeForm,
} from './model-form';
import {
  FEATURE_BOOL_LABELS,
  FEATURE_NUMBER_LABELS,
  FEATURE_STRING_LABELS,
  buildVideoDimensions,
  dropKnownFeatures,
  featureApplies,
  omitEmpty,
  omitEmptyStrings,
  pickFeatureBooleans,
  pickFeatureNumbers,
  pickFeatureStrings,
  pickVideoDimensions,
  pretty,
  readTaskTypesBase,
} from './feature-fields';
import { Alert, Button, Modal, Tabs } from '../../ui';
import BasicsTab from './BasicsTab';
import SizeMaterialTab from './SizeMaterialTab';
import PricingTab from './PricingTab';
import AdvancedTab from './AdvancedTab';

const TAB_ITEMS = [
  { key: 'basics', label: '基础' },
  { key: 'size', label: '尺寸与素材' },
  { key: 'pricing', label: '定价' },
  { key: 'advanced', label: '高级' },
] as const;

type TabKey = (typeof TAB_ITEMS)[number]['key'];

interface ModelFormModalProps {
  initial?: AdminModel;
  models: AdminModel[];
  defaultType: ModelType;
  onClose: () => void;
  onSubmit: (params: Partial<CreateAdminModelParams>, id?: string) => Promise<void>;
}

export default function ModelFormModal({ initial, models, defaultType, onClose, onSubmit }: ModelFormModalProps) {
  const [tab, setTab] = useState<TabKey>('basics');
  const [type, setType] = useState<ModelType>(initial?.capability_type ?? defaultType);
  const [copyFrom, setCopyFrom] = useState('');
  const [modelId, setModelId] = useState(initial?.model_id ?? '');
  const [label, setLabel] = useState(initial?.model_label ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? '');
  // IKHTVR：尺寸行只认 id / label 两个可编辑字段；`api_value` 提交时按 id 重建，
  // 像素宽高不再写（无消费方）。
  const [sizes, setSizes] = useState<SizeForm[]>(() => {
    const stored = sizesFromModel(initial?.supported_sizes);
    if (stored.length) return stored;
    return type === 'image' ? DEFAULT_IMAGE_SIZES : [];
  });
  const [ratios, setRatios] = useState<RatioForm[]>(() => {
    const stored = ratiosFromModel(initial?.supported_aspect_ratios);
    if (stored.length) return stored;
    return type === 'image' ? DEFAULT_IMAGE_RATIOS : [];
  });
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
  /** 输出像素表 `features.video_dimensions`（键从本行的档位 × 比例派生，值由运营填）。 */
  const [videoDimensions, setVideoDimensions] = useState<KeyValueRow[]>(() =>
    pickVideoDimensions(initial?.features),
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
  /** 渠道（能力行 `channel` 列）：表单上只有一个控件。映射表怎么读、出站走哪种协议都由它决定，
   *  解析器只是它的一格展开（`channelOf(channel).parser`）。 */
  const originalChannel = channelFromModel(initial);
  const [channel, setChannel] = useState<ChannelId>(originalChannel);
  const parser = channelOf(channel).parser ?? 'seedream';
  const originalParser = channelOf(originalChannel).parser ?? 'seedream';
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

  /* ── 定价（`pricing` 列）────────────────────────────────────────────────────── */
  /** 库里那条规则（`null` = 还没配）。它是「不编辑的字段原样带回去」的来源。 */
  const originalPricing = (initial?.pricing ?? null) as CatalogRuleView | null;
  const [pricingForm, setPricingForm] = useState<RuleForm>(() =>
    formFromRule(initial?.model_id ?? '', type, originalPricing ?? {}, null),
  );
  /** 用户动过定价 tab 没有。**没动过就完全不提交该字段**——库里那份原样保留。 */
  const [pricingTouched, setPricingTouched] = useState(false);

  /**
   * 换算率来自**定价目录**（它还为全局参数而存在）：单价按元填、写回 mc，换算就在这一层。
   * 读不到时**不阻塞本弹窗**（定价 tab 会说明并拦住填价）——目录接口抖动不该让「改个展示名」也做不成。
   */
  const catalog = useQuery(billingCatalogOptions());
  const creditsPerYuan = useMemo(() => {
    if (catalog.data === undefined) return null;
    try {
      return readCreditsPerYuan(parseCatalog(catalog.data.document));
    } catch {
      return null;
    }
  }, [catalog.data]);
  const rateNotice = catalog.isError
    ? isApiError(catalog.error)
      ? catalog.error.message
      : '获取定价目录失败'
    : '';

  // 换算率是异步到的：把「元」重新渲染一遍。⚠️ **用户已经动过定价就绝不覆盖**——
  // 那会把正在填的价冲掉。没动过时重建是恒等的（`formFromRule` 带上 originalMc，见文件头）。
  useEffect(() => {
    if (pricingTouched) return;
    setPricingForm(formFromRule(initial?.model_id ?? '', type, originalPricing ?? {}, creditsPerYuan));
  }, [pricingTouched, creditsPerYuan, initial, type, originalPricing]);

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

  /**
   * 本行的能力视图（尺寸 × 比例）—— 定价 tab 用它派生**规格键候选集**。
   *
   * <p>取的是**表单里正在编辑的那份**（不是库里的行）：运营刚加的一个档位，就应该立刻能在
   * 价格表里配价，而不是先保存一次、再打开定价 tab 才看得到。矩阵用表单里的映射表，
   * 好让价格表那行标出「本行尺寸：2048x2048（419 万像素）」。
   */
  const capabilityView = useMemo<ModelCapabilityView>(
    () => ({
      modelId: modelId.trim(),
      capabilityType: type,
      sizes: sizes
        .filter((size) => size.id.trim())
        .map((size) => ({
          id: size.id.trim(),
          label: (size.label ?? '').trim(),
          // IKHTVR：`api_value` 恒等于 id（表单不再单独编辑），这里保持一致以便
          // `configuredSizePixels` 用同一个键去矩阵里查像素。
          apiValue: size.id.trim(),
          width: null,
          height: null,
        })),
      ratios: ratios.filter((ratio) => ratio.id.trim()).map((ratio) => ratio.id.trim()),
      defaultRatio: defaultRatio.trim(),
      matrix: parser === 'seedream' ? seedreamMatrix : parser === 'gpt' ? gptMatrix : {},
    }),
    [modelId, type, sizes, ratios, defaultRatio, parser, seedreamMatrix, gptMatrix],
  );

  /** 输出像素表的候选键：本行的「档位 × 比例」笛卡尔积（与定价 tab 的尺寸表同源，不手敲）。 */
  const dimensionCandidates = useMemo(() => dimensionTableCandidates(capabilityView), [capabilityView]);

  const applySource = (src: AdminModel, nextType: ModelType) => {
    const srcSizes = sizesFromModel(src.supported_sizes);
    const nextSizes = srcSizes.length ? srcSizes : nextType === 'image' ? DEFAULT_IMAGE_SIZES : [];
    const nextRatios = ratiosFromModel(src.supported_aspect_ratios);
    if (!nextRatios.length && nextType === 'image') nextRatios.push(...DEFAULT_IMAGE_RATIOS);
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
    setVideoDimensions(pickVideoDimensions(src.features));
    setExtraFeatures(pretty(dropKnownFeatures(src.features)));
    setDefaultSize(src.default_size ?? '');
    setDefaultRatio(src.default_aspect_ratio ?? '');
    setDefaultFormat(src.default_format ?? '');
    setDefaultDuration(src.default_duration != null ? String(src.default_duration) : '');
    const nextChannel = channelFromModel(src);
    setChannel(nextChannel);
    const nextParser = channelOf(nextChannel).parser ?? 'seedream';
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

  const handleType = (next: ModelType) => {
    setType(next);
    setCopyFrom('');
    // 换类型 = 换媒介，渠道必须跟着换：渠道的媒介与行的 capability_type 绑死（后端媒体闸门），
    // 留着上一个媒介的渠道会让这次新建**保存必然 400**。
    setChannel((prev) => (channelOf(prev).media === next ? prev : defaultChannelFor(next)));
    if (next === 'image' && !sizes.length) setSizes(DEFAULT_IMAGE_SIZES);
    if (next === 'image' && !ratios.length) setRatios(DEFAULT_IMAGE_RATIOS);
  };

  const addSizeRow = () => {
    const next = [...sizes, { id: '', label: '' }];
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

  const removeRatio = (ratioId: string) => {
    const next = ratios.filter((item) => item.id !== ratioId);
    setRatios(next);
    setGptMatrix((prev) => mergeMatrix(prev, sizes, next));
    setSeedreamMatrix((prev) => mergeMatrix(prev, sizes, next));
  };

  const addRatio = () => {
    const id = ratioDraft.trim();
    if (!id || ratios.some((ratio) => ratio.id === id)) return;
    const next = [...ratios, { id }];
    setRatios(next);
    setRatioDraft('');
    setGptMatrix((prev) => mergeMatrix(prev, sizes, next));
    setSeedreamMatrix((prev) => mergeMatrix(prev, sizes, next));
  };

  const updateRatio = (index: number, patch: Partial<RatioForm>) => {
    const next = ratios.map((ratio, i) => (i === index ? { ...ratio, ...patch } : ratio));
    setRatios(next);
    if (patch.id !== undefined) {
      setGptMatrix((matrix) => mergeMatrix(matrix, sizes, next));
      setSeedreamMatrix((matrix) => mergeMatrix(matrix, sizes, next));
    }
  };

  const addChip = (
    draft: string,
    list: string[],
    setList: (v: string[]) => void,
    setDraft: (v: string) => void,
  ) => {
    const value = draft.trim();
    if (!value || list.includes(value)) return;
    setList([...list, value]);
    setDraft('');
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

  const removeTaskRatio = (taskType: string, ratio: string) => {
    setTaskTypeRatios((prev) => ({
      ...prev,
      [taskType]: (prev[taskType] ?? []).filter((x) => x !== ratio),
    }));
  };

  const snapshot = (): FormSnapshot => {
    let extra: Record<string, unknown> = {};
    try {
      extra = JSON.parse(extraFeatures || '{}') as Record<string, unknown>;
    } catch {
      extra = {};
    }
    const taskTypes = buildTaskTypes(taskTypesBase, taskTypeRatios);
    const dimensions = buildVideoDimensions(videoDimensions);
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
        // 输出像素表：**一行都没填就整个不写这个键**（留空 = 不做这张表，不是「配了张空表」）
        ...(dimensions !== undefined ? { video_dimensions: dimensions } : {}),
        ...(Object.keys(taskTypes).length ? { task_types: taskTypes } : {}),
      },
      channel,
      originalChannel,
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
      setTab('advanced');
      return;
    }
    const built = buildCreateParams(snapshot());
    if (!built.ok) {
      setError(built.error);
      return;
    }
    // 定价：**只在动过这一页时**才校验与提交。没动过 = 库里那份原样保留（`undefined`）。
    if (pricingTouched) {
      // 模型 / 任务类型就是这一行的身份（一个能力行恰好对应一条规则），校验前现填进去
      const effective: RuleForm = { ...pricingForm, modelId: modelId.trim(), taskType: type };
      const message = ruleFormError(effective, creditsPerYuan);
      if (message !== null) {
        setError(message);
        setTab('pricing');
        return;
      }
      try {
        built.value.pricing = ruleFromForm(effective, originalPricing ?? {}, creditsPerYuan);
      } catch (e) {
        setError(e instanceof Error ? e.message : '定价规则不合法');
        setTab('pricing');
        return;
      }
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
      <div style={{ marginBottom: 18 }}>
        <Tabs items={TAB_ITEMS} value={tab} onChange={(key) => setTab(key as TabKey)} />
      </div>

      {tab === 'basics' && (
        <BasicsTab
          initial={initial}
          type={type}
          onType={handleType}
          channel={channel}
          setChannel={setChannel}
          copyFrom={copyFrom}
          onCopy={handleCopy}
          copyOptions={copyOptions}
          modelId={modelId}
          onModelId={setModelId}
          label={label}
          onLabel={setLabel}
          icon={icon}
          onIcon={setIcon}
          enabled={enabled}
          onEnabled={setEnabled}
        />
      )}

      {tab === 'size' && (
        <SizeMaterialTab
          type={type}
          channel={channel}
          gpt={{ matrix: gptMatrix, setCell: (sizeId, ratio, value) => setGptMatrix((prev) => ({ ...prev, [sizeId]: { ...(prev[sizeId] ?? {}), [ratio]: value } })) }}
          seedream={{ matrix: seedreamMatrix, setCell: (sizeId, ratio, value) => setSeedreamMatrix((prev) => ({ ...prev, [sizeId]: { ...(prev[sizeId] ?? {}), [ratio]: value } })) }}
          banana={{
            quality: bananaQuality,
            setQuality: setBananaQuality,
            size: bananaSize,
            setSize: setBananaSize,
          }}
          visible={{ sizeRatio: showSizeRatio, duration: showDuration, defaultDuration: showDefaultDuration, format: showFormat, structuredFeature: hasStructuredFeature }}
          sizes={{ rows: sizes, add: addSizeRow, update: updateSize, remove: removeSize }}
          ratios={{
            rows: ratios,
            update: updateRatio,
            remove: removeRatio,
            draft: ratioDraft,
            setDraft: setRatioDraft,
            add: addRatio,
          }}
          dimensions={{ rows: videoDimensions, candidates: dimensionCandidates, set: setVideoDimensions }}
          defaults={{
            size: defaultSize,
            setSize: setDefaultSize,
            ratio: defaultRatio,
            setRatio: setDefaultRatio,
            format: defaultFormat,
            setFormat: setDefaultFormat,
            duration: defaultDuration,
            setDuration: setDefaultDuration,
          }}
          durations={{ min: durationMin, max: durationMax, step: durationStep, setMin: setDurationMin, setMax: setDurationMax, setStep: setDurationStep }}
          formats={{
            rows: formats,
            remove: (item) => setFormats(formats.filter((x) => x !== item)),
            draft: formatDraft,
            setDraft: setFormatDraft,
            add: () => addChip(formatDraft, formats, setFormats, setFormatDraft),
          }}
          features={{
            flags: featureFlags,
            toggle: (key) => setFeatureFlags((p) => ({ ...p, [key]: !p[key] })),
            numbers: featureNumbers,
            setNumber: (key, value) => setFeatureNumbers((p) => ({ ...p, [key]: value })),
            strings: featureStrings,
            setString: (key, value) => setFeatureStrings((p) => ({ ...p, [key]: value })),
          }}
          taskTypes={{
            ratios: taskTypeRatios,
            draft: taskRatioDraft,
            setDraft: setTaskRatioDraft,
            add: addTaskRatio,
            remove: removeTaskRatio,
          }}
        />
      )}

      {tab === 'pricing' && (
        <PricingTab
          rule={originalPricing}
          creditsPerYuan={creditsPerYuan}
          rateNotice={rateNotice}
          modelId={modelId.trim() || (initial?.model_id ?? '')}
          taskType={type}
          channel={channel}
          capability={capabilityView}
          form={pricingForm}
          onChange={(next) => {
            setPricingTouched(true);
            setPricingForm(next);
          }}
        />
      )}

      {tab === 'advanced' && <AdvancedTab extraFeatures={extraFeatures} setExtraFeatures={setExtraFeatures} />}

      {error && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Modal>
  );
}
