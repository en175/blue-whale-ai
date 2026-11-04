
export const DEFAULT_PANEL_WIDTH = 468;
export const MIN_PANEL_WIDTH = 400;
export const MAX_PANEL_WIDTH = 720;
export const PANEL_WIDTH_STORAGE_KEY = 'bw-agent-panel-width';

export function clampPanelWidth(width: number, viewportWidth: number): number {
  const min = Math.min(MIN_PANEL_WIDTH, viewportWidth - 60);
  const max = Math.max(Math.min(MAX_PANEL_WIDTH, viewportWidth * 0.5), min);
  return Math.min(Math.max(width, min), max);
}

export function readPersistedPanelWidth(viewportWidth: number): number {
  const saved = Number(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
  return clampPanelWidth(saved > 0 ? saved : DEFAULT_PANEL_WIDTH, viewportWidth);
}

export function persistPanelWidth(width: number): void {
  localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(width));
}

export interface AgentDrawerLayout {
  open: boolean;
  closing: boolean;
  floating: boolean;
  resizing: boolean;
  width: number;
}

export function drawerPushOffset(layout: AgentDrawerLayout | null | undefined): number {
  if (!layout || !layout.open || layout.closing || layout.floating) return 0;
  return layout.width;
}
