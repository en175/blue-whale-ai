/* ============================================
 * OperationLog 操作日志：管理操作审计记录，按类别/时间/关键词查询
 * 数据源 GET /api/admin/operation-logs（时间倒序）
 *
 * 呈现层全部走 @/admin/ui 的组件，**本页没有自己的样式文件**——
 * 这是「统一组件风格」的判据：页面只描述结构，样式一处定义在套件里。
 * ============================================ */
import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { fetchOperationLogs, type OperationLog } from '@/api/admin';
import { isApiError } from '@/api/http';
import { Badge, Button, Empty, Input, Page, PageHeader, Select, Table, Toolbar } from '../../ui';

/** 长 token（模型 ID、无空格的 JSON）允许在列内断行 —— 否则固定列宽下它会撑破单元格 */
const BREAK_ANY = { overflowWrap: 'anywhere' } as const;

/** 类别 code → 展示名（筛选下拉与表格徽章共用） */
const CATEGORY_OPTIONS: { code: string; label: string }[] = [
  { code: 'model.capability', label: '模型列表' },
  { code: 'tier', label: '充值档位' },
  { code: 'order', label: '订单管理' },
  { code: 'user', label: '用户管理' },
  { code: 'template', label: '模板管理' },
];

/** 类别筛选下拉选项（Select 基元收的是 {value,label}） */
const CATEGORY_SELECT_OPTIONS = [
  { value: 'all', label: '全部类别' },
  ...CATEGORY_OPTIONS.map((c) => ({ value: c.code, label: c.label })),
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
    <Page>
      <PageHeader title="操作日志" subtitle="管理操作审计记录，按类别和时间筛选" />

      {/* 筛选行 */}
      <Toolbar>
        <Select options={CATEGORY_SELECT_OPTIONS} value={category} onChange={setCategory} />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span>—</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {/* 搜索框：基元没有「前置图标」位，图标与输入框并排放在同一行内；
            宽度走内联而非私有样式类 —— 本页已无自己的 CSS 文件 */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Search size={16} strokeWidth={2} aria-hidden />
          <Input
            style={{ width: 260 }}
            placeholder="搜索目标/详情/操作人..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Toolbar>

      {/* 日志表格 */}
      <Table fixed>
        {/* ⚠️ **列宽必须显式分配**，否则宽度由内容决定：详情列的文字最长，它会把宽度全抢走，
            目标列被压到 76px、「doubao-seedream-5-0-pro-260628」折成四行（行高因此暴涨），
            最右的列**直接被挤出视口**（外壳是 overflow-x: auto，只在横向滚动后才出现）。
            固定列加起来 ~700px，剩下的留给详情 —— 常见屏宽下不再出现横向滚动。
            「操作人」放最前：看日志先问「谁干的」，它比时间更常是第一眼要找的东西。 */}
        <thead>
          <tr>
            <th style={{ width: 104 }}>操作人</th>
            <th style={{ width: 152 }}>时间</th>
            <th style={{ width: 92 }}>类别</th>
            <th style={{ width: 132 }}>操作</th>
            <th style={{ width: 220 }}>目标</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          {/* 三态统一走 Empty：加载中 / 加载失败（可重试）/ 空数据 */}
          {loading && (
            <tr>
              <td colSpan={6}>
                <Empty message="加载中…" />
              </td>
            </tr>
          )}
          {!loading && loadError && (
            <tr>
              <td colSpan={6}>
                <Empty
                  message={loadError}
                  extra={
                    <Button size="sm" onClick={() => void loadLogs()}>
                      重试
                    </Button>
                  }
                />
              </td>
            </tr>
          )}
          {!loading && !loadError && logs.length === 0 && (
            <tr>
              <td colSpan={6}>
                <Empty message="暂无日志" />
              </td>
            </tr>
          )}
          {!loading &&
            !loadError &&
            logs.map((l) => {
              const detailText = formatDetail(l.detail);
              return (
                <tr key={l.id}>
                  <td>{l.operator}</td>
                  {/* 时间**不许换行**：折成「日期 / 时分秒」两行会让每一行都变高，
                      而它只是定位用的坐标，不该占两行的视觉重量 */}
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(l.createdAt)}</td>
                  <td>
                    <Badge tone="neutral">{categoryLabel(l.category)}</Badge>
                  </td>
                  <td title={l.action}>{actionLabel(l.action)}</td>
                  <td title={l.target} style={BREAK_ANY}>
                    {l.target || '—'}
                  </td>
                  <td title={l.detail} style={BREAK_ANY}>
                    {detailText}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </Table>
    </Page>
  );
}
