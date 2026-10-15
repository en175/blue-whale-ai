import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Eye,
  RefreshCw,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import {
  topupTierKeys,
  topupTierPreviewKeys,
  topupTiersOptions,
  createTopupTier,
  updateTopupTier,
  deleteTopupTier,
  sortTopupTiers,
  syncTopupTiersToGo,
  type TopupTier,
  type TopupTierList,
} from '@/admin/api/adminTopupTiers';
import {
  TIER_PERMISSION_LABEL,
  TIER_STATUS_LABEL,
  TIER_STATUS_TONE,
  type TopupTierStatus,
} from '@/admin/enums';
import { isApiError } from '@/shared/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import { Alert, Badge, Button, Empty, Page, PageHeader, Select, Table } from '../../ui';
import PlanFormModal from './PlanFormModal';
import PreviewModal from './PreviewModal';
import {
  discountLabel,
  fmtMoney,
  fmtPoints,
  toPlan,
  type Plan,
  type PlanFormValues,
} from './plan';

const COLUMN_COUNT = 14;

type FilterKey = 'all' | TopupTierStatus;
const filterOptions: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'active', label: '上架' },
  { key: 'inactive', label: '下架' },
];

export default function RechargePlans() {
  const queryClient = useQueryClient();
  const list = useQuery(topupTiersOptions());

  const plans: Plan[] = useMemo(
    () =>
      [...(list.data?.tiers ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map(toPlan),
    [list.data],
  );

  const setTiers = (updater: (prev: TopupTier[]) => TopupTier[]): void => {
    queryClient.setQueryData<TopupTierList>(topupTierKeys.list(), (prev) =>
      prev === undefined ? prev : { ...prev, tiers: updater(prev.tiers) },
    );
  };

  const invalidatePreview = (): void => {
    void queryClient.invalidateQueries({ queryKey: topupTierPreviewKeys.all });
  };

  const applyOrder = (orderById: Map<string, number>): void => {
    setTiers((tiers) =>
      tiers.map((t) => ({ ...t, sortOrder: orderById.get(t.id) ?? t.sortOrder })),
    );
  };

  const [filter, setFilter] = useState<FilterKey>('all');
  const [form, setForm] = useState<{ id?: string } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [synced, setSynced] = useState(false);
  const [warning, setWarning] = useState('');
  const [actionError, setActionError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const loading = list.isPending;
  const loadError = list.isError
    ? isApiError(list.error)
      ? list.error.message
      : '获取档位列表失败'
    : '';

  const filtered = useMemo(
    () => plans.filter((p) => (filter === 'all' ? true : p.status === filter)),
    [plans, filter]
  );

  const move = async (id: string, dir: -1 | 1) => {
    if (sorting) return;
    const prevOrder = new Map(plans.map((p) => [p.id, p.sort]));
    const sorted = [...plans].sort((a, b) => a.sort - b.sort);
    const i = sorted.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    const next = sorted.map((p, idx) => ({ ...p, sort: idx + 1 }));
    applyOrder(new Map(next.map((p) => [p.id, p.sort])));
    setSorting(true);
    setActionError('');
    try {
      const { warning: warn } = await sortTopupTiers(
        next.map((p) => ({ id: p.id, sortOrder: p.sort }))
      );
      invalidatePreview();
      if (warn) setWarning(warn);
    } catch (e) {
      applyOrder(prevOrder);
      setActionError(isApiError(e) ? e.message : '排序失败，请稍后重试');
    } finally {
      setSorting(false);
    }
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setWarning('');
    setActionError('');
    try {
      const { data, warning: warn } = await syncTopupTiersToGo();
      setSyncMsg(`已同步 ${data.synced}/${data.total} 个档位`);
      setSynced(true);
      if (warn) setWarning(warn);
      setTimeout(() => {
        setSynced(false);
        setSyncMsg('');
      }, 3000);
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '同步失败，请稍后重试');
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmit = async (data: PlanFormValues, id?: string) => {
    setWarning('');
    const card = {
      baseCredits: data.baseCredits,
      description: data.description,
      bonusCredits: data.bonusCredits,
      activityTag: data.activityTag,
      buttonText: data.buttonText,
      firstPurchaseEligible: data.firstPurchaseEligible,
      creditsValidMonths: data.creditsValidMonths,
      permission: data.permission,
      permissionAllowlist: data.allowlist,
      permissionDeniedHint: data.deniedHint,
    };
    if (id !== undefined) {
      const { data: tier, warning: warn } = await updateTopupTier(id, {
        originalPrice: data.price,
        discount: data.ratio,
        name: data.name,
        isRecommended: data.recommended,
        status: data.status,
        startTime: data.start ? new Date(data.start).toISOString() : '',
        endTime: data.end ? new Date(data.end).toISOString() : '',
        ...card,
      });
      setTiers((tiers) => tiers.map((t) => (t.id === id ? tier : t)));
      if (warn) setWarning(warn);
    } else {
      const { data: tier, warning: warn } = await createTopupTier({
        originalPrice: data.price,
        discount: data.ratio,
        ...(data.name ? { name: data.name } : {}),
        isRecommended: data.recommended,
        status: data.status,
        ...(data.start ? { startTime: new Date(data.start).toISOString() } : {}),
        ...(data.end ? { endTime: new Date(data.end).toISOString() } : {}),
        ...card,
      });
      setTiers((tiers) => [...tiers, tier]);
      if (warn) setWarning(warn);
    }
    invalidatePreview();
    setForm(null);
  };

  const confirmDelete = async () => {
    if (deleteId === null || deleting) return;
    setDeleting(true);
    setActionError('');
    setWarning('');
    try {
      const { warning: warn } = await deleteTopupTier(deleteId);
      const removed = deleteId;
      setTiers((tiers) => tiers.filter((t) => t.id !== removed));
      invalidatePreview();
      if (warn) setWarning(warn);
      setDeleteId(null);
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Page>
      {}
      <PageHeader
        title="充值档位"
        subtitle="管理档位 CRUD、折扣定价、限时上下架与效果预览"
        extra={
          <>
            <Button
              icon={<RefreshCw size={16} strokeWidth={2} />}
              disabled={syncing}
              onClick={handleSync}
            >
              {syncing ? '同步中…' : synced && syncMsg ? syncMsg : '同步折扣到 Go'}
            </Button>
            <Button
              icon={<Eye size={16} strokeWidth={2} />}
              onClick={() => setShowPreview(true)}
            >
              用户端预览
            </Button>
            <Button variant="primary" icon={<Plus size={16} strokeWidth={2} />} onClick={() => setForm({})}>
              新建档位
            </Button>
          </>
        }
      />

      {}
      {warning && <Alert tone="warning">{warning}</Alert>}
      {actionError && <Alert tone="danger">{actionError}</Alert>}

      {}
      <Select
        options={filterOptions.map((f) => ({ value: f.key, label: f.label }))}
        value={filter}
        onChange={(v) => setFilter(v as FilterKey)}
        aria-label="状态筛选"
      />

      {}
      <Table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>积分数</th>
            <th>赠送积分</th>
            <th>原价（元）</th>
            <th>折扣</th>
            <th>实付（元）</th>
            <th>活动标签</th>
            <th>权限</th>
            <th>推荐</th>
            <th>限时</th>
            <th>排序</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={COLUMN_COUNT}>
                <Empty message="加载中…" />
              </td>
            </tr>
          )}
          {!loading && loadError && (
            <tr>
              <td colSpan={COLUMN_COUNT}>
                <Empty
                  message={loadError}
                  extra={<Button onClick={() => void list.refetch()}>重试</Button>}
                />
              </td>
            </tr>
          )}
          {!loading && !loadError && filtered.length === 0 && (
            <tr>
              <td colSpan={COLUMN_COUNT}>
                <Empty
                  message="暂无档位"
                  extra={
                    <Button variant="primary" onClick={() => setForm({})}>
                      新建档位
                    </Button>
                  }
                />
              </td>
            </tr>
          )}
          {filtered.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.name || '—'}</td>
              <td>{fmtPoints(p.baseCredits)}</td>
              {}
              <td>{p.bonusCredits > 0 ? fmtPoints(p.bonusCredits) : '—'}</td>
              <td>¥{fmtMoney(p.price)}</td>
              <td>
                {p.ratio < 1 ? (
                  <Badge tone="success">{discountLabel(p.ratio)}</Badge>
                ) : (
                  '—'
                )}
              </td>
              <td>¥{fmtMoney(p.pay)}</td>
              <td>{p.activityTag || '—'}</td>
              <td>{TIER_PERMISSION_LABEL[p.permission]}</td>
              <td>{p.recommended ? <Badge tone="success">推荐</Badge> : '—'}</td>
              <td>{p.start || p.end ? '限时' : '永久'}</td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="上移"
                    aria-label="上移"
                    disabled={sorting}
                    icon={<ChevronUp size={15} strokeWidth={2} />}
                    onClick={() => move(p.id, -1)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    title="下移"
                    aria-label="下移"
                    disabled={sorting}
                    icon={<ChevronDown size={15} strokeWidth={2} />}
                    onClick={() => move(p.id, 1)}
                  />
                </div>
              </td>
              <td>
                <Badge tone={TIER_STATUS_TONE[p.status]}>
                  {TIER_STATUS_LABEL[p.status]}
                </Badge>
              </td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="编辑"
                    aria-label="编辑"
                    icon={<Pencil size={15} strokeWidth={2} />}
                    onClick={() => setForm({ id: p.id })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    title="删除"
                    aria-label="删除"
                    icon={<Trash2 size={15} strokeWidth={2} />}
                    onClick={() => setDeleteId(p.id)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {}
      {form !== null && (
        <PlanFormModal
          initial={form.id !== undefined ? plans.find((p) => p.id === form.id) : undefined}
          onClose={() => setForm(null)}
          onSubmit={handleSubmit}
        />
      )}

      {}
      {deleteId !== null && (
        <ConfirmModal
          title="删除档位"
          content={`删除后不可恢复，确定要删除 ID 为 ${deleteId} 的档位吗？`}
          confirmText={deleting ? '删除中…' : '确认删除'}
          onConfirm={confirmDelete}
          onClose={() => setDeleteId(null)}
        />
      )}

      {}
      {showPreview && <PreviewModal onClose={() => setShowPreview(false)} />}
    </Page>
  );
}
