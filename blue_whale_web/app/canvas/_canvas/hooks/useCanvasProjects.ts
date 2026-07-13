/**
 * useCanvasProjects —— 画布多项目持久化数据流 hook（任务 4）
 *
 * 把 projectReducer（本地真相源）与后端 project/canvas API 缝合：
 * - 后端可用（listProjects 成功）：覆盖 mock → 切换/首次 loadCanvas 恢复 →
 *   canvas 变化 800ms debounce 整体 PUT → beforeunload flush。
 * - 后端不可达 / 未登录（无 token）：保留 PROJECTS mock 作离线 fallback，不连后端。
 *
 * 两级降级判断：
 * - online（有 access token）：决定是否**尝试** listProjects。
 * - backendReady（listProjects 成功）：决定 loadCanvas/saveCanvas/CRUD 是否连后端。
 *   有 token 但后端不可达时 online=true、backendReady=false → 仍走 mock，不刷报错
 *   （避免 mock id "1" 等纯数字 id 误判为后端 id 而触发 loadCanvas 失败）。
 *
 * id 适配：后端 ProjectDto.id:number ↔ 前端 Project.id:string。API 边界 String()/Number() 转换，
 * reducer/types 不动。backendReady=true 时 projects 已是后端真 id；false 时是 mock id（不连后端）。
 *
 * 保存守卫：loadCanvas 恢复的 canvas 用 lastSavedRef 快照同步，使保存 effect 判定无变化而跳过；
 * loadingProjectRef 标记加载中的 project，避免慢网络下空 canvas 回存覆盖后端。
 */
"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { loadAccessToken, loadUser, SKIP_AUTH, MOCK_USER } from "@/components/auth/authStorage";
import { projectReducer, initialProjectState } from "../projectReducer";
import { PROJECTS } from "../constants";
import type { NodeItem, Project, Viewport } from "../types";
import * as canvasApi from "@/lib/canvas";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const EMPTY_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/** 后端 ProjectDto → 前端 Project（id number→string；canvas 未加载先给空，loadCanvas 再填）。 */
function dtoToProject(dto: canvasApi.ProjectDto): Project {
  return {
    id: String(dto.id),
    name: dto.name,
    thumb: dto.thumb,
    canvas: { nodes: [], viewport: EMPTY_VIEWPORT },
    messages: [],
  };
}

export function useCanvasProjects() {
  const [state, dispatch] = useReducer(projectReducer, PROJECTS, initialProjectState);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // 进画布时定一次登录态：有 token 才尝试连后端，否则 mock 离线 fallback。
  const [online] = useState(() => typeof window !== "undefined" && !!loadAccessToken());
  // 后端真正可用（listProjects 成功）才 true；有 token 但后端不可达时仍 false → 走 mock
  const [backendReady, setBackendReady] = useState(false);
  // offline（无 token）不需要拉取，booting 直接 false；online 等列表到位才 false
  const [booting, setBooting] = useState(online);
  const tokenRef = useRef<string | null>(null);

  const activeProject =
    state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0];

  // 已加载 canvas 的 projectId 集合（避免重复 loadCanvas）
  const loadedRef = useRef<Set<string>>(new Set());
  // 正在 loadCanvas 的 projectId：加载期间禁止保存 effect 回存空 canvas 覆盖后端
  const loadingProjectRef = useRef<string | null>(null);
  // 上次落库的 canvas 快照（JSON）：loadCanvas 恢复后同步，使保存 effect 判定「无变化」跳过回存
  const lastSavedRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 最新 state 的 ref（beforeunload flush 读最新值，不依赖闭包过期的 state）。
  // render 期不能写 ref（lint：Cannot update ref during render），用 effect 同步。
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // 初始 token + 首次拉列表（online 才尝试；失败降级 mock，不阻塞画布）
  useEffect(() => {
    tokenRef.current = loadAccessToken();
    if (!online) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await canvasApi.listProjects();
        if (cancelled) return;
        if (list.length === 0) {
          // 后端空：建默认项目，避免空列表无 active
          const created = await canvasApi.createProject("未命名项目");
          if (cancelled) return;
          dispatch({ type: "replace-all", projects: [dtoToProject(created)] });
        } else {
          dispatch({ type: "replace-all", projects: list.map(dtoToProject) });
        }
        setBackendReady(true); // 后端可用，后续 loadCanvas/saveCanvas/CRUD 连后端
      } catch (e) {
        // 后端不可达（未启动/token 过期/网关异常）：降级 mock，不阻塞画布使用
        console.warn("[canvas] backend unreachable, using mock:", e);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online]);

  // active 变化 → loadCanvas 恢复（仅 backendReady + 未加载过）
  useEffect(() => {
    if (!backendReady) return; // 后端不可达时走 mock，不 loadCanvas
    const pid = activeProject.id;
    if (!pid || loadedRef.current.has(pid)) return;
    loadedRef.current.add(pid);
    let cancelled = false;
    loadingProjectRef.current = pid; // 加载期间禁止保存 effect 回存
    canvasApi
      .loadCanvas(Number(pid))
      .then((dto) => {
        if (cancelled) return;
        const nodes = dto.nodes ? (JSON.parse(dto.nodes) as NodeItem[]) : [];
        const viewport = dto.viewport ? (JSON.parse(dto.viewport) as Viewport) : EMPTY_VIEWPORT;
        dispatch({ type: "set-canvas", projectId: pid, nodes, viewport });
        // 同步快照：加载的数据视为「已存」，避免触发回存覆盖
        lastSavedRef.current = JSON.stringify({ nodes, viewport });
        loadingProjectRef.current = null;
      })
      .catch((e) => {
        console.error("[canvas] loadCanvas failed:", e);
        lastSavedRef.current = JSON.stringify({ nodes: [], viewport: EMPTY_VIEWPORT });
        loadingProjectRef.current = null;
      });
    return () => {
      cancelled = true;
      if (loadingProjectRef.current === pid) loadingProjectRef.current = null;
    };
  }, [activeProject.id, backendReady]);

  // canvas 变化 → 800ms debounce 整体 PUT（仅 backendReady + 已加载 + 快照有变化）
  useEffect(() => {
    if (!backendReady || booting) return;
    const pid = activeProject.id;
    if (!pid || !loadedRef.current.has(pid)) return;
    if (loadingProjectRef.current === pid) return; // 加载中：避免回存空 canvas 覆盖后端
    const snap = JSON.stringify({
      nodes: activeProject.canvas.nodes,
      viewport: activeProject.canvas.viewport,
    });
    if (snap === lastSavedRef.current) return; // 无变化（含刚加载的数据）

    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const p = stateRef.current.projects.find((x) => x.id === pid);
      if (!p) return;
      try {
        await canvasApi.saveCanvas(
          Number(pid),
          JSON.stringify(p.canvas.viewport),
          JSON.stringify(p.canvas.nodes)
        );
        lastSavedRef.current = JSON.stringify({
          nodes: p.canvas.nodes,
          viewport: p.canvas.viewport,
        });
        setSaveStatus("saved");
      } catch (e) {
        console.error("[canvas] saveCanvas failed:", e);
        setSaveStatus("error");
      }
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [activeProject.canvas.nodes, activeProject.canvas.viewport, activeProject.id, backendReady, booting]);

  // beforeunload：flush 未保存改动（fetch keepalive，不阻塞卸载）
  useEffect(() => {
    if (!backendReady) return;
    const handler = () => {
      const s = stateRef.current;
      const p = s.projects.find((x) => x.id === s.activeProjectId);
      if (!p) return;
      const snap = JSON.stringify({ nodes: p.canvas.nodes, viewport: p.canvas.viewport });
      if (snap === lastSavedRef.current) return; // 已存，不重复
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const token = tokenRef.current;
      const user = loadUser() ?? (SKIP_AUTH ? MOCK_USER : null);
      fetch(`/api/canvases/${p.id}`, {
        method: "PUT",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(user ? { "X-User-Id": String(user.userId) } : {}),
        },
        body: JSON.stringify({
          viewport: JSON.stringify(p.canvas.viewport),
          nodes: JSON.stringify(p.canvas.nodes),
        }),
      }).catch(() => {});
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [backendReady]);

  // ---- CRUD actions ----

  /** 新建项目：backendReady 先落库拿真 id 再 dispatch；否则用本地 idGen（mock）。 */
  const createProjectAction = useCallback(async () => {
    const name = `项目 ${Date.now().toString().slice(-4)}`;
    if (!backendReady) {
      dispatch({ type: "create", name, idGen: () => `p-${Date.now()}` });
      return;
    }
    try {
      const dto = await canvasApi.createProject(name);
      const pid = String(dto.id);
      dispatch({ type: "create", name: dto.name, idGen: () => pid });
      loadedRef.current.add(pid); // 新项目空 canvas，标记已加载
      lastSavedRef.current = JSON.stringify({ nodes: [], viewport: EMPTY_VIEWPORT });
    } catch (e) {
      console.error("[canvas] createProject failed:", e);
    }
  }, [backendReady]);

  const switchProject = useCallback((id: string) => {
    dispatch({ type: "switch", projectId: id });
  }, []);

  /** 删除项目：backendReady 先删库再 dispatch；否则直接 dispatch（mock）。 */
  const deleteProjectAction = useCallback(
    async (id: string) => {
      loadedRef.current.delete(id);
      if (backendReady) {
        try {
          await canvasApi.deleteProject(Number(id));
        } catch (e) {
          console.error("[canvas] deleteProject failed:", e);
        }
      }
      dispatch({ type: "delete", projectId: id });
    },
    [backendReady]
  );

  return {
    state,
    dispatch,
    activeProject,
    saveStatus,
    booting,
    backendReady,
    createProjectAction,
    switchProject,
    deleteProjectAction,
  };
}
