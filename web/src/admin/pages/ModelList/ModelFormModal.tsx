





































import { useEffect, useMemo, useState } from 'react';
import type { AdminModel, CreateAdminModelParams } from '@/admin/api/adminModels';
import { isApiError } from '@/shared/api/http';
import {
  formFromRule,
  ruleFormError,
  ruleFromForm,
  type CatalogRuleView,
  type KeyValueRow,
  type RuleForm,
} from '../../utils/billing-catalog/catalogDraft';
import type { ModelCapabilityView } from '../../utils/billing-catalog/sizeCandidates';
import { dimensionTableCandidates, expandDurations } from '../../utils/billing-catalog/sizeCandidates';
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
  pickTaskTypeEnabled,
  pickTaskTypeDuration,
  ratiosFromModel,
  readFeature,
  sizesFromModel,
  type ChannelId,
  type FormSnapshot,
  type GptMatrix,
  type RatioForm,
  type SizeForm,
  type TaskTypeDurationStrategy,
} from './model-form';
import { type ModelType } from '@/admin/enums';
import {
  buildVideoDimensions,
  dropKnownFeatures,
  omitEmpty,
  omitEmptyStrings,
  pickFeatureBooleans,
  pickFeatureNumbers,
  pickFeatureStrings,
  pickVideoDimensions,
  readTaskTypesBase,
} from './feature-fields';
import { Alert, Button, Modal, Tabs } from '../../ui';
import BasicsTab from './BasicsTab';
import SizeMaterialTab from './SizeMaterialTab';
import PricingTab from './PricingTab';

const TAB_ITEMS = [
  { key: 'basics', label: '基础' },
  { key: 'size', label: '尺寸与素材' },
  { key: 'pricing', label: '定价' },
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
  const [taskTypeEnabled, setTaskTypeEnabled] = useState<Record<string, boolean>>(() =>
    pickTaskTypeEnabled(initial?.features),
  );
  const [taskTypesBase, setTaskTypesBase] = useState<Record<string, unknown>>(() =>
    readTaskTypesBase(initial?.features),
  );
  const [taskTypeDuration, setTaskTypeDuration] = useState<Record<string, TaskTypeDurationStrategy>>(() =>
    pickTaskTypeDuration(initial?.features),
  );

  const [videoDimensions, setVideoDimensions] = useState<KeyValueRow[]>(() =>
    pickVideoDimensions(initial?.features),
  );
  const [extraFeatures, setExtraFeatures] = useState<Record<string, unknown>>(
    initial ? dropKnownFeatures(initial.features) : {},
  );
  const [defaultSize, setDefaultSize] = useState(initial?.default_size ?? '');
  const [defaultRatio, setDefaultRatio] = useState(initial?.default_aspect_ratio ?? '');
  const [defaultFormat, setDefaultFormat] = useState(initial?.default_format ?? '');
  const [defaultDuration, setDefaultDuration] = useState(
    initial?.default_duration != null ? String(initial.default_duration) : '',
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);


  const originalChannel = channelFromModel(initial);
  const [channel, setChannel] = useState<ChannelId>(originalChannel);
  const parser = channelOf(channel).parser ?? 'seedream';
  const originalParser = channelOf(originalChannel).parser ?? 'seedream';
  const [gptMatrix, setGptMatrix] = useState(() => parseGptMatrix(initial?.request_mapping, sizes, ratios));



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



  const originalPricing = (initial?.pricing ?? null) as CatalogRuleView | null;
  const [pricingForm, setPricingForm] = useState<RuleForm>(() =>
    formFromRule(initial?.model_id ?? '', type, originalPricing ?? {}),
  );

  const [pricingTouched, setPricingTouched] = useState(false);



  useEffect(() => {
    if (pricingTouched) return;
    setPricingForm(formFromRule(initial?.model_id ?? '', type, originalPricing ?? {}));
  }, [pricingTouched, initial, type, originalPricing]);

  const copyOptions = models.filter((m) => m.capability_type === type);
  const showSizeRatio = type === 'image' || type === 'video';


  const showDuration = type === 'video';

  const showDefaultDuration = type === 'video' || type === 'audio';
  const showFormat = type === 'audio' || type === 'video';







  const capabilityView = useMemo<ModelCapabilityView>(
    () => ({
      modelId: modelId.trim(),
      capabilityType: type,
      sizes: sizes
        .filter((size) => size.id.trim())
        .map((size) => ({
          id: size.id.trim(),
          label: (size.label ?? '').trim(),


          apiValue: size.id.trim(),
          width: null,
          height: null,
        })),
      ratios: ratios.filter((ratio) => ratio.id.trim()).map((ratio) => ratio.id.trim()),
      durations: expandDurations(
        durationMin.trim() ? Number(durationMin) : null,
        durationMax.trim() ? Number(durationMax) : null,
        durationStep.trim() ? Number(durationStep) : null,
      ),
      defaultRatio: defaultRatio.trim(),
      matrix: parser === 'seedream' ? seedreamMatrix : parser === 'gpt' ? gptMatrix : {},
    }),
    [
      modelId,
      type,
      sizes,
      ratios,
      durationMin,
      durationMax,
      durationStep,
      defaultRatio,
      parser,
      seedreamMatrix,
      gptMatrix,
    ],
  );


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
    setTaskTypeDuration(pickTaskTypeDuration(src.features));
    setTaskTypesBase(readTaskTypesBase(src.features));
    setVideoDimensions(pickVideoDimensions(src.features));
    setExtraFeatures(dropKnownFeatures(src.features));
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
    const extra = extraFeatures;
    const taskTypes = buildTaskTypes(taskTypesBase, taskTypeRatios, taskTypeEnabled, taskTypeDuration);
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



          Object.entries(featureFlags).filter(([k, v]) => {
            if (v) return true;
            const stored = readFeature(initial?.features, k);
            return stored !== undefined && (stored === null || featureValueTypeOk(k, stored));
          }),
        ),

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
    const built = buildCreateParams(snapshot());
    if (!built.ok) {
      setError(built.error);
      return;
    }

    if (pricingTouched) {

      const effective: RuleForm = { ...pricingForm, modelId: modelId.trim(), taskType: type };
      const message = ruleFormError(effective);
      if (message !== null) {
        setError(message);
        setTab('pricing');
        return;
      }
      try {
        built.value.pricing = ruleFromForm(effective, originalPricing ?? {});
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
          visible={{ sizeRatio: showSizeRatio, duration: showDuration, defaultDuration: showDefaultDuration, format: showFormat }}
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
          extraFeatures={{
            entries: extraFeatures,
            remove: (key) =>
              setExtraFeatures((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key))),
          }}
          taskTypes={{
            ratios: taskTypeRatios,
            enabled: taskTypeEnabled,
            toggle: (taskType: string) =>
              setTaskTypeEnabled((p) => ({ ...p, [taskType]: !p[taskType] })),
            draft: taskRatioDraft,
            setDraft: setTaskRatioDraft,
            add: addTaskRatio,
            remove: removeTaskRatio,
            duration: taskTypeDuration,
            setDuration: (taskType: string, strategy: TaskTypeDurationStrategy) =>
              setTaskTypeDuration((p) => ({ ...p, [taskType]: strategy })),
          }}
        />
      )}

      {tab === 'pricing' && (
        <PricingTab
          rule={originalPricing}
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

      {error && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Modal>
  );
}
