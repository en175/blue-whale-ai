/* ============================================
 * Canvas ReactFlow 画布容器：节点渲染与交互事件
 * ============================================ */
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  SelectionMode,
  useReactFlow,
  useViewport,
  type Node,
  type Edge,
  useNodesState,
  type Connection,
  type EdgeChange,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
  type Viewport,
  type OnSelectionChangeParams,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import ZoomControl from '../ZoomControl';
import TextNode from '../TextNode';
import MediaNode from '../MediaNode';
import { mediaInputStale, firstTextSourceOf } from '../../textIndexSync';
import ProductNode from '../ProductNode';
import AssetCardNode from '../AssetCardNode';
import CustomEdge from '../CustomEdge';
import GroupOverlay from '../GroupOverlay';
import GroupFrameNode from '../GroupFrameNode';
import { canvasDeleteKeyAction, deleteSelectedCanvasNodes, isEditableKeyboardTarget } from './keyboardDelete';
import { useCanvasPan } from './useCanvasPan';
import ConnectionPreview from './ConnectionPreview';
import {
  MIN_GROUP_MEMBERS,
  exclusiveMembersInGroup,
  groupFrameZ,
  groupMemberZ,
  type CanvasGroup,
  type GroupFrameDragResult,
} from '../../canvasGroups';

import styles from './index.module.css';

const initialNodes: Node[] = [];

interface FlowCanvasProps {
  showMiniMap: boolean;
  toolMode: 'drag' | 'select';
  extraNodes: Node[];
  textNodes: Node[];
  mediaNodes: Node[];
  productNodes: Node[];
  assetNodes: Node[];
  showEdges: boolean;
  /** 连线（受控：父级持有，水合恢复与自动保存签名以此为准，IKDLQF） */
  edges: Edge[];
  /** 连线变更上抛（剪刀删除等移除变更；受控模式下由父级落状态） */
  onEdgesChange: (changes: EdgeChange[]) => void;
  /** 建立连线 */
  onConnect: (connection: Connection) => void;
  /** 开始从节点手柄拖线（记下源节点，松手时即使 fromNode 缺失也能弹出菜单） */
  onConnectStart?: (nodeId: string | null) => void;
  /** 拖线在空白/非法目标松开（类型菜单由父级处理） */
  onConnectEnd?: (event: MouseEvent | TouchEvent, state: { fromNode?: Node | null; toNode?: Node | null; isValid?: boolean | null; toHandle?: { nodeId?: string | null } | null }) => void;
  /** 仅允许连到生成节点且能力匹配 */
  isValidConnection?: (connection: Connection | { source: string | null; target: string | null }) => boolean;
  /** 加载画布文档后注入的视口（切换项目时应用） */
  viewport?: Viewport;
  /** 视口变更回调（拖拽/缩放结束），供自动保存使用 */
  onViewportChange?: (v: Viewport) => void;
  /** 平移/缩放过程中的视口（不落盘，仅供跟随输入框对齐） */
  onViewportLive?: (v: Viewport) => void;
  /** 节点拖拽结束回调（同步坐标到父组件，触发自动保存）。多选整组拖拽时 draggedNodes 含同组全部节点 */
  onNodeDragStop?: (node: Node, draggedNodes: Node[]) => void;
  /** 键盘删除选中节点（多选一次回调全部 id，保证撤销为原子操作） */
  onDeleteNode: (ids: string[]) => void;
  /** 节点单击（画布选取模式等场景） */
  onNodeClick?: (node: Node) => void;
  /** 画布空白处单击 */
  onPaneClick?: () => void;
  /** 选中集合变化（IKDMQU：空白/多选隐藏生成面板） */
  onSelectionChange?: (params: OnSelectionChangeParams) => void;
  /** 父层显式选中请求（IKDMQV，侧栏新建草稿自动选中）：唯一选中目标节点。
   *  必须经内部 setNodes 应用——外部 nodes 的 selected 字段会被合并保护忽略
   *  （父层尺寸回填等 update 携带过期选中态时不得覆盖交互），且经外部传播
   *  会因内部 selection store 的时序差产生旧卡+新卡双选中误报。ts 驱动去重。 */
  selectRequest?: { id: string; ts: number } | null;
  /** 隐藏右下角缩放控件。Agent 面板打开时它正好压在面板的发送按钮上（IKAGZC）。 */
  hideZoomControl?: boolean;
  /** 注册屏幕点→flow 坐标转换（无参默认视口中心），供父级创建节点时落在用户可见区域并换算 Dock 避让区 */
  registerSpawnPosition?: (fn: (screenPt?: { x: number; y: number }) => { x: number; y: number }) => void;
  /** 商品卡 ts 驱动注入结果 */
  productPickResult?: { ts: number; productId: string; image: { id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string } } | null;
  /** 资产卡 ts 驱动注入结果 */
  assetPickResult?: { ts: number; assetId: string; ref: { id: string; src: string; type?: 'image' | 'video'; assetId?: string } } | null;
  /** 快捷键复制选中节点（Ctrl/Cmd+D，IKD0JT REQ-A-109）：内部选中态由 Canvas 持有，回调上抛 */
  onDuplicateSelected?: (ids: string[]) => void;
  /** 成组名单（IKD0JT A3）：底框/徽标渲染与整组拖拽依据 */
  groups?: CanvasGroup[];
  /** 成组（IKD0JT A4）：成组按钮 / Ctrl/Cmd+G 上抛选中节点对象（含 measured 实际尺寸，父级按真实包围盒定格组矩形） */
  onCreateGroup?: (nodes: Node[]) => void;
  /** 解组 */
  onUngroupGroup?: (groupId: string) => void;
  /** 删除组（连同成员） */
  onDeleteGroup?: (groupId: string) => void;
  /** 框选/组下载：按节点 id 依次下载组内素材 */
  onDownloadGroup?: (nodeIds: string[]) => void;
  /** 整组拖动结束（动态成员 + 固定矩形），父级落坐标/矩形并登记撤销 */
  onGroupFrameDragStop?: (res: GroupFrameDragResult) => void;
  /** 拖组置顶：数组末尾为最上层，上层组框与素材压住下层 */
  onBringGroupToFront?: (groupId: string) => void;
  /** 组→目标：从组右侧「+」拖到某节点，为组内每个成员各建一条边到目标 */
  onConnectGroupToTarget?: (memberIds: string[], targetId: string) => void;
  onConnectGroupDrop?: (memberIds: string[], targetId: string | null, client: { x: number; y: number }) => void;
  /** 源→组：外部节点拖到组左侧「+」，为该源到组内每个成员各建一条边 */
  onConnectSourceToGroup?: (sourceId: string, memberIds: string[]) => void;
  /** 选择模式下右键画布空白 */
  onPaneContextMenu?: (pt: { clientX: number; clientY: number }) => void;
  /** IKFR4X 画布参考选取会话进行中：隔离节点拖动、框选与普通选中，左键拖空白转为平移 */
  refPickActive?: boolean;
  /** IKFR4X 会话勾选标识：已并入当前选取目标的来源节点 id（渲染期注入角标，不持久化） */
  refPickMarkedIds?: string[];
  /** 视频选取会话中不可选节点（合规未通过等），渲染期置灰 */
  refPickBlockedIds?: string[];
}

function FlowCanvasInner({ showMiniMap, toolMode, extraNodes, textNodes, mediaNodes, productNodes, assetNodes, showEdges, edges, onEdgesChange, onConnect, onConnectStart, onConnectEnd, isValidConnection, viewport, onViewportChange, onViewportLive, onNodeDragStop, onDeleteNode, onNodeClick, onPaneClick, onSelectionChange, registerSpawnPosition, hideZoomControl, productPickResult, assetPickResult, selectRequest, onDuplicateSelected, groups, onCreateGroup, onUngroupGroup, onDeleteGroup, onDownloadGroup, onGroupFrameDragStop, onBringGroupToFront, onConnectGroupToTarget, onConnectGroupDrop, onConnectSourceToGroup, onPaneContextMenu, refPickActive, refPickMarkedIds, refPickBlockedIds }: FlowCanvasProps) {
  const { isPanning: isDrag, onMouseDownCapture, onClickCapture } = useCanvasPan(toolMode);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const extraIdsRef = useRef<Set<string>>(new Set());
  const textIdsRef = useRef<Set<string>>(new Set());
  /** 上次已从父层接受的文本坐标：仅当父层坐标变化时才回写（撤销/拖结束），避免 html 刷新把拖动位置打回 */
  const textParentPosRef = useRef(new Map<string, { x: number; y: number }>());
  const mediaIdsRef = useRef<Set<string>>(new Set());
  const productIdsRef = useRef<Set<string>>(new Set());
  const assetIdsRef = useRef<Set<string>>(new Set());

  /** 父层显式选中请求（IKDMQV）：唯一选中目标并取消其余——经内部 setNodes 应用，
   *  同步 React Flow selection store，避免外部 selected 传播的双选中误报。 */
  const selectReqTsRef = useRef(0);
  useEffect(() => {
    if (!selectRequest || selectRequest.ts === selectReqTsRef.current) return;
    selectReqTsRef.current = selectRequest.ts;
    setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === selectRequest.id })));
  }, [selectRequest, setNodes]);

  const nodeTypes: NodeTypes = useMemo(
    () => ({
      textNode: TextNode,
      mediaNode: MediaNode,
      productNode: ProductNode,
      assetNode: AssetCardNode,
      groupFrame: GroupFrameNode,
    }),
    [],
  );
  const edgeTypes: EdgeTypes = useMemo(() => ({ custom: CustomEdge }), []);
  const { setCenter, setViewport, screenToFlowPosition } = useReactFlow();
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const onViewportLiveRef = useRef(onViewportLive);
  onViewportLiveRef.current = onViewportLive;

  /** 波点缩放补偿：屏幕点半径 = size × zoom，取 size = 1/zoom 使屏幕点径恒定约 2px，
   * 缩小视图（如 58%）时波点依然清晰可见 */
  const { zoom } = useViewport();
  const dotSize = Math.max(0.4, Math.min(4, 1 / zoom));

  /** 向父级注册屏幕点→flow 坐标转换（无参取屏幕视觉中心） */
  useEffect(() => {
    registerSpawnPosition?.((screenPt) =>
      screenToFlowPosition(screenPt ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }),
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

  /** 合并文本节点（新增/删除同步；父层坐标回写含撤销，拖动中不覆盖内部位置） */
  useEffect(() => {
    const newIds = new Set(textNodes.map((n) => n.id));
    const currentIds = textIdsRef.current;
    const added = textNodes.filter((n) => !currentIds.has(n.id));
    const updated = textNodes.filter((n) => currentIds.has(n.id));
    const removed = [...currentIds].filter((id) => !newIds.has(id));

    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
      setNodes((prev) => {
        let result = removed.length > 0 ? prev.filter((n) => !removed.includes(n.id)) : prev;
        if (updated.length > 0) {
          result = result.map((node) => {
            const update = updated.find((u) => u.id === node.id);
            if (!update) return node;
            const prevPos = textParentPosRef.current.get(node.id);
            const parentMoved = !prevPos
              || prevPos.x !== update.position.x
              || prevPos.y !== update.position.y;
            return {
              ...node,
              ...update,
              position: node.dragging ? node.position : parentMoved ? update.position : node.position,
              selected: node.selected,
              dragging: node.dragging,
              measured: node.measured,
            };
          });
        }
        if (added.length > 0) result = [...result, ...added];
        return result;
      });
    }
    textIdsRef.current = newIds;
    textParentPosRef.current = new Map(textNodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
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
          result = result.map((node) => {
            const update = updated.find((u) => u.id === node.id);
            if (!update) return node;
            // 父层只在拖动结束时保存坐标；媒体加载不能覆盖画布当前的交互状态
            // （父层尺寸回填等 update 可能顺带携带过期的 selected，一律以内部交互态为准；
            //  父层显式选中请求走 selectRequest prop，经内部 setNodes 应用——IKDMQV）
            return {
              ...node,
              ...update,
              position: node.dragging ? node.position : update.position,
              selected: node.selected,
              dragging: node.dragging,
              measured: node.measured,
            };
          });
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

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const onDeleteNodeRef = useRef(onDeleteNode);
  onDeleteNodeRef.current = onDeleteNode;
  const onDuplicateSelectedRef = useRef(onDuplicateSelected);
  onDuplicateSelectedRef.current = onDuplicateSelected;
  // groups 是可选 prop：统一落成空数组，避免 408/410/574 处的 groupsRef.current.find 在省略时崩
  const groupsRef = useRef<CanvasGroup[]>(groups ?? []);
  groupsRef.current = groups ?? [];
  const onCreateGroupRef = useRef(onCreateGroup);
  onCreateGroupRef.current = onCreateGroup;
  const onNodeDragStopRef = useRef(onNodeDragStop);
  onNodeDragStopRef.current = onNodeDragStop;
  const onGroupFrameDragStopRef = useRef(onGroupFrameDragStop);
  onGroupFrameDragStopRef.current = onGroupFrameDragStop;

  /** 组成员按组数组顺序分层：后创建/后拖动的组在上，组框与素材一起压住下层。
   *  拖组途中逻辑框未落盘，成员用冻结集合维持所属层。 */
  const [frameDragMemberIds, setFrameDragMemberIds] = useState<Set<string>>(new Set());
  const [frameDragOffset, setFrameDragOffset] = useState<{ id: string; x: number; y: number } | null>(null);
  /** 同步标记：拖组途中立刻挡住框选/选中变更，不等 state 提交 */
  const frameDraggingRef = useRef(false);
  const handleFrameDragMembersChange = useCallback((ids: Set<string>) => {
    frameDraggingRef.current = ids.size > 0;
    setFrameDragMemberIds(ids);
  }, []);
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (frameDraggingRef.current) {
        const next = changes.filter((c) => c.type !== 'select');
        if (next.length === 0) return;
        onNodesChange(next);
        return;
      }
      onNodesChange(changes);
    },
    [onNodesChange],
  );
  /** 节点拖拽中标记：拖动节点（含拖组内成员出组）时隐藏框选悬浮条（成组/下载标签），
   *  这些标签只在静止框选状态出现，不应跟随被拖节点移动。 */
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  /** 组内编辑中的组 id（TC_CX_210）：双击组空白进入，成员可单选编辑；
   *  成员仍算组（组框层级不变），仅改为按普通选中参与交互。 */
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  /** 双击组判定延迟：等待 350ms 内第二次点击，单击/拖拽立即按整组处理 */
  const [pendingGroupPick, setPendingGroupPick] = useState<{ id: string; screen: { x: number; y: number } } | null>(null);
  const pendingGroupPickTimerRef = useRef(0);
  /** 进入组内编辑：选中该组全部成员（内部 setNodes——父层 selected 字段被合并保护忽略） */
  const enterGroupEdit = useCallback((groupId: string) => {
    const g = groupsRef.current.find((x) => x.id === groupId);
    if (!g) return;
    const memberIds = new Set(exclusiveMembersInGroup(nodesRef.current, g, groupsRef.current).map((n) => n.id));
    if (memberIds.size === 0) return;
    setNodes((prev) => prev.map((n) => ({ ...n, selected: memberIds.has(n.id) })));
    setEditGroupId(groupId);
  }, [setNodes]);
  /** 连续快速点击同一组且全程无位移时视为双击（进入组内编辑） */
  const onGroupClick = useCallback((groupId: string, screen: { x: number; y: number }) => {
    if (pendingGroupPick?.id === groupId) {
      window.clearTimeout(pendingGroupPickTimerRef.current);
      pendingGroupPickTimerRef.current = 0;
      setPendingGroupPick(null);
      enterGroupEdit(groupId);
      return;
    }
    setPendingGroupPick({ id: groupId, screen });
    pendingGroupPickTimerRef.current = window.setTimeout(() => {
      pendingGroupPickTimerRef.current = 0;
      setPendingGroupPick(null);
    }, 350);
  }, [pendingGroupPick, enterGroupEdit]);
  const onGroupClickSuppress = useCallback(() => {
    if (pendingGroupPickTimerRef.current) {
      window.clearTimeout(pendingGroupPickTimerRef.current);
      pendingGroupPickTimerRef.current = 0;
    }
    setPendingGroupPick(null);
  }, []);
  /** 点组外空白退出组内编辑：组内成员取消选中，操作条收起 */
  const exitGroupEdit = useCallback(() => {
    setEditGroupId(null);
  }, []);
  const memberStackById = useMemo(() => {
    const stack = new Map<string, number>();
    groups?.forEach((g, i) => {
      exclusiveMembersInGroup(nodes, g, groups).forEach((n) => stack.set(n.id, i));
    });
    return stack;
  }, [groups, nodes]);
  const nodesForFlow = useMemo(() => {
    const list = groups ?? [];
    const topStack = Math.max(0, list.length - 1);
    // IKFR4X 会话勾选集合：仅会话活跃时标记（Set 查询 O(1)）
    const pickMarked = new Set(refPickMarkedIds ?? []);
    const pickBlocked = new Set(refPickBlockedIds ?? []);
    const content = nodes
      .filter((n) => n.type !== 'groupFrame')
      .map((n) => {
        if (frameDragMemberIds.has(n.id)) {
          return { ...n, zIndex: groupMemberZ(topStack) + 20 };
        }
        const stack = memberStackById.get(n.id);
        const zIndex = stack == null ? 0 : groupMemberZ(stack);
        // IKFM3S §4 / IKFM3W §10 / IKFM41 §11：「输入已更新」徽标派生注入（图片/视频/音频
        // 目标 + 文本入边 + 签名不一致），纯渲染期派生不持久化；来源文本卡 id 一并注入供定位入口。
        const staleMediaType = n.type === 'mediaNode'
          ? (n.data as Record<string, unknown> | undefined)?.mediaType
          : undefined;
        const stale = n.type === 'mediaNode'
          && (staleMediaType === 'image' || staleMediaType === 'video' || staleMediaType === 'audio')
          && mediaInputStale(n.id, edges, nodes, staleMediaType);
        // IKFR4X 勾选标识派生注入（已并入当前选取目标的来源节点）：纯渲染期派生不持久化，可与「输入已更新」并存
        const marked = pickMarked.size > 0 && pickMarked.has(n.id);
        const blocked = pickBlocked.size > 0 && pickBlocked.has(n.id);
        if (!stale && !marked && !blocked) return { ...n, zIndex };
        return {
          ...n,
          zIndex,
          data: {
            ...n.data,
            ...(stale ? { inputStale: true, inputSourceNodeId: firstTextSourceOf(n.id, edges, nodes) } : {}),
            ...(marked ? { pickMarked: true } : {}),
            ...(blocked ? { pickBlocked: true } : {}),
          },
        };
      });
    const frames: Node[] = list.map((g, i) => {
      const box =
        frameDragOffset?.id === g.id
          ? { ...g.box, x: g.box.x + frameDragOffset.x, y: g.box.y + frameDragOffset.y }
          : g.box;
      return {
        id: g.id,
        type: 'groupFrame',
        position: { x: box.x, y: box.y },
        width: box.w,
        height: box.h,
        style: { width: box.w, height: box.h, pointerEvents: 'none' },
        zIndex: groupFrameZ(i),
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
        deletable: false,
        data: {},
      };
    });
    return [...frames, ...content];
  }, [nodes, groups, memberStackById, frameDragMemberIds, frameDragOffset, edges, refPickMarkedIds, refPickBlockedIds]);

  /** 节点拖拽起：仅标记拖拽中（隐藏框选悬浮条）。组内节点可自由拖出组，拖出后按
   *  坐标动态脱离组；不再整组选中——整组拖动改由组框把手承担。 */
  const onNodeDragStart = useCallback((_e: MouseEvent | TouchEvent, _node: Node) => {
    setIsDraggingNode(true);
  }, []);

  const handleNodeDragStopInternal = useCallback(
    (_e: MouseEvent | TouchEvent, node: Node, draggedNodes: Node[]) => {
      setIsDraggingNode(false);
      onNodeDragStopRef.current?.(node, draggedNodes);
    },
    [],
  );

  /** Delete/Backspace 删除选中节点；Enter 继续拦截（输入框/编辑器内保持原语义）。
   *  连线级联删除由父级完成：节点离开各列表后，悬空连线被统一定时清理（IKDLQF）。
   *  内部 nodes 不在此处直接移除（IKDMQW）：生成中卡片的删除是「先取消后移除」的异步流程，
   *  若内部抢先移除而父级在取消竞态中保留卡片（任务抢先成功保留作品），节点会从画布消失；
   *  统一由父级各列表状态驱动，各合并 effect 的 removed 分支同步内部 nodes。
   *  快捷键（IKD0JT）：Ctrl/Cmd+D 复制选中节点（偏移落位由父级 duplicate 处理）；
   *  Ctrl/Cmd+A 全选画布节点（拖动模式不响应，保持既有手势语义）；
   *  Ctrl/Cmd+G 选中 ≥2 节点成组。 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === 'd' && !isEditableKeyboardTarget(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          const ids = nodesRef.current.filter((n) => n.selected).map((n) => n.id);
          if (ids.length > 0) onDuplicateSelectedRef.current?.(ids);
          return;
        }
        if (key === 'g' && !isEditableKeyboardTarget(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          const selected = nodesRef.current.filter((n) => n.selected);
          if (selected.length >= MIN_GROUP_MEMBERS) onCreateGroupRef.current?.(selected);
          return;
        }
        if (key === 'a' && !isEditableKeyboardTarget(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          setNodes((prev) => prev.map((n) => ({ ...n, selected: true })));
          return;
        }
        return;
      }
      const action = canvasDeleteKeyAction(e.key, e.target);
      if (action === 'ignore') return;
      e.preventDefault();
      e.stopPropagation();
      if (action !== 'delete-selected') return;

      deleteSelectedCanvasNodes(nodesRef.current, onDeleteNodeRef.current);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [setNodes]);

  /** 组内编辑中：点组外空白退出（成员已可单选编辑；组外落点不命中成员时清空编辑态）。
   *  不拦截 pane 事件，退出交给 onPaneClick 统一处理（同步取消选中）。 */
  useEffect(() => {
    if (!editGroupId) return;
    const onPaneDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      // 命中节点/连线/面板 → 仍在组内编辑
      if (target && (target.closest('.react-flow__node') || target.closest('.react-flow__edge') || target.closest('.react-flow__panel'))) return;
      const g = groupsRef.current.find((x) => x.id === editGroupId);
      if (!g) {
        exitGroupEdit();
        return;
      }
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const inBox = p.x >= g.box.x && p.x <= g.box.x + g.box.w && p.y >= g.box.y && p.y <= g.box.y + g.box.h;
      if (!inBox) exitGroupEdit();
    };
    window.addEventListener('pointerdown', onPaneDown, true);
    return () => window.removeEventListener('pointerdown', onPaneDown, true);
  }, [editGroupId, exitGroupEdit, screenToFlowPosition]);

  /** 卸载或 groups 变化时清理双击待确认计时器 */
  useEffect(() => () => {
    if (pendingGroupPickTimerRef.current) window.clearTimeout(pendingGroupPickTimerRef.current);
  }, []);

  return (
    <div
      className={`${styles.canvasContainer} ${isDrag ? styles.dragMode : ''}`}
      onMouseDownCapture={onMouseDownCapture}
      onClickCapture={onClickCapture}
      onDoubleClickCapture={onClickCapture}
    >
      <ReactFlow
        nodes={nodesForFlow}
        edges={showEdges ? edges : []}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={(_e, params) => onConnectStart?.(params.nodeId ?? null)}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        connectionLineComponent={ConnectionPreview}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeClick={
          onNodeClick
            ? (_e, node) => {
                // 阻止节点点击冒泡到 pane，避免「到节点选择」命中节点时误触画布空白关闭（视频/图片/音频生成面板）
                _e.stopPropagation();
                onNodeClick(node);
              }
            : undefined
        }
        onPaneClick={onPaneClick}
        onSelectionChange={frameDragMemberIds.size > 0 ? undefined : onSelectionChange}
        onMove={(_e, v) => onViewportLiveRef.current?.(v)}
        onMoveEnd={(_e, v) => onViewportChangeRef.current?.(v)}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={handleNodeDragStopInternal}
        onContextMenu={(e) => {
          e.preventDefault();
          if (toolMode !== 'select') return;
          const el = e.target as HTMLElement;
          if (el.closest('.react-flow__node') || el.closest('.react-flow__edge')) return;
          onPaneContextMenu?.({ clientX: e.clientX, clientY: e.clientY });
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // 中键（button 1）任意模式均可平移（IKD0JT A1 R2）；拖动模式左键也平移，选择模式左键留给框选；
        // IKFR4X 参考选取会话中框选被隔离，左键空白拖拽转为平移（平移/缩放保持可用）
        panOnDrag={refPickActive ? [0, 1] : isDrag ? [0, 1] : [1]}
        // 拖节点/连线/框选到边缘时不自动跟平移，画布只走手动平移规则
        autoPanOnNodeDrag={false}
        autoPanOnConnect={false}
        autoPanOnSelection={false}
        // 滚轮=平移；缩放交给平台原生修饰键+滚轮与触控板捏合（库默认为滚轮缩放，此处刻意相反，见 ADR-0081）
        panOnScroll
        zoomOnScroll={false}
        panActivationKeyCode={null}
        // IKFR4X 参考选取会话：框选隔离；整组拖动期间同样关掉框选，避免选框扫到组外节点
        selectionOnDrag={!refPickActive && frameDragMemberIds.size === 0}
        selectionMode={SelectionMode.Partial}
        zoomOnDoubleClick={!isDrag}
        nodesDraggable={!isDrag && !refPickActive}
        elementsSelectable={!isDrag && !refPickActive}
        nodesConnectable
        nodesFocusable={false}
        edgesFocusable={false}
        minZoom={0.2}
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
        {/* GroupOverlay 必须作为 ReactFlow 的 children 渲染：
         *  .react-flow 根有 position:relative + z-index:0，自成层叠上下文，会把整棵子树
         *  （含 .react-flow__renderer z4 与全部节点）压平到 0 层。若把 overlay 放在
         *  <ReactFlow> 之外做兄弟节点，其 frameLayer 会在外层与 0 比较而盖住所有节点。
         *  放进内部后徽标层才能与 renderer 同上下文比较。
         *  组框是 groupFrame 节点，与素材共用 zIndex：上层组框压下层素材，上层素材再压本组组框。 */}
        {groups && (
          <GroupOverlay
            nodes={nodes}
            groups={groups}
            onCreateGroup={onCreateGroup ?? (() => {})}
            onUngroup={onUngroupGroup ?? (() => {})}
            onDeleteGroup={onDeleteGroup ?? (() => {})}
            onDownloadNodes={onDownloadGroup ?? (() => {})}
            setNodes={setNodes}
            onGroupFrameDragStop={onGroupFrameDragStopRef.current}
            onFrameDragMembersChange={handleFrameDragMembersChange}
            onFrameDragOffsetChange={setFrameDragOffset}
            onBringGroupToFront={onBringGroupToFront}
            onGroupClick={onGroupClick}
            onGroupClickSuppress={onGroupClickSuppress}
            editGroupId={editGroupId}
            onConnectGroupToTarget={onConnectGroupToTarget ?? (() => {})}
            onConnectGroupDrop={onConnectGroupDrop}
            onConnectSourceToGroup={onConnectSourceToGroup ?? (() => {})}
            isDraggingNode={isDraggingNode}
          />
        )}
      </ReactFlow>
      {!hideZoomControl && <ZoomControl />}
    </div>
  );
}

export default function FlowCanvas({ showMiniMap, toolMode, extraNodes, textNodes, mediaNodes, productNodes, assetNodes, showEdges, edges, onEdgesChange, onConnect, onConnectStart, onConnectEnd, isValidConnection, viewport, onViewportChange, onViewportLive, onNodeDragStop, onDeleteNode, onNodeClick, onPaneClick, onSelectionChange, registerSpawnPosition, hideZoomControl, productPickResult, assetPickResult, selectRequest, onDuplicateSelected, groups, onCreateGroup, onUngroupGroup, onDeleteGroup, onDownloadGroup, onGroupFrameDragStop, onBringGroupToFront, onConnectGroupToTarget, onConnectGroupDrop, onConnectSourceToGroup, onPaneContextMenu, refPickActive, refPickMarkedIds, refPickBlockedIds }: FlowCanvasProps) {
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
        edges={edges}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        viewport={viewport}
        onViewportChange={onViewportChange}
        onViewportLive={onViewportLive}
        onNodeDragStop={onNodeDragStop}
        onDeleteNode={onDeleteNode}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onSelectionChange={onSelectionChange}
        registerSpawnPosition={registerSpawnPosition}
        hideZoomControl={hideZoomControl}
        productPickResult={productPickResult}
        assetPickResult={assetPickResult}
        selectRequest={selectRequest}
        onDuplicateSelected={onDuplicateSelected}
        groups={groups}
        onCreateGroup={onCreateGroup}
        onUngroupGroup={onUngroupGroup}
        onDeleteGroup={onDeleteGroup}
        onDownloadGroup={onDownloadGroup}
        onGroupFrameDragStop={onGroupFrameDragStop}
        onBringGroupToFront={onBringGroupToFront}
        onConnectGroupToTarget={onConnectGroupToTarget}
        onConnectGroupDrop={onConnectGroupDrop}
        onConnectSourceToGroup={onConnectSourceToGroup}
        onPaneContextMenu={onPaneContextMenu}
        refPickActive={refPickActive}
        refPickMarkedIds={refPickMarkedIds}
        refPickBlockedIds={refPickBlockedIds}
      />
    </ReactFlowProvider>
  );
}
