import type { KeyValueRow, PriceRow } from './catalogDraft';

export interface RowPlan<T extends KeyValueRow> {
  rows: T[];
  orphans: T[];
}

export function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

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
  const orphans = existing.filter((row) => {
    const key = normalizeKey(row.key);
    return key.length > 0 && !used.has(key);
  });
  return { rows, orphans };
}

export function filledKeyValueRows<T extends KeyValueRow>(rows: T[]): T[] {
  return rows.filter((row) => row.key.trim().length > 0 && row.value.trim().length > 0);
}

export function filledPriceRows(rows: PriceRow[]): PriceRow[] {
  return rows.filter(
    (row) => row.key.trim().length > 0 && (row.value.trim().length > 0 || row.originalMc !== null),
  );
}
