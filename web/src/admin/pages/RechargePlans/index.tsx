/* ============================================
 * RechargePlans 充值档位管理：CRUD/折扣定价/限时上下架/排序/用户端预览
 *
 * 呈现层全部走 @/admin/ui 的组件，**本页没有自己的样式文件**（原 index.module.css 已删）——
 * 这是「统一组件风格」的判据：页面只描述结构，样式一处定义在套件里。
 *
 * 两个弹窗各自独立成文件（PlanFormModal / PreviewModal），数据映射与文案在 plan.ts：
 * 本文件撞过 max-lines 上限，拆的是**版面**，不是把规则挪走。
 *
 * 取数走 TanStack Query（IKJ058）。⚠️ 这一页与另两页不同：它展示的是 `toPlan()` 映射过的
 * **`Plan[]` 视图**，而缓存里存的是**原始 `{tiers}`** —— 两者没有反向映射。所以每一处写操作
 * 都要把「服务端返回的原始记录」写回缓存（见 `setTiers`），而不是像旧代码那样在视图空间里改。
 * 这样做是为了**保住乐观更新**：上下移点下去要立刻动。
 * ============================================ */
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
  type TopupTierStatus,
} from '@/api/adminTopupTiers';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import { Alert, Badge, Button, Empty, Page, PageHeader, Select, Table } from '../../ui';
import PlanFormModal from './PlanFormModal';
import PreviewModal from './PreviewModal';
import {
  TIER_PERMISSION_LABEL,
  TIER_STATUS_LABEL,
  TIER_STATUS_TONE,
  discountLabel,
  fmtMoney,
  fmtPoints,
  toPlan,
  type Plan,
  type PlanFormValues,
} from './plan';

/** 表格列数（含 ID 与操作列）。加载/空态那一行要跨满，所以只在这里数一次。 */
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

  /** 刷新全部档位（含停用），按 sortOrder 排序展示。 */
  const plans: Plan[] = useMemo(
    () =>
      [...(list.data?.tiers ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map(toPlan),
    [list.data],
  );

  /**
   * 把原始档位记录写回缓存。
   *
   * <p>⚠️ 页面用 `Plan[]`、缓存存原始 `TopupTier[]`，**两者没有反向映射** ——
   * 所以每一处写操作都拿**原始记录**来更新（服务端返回的那条，或本地改好 `sortOrder` 的那份），
   * 而不是像旧代码那样在视图空间里替换。
   */
  const setTiers = (updater: (prev: TopupTier[]) => TopupTier[]): void => {
    queryClient.setQueryData<TopupTierList>(topupTierKeys.list(), (prev) =>
      prev === undefined ? prev : { ...prev, tiers: updater(prev.tiers) },
    );
  };

  /**
   * 档位改完之后让**用户端预览**那一份也失效。
   *
   * <p>⚠️ 预览是**另一个 key**（`topupTierPreviewKeys`），而全站 `staleTime` 是 30s ——
   * 不显式失效的话，运营改完上架/改价后点「用户端预览」，看到的会是**改动前**的档位，
   * 且界面上没有任何地方提示它是旧的。改前每次打开都无条件重拉，所以这是 Query 化
   * 带进来的新风险，必须在这里堵住。
   */
  const invalidatePreview = (): void => {
    void queryClient.invalidateQueries({ queryKey: topupTierPreviewKeys.all });
  };

  /** 按 `id → sortOrder` 覆盖顺序（乐观写与失败回滚共用）。 */
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
  const [warning, setWarning] = useState(''); // 包络级警告（Go 折扣同步失败等）
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

  /** 排序：本地交换后提交全量排序数组，失败回滚 */
  const move = async (id: string, dir: -1 | 1) => {
    if (sorting) return;
    const prevOrder = new Map(plans.map((p) => [p.id, p.sort]));
    const sorted = [...plans].sort((a, b) => a.sort - b.sort);
    const i = sorted.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    // 全量重编号 1..n，乐观更新
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
      applyOrder(prevOrder); // 回滚交换前顺序
      setActionError(isApiError(e) ? e.message : '排序失败，请稍后重试');
    } finally {
      setSorting(false);
    }
  };

  /** 全量同步折扣到 Go：PUT /api/admin/topup-tiers/sync */
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

  /** 新建/编辑提交：POST/PUT /api/admin/topup-tiers，以服务端返回记录更新缓存 */
  const handleSubmit = async (data: PlanFormValues, id?: string) => {
    setWarning('');
    // ⚠️ 实付价格**仍不在参数里**（它由服务端 `原价 × 折扣` 派生，收下它就等于允许
    //    「原价 100、实付 1」这种自相矛盾的档位）。
    //    但**基础积分现在在**：它是配置值，运营填的就是用户到账的（见 PlanFormModal 文件头）。
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
      // 部分更新：startTime/endTime 传空字符串表示清空原值
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

  /** 确认删除：DELETE /api/admin/topup-tiers/:id（逻辑删除） */
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
      {/* 页头 */}
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

      {/* 包络级警告（Go 折扣同步失败等）用 warning 调子；操作错误用 danger */}
      {warning && <Alert tone="warning">{warning}</Alert>}
      {actionError && <Alert tone="danger">{actionError}</Alert>}

      {/* 状态筛选 */}
      <Select
        options={filterOptions.map((f) => ({ value: f.key, label: f.label }))}
        value={filter}
        onChange={(v) => setFilter(v as FilterKey)}
        aria-label="状态筛选"
      />

      {/* 档位表格 */}
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
              {/* 赠送积分是首购加赠的额度，不是到账积分：独立一列，不与上一列相加展示 */}
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

      {/* 新建/编辑弹窗 */}
      {form !== null && (
        <PlanFormModal
          initial={form.id !== undefined ? plans.find((p) => p.id === form.id) : undefined}
          onClose={() => setForm(null)}
          onSubmit={handleSubmit}
        />
      )}

      {/* 删除二次确认 */}
      {deleteId !== null && (
        <ConfirmModal
          title="删除档位"
          content={`删除后不可恢复，确定要删除 ID 为 ${deleteId} 的档位吗？`}
          confirmText={deleting ? '删除中…' : '确认删除'}
          onConfirm={confirmDelete}
          onClose={() => setDeleteId(null)}
        />
      )}

      {/* 用户端预览弹窗 */}
      {showPreview && <PreviewModal onClose={() => setShowPreview(false)} />}
    </Page>
  );
}
