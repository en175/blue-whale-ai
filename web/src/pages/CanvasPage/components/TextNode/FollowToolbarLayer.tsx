/* ============================================
 * 文本卡钉屏幕工具栏层（IKGYYE 自 TextNode wrapper 内迁出）：与 IKGYYD 通用容器
 * NodeFollowToolbar 同一锚定基建（computeFollowAnchorAbove + 容器 .toolbarLayer
 * 定位类 + data-gen-panel-territory），但不经 CanvasPage 挂载、不做唯一选中硬门——
 * 文本卡两条工具条的显示门是组件自身状态：格式工具栏=编辑聚焦（isFocused，
 * GroupOverlay 组穿透双击进入编辑时节点未必选中）、操作条=唯一选中（useSoloNodeSelected
 * 口径）或悬停卡片（.wrapper:hover 的 JS 等价），且按钮回调（execCmd/setHeading/
 * editMaterial）闭包依赖 TextNode 内部 ref/state，无法提为 CanvasPage 侧内容组件。
 * 故由 TextNode 自渲染本层并 createPortal 到 React Flow store 的 domNode
 * （.react-flow 根、viewport transform 层外），与容器的 followToolbarLayer 同位同层：
 * 任何缩放级别（0.2~8）屏幕尺寸恒定，拖动卡片/平移缩放由 useStore 订阅实时跟随。
 * ============================================ */
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@xyflow/react';
import { computeFollowAnchorAbove } from '../../followDialog';
import layerStyles from '../NodeFollowToolbar/index.module.css';

export interface FollowToolbarLayerProps {
  /** 跟随的目标节点 id（本文本卡） */
  nodeId: string;
  /** 显示门（调用方全权表达：格式栏=isFocused，操作条=唯一选中或悬停） */
  show: boolean;
  /** 工具条顶边相对卡片顶边的抬升量（屏幕像素，估高 + 间距）；缺省用 FOLLOW_ABOVE_LIFT */
  toolbarLift?: number;
  children: ReactNode;
}

export default function FollowToolbarLayer({ nodeId, show, toolbarLift, children }: FollowToolbarLayerProps) {
  const flowDom = useStore((state) => state.domNode);
  const position = useStore((state) => state.nodeLookup.get(nodeId)?.internals?.positionAbsolute);
  const nodeWidth = useStore((state) => state.nodeLookup.get(nodeId)?.measured?.width);
  const transform = useStore((state) => state.transform);
  const containerWidth = useStore((state) => state.width);
  if (!show || !flowDom || !position || nodeWidth == null || containerWidth <= 0) return null;

  const anchor = computeFollowAnchorAbove({
    nodeX: position.x,
    nodeY: position.y,
    nodeWidth,
    viewport: { x: transform[0], y: transform[1], zoom: transform[2] },
    containerWidth,
    toolbarLift,
  });

  return createPortal(
    <div
      className={layerStyles.toolbarLayer}
      data-gen-panel-territory
      style={{ left: anchor.left, top: anchor.top }}
    >
      {children}
    </div>,
    flowDom,
  );
}
