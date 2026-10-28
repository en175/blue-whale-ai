import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InternalAgentCanvasController } from "./internal-agent-canvas.controller.js";

const NODES = [
  { id: "n1", type: "textNode", position: { x: 1, y: 2 }, data: { title: "蓝鲸文案" } },
  { id: "n2", type: "mediaNode", position: { x: 3, y: 4 }, data: { title: "参考图" } },
];

function buildController(options: { owned?: boolean } = {}) {
  const prisma = {
    project_canvas: {
      findFirst: async () => ({
        id: 1n,
        project_id: 55n,
        version: 1,
        viewport_json: null,
        nodes_json: NODES,
        edges_json: [{ id: "e1", source: "n1", target: "n2" }],
        rows_authoritative: 0,
      }),
    },
  };
  const project = {
    findOwnedById: vi.fn(async () => options.owned === false ? null : { id: 55n }),
  };
  const controller = new InternalAgentCanvasController(
    project as never,
    { client: prisma } as never,
  );
  return { controller, project };
}

const TOKEN = "Bearer test-token";
const CONTEXT = ["tenant-1", "9", "55", "session-1"] as const;

describe("InternalAgentCanvasController", () => {
  const previousToken = process.env.AGENT_SERVICE_TOKEN;

  beforeEach(() => {
    process.env.AGENT_SERVICE_TOKEN = "test-token";
  });

  afterEach(() => {
    if (previousToken === undefined) delete process.env.AGENT_SERVICE_TOKEN;
    else process.env.AGENT_SERVICE_TOKEN = previousToken;
  });

  it("服务凭证无效 → 401", async () => {
    const { controller } = buildController();
    await expect(controller.search(undefined, ...CONTEXT, {})).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
  });

  it("缺少会话或上下文头 → 400 invalid_context", async () => {
    const { controller } = buildController();
    await expect(controller.search(TOKEN, "tenant-1", "9", "55", undefined, {})).rejects.toMatchObject({
      status: 400,
      code: "invalid_context",
    });
  });

  it("项目不属于该用户 → 403", async () => {
    const { controller } = buildController({ owned: false });
    await expect(controller.search(TOKEN, ...CONTEXT, {})).rejects.toMatchObject({
      status: 403,
      code: "project_forbidden",
    });
  });

  it("无筛选条件 → 400 filter_required", async () => {
    const { controller } = buildController();
    await expect(controller.search(TOKEN, ...CONTEXT, {})).rejects.toMatchObject({
      status: 400,
      code: "filter_required",
    });
  });

  it("空白名称 → 400 invalid_request", async () => {
    const { controller } = buildController();
    await expect(controller.search(TOKEN, ...CONTEXT, { name: "   " })).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
    });
  });

  it("按名称搜索返回节点", async () => {
    const { controller, project } = buildController();
    const result = await controller.search(TOKEN, ...CONTEXT, { name: "蓝鲸" });
    expect(project.findOwnedById).toHaveBeenCalledWith("55", "9");
    expect(result.items.map((item) => item.id)).toEqual(["n1"]);
    expect(result.next_cursor).toBeNull();
  });

  it("详情返回节点、边与 missing", async () => {
    const { controller } = buildController();
    const result = await controller.details(TOKEN, ...CONTEXT, { node_ids: ["n1", "n404", "n1"] });
    expect(result.nodes.map((node) => node.id)).toEqual(["n1"]);
    expect(result.edges.map((edge) => edge.id)).toEqual(["e1"]);
    expect(result.missing).toEqual(["n404"]);
  });

  it("详情 node_ids 非法 → 400 invalid_request", async () => {
    const { controller } = buildController();
    await expect(controller.details(TOKEN, ...CONTEXT, { node_ids: [] })).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
    });
  });
});
