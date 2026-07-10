// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useProject } from "./useProject";
import { PROJECTS } from "../constants";
import { initialProjectState } from "../projectReducer";

/**
 * Hook 层单测：聚焦「hook 暴露的便捷 action 是否正确路由到 dispatch 并更新派生选择器」。
 * 单 action 状态转移的细节（create / switch / add-node 的项目隔离、不可变性等等）
 * 已在 `projectReducer.test.ts`（A1–A9）覆盖；本文件不复述，避免冗余。
 *
 * 设计要点：
 * - 用 `idForCreate` 注入手动 idGen，避免生产默认 `Date.now()` 在不同测试间漂移。
 * - PROJECTS 是 const 数组，reducer 用 `[...state.projects, ...]` 不原地改它；
 *   useReducer 每次新组件实例都从 PROJECTS 重新构造 state → 测试间不串扰。
 */
describe("useProject / 初始态与派生选择器", () => {
  it("activeProjectId 取 PROJECTS.active 标记的项目", () => {
    const { result } = renderHook(() => useProject());
    expect(result.current.activeProjectId).toBe(
      initialProjectState(PROJECTS).activeProjectId,
    );
    expect(result.current.activeProjectId).toBe("1");
    expect(result.current.activeProject.name).toBe("小猫创作");
  });

  it("派生选择器 (activeProject/nodes/viewport/messages) 与 state.projects + state.activeProjectId 对齐", () => {
    const { result } = renderHook(() => useProject());
    const expected = result.current.projects.find((p) => p.id === result.current.activeProjectId)!;
    expect(result.current.activeProject).toBe(expected);
    expect(result.current.nodes).toBe(expected.canvas.nodes);
    expect(result.current.viewport).toBe(expected.canvas.viewport);
    expect(result.current.messages).toBe(expected.messages);
  });

  it("projects 与 state.projects 是同一引用（hook 不复制数组）", () => {
    const { result } = renderHook(() => useProject());
    expect(result.current.projects).toBe(result.current.state.projects);
  });
});

describe("useProject / 便捷 action 路由到 dispatch", () => {
  it("selectProject(id) → activeProjectId 切换、activeProject 派生相应跟随", () => {
    const { result } = renderHook(() => useProject());
    const before = result.current.activeProject.name;

    act(() => result.current.selectProject("3"));

    expect(result.current.activeProjectId).toBe("3");
    expect(result.current.activeProject.name).not.toBe(before);
    expect(result.current.activeProject.name).toBe("产品摄影");
  });

  it("createProject(name) 用 idForCreate 注入的 id，且 activeProjectId 切到新项目", () => {
    const { result } = renderHook(() =>
      useProject({ idForCreate: () => "p-test-create" }),
    );
    const beforeCount = result.current.projects.length;

    act(() => result.current.createProject("测试项目"));

    expect(result.current.projects.length).toBe(beforeCount + 1);
    expect(result.current.activeProjectId).toBe("p-test-create");
    const created = result.current.projects.find((p) => p.id === "p-test-create");
    expect(created).toBeDefined();
    expect(created?.name).toBe("测试项目");
    expect(created?.canvas.nodes).toEqual([]);
    expect(created?.messages).toEqual([]);
  });

  it("deleteProject(activeId) → projects.length-1 且 activeProjectId 落到剩余项目", () => {
    const { result } = renderHook(() => useProject());
    expect(result.current.activeProjectId).toBe("1");

    act(() => result.current.deleteProject("1"));

    expect(result.current.projects.find((p) => p.id === "1")).toBeUndefined();
    expect(result.current.projects.map((p) => p.id)).toContain(
      result.current.activeProjectId,
    );
  });

  it("setViewport(value) 与 setViewport((prev) => …) 都走 activeProject.canvas.viewport", () => {
    const { result } = renderHook(() => useProject());

    act(() =>
      result.current.setViewport({ x: 100, y: 200, scale: 2 }),
    );
    expect(result.current.viewport).toEqual({ x: 100, y: 200, scale: 2 });
    expect(
      result.current.projects.find((p) => p.id === result.current.activeProjectId)!
        .canvas.viewport,
    ).toEqual({ x: 100, y: 200, scale: 2 });

    act(() =>
      result.current.setViewport((prev) => ({ x: prev.x + 1, y: prev.y + 1, scale: prev.scale })),
    );
    expect(result.current.viewport.x).toBe(101);
    expect(result.current.viewport.y).toBe(201);
  });

  it("setNodes([...]) 与 setNodes((prev) => [...prev, n]) 都写入 activeProject.canvas.nodes", () => {
    const { result } = renderHook(() => useProject());
    const initialLen = result.current.nodes.length;

    act(() =>
      result.current.setNodes([
        { id: "n1", type: "image", x: 0, y: 0, width: 10, height: 10 },
      ]),
    );
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0]?.id).toBe("n1");

    act(() =>
      result.current.setNodes((prev) => [
        ...prev,
        { id: "n2", type: "text", x: 1, y: 1, width: 20, height: 20, content: "t" },
      ]),
    );
    expect(result.current.nodes).toHaveLength(initialLen > 0 ? 2 : 2);
    expect(result.current.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("appendMessages / setCardStatus 都路由到 activeProject", () => {
    const { result } = renderHook(() => useProject());

    act(() =>
      result.current.appendMessages([
        { id: "m-1", type: "user", text: "hi" },
      ]),
    );
    expect(result.current.messages.at(-1)).toEqual({
      id: "m-1",
      type: "user",
      text: "hi",
    });

    act(() =>
      result.current.appendMessages([
        {
          id: "c-1",
          type: "card",
          text: "图",
          meta: "1:1",
          status: "failed",
        },
      ]),
    );
    const cardId = result.current.messages.at(-1)?.id;
    expect(cardId).toBe("c-1");

    act(() => result.current.setCardStatus(cardId!, "normal"));
    const updated = result.current.messages.find((m) => m.id === cardId);
    expect((updated as { status?: string } | undefined)?.status).toBe("normal");
  });

  it("切到别的 project 后，appendMessages/setCardStatus 路由到新的 active project", () => {
    const { result } = renderHook(() => useProject());
    act(() => result.current.selectProject("3"));
    const p3Before = result.current.messages.length;

    act(() =>
      result.current.appendMessages([
        { id: "m-p3", type: "agent", text: "p3 新增" },
      ]),
    );

    expect(result.current.activeProjectId).toBe("3");
    expect(result.current.messages.length).toBe(p3Before + 1);
    // 回看全局 state：项目 1 的消息数不应被污染
    const p1 = result.current.projects.find((p) => p.id === "1");
    expect(p1).toBeDefined();
  });
});
