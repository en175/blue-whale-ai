/* ============================================
 * ModelList 模型列表：dock 模型能力目录管理（generation_model_capability）
 * 数据源 GET/POST/PUT /api/admin/models + PATCH /:id/toggle
 * ============================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, Pencil, Trash2, ChevronUp, ChevronDown, Power } from 'lucide-react';
import {
  fetchAdminModels,
  createAdminModel,
  updateAdminModel,
  toggleAdminModel,
  deleteAdminModel,
  type AdminModel,
  type CreateAdminModelParams,
  type ModelSize,
} from '@/api/admin';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import styles from './index.module.css';

/** 模型类型 */
type ModelType = 'image' | 'video' | 'text';

const TYPE_TABS: { key: ModelType; label: string }[] = [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'text', label: '文生文' },
];

const typeName = (t: ModelType) => TYPE_TABS.find((x) => x.key === t)?.label ?? t;

const pretty = (raw: string) => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

/** ISO 时间 → 本地展示 */
const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

/** 默认参数展示 */
const defaultParams = (m: AdminModel) => {
  if (m.capability_type === 'video') return m.default_duration != null ? `${m.default_duration}s` : '—';
  if (m.capability_type === 'image') {
    const parts = [m.default_size, m.default_aspect_ratio].filter(Boolean);
    return parts.length ? parts.join(' · ') : '—';
  }
  return '—';
};

export default function ModelList() {
  const [models, setModels] = useState<AdminModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<ModelType>('image');
  const [form, setForm] = useState<{ id?: string } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');

  const filtered = useMemo(
    () => models.filter((m) => m.capability_type === activeTab).sort((a, b) => a.sort_order - b.sort_order),
    [models, activeTab]
  );

  /** 刷新列表：页面加载 / 操作后 */
  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    fetchAdminModels()
      .then(setModels)
      .catch((e) => setLoadError(isApiError(e) ? e.message : '获取模型列表失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  /** 排序：相邻模型互换 sort_order（两次部分更新 PUT）后刷新 */
  const move = async (id: string, dir: -1 | 1) => {
    const i = filtered.findIndex((m) => m.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= filtered.length) return;
    const a = filtered[i];
    const b = filtered[j];
    setActionError('');
    try {
      await Promise.all([
        updateAdminModel(a.id, { sort_order: b.sort_order }),
        updateAdminModel(b.id, { sort_order: a.sort_order }),
      ]);
      load();
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '排序失败，请稍后重试');
    }
  };

  /** 启停切换：PATCH /:id/toggle，响应完整记录直接合并 */
  const toggle = async (id: string) => {
    setActionError('');
    try {
      const updated = await toggleAdminModel(id);
      setModels((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '启停切换失败，请稍后重试');
    }
  };

  /** 确认删除：DELETE /api/admin/models/:id（软删除），成功后刷新 */
  const confirmDelete = async () => {
    if (deleteId === null || deleting) return;
    setDeleting(true);
    setActionError('');
    try {
      await deleteAdminModel(deleteId);
      setDeleteId(null);
      load();
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  /** 新建/编辑提交：POST / PUT /api/admin/models，成功后刷新列表 */
  const handleSubmit = async (params: Partial<CreateAdminModelParams>, id?: string) => {
    setActionError('');
    if (id !== undefined) {
      await updateAdminModel(id, params);
    } else {
      await createAdminModel(params as CreateAdminModelParams);
    }
    setForm(null);
    load();
  };

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>模型列表</h1>
          <p className={styles.subtitle}>管理前端 dock 展示与后端调用所依赖的模型能力目录（generation_model_capability）</p>
        </div>
        <button className={styles.primaryBtn} onClick={() => setForm({})}>
          <Plus size={16} strokeWidth={2} />
          <span>新建模型</span>
        </button>
      </div>

      {/* 操作错误 */}
      {actionError && <div className={styles.actionError}>{actionError}</div>}

      {/* 类型 tabs */}
      <div className={styles.tabs}>
        {TYPE_TABS.map((t) => (
          <button
            key={t.key}
            className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 模型表格 */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>模型 ID</th>
              <th>供应商</th>
              <th>展示名</th>
              <th>类型</th>
              <th>默认参数</th>
              <th>启用</th>
              <th>排序</th>
              <th>更新时间</th>
              <th className={styles.thRight}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className={styles.tableState}>加载中…</td>
              </tr>
            )}
            {!loading && loadError && (
              <tr>
                <td colSpan={9} className={styles.tableState}>{loadError}</td>
              </tr>
            )}
            {!loading && !loadError && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className={styles.tableState}>暂无模型</td>
              </tr>
            )}
            {filtered.map((m) => (
              <tr key={m.id}>
                <td className={styles.cellMono}>{m.model_id}</td>
                <td>{m.provider_id}</td>
                <td className={styles.cellLabel}>{m.model_label}</td>
                <td className={styles.cellType}>{typeName(m.capability_type)}</td>
                <td>{defaultParams(m)}</td>
                <td>
                  <span className={m.enabled ? styles.badgeOn : styles.badgeOff}>{m.enabled ? '启用' : '停用'}</span>
                </td>
                <td className={styles.cellSort}>{m.sort_order}</td>
                <td className={styles.cellTime}>{fmtTime(m.updated_at)}</td>
                <td>
                  <div className={styles.actionGroup}>
                    <button
                      className={styles.iconBtn}
                      title={m.enabled ? '停用' : '启用'}
                      onClick={() => toggle(m.id)}
                    >
                      <Power size={15} strokeWidth={2} />
                    </button>
                    <button className={styles.iconBtn} title="上移" onClick={() => move(m.id, -1)}>
                      <ChevronUp size={15} strokeWidth={2} />
                    </button>
                    <button className={styles.iconBtn} title="下移" onClick={() => move(m.id, 1)}>
                      <ChevronDown size={15} strokeWidth={2} />
                    </button>
                    <button className={styles.iconBtn} title="编辑" onClick={() => setForm({ id: m.id })}>
                      <Pencil size={15} strokeWidth={2} />
                    </button>
                    <button
                      className={`${styles.iconBtn} ${styles.iconDanger}`}
                      title="删除"
                      onClick={() => setDeleteId(m.id)}
                    >
                      <Trash2 size={15} strokeWidth={2} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 新建/编辑模型弹窗 */}
      {form !== null && (
        <ModelFormModal
          initial={form.id !== undefined ? models.find((m) => m.id === form.id) : undefined}
          models={models}
          defaultType={activeTab}
          onClose={() => setForm(null)}
          onSubmit={handleSubmit}
        />
      )}

      {/* 删除二次确认 */}
      {deleteId !== null && (
        <ConfirmModal
          title="删除模型"
          content={`确定要删除「${models.find((m) => m.id === deleteId)?.model_label ?? ''}」吗？删除后 dock 与消费端不再返回该模型。`}
          confirmText={deleting ? '删除中…' : '确认删除'}
          onConfirm={confirmDelete}
          onClose={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

/* ============ 新建/编辑模型弹窗 ============ */
interface ModelFormModalProps {
  initial?: AdminModel;
  models: AdminModel[];
  defaultType: ModelType;
  onClose: () => void;
  /** 新建传完整入参；编辑传部分更新字段（仅变更项） */
  onSubmit: (params: Partial<CreateAdminModelParams>, id?: string) => Promise<void>;
}

function ModelFormModal({ initial, models, defaultType, onClose, onSubmit }: ModelFormModalProps) {
  const [type, setType] = useState<ModelType>(initial?.capability_type ?? defaultType);
  const [copyFrom, setCopyFrom] = useState('');
  const [providerId, setProviderId] = useState(initial?.provider_id ?? 'volcengine');
  const [modelId, setModelId] = useState(initial?.model_id ?? '');
  const [label, setLabel] = useState(initial?.model_label ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? '');
  const [sizes, setSizes] = useState(initial ? pretty(JSON.stringify(initial.supported_sizes)) : '[]');
  const [ratios, setRatios] = useState(initial ? pretty(JSON.stringify(initial.supported_aspect_ratios)) : '[]');
  const [durations, setDurations] = useState(
    initial?.supported_durations ? pretty(JSON.stringify(initial.supported_durations)) : ''
  );
  const [formats, setFormats] = useState(initial ? pretty(JSON.stringify(initial.supported_formats)) : '[]');
  const [features, setFeatures] = useState(initial ? pretty(JSON.stringify(initial.features)) : '{}');
  const [defaultSize, setDefaultSize] = useState(initial?.default_size ?? '');
  const [defaultRatio, setDefaultRatio] = useState(initial?.default_aspect_ratio ?? '');
  const [defaultFormat, setDefaultFormat] = useState(initial?.default_format ?? '');
  const [defaultDuration, setDefaultDuration] = useState(
    initial?.default_duration != null ? String(initial.default_duration) : ''
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const copyOptions = models.filter((m) => m.capability_type === type);

  /** 复制式新建：整份能力 JSON 与默认参数带过来（前端预填，服务端不感知 copy_source） */
  const handleCopy = (id: string) => {
    setCopyFrom(id);
    const src = models.find((m) => m.id === id);
    if (!src) return;
    setProviderId(src.provider_id);
    setSizes(pretty(JSON.stringify(src.supported_sizes)));
    setRatios(pretty(JSON.stringify(src.supported_aspect_ratios)));
    setDurations(src.supported_durations ? pretty(JSON.stringify(src.supported_durations)) : '');
    setFormats(pretty(JSON.stringify(src.supported_formats)));
    setFeatures(pretty(JSON.stringify(src.features)));
    setDefaultSize(src.default_size ?? '');
    setDefaultRatio(src.default_aspect_ratio ?? '');
    setDefaultFormat(src.default_format ?? '');
    setDefaultDuration(src.default_duration != null ? String(src.default_duration) : '');
  };

  /** 解析 JSON 字段，失败记录错误并返回 null */
  const parseJson = <T,>(raw: string, name: string, fallback: T): T | null => {
    const t = raw.trim();
    if (!t) return fallback;
    try {
      return JSON.parse(t) as T;
    } catch {
      setError(`${name} JSON 解析失败，请检查格式。`);
      return null;
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (!providerId.trim() || !modelId.trim() || !label.trim()) {
      setError('供应商、模型 ID、展示名为必填项。');
      return;
    }
    setError('');
    const sSizes = parseJson<ModelSize[]>(sizes, '尺寸', []);
    const sRatios = parseJson<string[]>(ratios, '比例', []);
    const sDurations = parseJson<number[]>(durations, '时长', []);
    const sFormats = parseJson<string[]>(formats, '格式', []);
    const sFeatures = parseJson<Record<string, unknown>>(features, '特性', {});
    if (sSizes === null || sRatios === null || sDurations === null || sFormats === null || sFeatures === null) return;
    if (!Array.isArray(sSizes) || !Array.isArray(sRatios) || !Array.isArray(sDurations) || !Array.isArray(sFormats)) {
      setError('尺寸/比例/时长/格式须为 JSON 数组。');
      return;
    }
    let dd: number | null = null;
    if (defaultDuration.trim()) {
      dd = parseInt(defaultDuration, 10);
      if (Number.isNaN(dd) || dd < 0) {
        setError('默认时长须为非负整数（秒）。');
        return;
      }
    }

    setSaving(true);
    try {
      if (initial) {
        // 编辑：部分更新，仅提交变更字段（身份字段不可改，不参与提交）
        const changes: Partial<CreateAdminModelParams> = {};
        if (label.trim() !== initial.model_label) changes.model_label = label.trim();
        const iconVal = icon.trim() || null;
        if (iconVal !== (initial.icon ?? null)) changes.icon = iconVal;
        if (JSON.stringify(sSizes) !== JSON.stringify(initial.supported_sizes)) changes.supported_sizes = sSizes;
        if (JSON.stringify(sRatios) !== JSON.stringify(initial.supported_aspect_ratios))
          changes.supported_aspect_ratios = sRatios;
        const durVal = sDurations.length ? sDurations : null;
        if (JSON.stringify(durVal) !== JSON.stringify(initial.supported_durations ?? null))
          changes.supported_durations = durVal;
        if (JSON.stringify(sFormats) !== JSON.stringify(initial.supported_formats)) changes.supported_formats = sFormats;
        if (JSON.stringify(sFeatures) !== JSON.stringify(initial.features)) changes.features = sFeatures;
        const ds = defaultSize.trim() || null;
        if (ds !== (initial.default_size ?? null)) changes.default_size = ds;
        const dr = defaultRatio.trim() || null;
        if (dr !== (initial.default_aspect_ratio ?? null)) changes.default_aspect_ratio = dr;
        const df = defaultFormat.trim() || null;
        if (df !== (initial.default_format ?? null)) changes.default_format = df;
        if (dd !== (initial.default_duration ?? null)) changes.default_duration = dd;
        if (enabled !== initial.enabled) changes.enabled = enabled;
        if (!Object.keys(changes).length) {
          setError('未检测到任何变更。');
          setSaving(false);
          return;
        }
        await onSubmit(changes, initial.id);
      } else {
        // 新建：完整入参
        const params: CreateAdminModelParams = {
          provider_id: providerId.trim(),
          model_id: modelId.trim(),
          capability_type: type,
          model_label: label.trim(),
          ...(icon.trim() ? { icon: icon.trim() } : {}),
          supported_sizes: sSizes,
          supported_aspect_ratios: sRatios,
          supported_durations: sDurations.length ? sDurations : null,
          supported_formats: sFormats,
          ...(defaultSize.trim() ? { default_size: defaultSize.trim() } : {}),
          ...(defaultFormat.trim() ? { default_format: defaultFormat.trim() } : {}),
          ...(defaultRatio.trim() ? { default_aspect_ratio: defaultRatio.trim() } : {}),
          default_duration: dd,
          features: sFeatures,
          enabled,
        };
        await onSubmit(params);
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
                <div className={styles.summaryLabel}>供应商</div>
                <div className={styles.summaryValue}>{initial.provider_id}</div>
              </div>
              <div>
                <div className={styles.summaryLabel}>模型 ID（不可改）</div>
                <div className={`${styles.summaryValue} ${styles.mono}`}>{initial.model_id}</div>
              </div>
            </div>
          )}

          {/* 类型/复制式新建仅新建时展示 */}
          {!initial && (
            <div className={styles.grid2}>
              <div>
                <div className={styles.label}>类型</div>
                <select
                  className={styles.selectNarrow}
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as ModelType);
                    setCopyFrom('');
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
              <div className={styles.label}>供应商 provider_id</div>
              <input
                className={styles.input}
                value={providerId}
                disabled={!!initial}
                onChange={(e) => setProviderId(e.target.value)}
              />
            </div>
            <div>
              <div className={styles.label}>模型 ID model_id</div>
              <input
                className={styles.input}
                placeholder="如 doubao-seedream-4-0-250828"
                value={modelId}
                disabled={!!initial}
                onChange={(e) => setModelId(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.grid2}>
            <div>
              <div className={styles.label}>展示名 model_label</div>
              <input
                className={styles.input}
                placeholder="如 豆包 Seedream 4.0"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
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
          </div>

          <div className={styles.sectionTitle}>能力 JSON 列（原始 JSON 编辑，保存时校验）</div>

          <div className={styles.label}>尺寸 supported_sizes</div>
          <textarea className={styles.textarea} value={sizes} onChange={(e) => setSizes(e.target.value)} />

          <div className={styles.label}>比例 supported_aspect_ratios</div>
          <textarea className={styles.textarea} value={ratios} onChange={(e) => setRatios(e.target.value)} />

          <div className={styles.label}>时长 supported_durations</div>
          <textarea
            className={styles.textarea}
            placeholder="[5,10,30] 或留空"
            value={durations}
            onChange={(e) => setDurations(e.target.value)}
          />

          <div className={styles.label}>格式 supported_formats</div>
          <textarea className={styles.textarea} value={formats} onChange={(e) => setFormats(e.target.value)} />

          <div className={styles.label}>特性 features</div>
          <textarea className={styles.textareaSm} value={features} onChange={(e) => setFeatures(e.target.value)} />

          <div className={styles.grid2}>
            <div>
              <div className={styles.label}>默认尺寸 default_size</div>
              <input
                className={styles.input}
                placeholder="如 2k"
                value={defaultSize}
                onChange={(e) => setDefaultSize(e.target.value)}
              />
            </div>
            <div>
              <div className={styles.label}>默认比例 default_aspect_ratio</div>
              <input
                className={styles.input}
                placeholder="如 1:1"
                value={defaultRatio}
                onChange={(e) => setDefaultRatio(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.grid2}>
            <div>
              <div className={styles.label}>
                默认格式 default_format <span className={styles.labelSub}>（选填）</span>
              </div>
              <input
                className={styles.input}
                placeholder="如 png"
                value={defaultFormat}
                onChange={(e) => setDefaultFormat(e.target.value)}
              />
            </div>
            <div>
              <div className={styles.label}>
                默认时长 default_duration 秒 <span className={styles.labelSub}>（选填）</span>
              </div>
              <input
                className={styles.input}
                placeholder="如 5"
                value={defaultDuration}
                onChange={(e) => setDefaultDuration(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.switchRow}>
            <span className={styles.switchLabel}>启用</span>
            <button className={`${styles.switch} ${enabled ? styles.switchOn : ''}`} onClick={() => setEnabled(!enabled)}>
              <span className={styles.knob} />
            </button>
          </div>

          <p className={styles.hint}>
            复制式新建会把所选模型的能力 JSON 与默认参数整份带过来，改 provider_id / model_id / 展示名即可出新档位；同
            (provider_id, model_id) 不可重复（含已软删）。
          </p>

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
    document.body
  );
}
