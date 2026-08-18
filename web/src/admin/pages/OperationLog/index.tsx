/* ============================================
 * OperationLog 操作日志：管理操作审计记录，按类别/时间/关键词查询
 * 数据源 GET /api/admin/operation-logs（时间倒序）
 * ============================================ */
import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { fetchOperationLogs, type OperationLog } from '@/api/admin';
import { isApiError } from '@/api/http';
import styles from './index.module.css';

/** 类别 code → 展示名（筛选下拉与表格徽章共用） */
const CATEGORY_OPTIONS: { code: string; label: string }[] = [
  { code: 'model.capability', label: '模型列表' },
  { code: 'tier', label: '充值档位' },
  { code: 'order', label: '订单管理' },
  { code: 'user', label: '用户管理' },
  { code: 'template', label: '模板管理' },
];

const categoryLabel = (code: string) =>
  CATEGORY_OPTIONS.find((c) => c.code === code)?.label ?? code;

/** 已知 action → 中文展示名，未匹配原样展示 */
const ACTION_LABEL: Record<string, string> = {
  'model.capability.create': '新建模型',
  'model.capability.update': '编辑模型',
  'model.capability.delete': '删除模型',
  'model.capability.toggle': '启停模型',
  'model.capability.reorder': '模型调序',
  'tier.create': '新建档位',
  'tier.update': '编辑档位',
  'tier.delete': '删除档位',
  'tier.sort': '档位排序',
  'tier.sync': '档位同步',
  'order.complete': '手动补单',
  'user.freeze': '冻结用户',
  'user.unfreeze': '解冻用户',
  'user.adjust_balance': '调整积分',
  'template.create': '新建模板',
  'template.update': '编辑模板',
  'template.delete': '删除模板',
  'template.move': '模板调序',
  'template.tag.update': '标签改名',
};

const actionLabel = (action: string) => ACTION_LABEL[action] ?? action;

/** ISO 时间 → 本地展示 */
const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

/** 日期（yyyy-mm-dd）→ 当天零点 ISO */
const dayToIso = (day: string) => new Date(`${day}T00:00:00`).toISOString();

/** detail JSON 字符串 → 可读摘要，解析失败原样展示 */
function formatDetail(detail: string): string {
  if (!detail) return '—';
  try {
    const obj = JSON.parse(detail);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const parts = Object.entries(obj).map(([k, v]) =>
        `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`
      );
      if (parts.length) return parts.join('；');
    }
  } catch {
    /* 非 JSON 原样展示 */
  }
  return detail;
}

export default function OperationLog() {
  const [category, setCategory] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  /** 搜索输入 300ms 防抖，避免每次按键都请求 */
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  /** 拉取日志（筛选变化时重新请求，服务端时间倒序） */
  const loadLogs = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const list = await fetchOperationLogs({
        category: category === 'all' ? undefined : category,
        dateFrom: from ? dayToIso(from) : undefined,
        dateTo: to ? dayToIso(to) : undefined,
        searchText: searchDebounced || undefined,
      });
      setLogs(list);
    } catch (e) {
      setLoadError(isApiError(e) ? e.message : '日志加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [category, from, to, searchDebounced]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>操作日志</h1>
          <p className={styles.subtitle}>管理操作审计记录，按类别和时间筛选</p>
        </div>
      </div>

      {/* 筛选行 */}
      <div className={styles.filterRow}>
        <select className={styles.select} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">全部类别</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <input type="date" className={styles.dateInput} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className={styles.rangeDash}>—</span>
        <input type="date" className={styles.dateInput} value={to} onChange={(e) => setTo(e.target.value)} />
        <div className={styles.searchWrap}>
          <Search size={16} strokeWidth={2} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="搜索目标/详情/操作人..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* 日志表格 */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>时间</th>
              <th>类别</th>
              <th>操作</th>
              <th>目标</th>
              <th>详情</th>
              <th className={styles.thRight}>操作人</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className={styles.tableState}>
                  加载中…
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td colSpan={6} className={styles.tableState}>
                  {loadError}{' '}
                  <button className={styles.retryLink} onClick={() => void loadLogs()}>
                    重试
                  </button>
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.tableState}>
                  暂无日志
                </td>
              </tr>
            ) : (
              logs.map((l) => {
                const detailText = formatDetail(l.detail);
                return (
                  <tr key={l.id}>
                    <td className={styles.cellTime}>{fmtTime(l.createdAt)}</td>
                    <td>
                      <span className={styles.catBadge}>{categoryLabel(l.category)}</span>
                    </td>
                    <td className={styles.cellAction} title={l.action}>
                      {actionLabel(l.action)}
                    </td>
                    <td className={styles.cellTarget} title={l.target}>
                      {l.target || '—'}
                    </td>
                    <td className={styles.cellDetail} title={l.detail}>
                      {detailText}
                    </td>
                    <td className={styles.cellOperator}>{l.operator}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
