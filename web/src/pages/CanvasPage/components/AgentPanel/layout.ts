const PANEL_MARGIN = 8;

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

/**
 * 将面板约束到父容器可视区。坐标相对父容器，因此 y 的上界只扣一次面板高度，
 * header 只参与最小 y 与可用高度计算。
 */
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
