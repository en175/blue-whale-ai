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
export const CHECK_STACK: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 };
