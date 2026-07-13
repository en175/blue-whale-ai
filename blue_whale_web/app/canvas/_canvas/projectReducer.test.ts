import { describe, it, expect } from "vitest";
import { projectReducer, initialProjectState } from "./projectReducer";
import type { ProjectState, ProjectAction } from "./projectReducer";
import type { Project } from "./types";

/** 单项目 state：给定项目集合，首项为 active。 */
function stateFrom(projects: Project[]): ProjectState {
  return initialProjectState(projects);
}

const emptyCanvas = { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } };

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: `项目-${id}`,
    thumb: null,
    canvas: emptyCanvas,
    messages: [],
    ...overrides,
  };
}

/** dispatch 工具：对 state 执行一次 action。 */
function reduce(state: ProjectState, action: ProjectAction): ProjectState {
  return projectReducer(state, action);
}

describe("projectReducer / create (A1)", () => {
  it("create 新项目：数量+1、active 切到新项目、新项目画布与对话均空", () => {
    const before = stateFrom([project("1")]);
    const idGen = () => "p-new";

    const after = reduce(before, { type: "create", name: "新项目", idGen });

    expect(after.projects).toHaveLength(2);
    expect(after.activeProjectId).toBe("p-new");
    const created = after.projects.find((p) => p.id === "p-new");
    expect(created).toBeDefined();
    expect(created?.name).toBe("新项目");
    expect(created?.canvas.nodes).toEqual([]);
    expect(created?.messages).toEqual([]);
  });
});

describe("projectReducer / switch (A2)", () => {
  it("switch 切换 active，两个项目的画布与对话内容保持不变（验隔离）", () => {
    const n1 = { id: "n1", type: "image", x: 0, y: 0, width: 10, height: 10 } as const;
    const m1 = { id: "m1", type: "user", text: "hi" } as const;
    const p1 = project("1", {
      canvas: { nodes: [n1 as never], viewport: { x: 1, y: 1, zoom: 1 } },
      messages: [m1 as never],
    });
    const p2 = project("2", {
      canvas: { nodes: [], viewport: { x: 2, y: 2, zoom: 2 } },
      messages: [],
    });
    const before = stateFrom([p1, p2]);

    const after = reduce(before, { type: "switch", projectId: "2" });

    expect(after.activeProjectId).toBe("2");
    // 隔离：内容原样保留
    const stillP1 = after.projects.find((p) => p.id === "1");
    expect(stillP1?.canvas.nodes).toHaveLength(1);
    expect(stillP1?.messages).toHaveLength(1);
    const switchedP2 = after.projects.find((p) => p.id === "2");
    expect(switchedP2?.canvas.nodes).toEqual([]);
    expect(switchedP2?.canvas.viewport).toEqual({ x: 2, y: 2, zoom: 2 });
  });
});

describe("projectReducer / add-node (A3)", () => {
  it("add-node 到 p1：p1 节点+1，p2 节点仍为 0（聚合根隔离核心行为）", () => {
    const p1 = project("1");
    const p2 = project("2");
    const before = stateFrom([p1, p2]);
    const node = { id: "n-x", type: "image", x: 5, y: 6, width: 100, height: 100 } as const;

    const after = reduce(before, { type: "add-node", projectId: "1", node: node as never });

    expect(after.projects.find((p) => p.id === "1")?.canvas.nodes).toHaveLength(1);
    expect(after.projects.find((p) => p.id === "2")?.canvas.nodes).toHaveLength(0);
  });
});

describe("projectReducer / delete-node (A4)", () => {
  it("delete-node 移除指定节点，其他节点与其他项目不变", () => {
    const n1 = { id: "n1", type: "image", x: 0, y: 0, width: 1, height: 1 } as const;
    const n2 = { id: "n2", type: "image", x: 0, y: 0, width: 1, height: 1 } as const;
    const p1 = project("1", { canvas: { nodes: [n1 as never, n2 as never], viewport: { x: 0, y: 0, zoom: 1 } } });
    const before = stateFrom([p1]);

    const after = reduce(before, { type: "delete-node", projectId: "1", nodeId: "n1" });

    const nodes = after.projects.find((p) => p.id === "1")?.canvas.nodes ?? [];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("n2");
  });
});

describe("projectReducer / set-viewport (A5)", () => {
  it("set-viewport 更新目标项目视口，其他项目视口不变", () => {
    const p1 = project("1", { canvas: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } } });
    const p2 = project("2", { canvas: { nodes: [], viewport: { x: 9, y: 9, zoom: 9 } } });
    const before = stateFrom([p1, p2]);

    const after = reduce(before, {
      type: "set-viewport",
      projectId: "1",
      viewport: { x: 100, y: 50, zoom: 2 },
    });

    expect(after.projects.find((p) => p.id === "1")?.canvas.viewport).toEqual({
      x: 100,
      y: 50,
      zoom: 2,
    });
    expect(after.projects.find((p) => p.id === "2")?.canvas.viewport).toEqual({
      x: 9,
      y: 9,
      zoom: 9,
    });
  });
});

describe("projectReducer / append-messages (A6)", () => {
  it("append-messages 追加到 p1，p2 消息不变", () => {
    const p1 = project("1");
    const p2 = project("2", { messages: [{ id: "exist", type: "user", text: "旧" } as never] });
    const before = stateFrom([p1, p2]);
    const msgs = [
      { id: "m1", type: "user", text: "新1" } as never,
      { id: "m2", type: "agent", text: "新2" } as never,
    ];

    const after = reduce(before, { type: "append-messages", projectId: "1", messages: msgs });

    expect(after.projects.find((p) => p.id === "1")?.messages).toHaveLength(2);
    expect(after.projects.find((p) => p.id === "2")?.messages).toHaveLength(1);
  });
});

describe("projectReducer / set-card-status (A7)", () => {
  it("set-card-status 仅改目标 card 的 status，其他 message 不变（状态机语义复用，仅赋值）", () => {
    const cardMsg = { id: 5, type: "card", text: "图", meta: "1:1", status: "failed" } as never;
    const otherMsg = { id: 6, type: "agent", text: "其它" } as never;
    const p1 = project("1", { messages: [cardMsg, otherMsg] });
    const before = stateFrom([p1]);

    const after = reduce(before, {
      type: "set-card-status",
      projectId: "1",
      cardId: 5,
      status: "generating",
    });

    const msgs = after.projects.find((p) => p.id === "1")?.messages ?? [];
    expect(msgs).toHaveLength(2);
    expect((msgs[0] as { status?: string }).status).toBe("generating");
    // 其他 message 不变（仍是 agent，无 status 字段被乱加）
    expect(msgs[1]).toEqual(otherMsg);
  });
});

describe("projectReducer / delete (A8)", () => {
  it("delete 当前 active 项目：数量-1，active 切到剩余某项目", () => {
    const before = stateFrom([project("1"), project("2"), project("3")]);
    // initialProjectState 取首项 active → activeProjectId === "1"，先切到 "2"
    const switched = reduce(before, { type: "switch", projectId: "2" });
    expect(switched.activeProjectId).toBe("2");

    const after = reduce(switched, { type: "delete", projectId: "2" });

    expect(after.projects).toHaveLength(2);
    expect(after.projects.find((p) => p.id === "2")).toBeUndefined();
    // active 必须落到一个仍存在的项目上
    expect(after.projects.map((p) => p.id)).toContain(after.activeProjectId);
  });

  it("delete 非当前项目：active 不变", () => {
    const before = stateFrom([project("1"), project("2")]);

    const after = reduce(before, { type: "delete", projectId: "2" });

    expect(after.projects).toHaveLength(1);
    expect(after.activeProjectId).toBe("1");
  });
});

describe("projectReducer / 不可变性回归 (A9)", () => {
  it("reducer 不原地改原 state：对 frozen state 任一 action 不抛、原引用内容不变", () => {
    const node = { id: "n1", type: "image", x: 1, y: 1, width: 1, height: 1 } as const;
    const msg = { id: 5, type: "card", text: "t", meta: "1:1", status: "normal" } as const;
    const p1 = project("1", {
      canvas: { nodes: [node as never], viewport: { x: 0, y: 0, zoom: 1 } },
      messages: [msg as never],
    });
    const before = stateFrom([p1]);
    const beforeSnapshot = JSON.parse(JSON.stringify(before));

    // 对 frozen 派发一组覆盖变更路径的 action；纯函数不应原地写入（否则 throw）
    const actions: ProjectAction[] = [
      { type: "add-node", projectId: "1", node: { ...node, id: "n2" } as never },
      { type: "delete-node", projectId: "1", nodeId: "n1" },
      { type: "set-viewport", projectId: "1", viewport: { x: 7, y: 7, zoom: 7 } },
      { type: "append-messages", projectId: "1", messages: [{ id: 9, type: "user", text: "x" } as never] },
      { type: "set-card-status", projectId: "1", cardId: 5, status: "failed" },
      { type: "create", name: "新", idGen: () => "p2" },
    ];

    let s = before;
    for (const a of actions) {
      // 冻结当前 state，强制下一步走不可变路径
      const frozen = JSON.parse(JSON.stringify(s));
      Object.freeze(frozen);
      Object.freeze(frozen.projects);
      Object.freeze(frozen.projects[0].canvas);
      Object.freeze(frozen.projects[0].canvas.nodes);
      Object.freeze(frozen.projects[0].messages);
      s = reduce(frozen, a); // 若 reducer 原地改 frozen 对象 → strict mode 抛 TypeError
    }

    // 原 state 内容未被任何 action 改动
    expect(before).toEqual(beforeSnapshot);
  });
});
