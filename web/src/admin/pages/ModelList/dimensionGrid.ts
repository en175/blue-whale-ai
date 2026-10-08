/* ============================================
 * 输出像素表（`features.video_dimensions`）的**矩阵视图**：行 = 比例选项、列 = 尺寸档、格子 = 宽x高
 *
 * ── 为什么是视图，不是存储形态 ─────────────────────────────────────────────────
 *
 * 存储仍是扁平的 `{ "resolution=480p|aspect_ratio=16:9": "864x496" }`。理由：这张表**不跨进程**
 * ——跨进程的是 backend 解析出来的 `output_width` / `output_height` 两个标量
 * （`resolveOutputPixels` 查完冻进快照，见 `handle-create-generation-job.ts`），
 * 矩阵只是给人看的排布，扁平才是序列化形态。所以本文件只做「扁平 ⇄ 矩阵」的搬运，
 * 两边的存储形态都不动。
 *
 * ── 三条不变式 ────────────────────────────────────────────────────────────────
 *
 * 1. **键由本行的尺寸档 / 比例派生**（`gridSpecKey`，与 backend `specKeyOf` 逐字同形），
 *    **不手敲**：后端写闸门要求键形如 `resolution=X|aspect_ratio=Y`、值形如 `WxH`，形态不对直接拒存。
 * 2. **大小写不敏感**：档位值与库里键只差大小写是常态（能力行写 `4K`、表键是从定价目录
 *    搬来的 `4k`），**不是脏数据**。查格子两边都归一后再比——不这么做，`4K` 那一整列会
 *    显示成空，运营一保存就把已配的像素抹掉。
 * 3. **恒等写回**：写回时优先用库里**原来那个键**（{@link GridCell.originalKey}），
 *    一次「打开看一眼、点保存」不会把 `4k` 改成 `4K`（与定价 tab 的 `originalMc` 同源纪律）。
 * ============================================ */
import type { KeyValueRow } from '../../lib/billing-catalog/catalogDraft';
import { normalizeKey } from '../../lib/billing-catalog/rowPlan';
import { axisValueInKey } from '../../lib/billing-catalog/sizeCandidates';

/** 一个尺寸档（只取派生键需要的两个字段，`SizeForm` 结构上满足它）。 */
export interface GridSize {
  id: string;
  label?: string;
}

/** 一列 = 一个尺寸档。 */
export interface GridColumn {
  /** 档位 id（React key 与 aria-label 用） */
  id: string;
  /** 列头展示名：label 优先、回落 id */
  label: string;
  /**
   * 拼进 `resolution=` 的那个值。
   *
   * <p>IKHTVR 起就是档位 id 本身——出站档位值（旧 `api_value`）恒等于 id，提交侧送的
   * 也已经是 id，与这张表的查表键同一拼写。
   */
  resolution: string;
}

/** 一个格子。 */
export interface GridCell {
  /** 库里已存的那个键——写法可能与派生值只有大小写之差；**没存过时为 `null`** */
  originalKey: string | null;
  /** 格子的值（`864x496`）；库里没配过就是空串 */
  value: string;
}

/** 一行 = 一个比例选项。 */
export interface GridRow {
  ratio: string;
  cells: GridCell[];
}

/** 矩阵视图 + 放不进矩阵的那些键。 */
export interface DimensionGrid {
  columns: GridColumn[];
  rows: GridRow[];
  /** 库里有、矩阵里放不下的键（本行的档位 / 比例里没有这一对）——**不静默丢掉**，原样写回 */
  orphans: KeyValueRow[];
}

/** 规格键：与 backend `specKeyOf` 逐字同形（轴名、顺序都一致）。 */
export function gridSpecKey(resolution: string, ratio: string): string {
  return `resolution=${resolution}|aspect_ratio=${ratio}`;
}

/** 格子的查表键：两个轴各自归一后拼起来——与已存键里的轴序无关。 */
function cellKey(resolution: string, ratio: string): string {
  return `${normalizeKey(resolution)}|${normalizeKey(ratio)}`;
}

/** 已存行的查表键：先按轴名取出两个值（顺序无关），再归一；取不全（缺轴 / 空值）返回 `null`。 */
function storedKey(specKey: string): string | null {
  const resolution = axisValueInKey(specKey, 'resolution');
  const ratio = axisValueInKey(specKey, 'aspect_ratio');
  if (!resolution || !ratio) return null;
  return cellKey(resolution, ratio);
}

/**
 * 扁平表 → 矩阵。
 *
 * <p>列取**有 id 的**档位行（正在填的空行不占列），行取比例列表——与候选集
 * （`dimensionTableCandidates`）同一份来源，所以矩阵里的格子与候选键一一对应。
 */
export function buildDimensionGrid(
  sizes: GridSize[],
  ratios: string[],
  stored: KeyValueRow[],
): DimensionGrid {
  const columns: GridColumn[] = [];
  for (const size of sizes) {
    const id = (size.id ?? '').trim();
    if (!id) continue;
    columns.push({
      id,
      label: (size.label ?? '').trim() || id,
      resolution: id,
    });
  }

  // 索引：归一后的 (档位, 比例) → 库里那一行（连同它在 stored 里的下标，好标出孤儿）。
  // 同键多行时第一行胜出，其余留在孤儿里让人看见——总比悄悄写丢一行好。
  const index = new Map<string, { row: KeyValueRow; at: number }>();
  stored.forEach((row, at) => {
    const key = storedKey(row.key);
    if (key !== null && !index.has(key)) index.set(key, { row, at });
  });

  const used = new Set<number>();
  const rows: GridRow[] = ratios.map((ratio) => ({
    ratio,
    cells: columns.map((column) => {
      const found = index.get(cellKey(column.resolution, ratio));
      if (found === undefined) return { originalKey: null, value: '' };
      used.add(found.at);
      return { originalKey: found.row.key, value: found.row.value };
    }),
  }));

  return { columns, rows, orphans: stored.filter((_, at) => !used.has(at)) };
}

/**
 * 改一格 → 写回表单的扁平表。
 *
 * <p>只留**真有值**的格子（与 `filledKeyValueRows` 同口径）：候选集比库里大是常态，
 * 没填过的格子不该进表单，否则一次「打开看一眼、点保存」会往库里塞一堆空格子。
 * 格子留空 = 这条组合不能用，键随之从表里消失（含该档的提交会因「算不出上限」被拒）。
 *
 * <p>键：**优先用库里原来的那个**（恒等写回），只有新格子才按本行的档位 / 比例拼。
 */
export function setGridCell(
  grid: DimensionGrid,
  rowIndex: number,
  columnIndex: number,
  value: string,
): KeyValueRow[] {
  const rows: KeyValueRow[] = [];
  const seen = new Set<string>();
  grid.rows.forEach((row, ri) => {
    row.cells.forEach((cell, ci) => {
      const next = ri === rowIndex && ci === columnIndex ? value : cell.value;
      if (next.trim() === '') return;
      const column = grid.columns[ci];
      if (column === undefined) return;
      const key = cell.originalKey ?? gridSpecKey(column.resolution, row.ratio);
      const normalized = normalizeKey(key);
      // 两列派生出同一个键（档位值重复）时不写第二遍——一个键只能有一个值
      if (seen.has(normalized)) return;
      seen.add(normalized);
      rows.push({ key, value: next });
    });
  });
  return [...rows, ...grid.orphans];
}
