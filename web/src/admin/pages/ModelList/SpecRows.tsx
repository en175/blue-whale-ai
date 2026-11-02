import { Plus, Trash2 } from 'lucide-react';
import type { KeyValueRow } from '../../utils/billing-catalog/catalogDraft';
import { Button, Input } from '../../ui';

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
