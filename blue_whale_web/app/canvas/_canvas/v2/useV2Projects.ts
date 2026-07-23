"use client";
/**
 * useV2Projects —— v2 项目持久化 hook（strangler：独立于老 useCanvasProjects）。
 * 只管 projects 列表 + messages（会话态 by projectId）+ CRUD；
 * **active projectId 由 URL 路由传入**（/canvas-v2/[projectId]），非内部 state。
 * canvas（nodes/viewport/save/load）由 store 接管，page 按 URL projectId 调 store.load。
 *
 * 规格见 openspec canvas-frontend-architecture；ADR-0022（strangler）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAccessToken } from "@/components/auth/authStorage";
import * as canvasApi from "@/lib/canvas";
import type { Project, ChatMessage, Viewport } from "../types";
import type { CardStatus } from "@/types/domain";

const EMPTY_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/** 撞名时追加 (2)(3)… 递增至不撞现有名集合。新建/重命名共用。 */
function dedupeName(name: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  let suffix = 2;
  while (taken.has(`${name} (${suffix})`)) suffix++;
  return `${name} (${suffix})`;
}

function dtoToProject(dto: canvasApi.ProjectDto): Project {
  return {
    id: String(dto.id),
    name: dto.name,
    thumb: dto.thumb,
    canvas: { nodes: [], viewport: EMPTY_VIEWPORT },
    messages: [],
  };
}

function nowName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * @param projectId 当前 active projectId（来自 URL 路由）。null = 未选项目（index 页跳转中）。
 */
export function useV2Projects(projectId: string | null) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [messagesByPid, setMessagesByPid] = useState<Record<string, ChatMessage[]>>({});
  const [booting, setBooting] = useState(true);
  const [backendReady, setBackendReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [online] = useState(() => typeof window !== "undefined" && !!loadAccessToken());

  const projectsRef = useRef<Project[]>([]);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // list（online 才尝试；失败 loadError）— 不再 setActiveId（URL 路由控制 active）
  useEffect(() => {
    if (!online) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await canvasApi.listProjects();
        if (cancelled) return;
        setProjects(list.map(dtoToProject));
        setLoadError(false);
        setBackendReady(true);
      } catch (e) {
        if (cancelled) return;
        console.warn("[canvas-v2] listProjects failed", e);
        setLoadError(true);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online, retryKey]);

  const retry = useCallback(() => {
    setLoadError(false);
    setBooting(true);
    setRetryKey((k) => k + 1);
  }, []);

  const activeProject = projectId ? projects.find((p) => p.id === projectId) : undefined;

  /** 新建项目：落库 + 入列，返回新 id（调用方 router.push）。 */
  const createProject = useCallback(async (): Promise<string | null> => {
    const name = dedupeName(nowName(), projectsRef.current.map((p) => p.name));
    try {
      const dto = await canvasApi.createProject(name);
      const p = dtoToProject(dto);
      setProjects((prev) => [...prev, p]);
      return p.id;
    } catch (e) {
      console.error("[canvas-v2] createProject failed", e);
      return null;
    }
  }, []);

  const renameProject = useCallback(async (id: string, rawName: string): Promise<boolean> => {
    const trimmed = rawName.trim();
    const cur = projectsRef.current.find((p) => p.id === id);
    if (!cur || !trimmed || trimmed === cur.name) return false;
    const name = dedupeName(trimmed, projectsRef.current.filter((p) => p.id !== id).map((p) => p.name));
    try {
      await canvasApi.renameProject(Number(id), name);
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
      return true;
    } catch (e) {
      console.error("[canvas-v2] renameProject failed", e);
      return false;
    }
  }, []);

  /** 删除项目：后端删 + 本地删。active 被删时调用方应跳转。 */
  const deleteProject = useCallback(async (id: string): Promise<void> => {
    try {
      await canvasApi.deleteProject(Number(id));
    } catch (e) {
      console.error("[canvas-v2] deleteProject failed", e);
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const appendMessages = useCallback(
    (msgs: ChatMessage[]) => {
      if (!projectId) return;
      setMessagesByPid((prev) => ({ ...prev, [projectId]: [...(prev[projectId] ?? []), ...msgs] }));
    },
    [projectId],
  );

  const setCardStatus = useCallback(
    (cardId: number | string, status: CardStatus) => {
      if (!projectId) return;
      setMessagesByPid((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] ?? []).map((m) => (m.type === "card" && m.id === cardId ? { ...m, status } : m)),
      }));
    },
    [projectId],
  );

  const messages = activeProject && projectId ? messagesByPid[projectId] ?? [] : [];

  return {
    projects,
    activeProject,
    messages,
    booting,
    backendReady,
    loadError,
    retry,
    createProject,
    renameProject,
    deleteProject,
    appendMessages,
    setCardStatus,
  };
}
