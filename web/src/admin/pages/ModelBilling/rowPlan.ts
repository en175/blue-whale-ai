/* ============================================
 * 一张规格表的**渲染计划**：候选集排好的行 + 目录里多出来的「孤儿」行
 *
 * 从 `catalogDraft.ts` 拆出来（那个文件已顶到 `max-lines` 上限）：这里处理的是
 * **「模型配置派生的候选键」与「目录里已有的行」怎么对上**，与「目录怎么解析 / 怎么换算」
 * 是两件事，各自能单测。
 *
 * ⚠️ 数据来源：候选键派生自能力行（`sizeCandidates.ts`，模型配置是尺寸表的唯一来源）。
 *    所以这里的键**不可手改**，运营只填**数**（宽高 / 单价）。
 * ============================================ */
import type { KeyValueRow, PriceRow } from './catalogDraft';

/**
 * 一张规格表的渲染计划。
 *
 * <p>**孤儿行必须显出来，不能静默丢掉**：目录里有、能力行里没有的档位，就是两份配置已经
 * 漂了。悄悄删掉等于在保存里顺手改了别人的配置；留着并标出来，运营才看得见并且能决定。
 */
export interface RowPlan<T extends KeyValueRow> {
  /** 候选集里应有的行（按候选顺序）；目录里已有同键行的值**原样带过来** */
  rows: T[];
  /** 目录里有、候选集里没有的行（能力行没声明这个档位） */
  orphans: T[];
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * 目录里已有的行 → 渲染计划。
 *
 * @param candidates 候选规格键；`null` = 派生不出来（读不到能力行 / 轴不在能力行里），
 *        调用方据此**退回自由编辑**（{@link RowPlan.orphans} 恒为空）。
 */
export function planRows<T extends KeyValueRow>(
  existing: T[],
  candidates: string[] | null,
  makeRow: (key: string) => T,
): RowPlan<T> {
  if (candidates === null) return { rows: existing, orphans: [] };
  const byKey = new Map<string, T>();
  for (const row of existing) {
    const key = normalizeKey(row.key);
    if (key && !byKey.has(key)) byKey.set(key, row);
  }
  const used = new Set<string>();
  const rows = candidates.map((key) => {
    const found = byKey.get(normalizeKey(key));
    if (found === undefined) return makeRow(key);
    used.add(normalizeKey(found.key));
    return found;
  });
  // 键为空的行走不到这里（派生模式下不再有自由键），非空但不在候选集里的就是孤儿
  const orphans = existing.filter((row) => {
    const key = normalizeKey(row.key);
    return key.length > 0 && !used.has(key);
  });
  return { rows, orphans };
}

/**
 * 渲染计划 → 写回表单的行：**只留「真有内容」的行**。
 *
 * <p>候选集比目录大是常态（新档位还没配价）：那些格子渲染成空行给运营填，
 * 但没填过的不该进表单 —— 否则一次「打开看一眼、点保存」会把一堆空档位写进目录，
 * 而 billing 编译期会因「价格表里有键没价」拒掉整份文档。
 *
 * <p>⚠️ **只在派生模式（候选集可得）下用**：自由编辑时保持原行为（空行留着、由
 * `ruleFormError` 报「键不能为空」提醒删掉），否则「刚点了一下添加一行」的行会在下一次
 * 输入时凭空消失。
 */
export function filledKeyValueRows<T extends KeyValueRow>(rows: T[]): T[] {
  return rows.filter((row) => row.key.trim().length > 0 && row.value.trim().length > 0);
}

/** 价格行的「有内容」判据多一条：价格栏的「清空 = 不改原值」语义（见 `MoneyField`）。 */
export function filledPriceRows(rows: PriceRow[]): PriceRow[] {
  return rows.filter(
    (row) => row.key.trim().length > 0 && (row.value.trim().length > 0 || row.originalMc !== null),
  );
}
