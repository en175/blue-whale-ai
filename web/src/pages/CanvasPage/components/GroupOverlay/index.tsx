/* ============================================
 * GroupOverlay 成组交互层（IKD0JT A3/A4）：
 * - 组底框：由 groupFrame 节点按数组顺序分层渲染（后拖动的组压住先有的组）
 * - 组徽标：底框左上角屏幕空间徽标，点击展开操作条（解组/删除）
 * - 成组入口：≥2 节点选中且未全部同组时，在选区上方浮现「成组」；框选后同时提供「下载」
 *   （Ctrl/Cmd+G 快捷键同效，见 Canvas 键盘处理）
 * - 动态成员：节点是否属于组 = 是否落在组矩形内且不属于其他组（组与组独立）。
 * - 整组拖动：拖起组顶部把手，实时移动「当前在框内的全部节点」+ 组矩形
 *   （矩形视觉经本地偏移跟随，结束时一次性上抛父级落盘 + 登记撤销）
 * - 拖组途中徽标人数冻结为拖起时的独立成员数，选框扫过组外节点不改计数
 * 根层 pointer-events:none，仅徽标/按钮/操作条/把手可交互，不遮挡节点操作。
 * ============================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, useViewport, getBezierPath, Position, type Node } from '@xyflow/react';
import { Group, Ungroup, Trash2, Download, Plus } from 'lucide-react';
import {
  memberBBox,
  exclusiveMembersInGroup,
  membersInGroupBox,
  MIN_GROUP_MEMBERS,
  nodeInsideGroupBox,
  contentNodeAtFlowPoint,
  type CanvasGroup,
  type GroupBBox,
  type GroupFrameDragResult,
  type PositionRecord,
} from '../../canvasGroups';
import styles from './index.module.css';

/** 捕获阶段须放行的覆盖层：目标在这些子树上时，不按「组框穿透到 pane / 内容卡盒」拦截。
 *  扩图框、裁切框手柄压在源卡盒边界上（IKGOQ0 / IKH1WJ）；
 *  钉屏幕工具条 / 二级菜单 / 跟随对话框迁出 .react-flow__node 后同样压在卡盒上（IKHCUA）。 */
function isPassthroughOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest('[data-outpaint-frame]')
    || target.closest('[data-crop-frame]')
    || target.closest('[data-gen-panel-territory]'),
  );
}

interface GroupOverlayProps {
  /** 画布内部节点（含实时坐标 / 选中态 / measured 尺寸，拖拽中实时更新） */
  nodes: Node[];
  groups: CanvasGroup[];
  /** 成组：上抛选中节点对象（含 measured 实际尺寸），父级据此定格组矩形 */
  onCreateGroup: (nodes: Node[]) => void;
  onUngroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  /** 依次下载组内/框选节点中的可下载素材 */
  onDownloadNodes: (nodeIds: string[]) => void;
  /** 内部节点落笔（整组拖动实时移动成员用） */
  setNodes: (updater: (prev: Node[]) => Node[]) => void;
  /** 整组拖动结束：上抛矩形前后 + 成员节点位移，父级落盘并登记撤销 */
  onGroupFrameDragStop?: (res: GroupFrameDragResult) => void;
  /** 整组拖动起止：上抛「冻结的本次拖动成员集合」（拖起时传集合，结束时传空集合），
   *  供父级在拖组途中维持成员的高 zIndex（逻辑框未随拖动更新，避免成员被误判出组）。 */
  onFrameDragMembersChange?: (ids: Set<string>) => void;
  /** 整组拖动时组框本地偏移，供组框节点跟手 */
  onFrameDragOffsetChange?: (offset: { id: string; x: number; y: number } | null) => void;
  /** 拖组/点组置顶 */
  onBringGroupToFront?: (groupId: string) => void;
  /** 组空白单击（无位移）：默认激活组（展开徽标）；双击由父级判定后进入组内编辑 */
  onGroupClick?: (groupId: string, screen: { x: number; y: number }) => void;
  /** 组发生拖拽（有位移）：取消父级双击待确认 */
  onGroupClickSuppress?: () => void;
  /** 组内编辑中的组 id（TC_CX_210）：编辑中不吞 click，点组外空白才能触发 pane 取消选中 */
  editGroupId?: string | null;
  /** 组拖线松手：只弹可选菜单，不接到已有节点（targetId 仍上报，父级忽略） */
  onConnectGroupDrop?: (memberIds: string[], targetId: string | null, client: { x: number; y: number }) => void;
  /** 组→已有节点：兼容旧回调；组拖线现只走菜单，不再接到节点 */
  onConnectGroupToTarget?: (memberIds: string[], targetId: string) => void;
  /** 源→组：外部节点拖到组左侧「+」，为该源到组内每个成员各建一条边 */
  onConnectSourceToGroup?: (sourceId: string, memberIds: string[]) => void;
  /** 节点拖拽中：拖动节点时隐藏框选悬浮条（成组/下载标签只在静止框选时出现） */
  isDraggingNode?: boolean;
  /** 抓手态（空格按住或工具栏拖动模式）：内容区 pointerdown/双击整体让位给平移——
   *  不补选中、不拖组、不进编辑，事件穿透到 pane 由平移接管（IKJFH1）。
   *  徽标/操作条/连线把手等控件层不受它影响。 */
  isPanning?: boolean;
}

interface FrameInfo {
  id: string;
  box: GroupBBox;
  count: number;
  excludedIds: string[];
}

/** 拖动中的本地矩形偏移（flow 单位），使组框在结束落盘前跟手 */
interface DragOffset {
  id: string;
  x: number;
  y: number;
}

export default function GroupOverlay({
  nodes,
  groups,
  onCreateGroup,
  onUngroup,
  onDeleteGroup,
  onDownloadNodes,
  setNodes,
  onGroupFrameDragStop,
  onFrameDragMembersChange,
  onFrameDragOffsetChange,
  onBringGroupToFront,
  onGroupClick,
  onGroupClickSuppress,
  editGroupId,
  onConnectGroupToTarget,
  onConnectGroupDrop,
  isDraggingNode,
  isPanning,
}: GroupOverlayProps) {
  const { flowToScreenPosition, screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  /** 组「+」拖线中：右键 / 点空白不得收起组，否则手柄会随组激活态一起卸掉 */
  const connectDraggingRef = useRef(false);
  const [dragOffset, setDragOffset] = useState<DragOffset | null>(null);
  /** 整组拖动期间冻结的成员名单：徽标计数只认拖起时的集合，不跟选框实时相交 */
  const [frozenDragMembers, setFrozenDragMembers] = useState<{
    groupId: string;
    ids: Set<string>;
  } | null>(null);

  /** 组底框：直接用固定矩形渲染。静止时 count 为矩形内独立成员数；拖组时用冻结名单。 */
  const frames = useMemo<FrameInfo[]>(
    () =>
      groups.map((g) => {
        let count: number;
        if (frozenDragMembers?.groupId === g.id) {
          count = frozenDragMembers.ids.size;
        } else if (frozenDragMembers) {
          count = exclusiveMembersInGroup(nodes, g, groups).filter(
            (n) => !frozenDragMembers.ids.has(n.id),
          ).length;
        } else {
          count = exclusiveMembersInGroup(nodes, g, groups).length;
        }
        return {
          id: g.id,
          box: g.box,
          count,
          excludedIds: g.excludedIds,
        };
      }),
    [groups, nodes, frozenDragMembers],
  );

  /** 成组入口：≥2 选中且未全部落在同一组矩形内（已同组时徽标即操作入口） */
  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const selectedIds = selectedNodes.map((n) => n.id);
  const allInOneGroup =
    selectedIds.length >= MIN_GROUP_MEMBERS &&
    groups.some(
      (g) =>
        !selectedIds.some((id) => g.excludedIds.includes(id)) &&
        selectedNodes.every((n) => nodeInsideGroupBox(n, g.box)),
    );
  const selectionBox = useMemo(
    () => (selectedNodes.length >= MIN_GROUP_MEMBERS ? memberBBox(selectedNodes) : null),
    [selectedNodes],
  );
  const showCreateBtn = !!selectionBox && !allInOneGroup && !isDraggingNode;
  /* 框选悬浮条的下载入口仅在「多选且未全部同组」时出现：已成组后下载由组徽标操作条承担，
   *  避免与节点工具栏自带的下载图标重复（用户故事：成组后中间不再出现下载按钮）。
   *  拖动节点时隐藏：成组/下载标签只在静止框选状态出现，不跟随被拖节点移动。 */
  const showSelectionDownload = !!selectionBox && !allInOneGroup && !isDraggingNode;
  const createBtnPt = selectionBox
    ? flowToScreenPosition({ x: selectionBox.x + selectionBox.w / 2, y: selectionBox.y })
    : null;

  /** 点击空白处收起操作条（点击组徽标 / 操作条 / 右侧「+」连线把手本身不收起） */
  useEffect(() => {
    if (!openGroupId) return;
    const close = (e: MouseEvent) => {
      if (e.button !== 0 || connectDraggingRef.current) return;
      if (!(e.target instanceof Element)) return;
      if (
        e.target.closest(`.${styles.groupTools}`) ||
        e.target.closest(`.${styles.groupBadgeWrap}`) ||
        e.target.closest(`.${styles.connectHandle}`)
      )
        return;
      setOpenGroupId(null);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [openGroupId]);

  /** 整组拖动（IKD0JT A4 动态成员）：拖起组顶部把手，把「当前在矩形内的节点」整体平移。
   *  矩形/成员坐标经本地偏移即时跟随，结束时一次性上抛父级落盘 + 撤销。 */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const draggingRef = useRef(false);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  /** 供 window 级命中测试读取最新组数据（避免监听器随 groups 变化反复重挂） */
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  /** 组内编辑态镜像（window 捕获监听器读取，避免随状态反复重挂） */
  const editGroupIdRef = useRef(editGroupId);
  editGroupIdRef.current = editGroupId ?? null;
  /** 抓手态镜像（同理：window 捕获监听器读取最新值，不随抓手态反复重挂） */
  const isPanningRef = useRef(isPanning);
  isPanningRef.current = isPanning ?? false;
  /** pane DOM（承载光标反馈）：组框在节点层之下无法自己显示 cursor，改由 pane 内联光标表达 */
  const paneRef = useRef<HTMLElement | null>(null);
  /** 拖组结束后需吞掉一次 click（避免冒泡到 pane 触发 onPaneClick 清空选中） */
  const clickSuppressRef = useRef(false);
  /** 组框穿透点到内容卡：pointerdown 已补选中，必须吞掉随后打在 pane 上的 click，
   *  否则 onPaneClick 会立刻清掉选中（与拖组吞 click 分开：组内编辑时拖组仍要放行 pane） */
  const contentClickSuppressRef = useRef(false);
  /** 内容卡上的按下时刻：选中重绘会拆掉 dblclick，用间隔识别双击进编辑 */
  const lastContentPressRef = useRef({ id: '', at: 0 });
  const uiLayerRef = useCallback((el: HTMLDivElement | null) => {
    paneRef.current = el
      ? el.closest('.react-flow')?.querySelector<HTMLElement>('.react-flow__pane') ?? null
      : null;
  }, []);
  const dragStateRef = useRef<{
    groupId: string;
    startScreen: { x: number; y: number };
    dx: number;
    dy: number;
    oldBox: GroupBBox;
    excludedBefore: string[];
    nodeOld: Map<string, { x: number; y: number }>;
    nodeNew: Map<string, { x: number; y: number }>;
  } | null>(null);

  /** 结束：组矩形 + 成员位移 + 排除名单上抛父级（闭包 nodes 已过期，故用拖拽累积的最新位置）。
   *  成员可为空（拖空框 = 动态圈选场景），矩形位移仍需落盘避免框弹回。 */
  const endFrameDrag = useCallback(() => {
    const s = dragStateRef.current;
    dragStateRef.current = null;
    setDragOffset(null);
    if (!s) return;
    if (s.dx === 0 && s.dy === 0) return;
    const nodeOld: PositionRecord[] = [...s.nodeOld.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y }));
    const nodeNew: PositionRecord[] = [...s.nodeNew.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y }));
    const newBox = {
      x: s.oldBox.x + s.dx,
      y: s.oldBox.y + s.dy,
      w: s.oldBox.w,
      h: s.oldBox.h,
    };
    // 方向性规则：组盖到节点上 ≠ 吸收。新矩形内非本次拖动成员的节点 → 排除
    // （节点此后再被用户拖动时，若仍在矩形内则解除排除重新吸收，见父级 handleNodeDragStop）
    const draggedIds = new Set(s.nodeNew.keys());
    const excludedAfter = nodesRef.current
      .filter((n) => !draggedIds.has(n.id) && nodeInsideGroupBox(n, newBox))
      .map((n) => n.id);
    onGroupFrameDragStop?.({
      groupId: s.groupId,
      oldBox: s.oldBox,
      newBox,
      nodeOld,
      nodeNew,
      excludedBefore: s.excludedBefore,
      excludedAfter,
    });
  }, [onGroupFrameDragStop]);

  /** 实时平移：屏幕位移 / zoom → flow 位移，更新框内节点坐标 + 本地矩形偏移跟随 */
  const onFrameMove = useCallback(
    (e: PointerEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      const dx = (e.clientX - s.startScreen.x) / zoomRef.current;
      const dy = (e.clientY - s.startScreen.y) / zoomRef.current;
      s.dx = dx;
      s.dy = dy;
      const offset = { id: s.groupId, x: dx, y: dy };
      setDragOffset(offset);
      onFrameDragOffsetChange?.(offset);
      s.nodeNew.forEach((_, id) => {
        const start = s.nodeOld.get(id);
        if (start) s.nodeNew.set(id, { x: start.x + dx, y: start.y + dy });
      });
      setNodes((prev) =>
        prev.map((n) => {
          const p = s.nodeNew.get(n.id);
          return p ? { ...n, position: { x: p.x, y: p.y } } : n;
        }),
      );
    },
    [setNodes, onFrameDragOffsetChange],
  );

  const endDrag = useCallback(() => {
    window.removeEventListener('pointermove', onFrameMove);
    window.removeEventListener('pointerup', endDrag);
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (paneRef.current) paneRef.current.style.cursor = '';
    // 先抓取本次拖拽状态：endFrameDrag 会清空 dragStateRef。若全程无位移（dx=dy=0）
    // 则视为「点击组区域」——激活该组（展开徽标操作条 + 显示右侧「+」连线把手），
    // 与点击徽标同效。有位移则按整组拖动落盘。
    const s = dragStateRef.current;
    const isClick = !!s && s.dx === 0 && s.dy === 0;
    endFrameDrag();
    // 拖组结束：清空冻结成员集合，成员层级回归按落盘后的逻辑框判定
    setFrozenDragMembers(null);
    onFrameDragMembersChange?.(new Set());
    onFrameDragOffsetChange?.(null);
    if (isClick && s) {
      // 组内编辑中：单击组空白仅激活徽标（不进入/不退出编辑），双击由父级 onGroupClick 判定
      onGroupClick?.(s.groupId, { x: s.startScreen.x, y: s.startScreen.y });
      setOpenGroupId((prev) => (prev === s.groupId ? null : s.groupId));
    } else if (s) {
      onGroupClickSuppress?.();
    }
    // 吞掉本次按下抬起派发的 click：否则会冒泡到 pane 触发 onPaneClick 清空选中
    // （click 在 mouseup 后同轮派发，故用宏任务在本轮结束后复位标记）
    clickSuppressRef.current = true;
    window.setTimeout(() => {
      clickSuppressRef.current = false;
    }, 0);
  }, [onFrameMove, endFrameDrag, onFrameDragMembersChange, onFrameDragOffsetChange, onGroupClick, onGroupClickSuppress]);

  /** 按下开始拖动整组：冻结本组独立成员作为本次拖动集合。
   *  其他组成员即使落在本矩形内也不带走；被排除节点不随组移动；成员可为空。
   *  按下即置顶。组框节点 pointer-events:none，仍由 window 捕获阶段命中测试驱动。 */
  const startFrameDrag = useCallback(
    (clientX: number, clientY: number, g: CanvasGroup) => {
      const nodeOld = new Map<string, { x: number; y: number }>();
      exclusiveMembersInGroup(nodesRef.current, g, groupsRef.current).forEach((n) => {
        nodeOld.set(n.id, { x: n.position.x, y: n.position.y });
      });
      draggingRef.current = true;
      dragStateRef.current = {
        groupId: g.id,
        startScreen: { x: clientX, y: clientY },
        dx: 0,
        dy: 0,
        oldBox: { ...g.box },
        excludedBefore: [...g.excludedIds],
        nodeOld,
        nodeNew: new Map(nodeOld),
      };
      if (paneRef.current) paneRef.current.style.cursor = 'grabbing';
      setFrozenDragMembers({ groupId: g.id, ids: new Set(nodeOld.keys()) });
      onBringGroupToFront?.(g.id);
      onFrameDragMembersChange?.(new Set(nodeOld.keys()));
      onFrameDragOffsetChange?.({ id: g.id, x: 0, y: 0 });
      window.addEventListener('pointermove', onFrameMove);
      window.addEventListener('pointerup', endDrag);
    },
    [onFrameMove, endDrag, onFrameDragMembersChange, onFrameDragOffsetChange, onBringGroupToFront],
  );

  /** 命中测试：屏幕点是否落在某组矩形的「空白区」。
   *  落在节点/边/面板/自有 UI（徽标、操作条、成组按钮）或任何画布外 portal
   *  （如 body 挂载的右键菜单）上时返回 null，交回各自处理。
   *  组框 pointer-events:none，点击会穿透到 pane：除 e.target 外还用
   *  elementsFromPoint 穿透叠层，避免把内容卡误判成组空白（IKG7VR）。 */
  const hitGroupAt = useCallback(
    (clientX: number, clientY: number, target: EventTarget | null): CanvasGroup | null => {
      if (!(target instanceof Element)) return null;
      if (!target.closest('.react-flow')) return null;
      if (
        (target.closest('.react-flow__node') && !target.closest('.react-flow__node-groupFrame')) ||
        target.closest('.react-flow__edge') ||
        target.closest('.react-flow__panel') ||
        target.closest(`.${styles.groupBadgeWrap}`) ||
        target.closest(`.${styles.groupTools}`) ||
        target.closest(`.${styles.selectionBar}`) ||
        target.closest(`.${styles.connectHandle}`)
      ) {
        return null;
      }
      for (const el of document.elementsFromPoint(clientX, clientY)) {
        if (!(el instanceof Element)) continue;
        const nodeEl = el.closest('.react-flow__node');
        if (nodeEl && !nodeEl.classList.contains('react-flow__node-groupFrame')) return null;
      }
      const p = screenToFlowPosition({ x: clientX, y: clientY });
      if (contentNodeAtFlowPoint(nodesRef.current, p)) return null;
      const list = groupsRef.current;
      // 后创建的组视觉上在上层：倒序取首个命中
      for (let i = list.length - 1; i >= 0; i--) {
        const g = list[i];
        if (
          p.x >= g.box.x &&
          p.x <= g.box.x + g.box.w &&
          p.y >= g.box.y &&
          p.y <= g.box.y + g.box.h
        ) {
          return g;
        }
      }
      return null;
    },
    [screenToFlowPosition],
  );

  /** 捕获阶段接管 pointerdown：组框层在 renderer(z4) 之下、pane 铺满画布会吃掉事件，
   *  故不靠组框自身接事件，而在 window 捕获阶段先做命中测试。命中「组内空白」时
   *  stopPropagation 阻断事件下传到 pane —— ReactFlow v12 的框选由 pane 上的
   *  `onPointerDownCapture`（React 合成捕获）驱动，React 在根容器挂捕获监听，window
   *  原生捕获先于它执行，此处 stopPropagation 即可在合成捕获前阻断框选武装；
   *  平移则由 d3-zoom 的 `mousedown.zoom` 驱动，select 模式左键已被 panOnDrag=[1] 过滤，
   *  不会被触发。 */
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      // 抓手态：内容区按下整体让位给平移——不补选中、不拦框选、不拖组（IKJFH1）
      if (isPanningRef.current) return;
      if (e.button !== 0 || !e.isPrimary || draggingRef.current) return;
      // 扩图框 / 裁切框 / 钉屏幕浮层都压在内容卡盒上，target 却不在 .react-flow__node 内。
      // 不放行会被当成「组框穿透到 pane」：拦传播并程序化选中下方节点（IKGOQ0 / IKH1WJ / IKHCUA）。
      if (isPassthroughOverlayTarget(e.target)) return;
      const flowPoint = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const content = contentNodeAtFlowPoint(nodesRef.current, flowPoint);
      if (content) {
        const onContentNode = e.target instanceof Element
          && Boolean(e.target.closest('.react-flow__node'))
          && !e.target.closest('.react-flow__node-groupFrame');
        const now = performance.now();
        const last = lastContentPressRef.current;
        // 下限避开选中抬 zIndex 重绘触发的连发 pointerdown（~0–16ms），
        // 否则单击会被当成双击进编辑，Backspace 只改正文删不掉节点。
        const isDouble = last.id === content.id && now - last.at >= 80 && now - last.at < 350;
        lastContentPressRef.current = { id: content.id, at: now };
        // 事件已打在卡片上：放行走原有单击/拖拽/双击（媒体改名、节点放大等）
        if (onContentNode) return;
        // 组框穿透到 pane：拦住框选；单击补选中（否则后续 click 打在 pane 会清掉选中，
        // Delete/Backspace 没有目标）；双击文本卡再进编辑。
        e.stopPropagation();
        setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === content.id })));
        contentClickSuppressRef.current = true;
        window.setTimeout(() => {
          contentClickSuppressRef.current = false;
        }, 0);
        if (isDouble && content.type === 'textNode') {
          const editor = document.querySelector(
            `.react-flow__node[data-id="${CSS.escape(content.id)}"] [data-placeholder="输入内容..."]`,
          );
          editor?.dispatchEvent(new Event('bw-enter-edit'));
        }
        return;
      }
      const g = hitGroupAt(e.clientX, e.clientY, e.target);
      if (!g) return;
      // 只阻断冒泡到 pane（框选），不 preventDefault——否则正在编辑的文本卡无法失焦退出
      e.stopPropagation();
      startFrameDrag(e.clientX, e.clientY, g);
    };
    // 拖组结束吞掉派发的 click；组内编辑中不吞——点组外空白的 click 需到达 pane 触发 onPaneClick 取消选中
    const onClick = (e: MouseEvent) => {
      if (contentClickSuppressRef.current) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (!clickSuppressRef.current || editGroupIdRef.current) return;
      e.stopPropagation();
      e.preventDefault();
    };
    // 双击组空白 = 进入组内编辑（TC_CX_210），拦截 d3-zoom 的双击缩放避免视口跳动
    const onDblClick = (e: MouseEvent) => {
      // 抓手态：双击同样让位，不拦截、不触发任何内容区语义（IKJFH1）
      if (isPanningRef.current) return;
      if (isPassthroughOverlayTarget(e.target)) return;
      const flowPoint = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const content = contentNodeAtFlowPoint(nodesRef.current, flowPoint);
      if (content) {
        const onContentNode = e.target instanceof Element
          && Boolean(e.target.closest('.react-flow__node'))
          && !e.target.closest('.react-flow__node-groupFrame');
        // 已打在卡片上则放行（媒体改名、画布双击放大）；仅穿透到 pane 时拦住缩放
        if (!onContentNode) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      const g = hitGroupAt(e.clientX, e.clientY, e.target);
      if (!g) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('dblclick', onDblClick, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('dblclick', onDblClick, true);
    };
  }, [hitGroupAt, startFrameDrag, screenToFlowPosition, setNodes]);

  /** 卸载时若在拖动中则清理监听（不触发结束回调，避免卸载期落库） */
  useEffect(
    () => () => {
      if (!draggingRef.current) return;
      window.removeEventListener('pointermove', onFrameMove);
      window.removeEventListener('pointerup', endDrag);
      draggingRef.current = false;
    },
    [onFrameMove, endDrag],
  );

  /** 渲染用矩形（拖动时叠加本地偏移，使框跟手） */
  const boxFor = (f: FrameInfo): GroupBBox =>
    dragOffset && dragOffset.id === f.id
      ? { x: f.box.x + dragOffset.x, y: f.box.y + dragOffset.y, w: f.box.w, h: f.box.h }
      : f.box;

  /* ============ 组右侧「+」批量连线（组→目标） ============ */
  /** 拖拽中的连线状态：组成员右中点（flow 坐标）+ 当前光标（屏幕坐标）。null 表示未拖拽。
   *  预览线在屏幕空间绘制：成员右中点经 flowToScreenPosition 转屏幕，与光标屏幕点连 bezier。 */
  interface ConnectDragState {
    groupId: string;
    memberIds: string[];
    /** 成员右中点 flow 坐标（拖拽期间成员不动，起点固定） */
    sources: { x: number; y: number }[];
  }
  const connectStateRef = useRef<ConnectDragState | null>(null);
  const [connectCursor, setConnectCursor] = useState<{ x: number; y: number } | null>(null);
  /** 正在从哪个组拉批量连线：拖拽期间隐藏该组右侧「+」把手，避免把手随线一起出现 */
  const [connectDraggingGroupId, setConnectDraggingGroupId] = useState<string | null>(null);
  const onConnectGroupDropRef = useRef(onConnectGroupDrop);
  onConnectGroupDropRef.current = onConnectGroupDrop;
  const onConnectGroupToTargetRef = useRef(onConnectGroupToTarget);
  onConnectGroupToTargetRef.current = onConnectGroupToTarget;

  /** 命中测试：屏幕点下的目标节点 id。排除组内成员（组内不允许单独连线）。
   *  仅认 ReactFlow 节点（.react-flow__node[data-id]），组框是 overlay 不在此列。 */
  const targetNodeIdAt = useCallback(
    (clientX: number, clientY: number, memberIds: string[]): string | null => {
      const el = document.elementFromPoint(clientX, clientY);
      if (!(el instanceof Element)) return null;
      const nodeEl = el.closest('.react-flow__node') as HTMLElement | null;
      if (!nodeEl) return null;
      const id = nodeEl.getAttribute('data-id');
      if (!id || memberIds.includes(id) || groupsRef.current.some((g) => g.id === id)) return null;
      return id;
    },
    [],
  );
  const targetNodeIdAtRef = useRef(targetNodeIdAt);
  targetNodeIdAtRef.current = targetNodeIdAt;

  /** 稳定监听器：父级 setState（如右键弹出画布菜单）不能拆掉 window 监听，否则拖线状态会卡死 */
  const connectDragHandlersRef = useRef({
    onMove: (_e: PointerEvent) => {},
    onEnd: (_e: PointerEvent) => {},
    onContextMenu: (_e: Event) => {},
  });
  const onConnectMoveStable = useCallback((e: PointerEvent) => {
    connectDragHandlersRef.current.onMove(e);
  }, []);
  const onConnectEndStable = useCallback((e: PointerEvent) => {
    connectDragHandlersRef.current.onEnd(e);
  }, []);
  const onConnectContextMenuStable = useCallback((e: Event) => {
    connectDragHandlersRef.current.onContextMenu(e);
  }, []);

  const detachConnectDrag = useCallback(() => {
    window.removeEventListener('pointermove', onConnectMoveStable);
    window.removeEventListener('pointerup', onConnectEndStable);
    window.removeEventListener('pointercancel', onConnectEndStable);
    window.removeEventListener('contextmenu', onConnectContextMenuStable, true);
  }, [onConnectMoveStable, onConnectEndStable, onConnectContextMenuStable]);

  const resetConnectDrag = useCallback(() => {
    detachConnectDrag();
    connectStateRef.current = null;
    connectDraggingRef.current = false;
    setConnectCursor(null);
    setConnectDraggingGroupId(null);
    if (paneRef.current) paneRef.current.style.cursor = '';
  }, [detachConnectDrag]);

  connectDragHandlersRef.current.onMove = (e: PointerEvent) => {
    setConnectCursor({ x: e.clientX, y: e.clientY });
  };
  connectDragHandlersRef.current.onEnd = (e: PointerEvent) => {
    const s = connectStateRef.current;
    // 仅左键抬起算松手落线；右键抬起 / pointercancel 只取消本次拖线
    const commit = e.type === 'pointerup' && e.button === 0;
    resetConnectDrag();
    if (!commit || !s) return;
    const targetId = targetNodeIdAtRef.current(e.clientX, e.clientY, s.memberIds);
    const drop = onConnectGroupDropRef.current;
    if (drop) {
      drop(s.memberIds, targetId, { x: e.clientX, y: e.clientY });
    } else if (targetId) {
      onConnectGroupToTargetRef.current?.(s.memberIds, targetId);
    }
  };
  connectDragHandlersRef.current.onContextMenu = (e: Event) => {
    if (!connectStateRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    resetConnectDrag();
  };

  /** 按下组右侧「+」开始批量连线：冻结当前组成员，记录各成员右中点为连线起点 */
  const startConnectDrag = useCallback(
    (groupId: string, box: GroupBBox, excludedIds: string[], clientX: number, clientY: number) => {
      const host = groupsRef.current.find((g) => g.id === groupId);
      const members = host
        ? exclusiveMembersInGroup(nodesRef.current, host, groupsRef.current)
        : membersInGroupBox(nodesRef.current, box, excludedIds);
      const sources = members.map((n) => {
        const w = n.measured?.width ?? 200;
        const h = n.measured?.height ?? 120;
        return { x: n.position.x + w, y: n.position.y + h / 2 };
      });
      connectStateRef.current = {
        groupId,
        memberIds: members.map((n) => n.id),
        sources,
      };
      connectDraggingRef.current = true;
      setConnectCursor({ x: clientX, y: clientY });
      setConnectDraggingGroupId(groupId);
      if (paneRef.current) paneRef.current.style.cursor = 'crosshair';
      window.addEventListener('pointermove', onConnectMoveStable);
      window.addEventListener('pointerup', onConnectEndStable);
      window.addEventListener('pointercancel', onConnectEndStable);
      window.addEventListener('contextmenu', onConnectContextMenuStable, true);
    },
    [onConnectMoveStable, onConnectEndStable, onConnectContextMenuStable],
  );

  /** 卸载时若在连线拖拽中则清理监听（不触发结束回调，避免卸载期落库） */
  useEffect(
    () => () => {
      detachConnectDrag();
      connectStateRef.current = null;
      connectDraggingRef.current = false;
    },
    [detachConnectDrag],
  );

  return (
    <>
      {/* 组框本体已作为 groupFrame 节点参与 zIndex 分层；此处只保留徽标/操作条。 */}
      <div className={styles.uiLayer} ref={uiLayerRef}>
        {frames.map((f) => {
          const box = boxFor(f);
          const pt = flowToScreenPosition({ x: box.x, y: box.y });
          const open = openGroupId === f.id;
          return (
            <div key={f.id} className={styles.groupBadgeWrap} style={{ left: pt.x, top: pt.y }}>
              <button
                className={styles.groupBadge}
                title={open ? '收起' : '组操作'}
                onClick={(e) => {
                  e.stopPropagation();
                  onBringGroupToFront?.(f.id);
                  setOpenGroupId(open ? null : f.id);
                }}
              >
                <Group size={12} strokeWidth={2} />
                <span>{f.count}</span>
              </button>
              {open && (
                <div className={styles.groupTools}>
                  <button
                    className={styles.toolBtn}
                    title="解组"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenGroupId(null);
                      onUngroup(f.id);
                    }}
                  >
                    <Ungroup size={13} strokeWidth={2} />
                    <span>解组</span>
                  </button>
                  <button
                    className={styles.toolBtn}
                    title="下载组内全部素材"
                    onClick={(e) => {
                      e.stopPropagation();
                      const host = groups.find((g) => g.id === f.id);
                      const members = host
                        ? exclusiveMembersInGroup(nodes, host, groups)
                        : membersInGroupBox(nodes, f.box, f.excludedIds);
                      onDownloadNodes(members.map((n) => n.id));
                    }}
                  >
                    <Download size={13} strokeWidth={2} />
                    <span>下载</span>
                  </button>
                  <button
                    className={styles.toolBtn}
                    title="删除组内全部节点"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenGroupId(null);
                      onDeleteGroup(f.id);
                    }}
                  >
                    <Trash2 size={13} strokeWidth={2} />
                    <span>删除</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* 组右侧「+」批量连线把手：选中组（徽标展开）时出现，按下拖动 = 同时从组内
         *  每个成员右中点拉线到目标节点（见 startConnectDrag）。 */}
        {frames.map((f) => {
          if (openGroupId !== f.id || connectDraggingGroupId === f.id) return null;
          const box = boxFor(f);
          const pt = flowToScreenPosition({ x: box.x + box.w, y: box.y + box.h / 2 });
          return (
            <button
              key={`connect-${f.id}`}
              className={styles.connectHandle}
              style={{ left: pt.x, top: pt.y }}
              title="拖动后选择生成类型"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                startConnectDrag(f.id, f.box, f.excludedIds, e.clientX, e.clientY);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <Plus size={14} strokeWidth={2} />
            </button>
          );
        })}

        {/* 框选悬浮条：成组（未同组时）+ 下载；已成组时仍保留下载 */}
        {showSelectionDownload && createBtnPt && (
          <div className={styles.selectionBar} style={{ left: createBtnPt.x, top: createBtnPt.y }}>
            {showCreateBtn && (
              <button
                className={styles.toolBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateGroup(selectedNodes);
                }}
                title="成组（Ctrl/Cmd+G）"
              >
                <Group size={12} strokeWidth={2} />
                <span>成组</span>
              </button>
            )}
            <button
              className={styles.toolBtn}
              onClick={(e) => {
                e.stopPropagation();
                onDownloadNodes(selectedNodes.map((n) => n.id));
              }}
              title="下载选中全部素材"
            >
              <Download size={12} strokeWidth={2} />
              <span>下载</span>
            </button>
          </div>
        )}

        {/* 批量连线预览：拖动组「+」期间，从每个成员右中点到光标画 bezier。
         *  屏幕空间 SVG，pointer-events:none 不挡命中测试。 */}
        {connectCursor && connectStateRef.current && (
          <svg className={styles.connectPreview}>
            {connectStateRef.current.sources.map((src, i) => {
              const s = flowToScreenPosition(src);
              const [path] = getBezierPath({
                sourceX: s.x,
                sourceY: s.y,
                sourcePosition: Position.Right,
                targetX: connectCursor.x,
                targetY: connectCursor.y,
                targetPosition: Position.Left,
              });
              return <path key={i} d={path} />;
            })}
          </svg>
        )}
      </div>
    </>
  );
}