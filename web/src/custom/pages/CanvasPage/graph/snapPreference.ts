
export const SNAP_ALIGNMENT_STORAGE_KEY = 'bw-canvas-snap-alignment';

export function readSnapAlignmentEnabled(): boolean {
  return localStorage.getItem(SNAP_ALIGNMENT_STORAGE_KEY) !== 'off';
}

export function persistSnapAlignmentEnabled(enabled: boolean): void {
  localStorage.setItem(SNAP_ALIGNMENT_STORAGE_KEY, enabled ? 'on' : 'off');
}
