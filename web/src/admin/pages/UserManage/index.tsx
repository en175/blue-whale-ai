import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Coins, Lock, LockOpen, Search } from 'lucide-react';
import {
  adminUsersOptions,
  manageAdminUser,
  type AdminUserRow,
  type UserManageAction,
} from '@/admin/api/adminUsers';
import { operationLogsOptions, type OperationLog } from '@/admin/api/adminOperationLogs';
import { isApiError } from '@/shared/api/http';
import { newIdempotencyKey } from '@/shared/api/idempotencyKey';
import { formatLogIp } from '@/admin/formatLogIp';
import { normalizeAdminUserKeyword } from './userSearch';
import AdminQueryTable, {
  type Column,
  type OffsetPaginationState,
} from '../../components/AdminQueryTable';
import { useAppliedFilters, usePagedQuery } from '../../components/AdminQueryTable/useQueryFilters';
import {
  Alert,
  Badge,
  Button,
  Empty,
  Hint,
  Input,
  Modal,
  Select,
  Stat,
  MetaRow,
  Table,
  Tabs,
} from '../../ui';

const PAGE_SIZE = 20;

const fmt = (n: number) => n.toLocaleString('en-US');

const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

const ROLE_LABELS: Record<number, string> = { 1: '普通用户', 10: '管理员', 100: 'Root' };
const roleName = (r: number) => ROLE_LABELS[r] ?? `角色 ${r}`;

const ACTION_LABELS: Record<string, string> = {
  'user.freeze': '冻结',
  'user.unfreeze': '解冻',
  'user.adjust_balance': '调整积分',
};

const parseDetail = (raw: string): { reason?: string; value?: number } => {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '正常' },
  { value: 'disabled', label: '已冻结' },
];

type Filters = { keyword: string; status: string };

const EMPTY_FILTERS: Filters = { keyword: '', status: '' };

const RECHARGE_CALIBER = (
  <Hint label="累计充值的口径" title="累计充值怎么算">
    <div>
      单位是<b>积分</b>，不是元 —— 两者按定价目录里的「1 元 = N 积分」换算。
      拿这一列直接对营收会差一个换算率。
    </div>
    <div>
      <b>只算充值本金</b> —— 用户自己付钱买到的那部分积分。
    </div>
    <div>
      <b>不含充值赠送。</b>赠送是平台另行发放的一批积分（另有来源与有效期）；
      把它折进来，运营拿这个数去核营收就对不上了。
    </div>
    <div>
      它记的是<b>历史上充了多少</b>，不是现在还剩多少 —— 充完又消费掉的照样算在里面。
    </div>
  </Hint>
);

export default function UserManage() {
  const filters = useAppliedFilters(EMPTY_FILTERS);
  const paging = usePagedQuery(filters.epoch);
  const { applied, draft, setDraft, apply, reset } = filters;

  const [detailUser, setDetailUser] = useState<AdminUserRow | null>(null);
  const [adjustUser, setAdjustUser] = useState<AdminUserRow | null>(null);
  const [freezeUser, setFreezeUser] = useState<AdminUserRow | null>(null);

  const query = {
    page: paging.page,
    pageSize: PAGE_SIZE,
    ...(applied.keyword ? { keyword: normalizeAdminUserKeyword(applied.keyword) } : {}),
    ...(applied.status ? { status: applied.status } : {}),
  };
  const list = useQuery(adminUsersOptions(query));

  const doManage = async (
    userId: number,
    params: { action: UserManageAction; reason: string; value?: number; idempotencyKey?: string }
  ) => {
    await manageAdminUser(userId, params);
    setAdjustUser(null);
    setFreezeUser(null);
    void list.refetch();
  };

  const columns: Column<AdminUserRow>[] = [
    { key: 'userId', header: '用户ID', render: (u) => u.userId },
    {
      key: 'nickname',
      header: '昵称',
      render: (u) => (
        <Button variant="ghost" size="sm" onClick={() => setDetailUser(u)}>
          {u.nickname}
        </Button>
      ),
    },
    { key: 'phone', header: '手机号', render: (u) => u.phone || '—' },
    { key: 'balance', header: '余额', render: (u) => fmt(u.balance) },
    {
      key: 'totalRecharge',
      header: (
        <>
          累计充值 {RECHARGE_CALIBER}
        </>
      ),
      render: (u) => fmt(u.totalRecharge),
    },
    { key: 'totalSpend', header: '累计消费', render: (u) => fmt(u.totalSpend) },
    {
      key: 'role',
      header: '角色',
      render: (u) => <Badge tone="neutral">{roleName(u.role)}</Badge>,
    },
    {
      key: 'status',
      header: '状态',
      render: (u) => (
        <Badge tone={u.status === 'active' ? 'success' : 'danger'}>
          {u.status === 'active' ? '正常' : '已冻结'}
        </Badge>
      ),
    },
    { key: 'createdAt', header: '注册时间', render: (u) => fmtTime(u.createdAt) },
    {
      key: 'actions',
      header: '操作',
      render: (u) => (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Button
            size="sm"
            variant="ghost"
            title="发放积分"
            aria-label={`发放积分 ${u.nickname}`}
            icon={<Coins size={15} strokeWidth={2} />}
            onClick={() => setAdjustUser(u)}
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
            onClick={() => setFreezeUser(u)}
          />
        </div>
      ),
    },
  ];

  const pagination: OffsetPaginationState = {
    kind: 'offset',
    page: paging.page,
    pageSize: PAGE_SIZE,
    total: list.data?.total ?? 0,
    prev: paging.prev,
    next: paging.next,
  };

  return (
    <>
      <AdminQueryTable
        title="用户管理"
        subtitle="管理用户积分、查看调整记录与操作日志、冻结/解冻账户"
        hasFilters={filters.hasApplied}
        filteredEmptyMessage="没有匹配的用户"
        emptyMessage="暂无用户"
        errorMessage="获取用户列表失败"
        tableErrorMessage="用户列表加载失败"
        columns={columns}
        rows={list.data?.list ?? []}
        rowKey={(u) => u.userId}
        status={list}
        pagination={pagination}
        filters={
          <>
            {}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Search size={16} strokeWidth={2} aria-hidden />
              <Input
                style={{ width: 240 }}
                placeholder="搜索昵称/手机号/用户ID..."
                value={draft.keyword}
                onChange={(e) => setDraft((d) => ({ ...d, keyword: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') apply();
                }}
              />
            </div>
            <Select
              aria-label="账户状态"
              options={STATUS_OPTIONS}
              value={draft.status}
              onChange={(status) => setDraft((d) => ({ ...d, status }))}
            />
          </>
        }
        actions={
          <>
            <Button size="sm" onClick={reset} disabled={list.isFetching}>
              重置
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Search size={15} strokeWidth={2} />}
              onClick={apply}
              disabled={list.isFetching}
            >
              查询
            </Button>
          </>
        }
      />

      {}
      {detailUser && <UserDetailModal user={detailUser} onClose={() => setDetailUser(null)} />}

      {}
      {adjustUser && (
        <AdjustModal
          user={adjustUser}
          onClose={() => setAdjustUser(null)}
          onConfirm={(params) => doManage(adjustUser.userId, params)}
        />
      )}

      {}
      {freezeUser && (
        <FreezeModal
          user={freezeUser}
          onClose={() => setFreezeUser(null)}
          onConfirm={(params) => doManage(freezeUser.userId, params)}
        />
      )}
    </>
  );
}

const DETAIL_TABS = [
  { key: 'base', label: '基本信息' },
  { key: 'adjust', label: '调整记录' },
  { key: 'log', label: '操作日志' },
] as const;

type DetailTab = (typeof DETAIL_TABS)[number]['key'];

function UserDetailModal({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const [tab, setTab] = useState<DetailTab>('base');
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

  const adjusts = logs.filter((l) => l.action === 'user.adjust_balance');

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

      {}
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
                        {}
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

function AdjustModal({
  user,
  onClose,
  onConfirm,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onConfirm: (params: {
    action: UserManageAction;
    reason: string;
    value?: number;
    idempotencyKey?: string;
  }) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const amountNum = Number(amount);
  const valid =
    Number.isSafeInteger(amountNum) && amountNum > 0 && reason.trim().length > 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      await onConfirm({
        action: 'adjustBalance',
        reason: reason.trim(),
        value: amountNum,
        idempotencyKey,
      });
    } catch (e) {
      setError(isApiError(e) ? e.message : '发放失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="发放积分"
      width={560}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button disabled={!valid || saving} onClick={submit}>
            {saving ? '提交中…' : '确认发放'}
          </Button>
        </>
      }
    >
      {}
      <MetaRow
        items={[
          { label: '用户', value: user.nickname },
          { label: '当前余额', value: `${fmt(user.balance)} 积分` },
        ]}
        tone="sunken"
      />

      {}
      <div style={{ margin: '16px 0 6px' }}>发放积分（正整数）</div>
      <Input
        style={{ width: '100%' }}
        type="number"
        min={1}
        step={1}
        placeholder="请输入积分数量"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <div style={{ margin: '16px 0 6px' }}>发放原因 *</div>
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
      {}
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
