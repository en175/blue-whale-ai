/* ============================================
 * 规格表编辑器（价格表 / token 尺寸表 / 输出像素表共用）
 *
 * 从 `ModelBilling/RuleEditorModal.tsx` 搬过来（那一页已删除，定价编辑收进模型列表）：
 * 两张表（价格表 + 尺寸表）与新的输出像素表用的是同一套「候选键 + 只填值」的形态，
 * 所以只有这一处定义。
 *
 * ── 两种形态，由 `derived` 决定 ──────────────────────────────────────────────
 *
 * - `derived`（候选集派生得出来）：**键是只读文本**，只编辑值。候选集以外、目录里
 *   却已有的行作为**孤儿**显出来（那是两份配置漂了的证据），孤儿可以删 —— 但**不能新增**：
 *   要加档位去模型配置加（用户口径：尺寸表在模型配置里，不该在定价页再录一遍）。
 * - 非 `derived`（读不到能力行 / 档位没配）：退回自由键值编辑，并说明原因 ——
 *   锁住界面比让人填错更坏，但**不替它猜**一份档位清单。
 * ============================================ */
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import type { KeyValueRow } from '../../lib/billing-catalog/catalogDraft';
import type { RowPlan } from '../../lib/billing-catalog/rowPlan';
import { Alert, Badge, Button, Input } from '../../ui';

interface SpecRowsProps<T extends KeyValueRow> {
  plan: RowPlan<T>;
  /** 候选集是否派生得出来；`false` = 退回自由键值编辑 */
  derived: boolean;
  ariaPrefix: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  /** 非派生模式下的说明（说清「为什么现在只能手工填键」） */
  fallbackNotice: string;
  /** 派生模式下每一行下面的小字（如「模型配置：2048x2048（419 万像素）」）；返回空串则不显示 */
  hintOf?: (row: T) => string;
  /** 自由编辑时「添加一行」要造的行（价格表得多带 `originalMc`，见 `MoneyField`） */
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
                  {/* ⚠️ 不静默丢掉：静默删掉等于在一次「只改单价」的保存里顺手改了别的档位 */}
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
              // 占位，让候选行的输入框与孤儿行左对齐
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

/* ============ 自由键值对编辑器（dims / 倍率 / 最低 token 用量表，以及候选集派生不出来时的规格表） ============
 *
 * 泛型是为了价格表：它每行还要多带一个 `originalMc`（未改动时原值写回，见 `MoneyField`），
 * 而 dims / 倍率不需要。`makeRow` 让「添加一行」知道该造哪种行。
 */
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
  /** 造一行空行 —— 必须由调用方给：价格表要多带 originalMc */
  makeRow: () => T;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row, index) => (
        // 行没有稳定 id（键就是内容本身，可以改），所以按序号做 key ——
        // 这不是可排序列表，序号在编辑过程中是稳定的
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
          // ⚠️ 一页上有好几组键值表（价格表 / 尺寸表 / 附加维度 / 整单倍率），
          //    每组的「添加一行」长得一模一样 —— 不带 aria-label 时读屏与自动化都分不出点的是哪一组
          aria-label={`给${ariaPrefix}添加一行`}
          onClick={() => onChange([...rows, makeRow()])}
        >
          添加一行
        </Button>
      </div>
    </div>
  );
}
