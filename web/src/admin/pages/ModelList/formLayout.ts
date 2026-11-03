import type { CSSProperties } from 'react';
import { formGrid } from '../../ui';

export const GRID2: CSSProperties = formGrid(2);
export const GRID3: CSSProperties = formGrid(3);
export const LABEL: CSSProperties = { marginBottom: 6 };
export const SECTION: CSSProperties = { margin: '24px 0 8px' };
export const SIZE_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr auto',
  gap: 8,
  alignItems: 'center',
  marginBottom: 8,
};
export const INLINE_ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
export const CHIP_LIST: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
export const FULL: CSSProperties = { width: '100%' };
export const PANEL: CSSProperties = {
  padding: 'var(--admin-space-4)',
  border: '1px solid var(--admin-divider)',
  borderRadius: 'var(--admin-radius-surface)',
  background: 'var(--admin-surface-sunken)',
};
export const FEATURE_GROUPS: CSSProperties = { display: 'grid', gap: 'var(--admin-space-5)' };
export const FEATURE_GROUP_LABEL: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--admin-text-muted)',
  marginBottom: 'var(--admin-space-2)',
};
export const FEATURE_FLAG_GRID: CSSProperties = {
  ...formGrid(2),
  gap: 'var(--admin-space-3) var(--admin-space-4)',
  marginBottom: 0,
};
export const FEATURE_FIELD_GRID: CSSProperties = { ...formGrid(2), marginBottom: 0 };
