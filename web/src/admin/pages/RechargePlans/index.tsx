/* ============================================
 * RechargePlans 充值档位管理：CRUD/折扣定价/限时上下架/排序/用户端预览
 * ============================================ */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Eye,
  RefreshCw,
  X,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Star,
} from 'lucide-react';
import {
  fetchTopupTiers,
  createTopupTier,
  updateTopupTier,
  deleteTopupTier,
  sortTopupTiers,
  fetchTopupTierPreview,
  syncTopupTiersToGo,
  type TopupTier,
  type TopupTierPreview,
} from '@/api/admin';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import styles from './index.module.css';

/** 档位数据（列表源 GET /api/admin/topup-tiers） */
interface Plan {
  id: string;
  name: string; // 档位名称（可空）
  price: number; // 原价（元），主输入字段
  ratio: number; // 折扣比例 (0-1]，1 = 无折扣
  pay: number; // 实付（元）= 原价 × 折扣，后端权威值
  amount: number; // 到账积分（服务端派生）
  recommended: boolean;
  start: string; // datetime-local 格式（空 = 不限）
  end: string;
  enabled: boolean;
  sort: number; // sortOrder，越小越靠前
}

/** Go 充值配额锚点：原价 × 500000 = quota（网关公式，不动）。本地展示派生：展示积分 = quota / 50000（1 元 = 10 积分，产品确认 2026-08-19） */
const QUOTA_PER_UNIT = 500000;

/** ISO 时间转 datetime-local 输入值（本地时区） */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 接口记录 → 页面 Plan */
function toPlan(t: TopupTier): Plan {
  return {
    id: String(t.id),
    name: t.name ?? '',
    price: t.originalPrice,
    ratio: t.discount,
    pay: t.price,
    amount: t.amount,
    recommended: t.isRecommended,
    start: isoToLocalInput(t.startTime),
    end: isoToLocalInput(t.endTime),
    enabled: t.status === 'active',
    sort: t.sortOrder,
  };
}

const fmtMoney = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const fmtPoints = (n: number) => n.toLocaleString('en-US');
const discountLabel = (ratio: number) => `${parseFloat((ratio * 10).toFixed(2))}折`;

type FilterKey = 'all' | 'on' | 'off';
const filterOptions: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'on', label: '启用' },
  { key: 'off', label: '停用' },
];

export default function RechargePlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [filterOpen, setFilterOpen] = useState(false);
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

  // 页面加载获取全部档位（含停用），按 sortOrder 排序展示
  useEffect(() => {
    fetchTopupTiers()
      .then((list) =>
        setPlans([...list].sort((a, b) => a.sortOrder - b.sortOrder).map(toPlan))
      )
      .catch((e) => setLoadError(isApiError(e) ? e.message : '获取档位列表失败'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => plans.filter((p) => (filter === 'all' ? true : filter === 'on' ? p.enabled : !p.enabled)),
    [plans, filter]
  );

  /** 排序：本地交换后提交全量排序数组，失败回滚 */
  const move = async (id: string, dir: -1 | 1) => {
    if (sorting) return;
    const prev = plans;
    const sorted = [...prev].sort((a, b) => a.sort - b.sort);
    const i = sorted.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    // 全量重编号 1..n，乐观更新
    const next = sorted.map((p, idx) => ({ ...p, sort: idx + 1 }));
    setPlans(next);
    setSorting(true);
    setActionError('');
    try {
      const { warning: warn } = await sortTopupTiers(
        next.map((p) => ({ id: p.id, sortOrder: p.sort }))
      );
      if (warn) setWarning(warn);
    } catch (e) {
      setPlans(prev); // 回滚交换前顺序
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

  /** 新建/编辑提交：POST/PUT /api/admin/topup-tiers，以服务端返回记录更新列表 */
  const handleSubmit = async (data: Omit<Plan, 'id' | 'pay' | 'amount' | 'sort'>, id?: string) => {
    setWarning('');
    if (id !== undefined) {
      // 部分更新：startTime/endTime 传空字符串表示清空原值
      const { data: tier, warning: warn } = await updateTopupTier(id, {
        originalPrice: data.price,
        discount: data.ratio,
        name: data.name,
        isRecommended: data.recommended,
        status: data.enabled ? 'active' : 'inactive',
        startTime: data.start ? new Date(data.start).toISOString() : '',
        endTime: data.end ? new Date(data.end).toISOString() : '',
      });
      setPlans((prev) =>
        prev.map((p) => (p.id === id ? toPlan(tier) : p)).sort((a, b) => a.sort - b.sort)
      );
      if (warn) setWarning(warn);
    } else {
      const { data: tier, warning: warn } = await createTopupTier({
        originalPrice: data.price,
        discount: data.ratio,
        ...(data.name ? { name: data.name } : {}),
        isRecommended: data.recommended,
        status: data.enabled ? 'active' : 'inactive',
        ...(data.start ? { startTime: new Date(data.start).toISOString() } : {}),
        ...(data.end ? { endTime: new Date(data.end).toISOString() } : {}),
      });
      setPlans((prev) => [...prev, toPlan(tier)].sort((a, b) => a.sort - b.sort));
      if (warn) setWarning(warn);
    }
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
      setPlans((prev) => prev.filter((p) => p.id !== deleteId));
      if (warn) setWarning(warn);
      setDeleteId(null);
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>充值档位</h1>
          <p className={styles.subtitle}>管理档位 CRUD、折扣定价、限时上下架与效果预览</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.toolBtn} onClick={handleSync} disabled={syncing}>
            <RefreshCw size={16} strokeWidth={2} />
            <span>{syncing ? '同步中…' : synced && syncMsg ? syncMsg : '同步折扣到 Go'}</span>
          </button>
          <button className={styles.toolBtn} onClick={() => setShowPreview(true)}>
            <Eye size={16} strokeWidth={2} />
            <span>用户端预览</span>
          </button>
          <button className={styles.primaryBtn} onClick={() => setForm({})}>
            <Plus size={16} strokeWidth={2} />
            <span>新建档位</span>
          </button>
        </div>
      </div>

      {/* 包络级警告 / 操作错误 */}
      {warning && <div className={styles.warningBar}>{warning}</div>}
      {actionError && <div className={styles.errorBar}>{actionError}</div>}

      {/* 状态筛选 */}
      <div className={styles.filterWrap}>
        <button className={styles.filterBtn} onClick={() => setFilterOpen(!filterOpen)}>
          <span>{filterOptions.find((f) => f.key === filter)?.label}</span>
          <ChevronDown size={16} strokeWidth={2} />
        </button>
        {filterOpen && (
          <>
            <div className={styles.filterMask} onClick={() => setFilterOpen(false)} />
            <div className={styles.filterMenu}>
              {filterOptions.map((f) => (
                <button
                  key={f.key}
                  className={`${styles.filterOption} ${filter === f.key ? styles.filterOptionActive : ''}`}
                  onClick={() => {
                    setFilter(f.key);
                    setFilterOpen(false);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 档位表格 */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th>积分数</th>
              <th>原价（元）</th>
              <th>折扣</th>
              <th>实付（元）</th>
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
                <td colSpan={11} className={styles.tableState}>加载中…</td>
              </tr>
            )}
            {!loading && loadError && (
              <tr>
                <td colSpan={11} className={styles.tableState}>{loadError}</td>
              </tr>
            )}
            {!loading && !loadError && filtered.length === 0 && (
              <tr>
                <td colSpan={11} className={styles.tableState}>暂无档位</td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr key={p.id}>
                <td className={styles.cellId}>{p.id}</td>
                <td className={styles.cellName}>{p.name || <span className={styles.dash}>—</span>}</td>
                <td className={styles.cellPoints}>{fmtPoints(p.amount)}</td>
                <td>¥{fmtMoney(p.price)}</td>
                <td>
                  {p.ratio < 1 ? (
                    <span className={styles.discount}>{discountLabel(p.ratio)}</span>
                  ) : (
                    <span className={styles.dash}>—</span>
                  )}
                </td>
                <td className={styles.cellPay}>¥{fmtMoney(p.pay)}</td>
                <td>
                  {p.recommended ? <span className={styles.badgeGreen}>推荐</span> : <span className={styles.dash}>—</span>}
                </td>
                <td className={styles.dash}>{p.start || p.end ? '限时' : '永久'}</td>
                <td>
                  <div className={styles.sortGroup}>
                    <button className={styles.iconBtn} title="上移" disabled={sorting} onClick={() => move(p.id, -1)}>
                      <ChevronUp size={15} strokeWidth={2} />
                    </button>
                    <button className={styles.iconBtn} title="下移" disabled={sorting} onClick={() => move(p.id, 1)}>
                      <ChevronDown size={15} strokeWidth={2} />
                    </button>
                  </div>
                </td>
                <td>
                  <span className={p.enabled ? styles.badgeGreen : styles.badgeGray}>
                    {p.enabled ? '启用' : '停用'}
                  </span>
                </td>
                <td>
                  <div className={styles.sortGroup}>
                    <button className={styles.iconBtn} title="编辑" onClick={() => setForm({ id: p.id })}>
                      <Pencil size={15} strokeWidth={2} />
                    </button>
                    <button
                      className={`${styles.iconBtn} ${styles.iconDanger}`}
                      title="删除"
                      onClick={() => setDeleteId(p.id)}
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
    </div>
  );
}

/* ============ 新建/编辑档位弹窗 ============ */
interface PlanFormModalProps {
  initial?: Plan;
  onClose: () => void;
  onSubmit: (data: Omit<Plan, 'id' | 'pay' | 'amount' | 'sort'>, id?: string) => Promise<void>;
}

function PlanFormModal({ initial, onClose, onSubmit }: PlanFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState(initial ? String(initial.price) : '10');
  const [ratio, setRatio] = useState(initial ? String(initial.ratio) : '1');
  const [start, setStart] = useState(initial?.start ?? '');
  const [end, setEnd] = useState(initial?.end ?? '');
  const [recommended, setRecommended] = useState(initial?.recommended ?? false);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const priceNum = parseFloat(price) || 0;
  const ratioNum = parseFloat(ratio) || 0;
  const points = (priceNum * QUOTA_PER_UNIT) / 50_000;
  const pay = priceNum * ratioNum;

  const handleSave = async () => {
    if (saving) return;
    if (priceNum <= 0 || ratioNum <= 0 || ratioNum > 1) return;
    if (!Number.isInteger(priceNum)) {
      setFormError('原价须为正整数');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await onSubmit(
        { name: name.trim(), price: priceNum, ratio: ratioNum, recommended, enabled, start, end },
        initial?.id
      );
    } catch (e) {
      setFormError(isApiError(e) ? e.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>{initial ? '编辑档位' : '新建档位'}</h2>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.formGrid}>
            <div>
              <div className={styles.label}>
                档位名称 <span className={styles.labelSub}>（选填）</span>
              </div>
              <input
                className={styles.input}
                value={name}
                placeholder="选填"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <div className={styles.label}>原价（元）</div>
              <input className={styles.input} value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <div className={styles.label}>
                积分数 <span className={styles.labelSub}>(派生)</span>
              </div>
              <div className={styles.readonlyBox}>{fmtPoints(points)}</div>
            </div>
            <div>
              <div className={styles.label}>折扣比例 (0–1]</div>
              <input className={styles.input} value={ratio} onChange={(e) => setRatio(e.target.value)} />
            </div>
            <div>
              <div className={styles.label}>实付价格</div>
              <div className={styles.payBox}>¥{fmtMoney(pay)}</div>
            </div>
          </div>

          <p className={styles.hint}>
            积分 = 原价 × 500000（只读派生，对应 Go 充值配额 QuotaPerUnit）。实付 = 原价 × 折扣，折扣 = 1 表示无折扣。
          </p>

          <div className={styles.formGrid}>
            <div>
              <div className={styles.label}>
                生效时间 <span className={styles.labelSub}>（选填）</span>
              </div>
              <input
                type="datetime-local"
                className={styles.input}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div>
              <div className={styles.label}>
                失效时间 <span className={styles.labelSub}>（选填）</span>
              </div>
              <input
                type="datetime-local"
                className={styles.input}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          <p className={styles.hint}>设限时范围后，到生效时间自动上架、到失效时间自动下架。留空 = 永久有效。</p>

          <div className={styles.switchRow}>
            <span className={styles.switchLabel}>推荐档位</span>
            <button
              className={`${styles.switch} ${recommended ? styles.switchOn : ''}`}
              onClick={() => setRecommended(!recommended)}
            >
              <span className={styles.knob} />
            </button>
          </div>

          <div className={styles.label}>状态</div>
          <select className={styles.select} value={enabled ? 'on' : 'off'} onChange={(e) => setEnabled(e.target.value === 'on')}>
            <option value="on">启用</option>
            <option value="off">停用</option>
          </select>

          {formError && <div className={styles.formError}>{formError}</div>}
        </div>

        <div className={styles.modalFoot}>
          <button className={styles.cancelBtn} onClick={onClose}>
            取消
          </button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ============ 用户端预览弹窗（GET /api/admin/topup-tiers/preview） ============ */
function PreviewModal({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<TopupTierPreview[] | null>(null);
  const [error, setError] = useState('');

  // 打开时拉取当前已上架且未失效的档位（服务端过滤）
  useEffect(() => {
    fetchTopupTierPreview()
      .then(setList)
      .catch((e) => setError(isApiError(e) ? e.message : '获取预览数据失败'));
  }, []);

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.previewModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>用户端充值页效果预览</h2>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.hint}>以下展示当前已上架且未失效的档位在用户端充值页的真实排列效果。</p>
          {error && <div className={styles.formError}>{error}</div>}
          {!error && list === null && <div className={styles.previewEmpty}>加载中…</div>}
          {!error && list !== null && list.length === 0 && (
            <div className={styles.previewEmpty}>暂无上架档位</div>
          )}
          {!error && list !== null && list.length > 0 && (
            <div className={styles.previewList}>
              {list.map((p) => (
                <div key={p.id} className={`${styles.planCard} ${p.isRecommended ? styles.planCardRec : ''}`}>
                  {p.isRecommended && (
                    <span className={styles.recBadge}>
                      <Star size={12} strokeWidth={2} fill="currentColor" />
                      <span>推荐</span>
                    </span>
                  )}
                  <div className={styles.cardLeft}>
                    <div className={styles.cardPoints}>
                      {fmtPoints(p.amount)} <span className={styles.cardUnit}>积分</span>
                    </div>
                    {p.discount < 1 && <div className={styles.cardDisc}>{discountLabel(p.discount)}优惠</div>}
                  </div>
                  <div className={styles.cardRight}>
                    <div className={styles.cardPriceRow}>
                      <span className={styles.cardPrice}>¥{fmtMoney(p.price)}</span>
                      {p.discount < 1 && <span className={styles.cardOriginal}>¥{fmtMoney(p.originalPrice)}</span>}
                    </div>
                    <button className={styles.cardBtn}>立即充值</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
