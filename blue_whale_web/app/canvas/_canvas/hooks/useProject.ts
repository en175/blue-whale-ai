"use client";

/**
 * useProject —— Project 聚合根的 React 适配层（IJZYWD ARCH-6）
 *
 * 把 `app/canvas/page.tsx` 中裸 `useReducer(projectReducer)` + 散落派生选择器
 * 收到本 hook，对外暴露统一接口。reducer 纯函数本身不重写（见 `projectReducer.ts` + 单测）。
 *
 * 边界：
 * - 本 hook 只挂 ProjectState（多项目集合 + active 指针）；UI 层状态
 *   （selectedId / BottomDock 开关 / 选择模式等）属页面交互态，留在 page.tsx。
 * - DOM 依赖（containerRef getBoundingClientRect）不到本 hook —— 节点 x/y
 *   由 page.tsx 在调 `addNode(node)` 前算好作为入参传入，hook 只负责 dispatch。
 * - 跨模块领域类型（Project / NodeItem / Viewport / ChatMessage / CardStatus）
 *   全部从 `@/types/domain` 取（依赖 IJZYVQ ARCH-5）。
 *
 * 派生选择器解读（满足 spec「至少返回 { state, dispatch, ...派生选择器 }」）：
 *   state, dispatch —— 完整状态机入口（dispatch 暴露给 page.tsx 走无法合成的 reducer 动作）
 *   projects, activeProject, activeProjectId, nodes, viewport, messages —— 派生读
 *   selectProject / createProject / deleteProject / setViewport / setNodes /
 *   addNode / appendMessages / setCardStatus —— 由 dispatch 衍生的高频便捷 action，
 *     避免 page.tsx 每个动作写 `dispatch({ type, ... })` boilerplate
 */

import { useCallback, useMemo, useReducer } from "react";
import type { Dispatch } from "react";

import { PROJECTS } from "../constants";
import { projectReducer, initialProjectState } from "../projectReducer";
import type { ProjectAction, ProjectState } from "../projectReducer";
import type {
  CardStatus,
  ChatMessage,
  NodeItem,
  Project,
  Viewport,
} from "@/types/domain";

export type UseProject = {
  // 状态机入口
  state: ProjectState;
  dispatch: Dispatch<ProjectAction>;
  // 派生读
  projects: Project[];
  activeProjectId: string;
  activeProject: Project;
  nodes: NodeItem[];
  viewport: Viewport;
  messages: ChatMessage[];
  // 便捷 action（薄封装；page.tsx 调用即写）
  selectProject: (projectId: string) => void;
  createProject: (name: string) => void;
  deleteProject: (projectId: string) => void;
  setViewport: (next: Viewport | ((prev: Viewport) => Viewport)) => void;
  setNodes: (next: NodeItem[] | ((prev: NodeItem[]) => NodeItem[])) => void;
  /** 添加单个节点（位置由调用方算好；hook 不接 DOM） */
  addNode: (node: NodeItem) => void;
  appendMessages: (messages: ChatMessage[]) => void;
  setCardStatus: (cardId: number | string, status: CardStatus) => void;
};

/**
 * id 生成器：固定 timestamp，避免每次 render 重新分配 ID（保证 React 渲染期间引用稳定）。
 * 测试场景通过依赖注入重新指定（useProject 接受可选 idForCreate）。
 */
const defaultIdGen = () => `p-${Date.now()}`;

export function useProject(opts?: {
  /** createProject 用的 id 生成器；测试场景注入，生产用默认 timestamp。 */
  idForCreate?: () => string;
}): UseProject {
  const idForCreate = opts?.idForCreate ?? defaultIdGen;

  const [state, dispatch] = useReducer(projectReducer, PROJECTS, initialProjectState);

  const activeProject = useMemo(
    () =>
      state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0],
    [state.projects, state.activeProjectId],
  );

  const selectProject = useCallback(
    (projectId: string) => dispatch({ type: "switch", projectId }),
    [],
  );
  const createProject = useCallback(
    (name: string) => dispatch({ type: "create", name, idGen: idForCreate }),
    [idForCreate],
  );
  const deleteProject = useCallback(
    (projectId: string) => dispatch({ type: "delete", projectId }),
    [],
  );

  const setViewport = useCallback(
    (next: Viewport | ((prev: Viewport) => Viewport)) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: Viewport) => Viewport)(activeProject.canvas.viewport)
          : next;
      dispatch({
        type: "set-viewport",
        projectId: activeProject.id,
        viewport: resolved,
      });
    },
    [activeProject.id, activeProject.canvas.viewport],
  );

  const setNodes = useCallback(
    (next: NodeItem[] | ((prev: NodeItem[]) => NodeItem[])) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: NodeItem[]) => NodeItem[])(activeProject.canvas.nodes)
          : next;
      dispatch({
        type: "set-nodes",
        projectId: activeProject.id,
        nodes: resolved,
      });
    },
    [activeProject.id, activeProject.canvas.nodes],
  );

  const addNode = useCallback(
    (node: NodeItem) =>
      dispatch({ type: "add-node", projectId: activeProject.id, node }),
    [activeProject.id],
  );

  const appendMessages = useCallback(
    (messages: ChatMessage[]) =>
      dispatch({
        type: "append-messages",
        projectId: activeProject.id,
        messages,
      }),
    [activeProject.id],
  );

  const setCardStatus = useCallback(
    (cardId: number | string, status: CardStatus) =>
      dispatch({
        type: "set-card-status",
        projectId: activeProject.id,
        cardId,
        status,
      }),
    [activeProject.id],
  );

  return useMemo<UseProject>(
    () => ({
      state,
      dispatch,
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      activeProject,
      nodes: activeProject.canvas.nodes,
      viewport: activeProject.canvas.viewport,
      messages: activeProject.messages,
      selectProject,
      createProject,
      deleteProject,
      setViewport,
      setNodes,
      addNode,
      appendMessages,
      setCardStatus,
    }),
    [
      state,
      activeProject,
      selectProject,
      createProject,
      deleteProject,
      setViewport,
      setNodes,
      addNode,
      appendMessages,
      setCardStatus,
    ],
  );
}
