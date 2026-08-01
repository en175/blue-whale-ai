import { describe, expect, it, vi } from "vitest";

import { handleCreateProject } from "./handle-create-project.js";
import { handleListProjects } from "./handle-list-projects.js";

// Project 路由处理器（list/create）：校验 + 调 repo → {code,msg,data}。
function makeRepo() {
  return {
    listByOwner: vi.fn(),
    create: vi.fn(),
    findOwnedById: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
  };
}

const sample = {
  id: "1",
  name: "我的画布",
  thumb: null,
  created_at: "2026-07-27T00:00:00.000Z",
};

describe("handleListProjects", () => {
  it("列出 owner 的项目 → 200 + ProjectView[]", async () => {
    const db = makeRepo();
    db.listByOwner.mockResolvedValue([sample]);
    const result = await handleListProjects("9", { db });
    expect(result).toEqual({ code: 200, msg: null, data: [sample] });
    expect(db.listByOwner).toHaveBeenCalledWith("9");
  });
});

describe("handleCreateProject", () => {
  it("合法 name → 200 + 新 ProjectView", async () => {
    const db = makeRepo();
    db.create.mockResolvedValue({ ...sample, id: "10", name: "新画布" });
    const result = await handleCreateProject("9", { name: "新画布" }, { db });
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ id: "10", name: "新画布" });
    expect(db.create).toHaveBeenCalledWith("9", "新画布");
  });

  it("空 name → 400，不建", async () => {
    const db = makeRepo();
    const result = await handleCreateProject("9", { name: "  " }, { db });
    expect(result.code).toBe(400);
    expect(db.create).not.toHaveBeenCalled();
  });
});
