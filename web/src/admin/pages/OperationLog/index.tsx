import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  operationLogsOptions,
  type OperationLog as OperationLogRow,
} from '@/api/adminOperationLogs';
import { isApiError } from '@/api/http';
import { Badge, Button, Empty, Input, Page, PageHeader, Select, Table, Toolbar } from '../../ui';

const BREAK_ANY = { overflowWrap: 'anywhere' } as const;

const CATEGORY_OPTIONS: { code: string; label: string }[] = [
  { code: 'model.capability', label: '模型列表' },
  { code: 'tier', label: '充值档位' },
  { code: 'order', label: '订单管理' },
  { code: 'user', label: '用户管理' },
  { code: 'template', label: '模板管理' },
];

const CATEGORY_SELECT_OPTIONS = [
  { value: 'all', label: '全部类别' },
  ...CATEGORY_OPTIONS.map((c) => ({ value: c.code, label: c.label })),
];

const categoryLabel = (code: string) =>
  CATEGORY_OPTIONS.find((c) => c.code === code)?.label ?? code;

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

const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

const dayToIso = (day: string) => new Date(`${day}T00:00:00`).toISOString();

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
  }
  return detail;
}

export default function OperationLog() {
  const [category, setCategory] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useQuery(
    operationLogsOptions({
      category: category === 'all' ? undefined : category,
      dateFrom: from ? dayToIso(from) : undefined,
      dateTo: to ? dayToIso(to) : undefined,
      searchText: searchDebounced || undefined,
    })
  );
  const logs: OperationLogRow[] = list.data ?? [];
  const loadError = list.isError
    ? isApiError(list.error)
      ? list.error.message
      : '日志加载失败，请稍后重试'
    : '';

  return (
    <Page>
      <PageHeader title="操作日志" subtitle="管理操作审计记录，按类别和时间筛选" />

      {}
      <Toolbar>
        <Select options={CATEGORY_SELECT_OPTIONS} value={category} onChange={setCategory} />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span>—</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {}
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

      {}
      <Table fixed>
        {}
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
          {}
          {list.isPending && (
            <tr>
              <td colSpan={6}>
                <Empty message="加载中…" />
              </td>
            </tr>
          )}
          {!list.isPending && list.isError && (
            <tr>
              <td colSpan={6}>
                <Empty
                  message={loadError}
                  extra={
                    <Button size="sm" onClick={() => void list.refetch()}>
                      重试
                    </Button>
                  }
                />
              </td>
            </tr>
          )}
          {!list.isPending && !list.isError && logs.length === 0 && (
            <tr>
              <td colSpan={6}>
                <Empty message="暂无日志" />
              </td>
            </tr>
          )}
          {!list.isPending &&
            !list.isError &&
            logs.map((l) => {
              const detailText = formatDetail(l.detail);
              return (
                <tr key={l.id}>
                  <td>{l.operator}</td>
                  {}
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
