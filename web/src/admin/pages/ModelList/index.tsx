import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, Power } from 'lucide-react';
import {
  adminModelKeys,
  adminModelsOptions,
  createAdminModel,
  updateAdminModel,
  toggleAdminModel,
  setAdminModelDefault,
  deleteAdminModel,
  type AdminModel,
  type CreateAdminModelParams,
} from '@/api/adminModels';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import ModelFormModal from './ModelFormModal';
import { TYPE_TABS, typeName, type ModelType } from './model-form';
import { Alert, Badge, Button, Empty, Input, Page, PageHeader, Table, Tabs } from '../../ui';

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
  const queryClient = useQueryClient();
  const list = useQuery(adminModelsOptions());
  const models: AdminModel[] = useMemo(() => list.data ?? [], [list.data]);
  const writeModels = (
    next: AdminModel[] | ((prev: AdminModel[]) => AdminModel[]),
  ): void => {
    queryClient.setQueryData(adminModelKeys.list(), (prev: AdminModel[] | undefined) =>
      typeof next === 'function' ? next(prev ?? []) : next,
    );
  };

  const [activeTab, setActiveTab] = useState<ModelType>('image');
  const [form, setForm] = useState<{ id?: string } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [sortDrafts, setSortDrafts] = useState<Record<string, string>>({});

  const filtered = useMemo(
    () => models.filter((m) => m.capability_type === activeTab).sort((a, b) => a.sort_order - b.sort_order),
    [models, activeTab],
  );

  const loading = list.isPending;
  const loadError = list.isError
    ? isApiError(list.error)
      ? list.error.message
      : '获取模型列表失败'
    : '';

  const move = async (id: string, dir: -1 | 1) => {
    const i = filtered.findIndex((m) => m.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= filtered.length) return;
    const a = filtered[i];
    const b = filtered[j];
    setActionError('');
    if (a.sort_order === b.sort_order) {
      setActionError(`「${a.model_label}」与「${b.model_label}」的排序号相同（${a.sort_order}），上下移不会生效——请直接改「排序」列的数值。`);
      return;
    }
    try {
      await Promise.all([
        updateAdminModel(a.id, { sort_order: b.sort_order }),
        updateAdminModel(b.id, { sort_order: a.sort_order }),
      ]);
      void list.refetch();
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '排序失败，请稍后重试');
    }
  };

  const commitSort = async (id: string) => {
    const draft = sortDrafts[id];
    if (draft === undefined) return;
    const value = Number(draft.trim());
    const current = models.find((m) => m.id === id);
    if (!draft.trim() || !Number.isInteger(value) || value < 0) {
      setActionError('排序号须为非负整数。');
      setSortDrafts((prev) => ({ ...prev, [id]: current ? String(current.sort_order) : '' }));
      return;
    }
    if (current && current.sort_order === value) {
      setSortDrafts((prev) => ({ ...prev, [id]: String(value) }));
      return;
    }
    setActionError('');
    try {
      await updateAdminModel(id, { sort_order: value });
      setSortDrafts((prev) => ({ ...prev, [id]: String(value) }));
      void list.refetch();
    } catch (e) {
      setSortDrafts((prev) => ({ ...prev, [id]: current ? String(current.sort_order) : '' }));
      setActionError(isApiError(e) ? e.message : '排序号更新失败，请稍后重试');
    }
  };

  const makeDefault = async (id: string) => {
    setActionError('');
    try {
      writeModels(await setAdminModelDefault(id));
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '设为默认失败，请稍后重试');
    }
  };

  const toggle = async (id: string) => {
    setActionError('');
    try {
      const updated = await toggleAdminModel(id);
      writeModels((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
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
      void list.refetch();
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
    void list.refetch();
  };

  return (
    <Page>
      <PageHeader
        title="模型列表"
        subtitle="管理前端 dock 展示与后端调用所依赖的模型能力目录（generation_model_capability）"
        extra={
          <Button
            variant="primary"
            icon={<Plus size={16} strokeWidth={2} />}
            onClick={() => setForm({})}
          >
            新建模型
          </Button>
        }
      />

      {actionError && <Alert tone="danger">{actionError}</Alert>}

      <Tabs items={TYPE_TABS} value={activeTab} onChange={(key) => setActiveTab(key as ModelType)} />

      <Table>
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
            <th style={{ textAlign: 'right' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={9}>
                <Empty message="加载中…" />
              </td>
            </tr>
          )}
          {!loading && loadError && (
            <tr>
              <td colSpan={9}>
                <Empty
                  message={loadError}
                  extra={<Button onClick={() => void list.refetch()}>重试</Button>}
                />
              </td>
            </tr>
          )}
          {!loading && !loadError && filtered.length === 0 && (
            <tr>
              <td colSpan={9}>
                <Empty message="暂无模型" />
              </td>
            </tr>
          )}
          {filtered.map((m) => (
            <tr key={m.id}>
              <td>{m.model_id}</td>
              <td>{m.model_label}</td>
              <td>
                <Badge tone="accent">{typeName(m.capability_type)}</Badge>
              </td>
              <td>{defaultParams(m)}</td>
              <td>
                <Badge tone={m.enabled ? 'success' : 'neutral'}>{m.enabled ? '启用' : '停用'}</Badge>
              </td>
              <td>
                {m.is_default ? (
                  <span title="显式默认模型（同类只设一个）。后端「只设不清」：要取消本行的默认，把同类型另一行设为默认即可。">
                    <Badge tone="accent">默认</Badge>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="设为该类型的默认模型。后端只设不清——没有「取消默认」这个动作，把另一行设为默认就等于换过去。"
                    onClick={() => makeDefault(m.id)}
                  >
                    设为默认
                  </Button>
                )}
              </td>
              <td>
                <Input
                  type="number"
                  min={0}
                  value={sortDrafts[m.id] ?? String(m.sort_order)}
                  onChange={(e) => setSortDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))}
                  onBlur={() => commitSort(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                  title="排序号（同类内越小越靠前）。两行相同会让上下移失效，直接改这里的数值即可。"
                  style={{ width: 72 }}
                />
              </td>
              <td>{fmtTime(m.updated_at)}</td>
              <td>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    justifyContent: 'flex-end',
                    width: '100%',
                  }}
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    title={m.enabled ? '停用' : '启用'}
                    icon={<Power size={15} strokeWidth={2} />}
                    onClick={() => toggle(m.id)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    title="上移"
                    icon={<ChevronUp size={15} strokeWidth={2} />}
                    onClick={() => move(m.id, -1)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    title="下移"
                    icon={<ChevronDown size={15} strokeWidth={2} />}
                    onClick={() => move(m.id, 1)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    title="编辑"
                    icon={<Pencil size={15} strokeWidth={2} />}
                    onClick={() => setForm({ id: m.id })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    title="删除"
                    icon={<Trash2 size={15} strokeWidth={2} />}
                    onClick={() => setDeleteId(m.id)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

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
    </Page>
  );
}
