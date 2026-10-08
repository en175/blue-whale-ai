import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import type { KeyValueRow } from '../../lib/billing-catalog/catalogDraft';
import type { RowPlan } from '../../lib/billing-catalog/rowPlan';
import { Alert, Badge, Button, Input } from '../../ui';

interface SpecRowsProps<T extends KeyValueRow> {
  plan: RowPlan<T>;
  derived: boolean;
  ariaPrefix: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  fallbackNotice: string;
  hintOf?: (row: T) => string;
  makeRow: () => T;
  onRows: (rows: T[]) => void;
}

export default function SpecRows<T extends KeyValueRow>({
  plan,
  derived,
  ariaPrefix,
  keyPlaceholder,
  valuePlaceholder,
  fallbackNotice,
  hintOf,
  makeRow,
  onRows,
}: SpecRowsProps<T>) {
  if (!derived) {
    return (
      <>
        <Alert tone="warning">{fallbackNotice}</Alert>
        <KeyValueEditor
          rows={plan.rows}
          ariaPrefix={ariaPrefix}
          keyPlaceholder={keyPlaceholder}
          valuePlaceholder={valuePlaceholder}
          makeRow={makeRow}
          onChange={onRows}
        />
      </>
    );
  }

  const all = [...plan.rows, ...plan.orphans];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {all.map((row, index) => {
        const orphan = index >= plan.rows.length;
        const hint = hintOf === undefined ? '' : hintOf(row);
        return (
          <div key={`${row.key}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <code style={{ fontSize: 'var(--admin-font-xs)' }}>{row.key}</code>
              {orphan && (
                <span style={{ marginLeft: 8 }}>
                  {}
                  <Badge tone="warning">模型配置里没有这一档</Badge>
                </span>
              )}
              {hint && <div style={{ fontSize: 'var(--admin-font-xs)', }}>{hint}</div>}
            </div>
            <Input
              aria-label={`${ariaPrefix}值`}
              placeholder={valuePlaceholder}
              value={row.value}
              onChange={(e) =>
                onRows(all.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))
              }
              style={{ width: 120 }}
            />
            {orphan ? (
              <Button
                size="sm"
                variant="ghost"
                title="删掉这一行"
                aria-label={`删掉${ariaPrefix}第 ${index + 1} 行`}
                icon={<Trash2 size={15} strokeWidth={2} />}
                onClick={() => onRows(all.filter((_, i) => i !== index))}
              />
            ) : (
              <span style={{ width: 30 }} />
            )}
          </div>
        );
      })}
      {plan.orphans.length > 0 && (
        <div style={{ fontSize: 'var(--admin-font-xs)', }}>
          <AlertTriangle size={13} strokeWidth={2} /> 标黄的行在<b>模型配置</b>里没有对应档位
          —— 用户根本选不到它。要么在模型配置里补上，要么在这里删掉。
        </div>
      )}
      {all.length === 0 && (
        <div style={{ fontSize: 'var(--admin-font-xs)', }}>
          这个模型的能力行里没有档位可派生（尺寸/比例都没配）—— 请先在模型配置里补。
        </div>
      )}
      <div style={{ fontSize: 'var(--admin-font-xs)', }}>
        本表的行来自<b>模型配置</b>（尺寸表的唯一来源），这里只填值、不提供手工加行。
      </div>
    </div>
  );
}

export function KeyValueEditor<T extends KeyValueRow>({
  rows,
  onChange,
  ariaPrefix,
  keyPlaceholder,
  valuePlaceholder,
  makeRow,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  ariaPrefix: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  makeRow: () => T;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row, index) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Input
            aria-label={`${ariaPrefix}键`}
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(e) =>
              onChange(rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)))
            }
            style={{ flex: 1 }}
          />
          <Input
            aria-label={`${ariaPrefix}值`}
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(e) =>
              onChange(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))
            }
            style={{ width: 120 }}
          />
          <Button
            size="sm"
            variant="ghost"
            title="删掉这一行"
            aria-label={`删掉${ariaPrefix}第 ${index + 1} 行`}
            icon={<Trash2 size={15} strokeWidth={2} />}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <div>
        <Button
          size="sm"
          icon={<Plus size={15} strokeWidth={2} />}
          aria-label={`给${ariaPrefix}添加一行`}
          onClick={() => onChange([...rows, makeRow()])}
        >
          添加一行
        </Button>
      </div>
    </div>
  );
}
