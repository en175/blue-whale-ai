/**
 * projectReducer —— Project 聚合根的状态转移纯函数（seam）
 *
 * Project 是顶层聚合根（见 CONTEXT.md L44–50）：Project ⊇ { Canvas(节点+视口),
 * AgentChatPanel 消息流 }。对话归属 Project，不归属 Canvas。本 reducer 是把
 * 「项目切换真正更换画布节点集合与对话历史」这一契约落成可测纯函数的唯一入口。
 *
 * 副作用全部剥离/注入：
 * - id → 注入 IdGenerator（复用 messages.ts 的 () => number | string）。
 * - 位置（依赖 containerRef + viewport）→ 留在 page.tsx，dispatch 前算好作为
 *   node.position 传入，reducer 不碰 DOM/视口。
 * - setTimeout 逐条追加 → 留在 AgentChatPanel，每 tick 调一次 append-messages。
 *
 * 不可变性：reducer 返回新 state，绝不原地改原 state/原 project（A9 回归覆盖）。
 */
import type { ChatMessage, NodeItem, Project, Viewport } from "./types";
import type { CardStatus } from "./cardStatus";
import type { IdGenerator } from "./messages";

export type ProjectState = {
  projects: Project[];
  activeProjectId: string;
};

export type ProjectAction =
  | { type: "switch"; projectId: string }
  | { type: "create"; name: string; idGen: IdGenerator }
  | { type: "delete"; projectId: string }
  | { type: "add-node"; projectId: string; node: NodeItem }
  | { type: "delete-node"; projectId: string; nodeId: string }
  | { type: "set-viewport"; projectId: string; viewport: Viewport }
  | { type: "append-messages"; projectId: string; messages: ChatMessage[] }
  | { type: "set-card-status"; projectId: string; cardId: number | string; status: CardStatus }
  | { type: "set-nodes"; projectId: string; nodes: NodeItem[] };

/**
 * 由初始 Project 列表构造 reducer state：active 取第一个 active 标记项目，
 * 无标记则取首项。
 */
export function initialProjectState(projects: Project[]): ProjectState {
  const first = projects[0];
  const marked = projects.find((p) => p.active);
  return {
    projects,
    activeProjectId: (marked ?? first).id,
  };
}

/**
 * Project 聚合根状态转移纯函数。
 *
 * 逐切片实现：每个 case 独立返回新 state，绝不原地改原 state/原 project。
 */
export function projectReducer(state: ProjectState, action: ProjectAction): ProjectState {
  switch (action.type) {
    case "create": {
      const id = String(action.idGen());
      const created: Project = {
        id,
        name: action.name,
        thumb: null,
        canvas: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } },
        messages: [],
      };
      return {
        projects: [...state.projects, created],
        activeProjectId: id,
      };
    }
    case "switch": {
      return { ...state, activeProjectId: action.projectId };
    }
    case "delete": {
      const projects = state.projects.filter((p) => p.id !== action.projectId);
      // 删的是当前 active 项目 → active 回落到剩余首项；删非 active → active 不变
      const activeProjectId =
        action.projectId === state.activeProjectId && projects.length > 0
          ? projects[0].id
          : state.activeProjectId;
      return { projects, activeProjectId };
    }
    case "add-node": {
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? { ...p, canvas: { ...p.canvas, nodes: [...p.canvas.nodes, action.node] } }
            : p
        ),
      };
    }
    case "delete-node": {
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? {
                ...p,
                canvas: {
                  ...p.canvas,
                  nodes: p.canvas.nodes.filter((n) => n.id !== action.nodeId),
                },
              }
            : p
        ),
      };
    }
    case "set-viewport": {
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? { ...p, canvas: { ...p.canvas, viewport: action.viewport } }
            : p
        ),
      };
    }
    case "set-nodes": {
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId ? { ...p, canvas: { ...p.canvas, nodes: action.nodes } } : p
        ),
      };
    }
    case "append-messages": {
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? { ...p, messages: [...p.messages, ...action.messages] }
            : p
        ),
      };
    }
    case "set-card-status": {
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? {
                ...p,
                messages: p.messages.map((m) =>
                  m.type === "card" && m.id === action.cardId
                    ? { ...m, status: action.status }
                    : m
                ),
              }
            : p
        ),
      };
    }
    default:
      throw new Error(`projectReducer: action "${(action as { type: string }).type}" 未实现`);
  }
}
