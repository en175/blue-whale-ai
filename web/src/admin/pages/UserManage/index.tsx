/* ============================================
 * UserManage 用户管理：积分调整/冻结解冻/审计日志
 * 数据源 GET /api/admin/users + POST /:userId/manage + GET /api/admin/operation-logs
 * ============================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Coins, Lock, LockOpen } from 'lucide-react';
import {
  fetchAdminUsers,
  manageAdminUser,
  fetchOperationLogs,
  type AdminUserRow,
  type OperationLog,
  type UserManageAction,
} from '@/api/admin';
import { isApiError } from '@/api/http';
import { formatLogIp } from '@/admin/formatLogIp';
import { matchesAdminUserKeyword } from './userSearch';
import styles from './index.module.css';

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

export default function UserManage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [rangeKey, setRangeKey] = useState('all');
  const [minVal, setMinVal] = useState('');
  const [maxVal, setMaxVal] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [adjustId, setAdjustId] = useState<number | null>(null);
  const [freezeId, setFreezeId] = useState<number | null>(null);

  /** 页面加载拉取前 100 条；搜索/状态/余额筛选均在本地进行 */
  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    fetchAdminUsers({ page: 1, pageSize: 100 })
      .then((d) => setUsers(d.list))
      .catch((e) => setLoadError(isApiError(e) ? e.message : '获取用户列表失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

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
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>用户管理</h1>
          <p className={styles.subtitle}>管理用户积分、查看调整记录与操作日志、冻结/解冻账户</p>
        </div>
      </div>

      {/* 筛选行（本地筛选） */}
      <div className={styles.filterRow}>
        <div className={styles.searchWrap}>
          <Search size={16} strokeWidth={2} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="搜索昵称/手机号/用户ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">全部状态</option>
          <option value="active">正常</option>
          <option value="disabled">已冻结</option>
        </select>
        <select className={styles.select} value={rangeKey} onChange={(e) => setRangeKey(e.target.value)}>
          {RANGE_OPTIONS.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {/* 自定义区间 */}
      {rangeKey === 'custom' && (
        <div className={styles.rangeBlock}>
          <input className={styles.input} placeholder="最小值" value={minVal} onChange={(e) => setMinVal(e.target.value)} />
          <span className={styles.rangeDash}>—</span>
          <input className={styles.input} placeholder="最大值" value={maxVal} onChange={(e) => setMaxVal(e.target.value)} />
        </div>
      )}

      {/* 用户表格 */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
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
              <th className={styles.thRight}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className={styles.tableState}>加载中…</td>
              </tr>
            )}
            {!loading && loadError && (
              <tr>
                <td colSpan={10} className={styles.tableState}>{loadError}</td>
              </tr>
            )}
            {!loading && !loadError && filtered.length === 0 && (
              <tr>
                <td colSpan={10} className={styles.tableState}>暂无用户</td>
              </tr>
            )}
            {filtered.map((u) => (
              <tr key={u.userId}>
                <td className={styles.cellId}>{u.userId}</td>
                <td>
                  <button className={styles.nickLink} onClick={() => setDetailId(u.userId)}>
                    {u.nickname}
                  </button>
                </td>
                <td>{u.phone || <span className={styles.dash}>—</span>}</td>
                <td className={styles.cellNum}>{fmt(u.balance)}</td>
                <td>{fmt(u.totalRecharge)}</td>
                <td>{fmt(u.totalSpend)}</td>
                <td>
                  <span className={styles.badgeRole}>{roleName(u.role)}</span>
                </td>
                <td>
                  <span className={u.status === 'active' ? styles.badgeOn : styles.badgeOff}>
                    {u.status === 'active' ? '正常' : '已冻结'}
                  </span>
                </td>
                <td className={styles.cellTime}>{fmtTime(u.createdAt)}</td>
                <td>
                  <div className={styles.actionGroup}>
                    <button className={styles.iconBtn} title="调整积分" onClick={() => setAdjustId(u.userId)}>
                      <Coins size={15} strokeWidth={2} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      title={u.status === 'active' ? '冻结账户' : '解冻账户'}
                      onClick={() => setFreezeId(u.userId)}
                    >
                      {u.status === 'active' ? <Lock size={15} strokeWidth={2} /> : <LockOpen size={15} strokeWidth={2} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
    </div>
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
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState('');

  // 打开时按类别 + 用户ID 拉取审计日志
  useEffect(() => {
    setLogsLoading(true);
    setLogsError('');
    fetchOperationLogs({ category: 'user', searchText: `user:${user.userId}` })
      .then(setLogs)
      .catch((e) => setLogsError(isApiError(e) ? e.message : '获取日志失败'))
      .finally(() => setLogsLoading(false));
  }, [user.userId]);

  /** 调整记录 tab：仅 adjust_balance */
  const adjusts = logs.filter((l) => l.action === 'user.adjust_balance');

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modalWide} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>用户详情</h2>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.tabs}>
            {DETAIL_TABS.map((t) => (
              <button
                key={t.key}
                className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'base' && (
            <div className={styles.infoGrid}>
              <div>
                <div className={styles.infoLabel}>用户ID</div>
                <div className={styles.infoValue}>{user.userId}</div>
              </div>
              <div>
                <div className={styles.infoLabel}>昵称</div>
                <div className={styles.infoValue}>{user.nickname}</div>
              </div>
              <div>
                <div className={styles.infoLabel}>手机号</div>
                <div className={styles.infoValue}>{user.phone || '—'}</div>
              </div>
              <div>
                <div className={styles.infoLabel}>角色</div>
                <div className={styles.infoValue}>{roleName(user.role)}</div>
              </div>
              <div>
                <div className={styles.infoLabel}>余额</div>
                <div className={styles.infoValue}>{fmt(user.balance)} 积分</div>
              </div>
              <div>
                <div className={styles.infoLabel}>状态</div>
                <span className={user.status === 'active' ? styles.badgeOn : styles.badgeOff}>
                  {user.status === 'active' ? '正常' : '已冻结'}
                </span>
              </div>
              <div>
                <div className={styles.infoLabel}>注册时间</div>
                <div className={styles.infoValue}>{fmtTime(user.createdAt)}</div>
              </div>
              <div>
                <div className={styles.infoLabel}>累计充值 / 消费</div>
                <div className={styles.infoValue}>
                  {fmt(user.totalRecharge)} / {fmt(user.totalSpend)}
                </div>
              </div>
              <div>
                <div className={styles.infoLabel}>最后更新时间</div>
                <div className={styles.infoValue}>{fmtTime(user.updatedAt)}</div>
              </div>
            </div>
          )}

          {tab === 'adjust' && (
            <div className={styles.tabBody}>
              <div className={styles.subTableWrap}>
                <table className={styles.subTable}>
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
                    {logsLoading && (
                      <tr>
                        <td colSpan={5} className={styles.emptyCell}>加载中…</td>
                      </tr>
                    )}
                    {!logsLoading && logsError && (
                      <tr>
                        <td colSpan={5} className={styles.emptyCell}>{logsError}</td>
                      </tr>
                    )}
                    {!logsLoading && !logsError && adjusts.length === 0 && (
                      <tr>
                        <td colSpan={5} className={styles.emptyCell}>暂无调整记录</td>
                      </tr>
                    )}
                    {adjusts.map((l) => {
                      const d = parseDetail(l.detail);
                      const v = d.value ?? 0;
                      return (
                        <tr key={l.id}>
                          <td className={styles.cellTime}>{fmtTime(l.createdAt)}</td>
                          <td className={v >= 0 ? styles.cellPos : styles.cellNeg}>
                            {v >= 0 ? `+${fmt(v)}` : fmt(v)}
                          </td>
                          <td>{d.reason ?? '—'}</td>
                          <td>{l.operator}</td>
                          <td className={styles.mono}>{formatLogIp(l.ipAddress)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'log' && (
            <div className={styles.tabBody}>
              <div className={styles.subTableWrap}>
                <table className={styles.subTable}>
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
                    {logsLoading && (
                      <tr>
                        <td colSpan={5} className={styles.emptyCell}>加载中…</td>
                      </tr>
                    )}
                    {!logsLoading && logsError && (
                      <tr>
                        <td colSpan={5} className={styles.emptyCell}>{logsError}</td>
                      </tr>
                    )}
                    {!logsLoading && !logsError && logs.length === 0 && (
                      <tr>
                        <td colSpan={5} className={styles.emptyCell}>暂无操作日志</td>
                      </tr>
                    )}
                    {logs.map((l) => {
                      const d = parseDetail(l.detail);
                      return (
                        <tr key={l.id}>
                          <td className={styles.cellTime}>{fmtTime(l.createdAt)}</td>
                          <td>{ACTION_LABELS[l.action] ?? l.action}</td>
                          <td>{d.reason ?? '—'}</td>
                          <td>{l.operator}</td>
                          <td className={styles.mono}>{formatLogIp(l.ipAddress)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
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

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>调整积分</h2>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.summaryBox}>
            <span className={styles.summaryText}>
              用户：<b>{user.nickname}</b>
            </span>
            <span className={styles.summarySub}>
              当前余额：<b className={styles.mono}>{fmt(user.balance)}</b> 积分
            </span>
          </div>
          <div className={styles.label}>调整金额（正数增加，负数扣减）</div>
          <input className={styles.input} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className={styles.label}>
            调整原因 <span className={styles.required}>*</span>
          </div>
          <input
            className={styles.input}
            placeholder="请输入原因（必填）"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && <div className={styles.formError}>{error}</div>}
        </div>
        <div className={styles.modalFoot}>
          <button className={styles.cancelBtn} onClick={onClose}>
            取消
          </button>
          <button className={styles.confirmRed} disabled={!valid || saving} onClick={submit}>
            {saving ? '提交中…' : '确认调整'}
          </button>
        </div>
      </div>
    </div>,
    document.body
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

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>{freezing ? '冻结用户账户' : '解冻用户账户'}</h2>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <div className={freezing ? styles.warnBox : styles.okBox}>
            {freezing ? (
              <>
                即将冻结 <b>{user.nickname}</b>（{user.userId}）的积分账户。冻结后该用户将无法充值和消费。
              </>
            ) : (
              <>
                即将解冻 <b>{user.nickname}</b>（{user.userId}）的积分账户。解冻后该用户将恢复充值和消费能力。
              </>
            )}
          </div>
          <div className={styles.label}>{freezing ? '冻结' : '解冻'}原因 *</div>
          <input
            className={styles.input}
            placeholder={`请输入${freezing ? '冻结' : '解冻'}原因（必填）`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && <div className={styles.formError}>{error}</div>}
        </div>
        <div className={styles.modalFoot}>
          <button className={styles.cancelBtn} onClick={onClose}>
            取消
          </button>
          <button
            className={freezing ? styles.confirmAmber : styles.confirmGreen}
            disabled={!valid || saving}
            onClick={submit}
          >
            {saving ? '提交中…' : `确认${freezing ? '冻结' : '解冻'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
