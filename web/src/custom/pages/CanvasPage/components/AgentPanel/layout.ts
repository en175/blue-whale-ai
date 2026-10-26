export const PANEL_MARGIN = 8;

interface PanelLayoutInput {
  pageWidth: number;
  pageHeight: number;
  headerHeight: number;
  panelWidth: number;
  panelHeight: number;
  desiredX: number;
  desiredY: number;
}

export interface PanelLayout {
  x: number;
  y: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export function getPanelLayout(input: PanelLayoutInput): PanelLayout {
  const availableHeight = Math.max(0, input.pageHeight - input.headerHeight - PANEL_MARGIN * 2);
  const height = Math.min(Math.max(0, input.panelHeight), availableHeight);
  const minX = Math.min(PANEL_MARGIN, Math.max(0, input.pageWidth - input.panelWidth));
  const maxX = Math.max(minX, input.pageWidth - PANEL_MARGIN - input.panelWidth);
  const minY = Math.min(input.headerHeight + PANEL_MARGIN, Math.max(0, input.pageHeight - height));
  const maxY = Math.max(minY, input.pageHeight - PANEL_MARGIN - height);

  return {
    x: clamp(input.desiredX, minX, maxX),
    y: clamp(input.desiredY, minY, maxY),
    height,
  };
}

export interface PanelMetrics {
  pageWidth: number;
  pageHeight: number;
  headerHeight: number;
  panelWidth: number;
  panelHeight: number;
}

export function freePanelLayout(
  metrics: PanelMetrics,
  desiredX: number,
  desiredY: number,
): PanelLayout {
  return getPanelLayout({ ...metrics, desiredX, desiredY });
}
