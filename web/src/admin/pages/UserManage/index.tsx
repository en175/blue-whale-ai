/* ============================================
 * UserManage 用户管理：积分调整/冻结解冻/审计日志
 * 数据源 GET /api/admin/users + POST /:userId/manage + GET /api/admin/operation-logs
 *
 * 呈现层全部走 @/admin/ui 的组件，**本页没有自己的样式文件**——
 * 这是「统一组件风格」的判据：页面只描述结构，样式一处定义在套件里。
 * ============================================ */
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Coins, Lock, LockOpen } from 'lucide-react';
import {
  adminUsersOptions,
  manageAdminUser,
  type AdminUserRow,
  type UserManageAction,
} from '@/api/adminUsers';
import { operationLogsOptions, type OperationLog } from '@/api/adminOperationLogs';
import { isApiError } from '@/api/http';
import { formatLogIp } from '@/admin/formatLogIp';
import { matchesAdminUserKeyword } from './userSearch';
import {
  Alert,
  Badge,
  Button,
  Empty,
  Input,
  Modal,
  Page,
  PageHeader,
  Select,
  Stat,
  MetaRow,
  Table,
  Tabs,
  Toolbar,
} from '../../ui';

const fmt = (n: number) => n.toLocaleString('en-US');

/** ISO 时间 → 本地展示 */
const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

/** 角色：1 普通用户 / 10 管理员 / 100 root */
const ROLE_LABELS: Record<number, string> = { 1: '普通用户', 10: '管理员', 100: 'Root' };
const roleName = (r: number) => ROLE_LABELS[r] ?? `角色 ${r}`;

/** 审计日志 action → 展示名 */
const ACTION_LABELS: Record<string, string> = {
  'user.freeze': '冻结',
  'user.unfreeze': '解冻',
  'user.adjust_balance': '调整积分',
};

/** 解析日志 detail JSON 字符串（含 reason 与 value），失败返回空对象 */
const parseDetail = (raw: string): { reason?: string; value?: number } => {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

/** 余额区间选项（本地筛选，单位：积分——管理端展示口径 quota/50000，IK9VZ0 已按积分重标定） */
const RANGE_OPTIONS = [
  { key: 'all', label: '全部余额', min: -Infinity, max: Infinity },
  { key: '0-100', label: '0 — 100', min: 0, max: 100 },
  { key: '100-500', label: '100 — 500', min: 100, max: 500 },
  { key: '500-2000', label: '500 — 2,000', min: 500, max: 2000 },
  { key: '2000-10000', label: '2,000 — 10,000', min: 2000, max: 10000 },
  { key: 'gt10000', label: '> 10,000', min: 10000, max: Infinity },
  { key: 'custom', label: '自定义区间', min: 0, max: 0 },
];

/** 状态筛选下拉选项（Select 基元收的是 {value,label}） */
const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '正常' },
  { value: 'disabled', label: '已冻结' },
];

/** 余额区间下拉选项 */
const RANGE_SELECT_OPTIONS = RANGE_OPTIONS.map((r) => ({ value: r.key, label: r.label }));

export default function UserManage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [rangeKey, setRangeKey] = useState('all');
  const [minVal, setMinVal] = useState('');
  const [maxVal, setMaxVal] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [adjustId, setAdjustId] = useState<number | null>(null);
  const [freezeId, setFreezeId] = useState<number | null>(null);

  /**
   * 页面加载拉取前 100 条；搜索/状态/余额筛选均在本地进行。
   *
   * <p>⚠️ 「只拉前 100 条、其余筛选在本地」这条**口径本次不动**（IKJ058 只换取数方式）——
   * 「第 101 名之后的用户搜不到」是另一件事，要把它下沉成服务端分页，
   * 那是本工单验收第 2 条的内容，不在这一步。
   */
  const list = useQuery(adminUsersOptions({ page: 1, pageSize: 100 }));
  const users: AdminUserRow[] = list.data?.list ?? [];
  const loading = list.isPending;
  const loadError = list.isError
    ? isApiError(list.error)
      ? list.error.message
      : '获取用户列表失败'
    : '';

  const load = useCallback(() => {
    void list.refetch();
  }, [list]);

  const filtered = useMemo(() => {
    const range = RANGE_OPTIONS.find((r) => r.key === rangeKey)!;
    const min = rangeKey === 'custom' ? (minVal.trim() === '' ? -Infinity : parseFloat(minVal)) : range.min;
    const max = rangeKey === 'custom' ? (maxVal.trim() === '' ? Infinity : parseFloat(maxVal)) : range.max;
    return users.filter((u) => {
      if (!matchesAdminUserKeyword(u, search)) return false;
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (u.balance < min || u.balance > max) return false;
      return true;
    });
  }, [users, search, statusFilter, rangeKey, minVal, maxVal]);

  const findUser = (id: number | null) => users.find((u) => u.userId === id);

  /** 用户管理操作：冻结/解冻/调整积分（POST /:userId/manage），成功后关弹窗并刷新列表 */
  const doManage = async (userId: number, params: { action: UserManageAction; reason: string; value?: number }) => {
    await manageAdminUser(userId, params);
    setAdjustId(null);
    setFreezeId(null);
    load();
  };

  return (
    <Page>
      <PageHeader
        title="用户管理"
        subtitle="管理用户积分、查看调整记录与操作日志、冻结/解冻账户"
      />

      {/* 筛选行（本地筛选） */}
      <Toolbar>
        {/* 搜索框：基元没有「前置图标」位，图标与输入框并排放在同一行内；
            宽度走内联而非私有样式类 —— 本页已无自己的 CSS 文件 */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Search size={16} strokeWidth={2} aria-hidden />
          <Input
            style={{ width: 240 }}
            placeholder="搜索昵称/手机号/用户ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
        <Select options={RANGE_SELECT_OPTIONS} value={rangeKey} onChange={setRangeKey} />
      </Toolbar>

      {/* 自定义区间 */}
      {rangeKey === 'custom' && (
        <Toolbar>
          <Input placeholder="最小值" value={minVal} onChange={(e) => setMinVal(e.target.value)} />
          <span>—</span>
          <Input placeholder="最大值" value={maxVal} onChange={(e) => setMaxVal(e.target.value)} />
        </Toolbar>
      )}

      {/* 用户表格 */}
      <Table>
        <thead>
          <tr>
            <th>用户ID</th>
            <th>昵称</th>
            <th>手机号</th>
            <th>余额</th>
            <th>累计充值</th>
            <th>累计消费</th>
            <th>角色</th>
            <th>状态</th>
            <th>注册时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={10}>
                <Empty message="加载中…" />
              </td>
            </tr>
          )}
          {!loading && loadError && (
            <tr>
              <td colSpan={10}>
                <Empty
                  message={loadError}
                  extra={
                    <Button size="sm" onClick={load}>
                      重试
                    </Button>
                  }
                />
              </td>
            </tr>
          )}
          {!loading && !loadError && filtered.length === 0 && (
            <tr>
              <td colSpan={10}>
                <Empty message="暂无用户" />
              </td>
            </tr>
          )}
          {filtered.map((u) => (
            <tr key={u.userId}>
              <td>{u.userId}</td>
              <td>
                <Button variant="ghost" size="sm" onClick={() => setDetailId(u.userId)}>
                  {u.nickname}
                </Button>
              </td>
              <td>{u.phone || '—'}</td>
              <td>{fmt(u.balance)}</td>
              <td>{fmt(u.totalRecharge)}</td>
              <td>{fmt(u.totalSpend)}</td>
              <td>
                <Badge tone="neutral">{roleName(u.role)}</Badge>
              </td>
              <td>
                <Badge tone={u.status === 'active' ? 'success' : 'danger'}>
                  {u.status === 'active' ? '正常' : '已冻结'}
                </Badge>
              </td>
              <td>{fmtTime(u.createdAt)}</td>
              <td>
                {/* 行内操作：图标按钮并排（Button 基元已含尺寸/悬停态，不用私有样式） */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="调整积分"
                    aria-label={`调整积分 ${u.nickname}`}
                    icon={<Coins size={15} strokeWidth={2} />}
                    onClick={() => setAdjustId(u.userId)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    title={u.status === 'active' ? '冻结账户' : '解冻账户'}
                    aria-label={`${u.status === 'active' ? '冻结' : '解冻'}账户 ${u.nickname}`}
                    icon={
                      u.status === 'active' ? (
                        <Lock size={15} strokeWidth={2} />
                      ) : (
                        <LockOpen size={15} strokeWidth={2} />
                      )
                    }
                    onClick={() => setFreezeId(u.userId)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {/* 用户详情（审计日志：调整记录 + 操作日志） */}
      {detailId !== null && findUser(detailId) && (
        <UserDetailModal user={findUser(detailId)!} onClose={() => setDetailId(null)} />
      )}

      {/* 调整积分 */}
      {adjustId !== null && findUser(adjustId) && (
        <AdjustModal
          user={findUser(adjustId)!}
          onClose={() => setAdjustId(null)}
          onConfirm={(params) => doManage(adjustId, params)}
        />
      )}

      {/* 冻结/解冻 */}
      {freezeId !== null && findUser(freezeId) && (
        <FreezeModal
          user={findUser(freezeId)!}
          onClose={() => setFreezeId(null)}
          onConfirm={(params) => doManage(freezeId, params)}
        />
      )}
    </Page>
  );
}

/* ============ 用户详情弹窗 ============ */
const DETAIL_TABS = [
  { key: 'base', label: '基本信息' },
  { key: 'adjust', label: '调整记录' },
  { key: 'log', label: '操作日志' },
] as const;

type DetailTab = (typeof DETAIL_TABS)[number]['key'];

function UserDetailModal({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const [tab, setTab] = useState<DetailTab>('base');
  // 按类别 + 用户 ID 拉审计日志，走 Query（IKJ058）—— 参数整份进 key，
  // 所以换一个用户就是另一份数据，不会命中上一个人的缓存。
  const logsQuery = useQuery(
    operationLogsOptions({ category: 'user', searchText: `user:${user.userId}` }),
  );
  const logs: OperationLog[] = logsQuery.data ?? [];
  const logsLoading = logsQuery.isPending;
  const logsError = logsQuery.isError
    ? isApiError(logsQuery.error)
      ? logsQuery.error.message
      : '获取日志失败'
    : '';

  /** 调整记录 tab：仅 adjust_balance */
  const adjusts = logs.filter((l) => l.action === 'user.adjust_balance');

  /** 三态统一走 Empty：加载中 / 加载失败（可重试）/ 空数据；有数据时不渲染任何状态行 */
  const logRows = (isEmpty: boolean, emptyMessage: string) => (
    <>
      {logsLoading && (
        <tr>
          <td colSpan={5}>
            <Empty message="加载中…" />
          </td>
        </tr>
      )}
      {!logsLoading && logsError && (
        <tr>
          <td colSpan={5}>
            <Empty
              message={logsError}
              extra={
                <Button size="sm" onClick={() => void logsQuery.refetch()}>
                  重试
                </Button>
              }
            />
          </td>
        </tr>
      )}
      {!logsLoading && !logsError && isEmpty && (
        <tr>
          <td colSpan={5}>
            <Empty message={emptyMessage} />
          </td>
        </tr>
      )}
    </>
  );

  return (
    <Modal open title="用户详情" width={960} onClose={onClose}>
      <Tabs items={DETAIL_TABS} value={tab} onChange={(k) => setTab(k as DetailTab)} />

      {/* 页签与内容之间的一次性间距（基元不自带外边距） */}
      <div style={{ marginTop: 20 }}>
        {tab === 'base' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 12,
            }}
          >
            <Stat label="用户ID" value={user.userId} />
            <Stat label="昵称" value={user.nickname} />
            <Stat label="手机号" value={user.phone || '—'} />
            <Stat label="角色" value={roleName(user.role)} />
            <Stat label="余额" value={`${fmt(user.balance)} 积分`} />
            <Stat
              label="状态"
              value={
                <Badge tone={user.status === 'active' ? 'success' : 'danger'}>
                  {user.status === 'active' ? '正常' : '已冻结'}
                </Badge>
              }
            />
            <Stat label="注册时间" value={fmtTime(user.createdAt)} />
            <Stat label="累计充值 / 消费" value={`${fmt(user.totalRecharge)} / ${fmt(user.totalSpend)}`} />
            <Stat label="最后更新时间" value={fmtTime(user.updatedAt)} />
          </div>
        )}

        {tab === 'adjust' && (
          <Table>
            <thead>
              <tr>
                <th>时间</th>
                <th>金额</th>
                <th>原因</th>
                <th>操作人</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logRows(adjusts.length === 0, '暂无调整记录')}
              {!logsLoading &&
                !logsError &&
                adjusts.map((l) => {
                  const d = parseDetail(l.detail);
                  const v = d.value ?? 0;
                  return (
                    <tr key={l.id}>
                      <td>{fmtTime(l.createdAt)}</td>
                      <td>
                        {/* 正负用 Badge 的 success/danger 表达，不用私有颜色类 */}
                        <Badge tone={v >= 0 ? 'success' : 'danger'}>
                          {v >= 0 ? `+${fmt(v)}` : fmt(v)}
                        </Badge>
                      </td>
                      <td>{d.reason ?? '—'}</td>
                      <td>{l.operator}</td>
                      <td>{formatLogIp(l.ipAddress)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </Table>
        )}

        {tab === 'log' && (
          <Table>
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>原因</th>
                <th>操作人</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logRows(logs.length === 0, '暂无操作日志')}
              {!logsLoading &&
                !logsError &&
                logs.map((l) => {
                  const d = parseDetail(l.detail);
                  return (
                    <tr key={l.id}>
                      <td>{fmtTime(l.createdAt)}</td>
                      <td>{ACTION_LABELS[l.action] ?? l.action}</td>
                      <td>{d.reason ?? '—'}</td>
                      <td>{l.operator}</td>
                      <td>{formatLogIp(l.ipAddress)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </Table>
        )}
      </div>
    </Modal>
  );
}

/* ============ 调整积分弹窗 ============ */
function AdjustModal({
  user,
  onClose,
  onConfirm,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onConfirm: (params: { action: UserManageAction; reason: string; value?: number }) => Promise<void>;
}) {
  const [amount, setAmount] = useState('0');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const amountNum = parseFloat(amount);
  const valid = !Number.isNaN(amountNum) && amountNum !== 0 && reason.trim().length > 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      await onConfirm({ action: 'adjustBalance', reason: reason.trim(), value: amountNum });
    } catch (e) {
      setError(isApiError(e) ? e.message : '调整失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="调整积分"
      width={560}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="danger" disabled={!valid || saving} onClick={submit}>
            {saving ? '提交中…' : '确认调整'}
          </Button>
        </>
      }
    >
      {/* 账号摘要：只读状态，用 MetaRow 而不是蓝色色块 */}
      <MetaRow
        items={[
          { label: '用户', value: user.nickname },
          { label: '当前余额', value: `${fmt(user.balance)} 积分` },
        ]}
        tone="sunken"
      />

      {/* 表单标签只用一次性外边距，字号/颜色交给套件默认值 */}
      <div style={{ margin: '16px 0 6px' }}>调整金额（正数增加，负数扣减）</div>
      <Input
        style={{ width: '100%' }}
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <div style={{ margin: '16px 0 6px' }}>调整原因 *</div>
      <Input
        style={{ width: '100%' }}
        placeholder="请输入原因（必填）"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Modal>
  );
}

/* ============ 冻结/解冻弹窗 ============ */
function FreezeModal({
  user,
  onClose,
  onConfirm,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onConfirm: (params: { action: UserManageAction; reason: string; value?: number }) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const freezing = user.status === 'active';
  const valid = reason.trim().length > 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      await onConfirm({ action: freezing ? 'freeze' : 'unfreeze', reason: reason.trim() });
    } catch (e) {
      setError(isApiError(e) ? e.message : '操作失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={freezing ? '冻结用户账户' : '解冻用户账户'}
      width={560}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant={freezing ? 'danger' : 'primary'}
            disabled={!valid || saving}
            onClick={submit}
          >
            {saving ? '提交中…' : `确认${freezing ? '冻结' : '解冻'}`}
          </Button>
        </>
      }
    >
      {/* 后果说明：冻结=warning（有副作用）、解冻=success（恢复能力） */}
      <Alert tone={freezing ? 'warning' : 'success'}>
        {freezing ? (
          <>
            即将冻结 <b>{user.nickname}</b>（{user.userId}）的积分账户。冻结后该用户将无法充值和消费。
          </>
        ) : (
          <>
            即将解冻 <b>{user.nickname}</b>（{user.userId}）的积分账户。解冻后该用户将恢复充值和消费能力。
          </>
        )}
      </Alert>

      <div style={{ margin: '16px 0 6px' }}>{freezing ? '冻结' : '解冻'}原因 *</div>
      <Input
        style={{ width: '100%' }}
        placeholder={`请输入${freezing ? '冻结' : '解冻'}原因（必填）`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Modal>
  );
}
