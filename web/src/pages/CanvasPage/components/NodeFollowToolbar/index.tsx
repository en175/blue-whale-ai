/* ============================================
 * NodeFollowToolbar 钉屏幕工具栏容器（IKGYYD 基建，通用）：把跟随节点卡片的
 * 悬浮工具条渲染在画布缩放层之外——作为 ReactFlow children 渲染（同 GroupOverlay /
 * CropFrame / OutpaintFrame 先例：.react-flow 根内、viewport transform 层外），
 * 组件内 useStore 订阅节点位置与视口变换，拖动卡片 / 平移缩放画布每帧实时重算锚点
 * （父层 CanvasPage 的节点坐标仅在拖动结束回写，受控锚无法实时跟随，故必须直读 store）。
 * 锚定走 computeFollowAnchorAbove（卡片上方居中）：left 中心点语义由本容器
 * translateX(-50%) 完成真居中，任何缩放级别（0.2~8）工具条屏幕尺寸恒定。
 * 显隐分工：调用方数据条件走 show（如媒体卡非生成中/素材未缺失）；
 * 「唯一选中 + 画布无多选」门（useSoloNodeSelected）留在本容器，与节点内原口径同源。
 * hovered=true（IKGYYF，资产卡 hover 显示语义是第一个需要绕过唯一选中门的迁移方）：
 * 跳过唯一选中门但 show 数据门与几何条件照旧——等价迁移前节点内 CSS .wrapper:hover
 * 的显示语义（悬停显示与选中集合、多选抑制无关）。
 * 根元素打 data-gen-panel-territory（IKFYH6 点外关闭豁免）：工具条迁出 .react-flow__node
 * 后点击它不得被判成画布外点击而误关生成面板。
 * ============================================ */
import type { ReactNode } from 'react';
import { useStore } from '@xyflow/react';
import { computeFollowAnchorAbove } from '../../followDialog';
import { useSoloNodeSelected } from '../../useSoloNodeSelected';
import { shouldSuppressCanvasSelection } from '../Canvas/chromeHitGuard';
import styles from './index.module.css';

export interface NodeFollowToolbarProps {
  /** 跟随的目标节点 id */
  nodeId: string;
  /** 调用方数据条件（缺省 true）；唯一选中的多选抑制恒由本容器判定 */
  show?: boolean;
  /** 目标卡片处于指针悬停（缺省 false）：跳过唯一选中门，等价迁移前 CSS :hover 显示语义 */
  hovered?: boolean;
  /** 工具栏估半宽（屏幕像素），仅用于水平视口钳制，不参与居中；缺省用 FOLLOW_ABOVE_HALF_WIDTH */
  toolbarHalfWidth?: number;
  /** 工具栏顶边相对卡片顶边的抬升量（屏幕像素，估高 + 间距）；缺省用 FOLLOW_ABOVE_LIFT */
  toolbarLift?: number;
  children: ReactNode;
}

export default function NodeFollowToolbar({
  nodeId,
  show = true,
  hovered = false,
  toolbarHalfWidth,
  toolbarLift,
  children,
}: NodeFollowToolbarProps) {
  const node = useStore((state) => state.nodeLookup.get(nodeId));
  const nodeSelected = useStore((state) => state.nodeLookup.get(nodeId)?.selected);
  const transform = useStore((state) => state.transform);
  const containerWidth = useStore((state) => state.width);
  const soloSelected = useSoloNodeSelected(nodeSelected);

  /** 绝对 flow 坐标（组内成员也正确；顶级节点上与 position 等价） */
  const position = node?.internals?.positionAbsolute;
  const nodeWidth = node?.measured?.width;
  if (!show) return null;
  if (shouldSuppressCanvasSelection()) return null;
  if (!soloSelected && !hovered) return null;
  if (!position || nodeWidth == null || containerWidth <= 0) return null;

  const anchor = computeFollowAnchorAbove({
    nodeX: position.x,
    nodeY: position.y,
    nodeWidth,
    viewport: { x: transform[0], y: transform[1], zoom: transform[2] },
    containerWidth,
    toolbarHalfWidth,
    toolbarLift,
  });

  return (
    <div
      className={styles.toolbarLayer}
      data-canvas-chrome
      data-gen-panel-territory
      style={{ left: anchor.left, top: anchor.top }}
    >
      {children}
    </div>
  );
}
