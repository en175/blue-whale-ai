/* ============================================
 * Canvas ReactFlow 画布容器：节点渲染与交互事件
 * ============================================ */
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  useReactFlow,
  useViewport,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef, useMemo } from 'react';
import ZoomControl from '../ZoomControl';
import TextNode from '../TextNode';
import MediaNode from '../MediaNode';
import ProductNode from '../ProductNode';
import AssetCardNode from '../AssetCardNode';
import CustomEdge from '../CustomEdge';
import styles from './index.module.css';

const initialNodes: Node[] = [];

const initialEdges: Edge[] = [];

interface FlowCanvasProps {
  showMiniMap: boolean;
  toolMode: 'drag' | 'select';
  extraNodes: Node[];
  textNodes: Node[];
  mediaNodes: Node[];
  productNodes: Node[];
  assetNodes: Node[];
  showEdges: boolean;
  /** 加载画布文档后注入的视口（切换项目时应用） */
  viewport?: Viewport;
  /** 视口变更回调（拖拽/缩放结束），供自动保存使用 */
  onViewportChange?: (v: Viewport) => void;
  /** 节点拖拽结束回调（同步坐标到父组件，触发自动保存） */
  onNodeDragStop?: (node: Node) => void;
  onDeleteNode: (id: string) => void;
  /** 节点单击（画布选取模式等场景） */
  onNodeClick?: (node: Node) => void;
  /** 画布空白处单击 */
  onPaneClick?: () => void;
  /** 隐藏右下角缩放控件。Agent 面板打开时它正好压在面板的发送按钮上（IKAGZC）。 */
  hideZoomControl?: boolean;
  /** 注册出生点取数函数（当前视口中心的 flow 坐标），供父级创建节点时落在用户可见区域 */
  registerSpawnPosition?: (fn: () => { x: number; y: number }) => void;
  /** 商品卡 ts 驱动注入结果 */
  productPickResult?: { ts: number; productId: string; image: { id: string; src: string; enabled: boolean } } | null;
  /** 资产卡 ts 驱动注入结果 */
  assetPickResult?: { ts: number; assetId: string; ref: { id: string; src: string } } | null;
}

function FlowCanvasInner({ showMiniMap, toolMode, extraNodes, textNodes, mediaNodes, productNodes, assetNodes, showEdges, viewport, onViewportChange, onNodeDragStop, onDeleteNode, onNodeClick, onPaneClick, registerSpawnPosition, hideZoomControl, productPickResult, assetPickResult }: FlowCanvasProps) {
  const isDrag = toolMode === 'drag';
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const extraIdsRef = useRef<Set<string>>(new Set());
  const textIdsRef = useRef<Set<string>>(new Set());
  const mediaIdsRef = useRef<Set<string>>(new Set());
  const productIdsRef = useRef<Set<string>>(new Set());
  const assetIdsRef = useRef<Set<string>>(new Set());

  const nodeTypes: NodeTypes = useMemo(() => ({ textNode: TextNode, mediaNode: MediaNode, productNode: ProductNode, assetNode: AssetCardNode }), []);
  const edgeTypes: EdgeTypes = useMemo(() => ({ custom: CustomEdge }), []);
  const { setCenter, setViewport, screenToFlowPosition } = useReactFlow();
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  /** 波点缩放补偿：屏幕点半径 = size × zoom，取 size = 1/zoom 使屏幕点径恒定约 2px，
   * 缩小视图（如 58%）时波点依然清晰可见 */
  const { zoom } = useViewport();
  const dotSize = Math.max(0.4, Math.min(4, 1 / zoom));

  /** 向父级注册出生点取数函数：屏幕视觉中心 → flow 坐标 */
  useEffect(() => {
    registerSpawnPosition?.(() =>
      screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
    );
  }, [registerSpawnPosition, screenToFlowPosition]);

  /** 注入加载的视口状态（切换项目/首次加载） */
  useEffect(() => {
    if (viewport) setViewport(viewport);
  }, [viewport, setViewport]);

  /** 双击节点：居中到屏幕中心，缩放 200% */
  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const x = node.position.x + (node.measured?.width ?? 200) / 2;
      const y = node.position.y + (node.measured?.height ?? 100) / 2;
      setCenter(x, y, { zoom: 2, duration: 400 });
    },
    [setCenter],
  );

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge({ ...params, type: 'custom', style: { stroke: '#444' } }, eds),
      ),
    [setEdges],
  );

  /** 合并外部上传节点 */
  useEffect(() => {
    const newIds = new Set(extraNodes.map((n) => n.id));
    const currentExtraIds = extraIdsRef.current;

    // 找出新增的节点
    const added = extraNodes.filter((n) => !currentExtraIds.has(n.id));

    // 找出被更新的已有节点
    const updated = extraNodes.filter((n) => currentExtraIds.has(n.id));

    if (added.length > 0 || updated.length > 0) {
      setNodes((prev) => {
        // 更新已有上传节点
        let result = prev.map((node) => {
          const updatedNode = updated.find((u) => u.id === node.id);
          return updatedNode ?? node;
        });

        // 添加新节点
        result = [...result, ...added];
        return result;
      });
    }

    extraIdsRef.current = newIds;
  }, [extraNodes, setNodes]);

  /** 合并文本节点（新增追加；外部删除同步移除） */
  useEffect(() => {
    const newIds = new Set(textNodes.map((n) => n.id));
    const currentIds = textIdsRef.current;
    const added = textNodes.filter((n) => !currentIds.has(n.id));
    const removed = [...currentIds].filter((id) => !newIds.has(id));

    if (added.length > 0 || removed.length > 0) {
      setNodes((prev) => {
        let result = removed.length > 0 ? prev.filter((n) => !removed.includes(n.id)) : prev;
        if (added.length > 0) result = [...result, ...added];
        return result;
      });
    }

    textIdsRef.current = newIds;
  }, [textNodes, setNodes]);

  /** 合并媒体节点（新增追加；上传登记后同步更新 src；外部删除同步移除） */
  useEffect(() => {
    const newIds = new Set(mediaNodes.map((n) => n.id));
    const currentIds = mediaIdsRef.current;
    const added = mediaNodes.filter((n) => !currentIds.has(n.id));
    const updated = mediaNodes.filter((n) => currentIds.has(n.id));
    const removed = [...currentIds].filter((id) => !newIds.has(id));

    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
      setNodes((prev) => {
        let result = removed.length > 0 ? prev.filter((n) => !removed.includes(n.id)) : prev;
        if (updated.length > 0) {
          result = result.map((node) => updated.find((u) => u.id === node.id) ?? node);
        }
        if (added.length > 0) result = [...result, ...added];
        return result;
      });
    }

    mediaIdsRef.current = newIds;
  }, [mediaNodes, setNodes]);

  /** 合并商品节点（新增追加；外部删除同步移除） */
  useEffect(() => {
    const newIds = new Set(productNodes.map((n) => n.id));
    const currentIds = productIdsRef.current;
    const added = productNodes.filter((n) => !currentIds.has(n.id));
    const removed = [...currentIds].filter((id) => !newIds.has(id));

    if (added.length > 0 || removed.length > 0) {
      setNodes((prev) => {
        let result = removed.length > 0 ? prev.filter((n) => !removed.includes(n.id)) : prev;
        if (added.length > 0) result = [...result, ...added];
        return result;
      });
    }

    productIdsRef.current = newIds;
  }, [productNodes, setNodes]);

  /** 注入商品卡选取结果（ts 驱动，仅传递 productPickResult，图片注入由 ProductNode 本地完成） */
  useEffect(() => {
    if (!productPickResult) return;
    const { productId, ts, image } = productPickResult;
    setNodes((prev) =>
      prev.map((node) => {
        if (node.type !== 'productNode' || node.id !== productId) return node;
        return {
          ...node,
          data: { ...node.data, productPickResult: { ts, productId, image } },
        };
      }),
    );
  }, [productPickResult, setNodes]);

  /** 注入资产卡选取结果（ts 驱动） */
  useEffect(() => {
    if (!assetPickResult) return;
    const { assetId, ts, ref } = assetPickResult;
    setNodes((prev) =>
      prev.map((node) => {
        if (node.type !== 'assetNode' || node.id !== assetId) return node;
        return {
          ...node,
          data: { ...node.data, assetPickResult: { ts, assetId, ref } },
        };
      }),
    );
  }, [assetPickResult, setNodes]);

  /** 合并资产卡节点（新增追加；外部删除同步移除） */
  useEffect(() => {
    const newIds = new Set(assetNodes.map((n) => n.id));
    const currentIds = assetIdsRef.current;
    const added = assetNodes.filter((n) => !currentIds.has(n.id));
    const removed = [...currentIds].filter((id) => !newIds.has(id));

    if (added.length > 0 || removed.length > 0) {
      setNodes((prev) => {
        let result = removed.length > 0 ? prev.filter((n) => !removed.includes(n.id)) : prev;
        if (added.length > 0) result = [...result, ...added];
        return result;
      });
    }

    assetIdsRef.current = newIds;
  }, [assetNodes, setNodes]);

  /** 统一注入 isFirst 与 toolMode，保证节点数据始终最新 */
  useEffect(() => {
    setNodes((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const result = prev.map((node, index) => {
        const isFirst = index === 0;
        const needUpdate =
          !!node.data.isFirst !== isFirst || node.data.toolMode !== toolMode;
        if (needUpdate) {
          changed = true;
          return { ...node, data: { ...node.data, isFirst, toolMode } };
        }
        return node;
      });
      return changed ? result : prev;
    });
  }, [nodes, toolMode, setNodes]);

  /** 删除节点 */
  useEffect(() => {
    // onDeleteNode 通过 data.onDelete 传入 TextNode
  }, [onDeleteNode]);

  /** 全局拦截 Delete/Backspace/Enter 键删除行为 */
  useEffect(() => {
    const BLOCKED_KEYS = ['Delete', 'Backspace', 'Enter'];
    const handler = (e: KeyboardEvent) => {
      if (!BLOCKED_KEYS.includes(e.key)) return;
      const target = e.target as HTMLElement;
      // 输入框/编辑器内允许正常使用这些键
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  return (
    <div className={`${styles.canvasContainer} ${isDrag ? styles.dragMode : ''}`}>
      <ReactFlow
        nodes={nodes}
        edges={showEdges ? edges : []}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeClick={onNodeClick ? (_e, node) => onNodeClick(node) : undefined}
        onPaneClick={onPaneClick}
        onMoveEnd={(_e, v) => onViewportChangeRef.current?.(v)}
        onNodeDragStop={(_e, node) => onNodeDragStop?.(node)}
        onContextMenu={(e) => e.preventDefault()}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        panOnDrag={isDrag}
        nodesDraggable={!isDrag}
        elementsSelectable={!isDrag}
        nodesConnectable={!isDrag}
        nodesFocusable={false}
        edgesFocusable={false}
        maxZoom={8}
        connectionRadius={30}
        defaultViewport={{ x: 0, y: 0, zoom: 1.1 }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        defaultEdgeOptions={{
          type: 'custom',
          style: { stroke: '#444' },
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={dotSize}
          color="#4d4d4d"
        />
        {showMiniMap && (
          <MiniMap
            position="bottom-left"
            nodeColor="#333"
            maskColor="rgba(0, 0, 0, 0.7)"
            pannable
            zoomable
            style={{ bottom: 60 }}
          />
        )}
      </ReactFlow>
      {!hideZoomControl && <ZoomControl />}
    </div>
  );
}

export default function FlowCanvas({ showMiniMap, toolMode, extraNodes, textNodes, mediaNodes, productNodes, assetNodes, showEdges, viewport, onViewportChange, onNodeDragStop, onDeleteNode, onNodeClick, onPaneClick, registerSpawnPosition, hideZoomControl, productPickResult, assetPickResult }: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner
        showMiniMap={showMiniMap}
        toolMode={toolMode}
        extraNodes={extraNodes}
        textNodes={textNodes}
        mediaNodes={mediaNodes}
        productNodes={productNodes}
        assetNodes={assetNodes}
        showEdges={showEdges}
        viewport={viewport}
        onViewportChange={onViewportChange}
        onNodeDragStop={onNodeDragStop}
        onDeleteNode={onDeleteNode}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        registerSpawnPosition={registerSpawnPosition}
        hideZoomControl={hideZoomControl}
        productPickResult={productPickResult}
        assetPickResult={assetPickResult}
      />
    </ReactFlowProvider>
  );
}
