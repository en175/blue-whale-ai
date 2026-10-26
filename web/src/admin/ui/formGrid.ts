import type { CSSProperties } from 'react';

export function formGrid(columns: 1 | 2 | 3 = 2): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gap: 'var(--admin-space-4) var(--admin-space-5)',
    marginBottom: 'var(--admin-space-5)',
    alignItems: 'start',
  };
}
