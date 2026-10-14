import type { KeyValueRow } from '../../utils/billing-catalog/catalogDraft';
import { normalizeKey } from '../../utils/billing-catalog/rowPlan';
import { axisValueInKey } from '../../utils/billing-catalog/sizeCandidates';

export interface GridSize {
  id: string;
  label?: string;
}

export interface GridColumn {
  id: string;
  label: string;
  resolution: string;
}

export interface GridCell {
  originalKey: string | null;
  value: string;
}

export interface GridRow {
  ratio: string;
  cells: GridCell[];
}

export interface DimensionGrid {
  columns: GridColumn[];
  rows: GridRow[];
  orphans: KeyValueRow[];
}

export function gridSpecKey(resolution: string, ratio: string): string {
  return `resolution=${resolution}|aspect_ratio=${ratio}`;
}

function cellKey(resolution: string, ratio: string): string {
  return `${normalizeKey(resolution)}|${normalizeKey(ratio)}`;
}

function storedKey(specKey: string): string | null {
  const resolution = axisValueInKey(specKey, 'resolution');
  const ratio = axisValueInKey(specKey, 'aspect_ratio');
  if (!resolution || !ratio) return null;
  return cellKey(resolution, ratio);
}

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
      if (seen.has(normalized)) return;
      seen.add(normalized);
      rows.push({ key, value: next });
    });
  });
  return [...rows, ...grid.orphans];
}
