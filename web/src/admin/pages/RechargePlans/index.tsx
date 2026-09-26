/* ============================================
 * RechargePlans 充值档位管理：CRUD/折扣定价/限时上下架/排序/用户端预览
 *
 * 呈现层全部走 @/admin/ui 的组件，**本页没有自己的样式文件**（原 index.module.css 已删）——
 * 这是「统一组件风格」的判据：页面只描述结构，样式一处定义在套件里。
 * ============================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Eye,
  RefreshCw,
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
import { toast } from 'sonner';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import { tierFormError } from './tierForm';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Modal,
  Page,
  PageHeader,
  Select,
  Stat,
  Table,
  Hint,
  formGrid,
} from '../../ui';

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
  const [form, setForm] = useState<{ id?: string } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [synced, setSynced] = useState(false);
  const [warning, setWarning] = useState(''); // 包络级警告（Go 折扣同步失败等）
  const [actionError, setActionError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  /**
   * 当前生效的换算率（1 元 = 多少积分），随档位列表一起从服务端回来。
   *
   * ⚠️ **表单的积分预览用它算**，不要在本地写死倍数：换算是运行时配置
   * （住在 billing 的定价目录里，运营随时可改），前端猜不出来。
   * 曾经这里写死「×10」，而列表走服务端按真实换算率派生 —— 同一页两个数。
   */
  const [creditsPerYuan, setCreditsPerYuan] = useState(0);
  const [syncMsg, setSyncMsg] = useState('');

  /** 刷新全部档位（含停用），按 sortOrder 排序展示；页面加载与加载失败重试都走它 */
  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    fetchTopupTiers()
      .then((data) => {
        // 换算率随列表一起回来 —— 表单的积分预览必须用它（见 creditsPerYuan 状态的注释）
        setCreditsPerYuan(data.creditsPerYuan);
        setPlans([...data.tiers].sort((a, b) => a.sortOrder - b.sortOrder).map(toPlan));
      })
      .catch((e) => setLoadError(isApiError(e) ? e.message : '获取档位列表失败'))
      .finally(() => setLoading(false));
  }, []);

  // 页面加载获取全部档位
  useEffect(() => load(), [load]);

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
              <td colSpan={11}>
                <Empty message="加载中…" />
              </td>
            </tr>
          )}
          {!loading && loadError && (
            <tr>
              <td colSpan={11}>
                <Empty message={loadError} extra={<Button onClick={load}>重试</Button>} />
              </td>
            </tr>
          )}
          {!loading && !loadError && filtered.length === 0 && (
            <tr>
              <td colSpan={11}>
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
              <td>{fmtPoints(p.amount)}</td>
              <td>¥{fmtMoney(p.price)}</td>
              <td>
                {p.ratio < 1 ? (
                  <Badge tone="success">{discountLabel(p.ratio)}</Badge>
                ) : (
                  '—'
                )}
              </td>
              <td>¥{fmtMoney(p.pay)}</td>
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
                <Badge tone={p.enabled ? 'success' : 'neutral'}>
                  {p.enabled ? '启用' : '停用'}
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
          creditsPerYuan={creditsPerYuan}
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

/* ============ 新建/编辑档位弹窗 ============ */
interface PlanFormModalProps {
  initial?: Plan;
  /** 当前生效的换算率（1 元 = 多少积分），由列表接口带回。积分预览用它算。 */
  creditsPerYuan: number;
  onClose: () => void;
  onSubmit: (data: Omit<Plan, 'id' | 'pay' | 'amount' | 'sort'>, id?: string) => Promise<void>;
}

function PlanFormModal({ initial, creditsPerYuan, onClose, onSubmit }: PlanFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState(initial ? String(initial.price) : '10');
  const [ratio, setRatio] = useState(initial ? String(initial.ratio) : '1');
  const [start, setStart] = useState(initial?.start ?? '');
  const [end, setEnd] = useState(initial?.end ?? '');
  const [recommended, setRecommended] = useState(initial?.recommended ?? false);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);

  const priceNum = parseFloat(price) || 0;
  const ratioNum = parseFloat(ratio) || 0;
  // 到账积分 = 原价 × **当前生效的换算率**（与后端 deriveCredits 同一条公式、同一个数）。
  // ⚠️ 这里以前写死 `× 500000 / 50000`（= ×10），而列表里的 amount 走服务端按真实换算率派生 ——
  //    换算是运行时配置，两边一旦不同就是同页两个数（2026-09-26 实测：本地库是 15）。
  const points = Math.round(priceNum * creditsPerYuan);
  const pay = priceNum * ratioNum;

  const handleSave = async () => {
    if (saving) return;
    const err = tierFormError(priceNum, ratioNum);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(
        { name: name.trim(), price: priceNum, ratio: ratioNum, recommended, enabled, start, end },
        initial?.id
      );
    } catch (e) {
      if (!isApiError(e)) toast.error('保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={initial ? '编辑档位' : '新建档位'}
      width={680}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      {/* 字段标签是「一行说明 + 控件」，套件暂无对应基元，这里只用一次性间距排布 */}
      <div style={formGrid(2)}>
        <div>
          <div style={{ marginBottom: 6 }}>档位名称 （选填）</div>
          <Input
            value={name}
            placeholder="选填"
            aria-label="档位名称"
            onChange={(e) => setName(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>原价（元）</div>
          <Input
            value={price}
            aria-label="原价（元）"
            onChange={(e) => setPrice(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>
            积分数 (派生){' '}
            <Hint>
              <div>
                积分 = 原价 × 当前换算率（1 元 = {creditsPerYuan} 积分，在「系统设置 → 计费」里改）。
              </div>
              <div>实付 = 原价 × 折扣；折扣 = 1 表示无折扣。</div>
            </Hint>
          </div>
          {/* 派生值只读展示：用 readOnly Input 而不是自绘灰框，样式仍由套件定义 */}
          <Input
            readOnly
            value={fmtPoints(points)}
            aria-label="积分数"
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>折扣比例 (0–1]</div>
          <Input
            value={ratio}
            aria-label="折扣比例"
            onChange={(e) => setRatio(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>实付价格</div>
          <Input
            readOnly
            value={`¥${fmtMoney(pay)}`}
            aria-label="实付价格"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div
        style={{ ...formGrid(2), marginTop: 16 }}
      >
        <div>
          <div style={{ marginBottom: 6 }}>
            生效时间 （选填）{' '}
            <Hint>设限时范围后，到生效时间自动上架、到失效时间自动下架。留空 = 永久有效。</Hint>
          </div>
          <Input
            type="datetime-local"
            value={start}
            aria-label="生效时间"
            onChange={(e) => setStart(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>失效时间 （选填）</div>
          <Input
            type="datetime-local"
            value={end}
            aria-label="失效时间"
            onChange={(e) => setEnd(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* 推荐档位：原来的自绘开关在套件里没有对应基元，改用勾选框（语义相同：一个布尔量） */}
      <div style={{ marginTop: 16 }}>
        <Checkbox checked={recommended} onChange={setRecommended} label="推荐档位" />
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 6 }}>状态</div>
        <Select
          options={[
            { value: 'on', label: '启用' },
            { value: 'off', label: '停用' },
          ]}
          value={enabled ? 'on' : 'off'}
          onChange={(v) => setEnabled(v === 'on')}
          aria-label="状态"
        />
      </div>
    </Modal>
  );
}

/* ============ 用户端预览弹窗（GET /api/admin/topup-tiers/preview） ============ */
function PreviewModal({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<TopupTierPreview[] | null>(null);
  const [error, setError] = useState('');

  /** 拉取当前已上架且未失效的档位（服务端过滤）；加载失败可重试 */
  const load = useCallback(() => {
    setError('');
    setList(null);
    fetchTopupTierPreview()
      .then(setList)
      .catch((e) => setError(isApiError(e) ? e.message : '获取预览数据失败'));
  }, []);

  // 打开时拉取
  useEffect(() => load(), [load]);

  return (
    <Modal
      open
      width={720}
      onClose={onClose}
      title={
        <>
          用户端充值页效果预览{' '}
          <Hint>以下展示当前已上架且未失效的档位在用户端充值页的真实排列效果。</Hint>
        </>
      }
    >
      {error && (
        <div style={{ marginTop: 12 }}>
          <Empty message={error} extra={<Button onClick={load}>重试</Button>} />
        </div>
      )}
      {!error && list === null && <Empty message="加载中…" />}
      {!error && list !== null && list.length === 0 && <Empty message="暂无上架档位" />}
      {!error && list !== null && list.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {list.map((p) => (
            <Card
              key={p.id}
              extra={
                p.isRecommended ? (
                  <Badge tone="accent">
                    <Star size={12} strokeWidth={2} fill="currentColor" />
                    推荐
                  </Badge>
                ) : undefined
              }
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Stat
                    label="积分"
                    value={fmtPoints(p.amount)}
                    hint={p.discount < 1 ? `${discountLabel(p.discount)}优惠` : undefined}
                  />
                  <Stat
                    label="实付"
                    value={`¥${fmtMoney(p.price)}`}
                    hint={p.discount < 1 ? `¥${fmtMoney(p.originalPrice)}` : undefined}
                  />
                </div>
                <Button variant="primary">立即充值</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Modal>
  );
}
