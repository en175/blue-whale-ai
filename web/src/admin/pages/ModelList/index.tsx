/* ============================================
 * ModelList 模型列表：dock 模型能力目录管理（generation_model_capability）
 * 数据源 GET/POST/PUT /api/admin/models + PATCH /:id/toggle + PATCH /:id/default
 * ============================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, Power } from 'lucide-react';
import {
  fetchAdminModels,
  createAdminModel,
  updateAdminModel,
  toggleAdminModel,
  setAdminModelDefault,
  deleteAdminModel,
  type AdminModel,
  type CreateAdminModelParams,
} from '@/api/admin';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import ModelFormModal from './ModelFormModal';
import { TYPE_TABS, typeName, type ModelType } from './model-form';
import styles from './index.module.css';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

const defaultParams = (m: AdminModel) => {
  if (m.capability_type === 'video' || m.capability_type === 'audio') {
    const parts = [m.default_format, m.default_duration != null ? `${m.default_duration}s` : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : '—';
  }
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
    [models, activeTab],
  );

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    fetchAdminModels()
      .then(setModels)
      .catch((e) => setLoadError(isApiError(e) ? e.message : '获取模型列表失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

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

  /**
   * 设为该类型的默认模型（IKE0VX）。
   *
   * 同类其它行的标记由服务端在同一事务里清掉，所以这里用返回的**整份列表**覆盖，
   * 不做单行合并——单行合并会让被清掉的那一行在界面上继续显示「默认」。
   */
  const makeDefault = async (id: string) => {
    setActionError('');
    try {
      setModels(await setAdminModelDefault(id));
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '设为默认失败，请稍后重试');
    }
  };

  const toggle = async (id: string) => {
    setActionError('');
    try {
      const updated = await toggleAdminModel(id);
      setModels((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '启停切换失败，请稍后重试');
    }
  };

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

      {actionError && <div className={styles.actionError}>{actionError}</div>}

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

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>模型 ID</th>
              <th>展示名</th>
              <th>类型</th>
              <th>默认参数</th>
              <th>启用</th>
              <th>默认</th>
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
                <td className={styles.cellLabel}>{m.model_label}</td>
                <td className={styles.cellType}>{typeName(m.capability_type)}</td>
                <td>{defaultParams(m)}</td>
                <td>
                  <span className={m.enabled ? styles.badgeOn : styles.badgeOff}>{m.enabled ? '启用' : '停用'}</span>
                </td>
                <td>
                  {m.is_default ? (
                    <span className={styles.badgeDefault}>默认</span>
                  ) : (
                    <button className={styles.linkBtn} onClick={() => makeDefault(m.id)}>
                      设为默认
                    </button>
                  )}
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

      {form !== null && (
        <ModelFormModal
          initial={form.id !== undefined ? models.find((m) => m.id === form.id) : undefined}
          models={models}
          defaultType={activeTab}
          onClose={() => setForm(null)}
          onSubmit={handleSubmit}
        />
      )}

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
