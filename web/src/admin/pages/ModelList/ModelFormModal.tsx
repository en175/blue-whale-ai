import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import type { AdminModel, CreateAdminModelParams, ModelSize } from '@/api/admin';
import { isApiError } from '@/api/http';
import {
  DEFAULT_IMAGE_RATIOS,
  DEFAULT_IMAGE_SIZES,
  GPT_PROVIDER_SIZES,
  IMAGE_CHANNEL_PARSERS,
  TYPE_TABS,
  buildCreateParams,
  diffUpdateParams,
  durationsFromModel,
  emptyGptMatrix,
  parseBananaMaps,
  parseGptMatrix,
  parserFromModel,
  type FormSnapshot,
  type ImageChannelParserId,
  type ModelType,
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
};

const FEATURE_NUMBER_LABELS: Record<string, { label: string; types?: ModelType[]; placeholder: string }> = {
  max_reference_images: { label: '参考图上限 max_reference_images', types: ['image', 'video'], placeholder: '如 10' },
  quantity_max: { label: '单次生成数量 quantity_max', types: ['image'], placeholder: '如 1' },
};

const pretty = (raw: unknown) => {
  try {
    return JSON.stringify(raw ?? {}, null, 2);
  } catch {
    return '{}';
  }
};

const pickFeatureBooleans = (features: Record<string, unknown> = {}): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(FEATURE_BOOL_LABELS)) out[key] = features[key] === true;
  return out;
};

const pickFeatureNumbers = (features: Record<string, unknown> = {}): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of Object.keys(FEATURE_NUMBER_LABELS)) {
    const v = features[key];
    out[key] = typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  }
  return out;
};

const dropKnownFeatures = (features: Record<string, unknown> = {}): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(features)) {
    if (k in FEATURE_BOOL_LABELS || k in FEATURE_NUMBER_LABELS) continue;
    out[k] = v;
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
  const [sizes, setSizes] = useState<ModelSize[]>(
    initial?.supported_sizes?.length ? initial.supported_sizes : type === 'image' ? DEFAULT_IMAGE_SIZES : [],
  );
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
  const [parser, setParser] = useState<ImageChannelParserId>(parserFromModel(initial));
  const [gptMatrix, setGptMatrix] = useState(() => parseGptMatrix(initial?.request_mapping, sizes, ratios));
  const bananaInit = parseBananaMaps(initial?.request_mapping);
  const [bananaQuality, setBananaQuality] = useState(bananaInit.quality);
  const [bananaSize, setBananaSize] = useState(bananaInit.size);
  const [ratioDraft, setRatioDraft] = useState('');
  const [formatDraft, setFormatDraft] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const copyOptions = models.filter((m) => m.capability_type === type);
  const showSizeRatio = type === 'image' || type === 'video';
  const showDuration = type === 'video' || type === 'audio';
  const showFormat = type === 'audio' || type === 'video';
  const showExtraJson = type === 'image' || type === 'video';

  const applySource = (src: AdminModel, nextType: ModelType) => {
    setSizes(src.supported_sizes?.length ? src.supported_sizes : nextType === 'image' ? DEFAULT_IMAGE_SIZES : []);
    setRatios(
      src.supported_aspect_ratios?.length
        ? src.supported_aspect_ratios
        : nextType === 'image'
          ? DEFAULT_IMAGE_RATIOS
          : [],
    );
    const d = durationsFromModel(src);
    setDurationMin(d.min);
    setDurationMax(d.max);
    setDurationStep(d.step);
    setFormats(src.supported_formats ?? []);
    setFeatureFlags(pickFeatureBooleans(src.features));
    setFeatureNumbers(pickFeatureNumbers(src.features));
    setExtraFeatures(pretty(dropKnownFeatures(src.features)));
    setDefaultSize(src.default_size ?? '');
    setDefaultRatio(src.default_aspect_ratio ?? '');
    setDefaultFormat(src.default_format ?? '');
    setDefaultDuration(src.default_duration != null ? String(src.default_duration) : '');
    const nextParser = parserFromModel(src);
    setParser(nextParser);
    setGptMatrix(parseGptMatrix(src.request_mapping, src.supported_sizes ?? [], src.supported_aspect_ratios ?? []));
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
    const next = [...sizes, { id: '', label: '' }];
    setSizes(next);
    setGptMatrix(emptyGptMatrix(next, ratios));
  };

  const updateSize = (index: number, patch: Partial<ModelSize>) => {
    const next = sizes.map((item, i) => (i === index ? { ...item, ...patch } : item));
    setSizes(next);
    setGptMatrix((prev) => {
      const rebuilt = emptyGptMatrix(next, ratios);
      for (const [sizeId, row] of Object.entries(prev)) {
        if (rebuilt[sizeId]) rebuilt[sizeId] = { ...rebuilt[sizeId], ...row };
      }
      return rebuilt;
    });
  };

  const removeSize = (index: number) => {
    const next = sizes.filter((_, i) => i !== index);
    setSizes(next);
    setGptMatrix(emptyGptMatrix(next, ratios));
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
      setGptMatrix((prev) => {
        const rebuilt = emptyGptMatrix(sizes, next);
        for (const [sizeId, row] of Object.entries(prev)) {
          if (rebuilt[sizeId]) rebuilt[sizeId] = { ...rebuilt[sizeId], ...row };
        }
        return rebuilt;
      });
    }
  };

  const snapshot = (): FormSnapshot => {
    let extra: Record<string, unknown> = {};
    try {
      extra = JSON.parse(extraFeatures || '{}') as Record<string, unknown>;
    } catch {
      extra = {};
    }
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
      formats,
      defaultSize,
      defaultRatio,
      defaultFormat,
      defaultDuration,
      enabled,
      features: {
        ...extra,
        ...omitEmpty(featureNumbers),
        ...Object.fromEntries(
          Object.entries(featureFlags).filter(([k, v]) => v || (initial?.features != null && k in initial.features)),
        ),
      },
      parser,
      gptMatrix,
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
              {sizes.map((size, index) => (
                <div className={styles.chipRow} key={`${size.id}-${index}`}>
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
                    <button
                      onClick={() => {
                        const next = ratios.filter((item) => item !== ratio);
                        setRatios(next);
                        setGptMatrix(emptyGptMatrix(sizes, next));
                      }}
                    >
                      ×
                    </button>
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
                <p className={styles.hint}>Seedream 本期不提供映射编辑，仍走代码表 seedream-image-size。</p>
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
              <div className={styles.grid2}>
                <div>
                  <div className={styles.label}>默认时长（秒）</div>
                  <input className={styles.input} value={defaultDuration} onChange={(e) => setDefaultDuration(e.target.value)} />
                </div>
              </div>
            </>
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

          {type !== 'text' && type !== 'audio' && (
            <>
              <div className={styles.sectionTitle}>特性 features（结构化）</div>
              <div className={styles.featureGroup}>
                {Object.entries(FEATURE_BOOL_LABELS)
                  .filter(([, meta]) => !meta.types || meta.types.includes(type))
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
                  .filter(([, meta]) => !meta.types || meta.types.includes(type))
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
            </>
          )}

          {showExtraJson && (
            <details className={styles.featureExtra}>
              <summary>高级 JSON（未识别字段 / 映射兜底）</summary>
              <textarea className={styles.textareaSm} value={extraFeatures} onChange={(e) => setExtraFeatures(e.target.value)} />
            </details>
          )}

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
