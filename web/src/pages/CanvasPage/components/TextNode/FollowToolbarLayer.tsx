/* ============================================
 * 文本卡钉屏幕工具栏层（IKGYYE 自 TextNode wrapper 内迁出）：与 IKGYYD 通用容器
 * NodeFollowToolbar 同一锚定基建（computeFollowAnchorAbove + 容器 .toolbarLayer
 * 定位类 + data-gen-panel-territory），但不经 CanvasPage 挂载、不做唯一选中硬门——
 * 文本卡两条工具条的显示门是组件自身状态：格式工具栏=编辑聚焦（isFocused，
 * GroupOverlay 组穿透双击进入编辑时节点未必选中）、操作条=唯一选中（useSoloNodeSelected
 * 口径）或悬停卡片（.wrapper:hover 的 JS 等价），且按钮回调（execCmd/setHeading/
 * editMaterial）闭包依赖 TextNode 内部 ref/state，无法提为 CanvasPage 侧内容组件。
 * 故由 TextNode 自渲染本层。坐标仍按 .react-flow 容器换算，但 portal 必须挂到
 * document.body：.react-flow 是 React Flow 自己调和的祖先节点，往里插 portal
 * 会在节点卸载 / 离页时和 React 抢 removeChild，整页 NotFoundError。
 * 挂 body 后用 position:fixed + 容器 getBoundingClientRect 偏移，屏幕尺寸仍不随缩放变化。
 * ============================================ */
import type { ReactNode, Ref } from 'react';
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
  /** 层根 DOM，供卡片侧用命中测试判断指针是否还在工具条上 */
  layerRef?: Ref<HTMLDivElement>;
  /** 层根指针进入（IKGYYB hover 桥接）：指针从卡间隙抵达工具条，取消延迟清除 hover */
  onLayerPointerEnter?: () => void;
  /** 层根指针离开（IKGYYB hover 桥接）：指针移向卡外，重新调度延迟清除（移回卡则被卡 enter 取消） */
  onLayerPointerLeave?: () => void;
  children: ReactNode;
}

export default function FollowToolbarLayer({
  nodeId,
  show,
  toolbarLift,
  layerRef,
  onLayerPointerEnter,
  onLayerPointerLeave,
  children,
}: FollowToolbarLayerProps) {
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
  const flowRect = flowDom.getBoundingClientRect();

  return createPortal(
    <div
      ref={layerRef}
      className={layerStyles.toolbarLayer}
      data-gen-panel-territory
      style={{
        position: 'fixed',
        left: anchor.left + flowRect.left,
        top: anchor.top + flowRect.top,
        zIndex: 1,
      }}
      onPointerEnter={onLayerPointerEnter}
      onPointerLeave={onLayerPointerLeave}
      onMouseEnter={onLayerPointerEnter}
      onMouseLeave={onLayerPointerLeave}
    >
      {children}
    </div>,
    document.body,
  );
}
