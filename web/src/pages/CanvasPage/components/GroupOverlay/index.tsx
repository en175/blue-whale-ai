/* ============================================
 * GroupOverlay 成组交互层（IKD0JT A3/A4）：
 * - 组底框：组矩形（成组时刻固定）虚线框（线宽按 zoom 反向补偿保持屏幕恒定）
 * - 组徽标：底框左上角屏幕空间徽标，点击展开操作条（解组/删除）
 * - 成组入口：≥2 节点选中且未全部同组时，在选区上方浮现「成组」按钮
 *   （Ctrl/Cmd+G 快捷键同效，见 Canvas 键盘处理）
 * - 动态成员：节点是否属于组 = 是否落在组矩形内（不存冻结名单）。
 * - 整组拖动：拖起组顶部把手，实时移动「当前在框内的全部节点」+ 组矩形
 *   （矩形视觉经本地偏移跟随，结束时一次性上抛父级落盘 + 登记撤销）
 * 根层 pointer-events:none，仅徽标/按钮/操作条/把手可交互，不遮挡节点操作。
 * ============================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, useViewport, type Node } from '@xyflow/react';
import { Group, Ungroup, Trash2 } from 'lucide-react';
import {
  memberBBox,
  membersInGroupBox,
  MIN_GROUP_MEMBERS,
  nodeInsideGroupBox,
  type CanvasGroup,
  type GroupBBox,
  type GroupFrameDragResult,
  type PositionRecord,
} from '../../canvasGroups';
import styles from './index.module.css';

interface GroupOverlayProps {
  /** 画布内部节点（含实时坐标 / 选中态 / measured 尺寸，拖拽中实时更新） */
  nodes: Node[];
  groups: CanvasGroup[];
  /** 成组：上抛选中节点对象（含 measured 实际尺寸），父级据此定格组矩形 */
  onCreateGroup: (nodes: Node[]) => void;
  onUngroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  /** 内部节点落笔（整组拖动实时移动成员用） */
  setNodes: (updater: (prev: Node[]) => Node[]) => void;
  /** 整组拖动结束：上抛矩形前后 + 成员节点位移，父级落盘并登记撤销 */
  onGroupFrameDragStop?: (res: GroupFrameDragResult) => void;
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
  setNodes,
  onGroupFrameDragStop,
}: GroupOverlayProps) {
  const { flowToScreenPosition } = useReactFlow();
  const { x: vx, y: vy, zoom } = useViewport();
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<DragOffset | null>(null);

  /** 组底框：直接用固定矩形渲染，count 为当前落在矩形内且未被排除的节点数（动态） */
  const frames = useMemo<FrameInfo[]>(
    () =>
      groups.map((g) => ({
        id: g.id,
        box: g.box,
        count: membersInGroupBox(nodes, g.box, g.excludedIds).length,
        excludedIds: g.excludedIds,
      })),
    [groups, nodes],
  );

  /** 被排除节点的覆盖块（组盖住的节点）：组矩形内且在排除名单中的节点，
   *  用独立玻璃块盖在其上方（z 高于节点），视觉呈现"被组压在玻璃之下"。 */
  const excludedCovers = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const result: { key: string; groupId: string; x: number; y: number; w: number; h: number }[] = [];
    groups.forEach((g) => {
      g.excludedIds.forEach((id) => {
        const n = byId.get(id);
        if (!n || !nodeInsideGroupBox(n, g.box)) return;
        result.push({
          key: `${g.id}:${id}`,
          groupId: g.id,
          x: n.position.x,
          y: n.position.y,
          w: n.measured?.width ?? 200,
          h: n.measured?.height ?? 120,
        });
      });
    });
    return result;
  }, [groups, nodes]);

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
  const showCreateBtn = !!selectionBox && !allInOneGroup;
  const createBtnPt = selectionBox
    ? flowToScreenPosition({ x: selectionBox.x + selectionBox.w / 2, y: selectionBox.y })
    : null;

  /** 点击空白处收起操作条 */
  useEffect(() => {
    if (!openGroupId) return;
    const close = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest(`.${styles.groupTools}`)) return;
      setOpenGroupId(null);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [openGroupId]);

  /** 虚线线宽按 zoom 反向补偿（zoom 0.2 → 8px flow 坐标 = 屏幕 1.6px） */
  const borderWidth = Math.max(1, 1.5 / zoom);

  /** 整组拖动（IKD0JT A4 动态成员）：拖起组顶部把手，把「当前在矩形内的节点」整体平移。
   *  矩形/成员坐标经本地偏移即时跟随，结束时一次性上抛父级落盘 + 撤销。 */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const draggingRef = useRef(false);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
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
      setDragOffset({ id: s.groupId, x: dx, y: dy });
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
    [setNodes],
  );

  const endDrag = useCallback(() => {
    window.removeEventListener('pointermove', onFrameMove);
    window.removeEventListener('pointerup', endDrag);
    if (!draggingRef.current) return;
    draggingRef.current = false;
    endFrameDrag();
  }, [onFrameMove, endFrameDrag]);

  /** 按下组框开始：冻结当前在矩形内且未被排除的成员作为本次拖动集合。
   *  被排除节点（组此前盖住的）不随组移动；成员可为空。 */
  const beginFrameDrag = useCallback(
    (e: React.PointerEvent, f: FrameInfo) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const nodeOld = new Map<string, { x: number; y: number }>();
      membersInGroupBox(nodes, f.box, f.excludedIds).forEach((n) => {
        nodeOld.set(n.id, { x: n.position.x, y: n.position.y });
      });
      draggingRef.current = true;
      dragStateRef.current = {
        groupId: f.id,
        startScreen: { x: e.clientX, y: e.clientY },
        dx: 0,
        dy: 0,
        oldBox: { ...f.box },
        excludedBefore: [...f.excludedIds],
        nodeOld,
        nodeNew: new Map(nodeOld),
      };
      window.addEventListener('pointermove', onFrameMove);
      window.addEventListener('pointerup', endDrag);
    },
    [nodes, onFrameMove, endDrag],
  );

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

  return (
    <>
      {/* 组框拖拽层（flow 坐标，随视口变换）：整框为拖拽面，节点区在上不受影响 */}
      <div
        className={styles.frameLayer}
        style={{ transform: `translate(${vx}px, ${vy}px) scale(${zoom})` }}
      >
        {frames.map((f) => {
          const box = boxFor(f);
          return (
            <div
              key={f.id}
              className={styles.frame}
              style={{
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                borderWidth,
              }}
              title="拖动整组"
              onPointerDown={(e) => beginFrameDrag(e, f)}
            />
          );
        })}
      </div>

      {/* 排除节点覆盖层（flow 坐标，随视口变换）：z 高于节点 renderer，
       *  组盖住的节点视觉上被玻璃压在下层（成员归属即视觉层级） */}
      <div
        className={styles.coverLayer}
        style={{ transform: `translate(${vx}px, ${vy}px) scale(${zoom})` }}
      >
        {excludedCovers.map((c) => (
          <div key={c.key} className={styles.cover} style={{ left: c.x, top: c.y, width: c.w, height: c.h }} />
        ))}
      </div>

      {/* 组徽标 + 操作条 + 成组按钮（屏幕空间，恒定尺寸，置于节点之上） */}
      <div className={styles.uiLayer}>
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

        {/* 成组入口按钮：上抛选中节点对象（含 measured 实际尺寸），父级按真实包围盒定格组矩形 */}
        {showCreateBtn && createBtnPt && (
          <button
            className={styles.createBtn}
            style={{ left: createBtnPt.x, top: createBtnPt.y }}
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
      </div>
    </>
  );
}