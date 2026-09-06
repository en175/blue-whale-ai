/**
 * 面板与父容器边缘的固定间距。
 *
 * 刻意不用视口百分比：同一个界面在半屏与全屏下应当长得一样（IKAGZC）。
 * 收边与贴角共用这一个值——此前 index.tsx 另有一个 `PANEL_EDGE_GAP = 8` 与它并存，
 * 同一个概念两个名字，改一个另一个不会跟着动。
 */
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

/**
 * 一次 DOM 量测的结果：算布局要的全部输入。
 *
 * 各调用点（缩窗、切浮动、拖拽）此前各自量一遍 `parentElement` / `getBoundingClientRect` /
 * `querySelector('header')`，量法还略有出入。收成一个形状，量测与决策就分开了。
 */
export interface PanelMetrics {
  pageWidth: number;
  pageHeight: number;
  headerHeight: number;
  panelWidth: number;
  /** 面板当前实测高度，只服务浮动模式（停靠抽屉是全高覆盖，不参与这套坐标，IKDLD4）。 */
  panelHeight: number;
}

/**
 * 浮动模式：保持当前高度，把调用方想要的位置收进可视区。
 *
 * 缩窗（沿用上次位置）与拖拽（起点 + 位移）只差这一对坐标，其余完全一致。
 */
export function freePanelLayout(
  metrics: PanelMetrics,
  desiredX: number,
  desiredY: number,
): PanelLayout {
  return getPanelLayout({ ...metrics, desiredX, desiredY });
}
