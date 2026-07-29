import { describe, expect, it, vi } from "vitest";

import { handleDeleteProject } from "./handle-delete-project.js";
import { handleGetProject } from "./handle-get-project.js";
import { handleRenameProject } from "./handle-rename-project.js";

function makeRepo() {
  return {
    listByOwner: vi.fn(),
    create: vi.fn(),
    findOwnedById: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
  };
}

const sample = { id: "1", name: "p", thumb: null, created_at: "2026-07-27T00:00:00.000Z" };

describe("handleGetProject", () => {
  it("找到且归属对 → 200 + ProjectView", async () => {
    const db = makeRepo();
    db.findOwnedById.mockResolvedValue(sample);
    const result = await handleGetProject("9", "1", { db });
    expect(result).toEqual({ code: 200, msg: null, data: sample });
    expect(db.findOwnedById).toHaveBeenCalledWith("1", "9");
  });

  it("找不到/无权 → 100100", async () => {
    const db = makeRepo();
    db.findOwnedById.mockResolvedValue(null);
    expect((await handleGetProject("9", "1", { db })).code).toBe(100100);
  });
});

describe("handleRenameProject", () => {
  it("合法 name + 找到 → 200", async () => {
    const db = makeRepo();
    db.rename.mockResolvedValue({ ...sample, name: "改名" });
    const result = await handleRenameProject("9", "1", { name: "改名" }, { db });
    expect(result.code).toBe(200);
    expect(db.rename).toHaveBeenCalledWith("1", "9", "改名");
  });

  it("空 name → 400", async () => {
    const db = makeRepo();
    expect((await handleRenameProject("9", "1", { name: "  " }, { db })).code).toBe(400);
    expect(db.rename).not.toHaveBeenCalled();
  });

  it("找不到 → 100100", async () => {
    const db = makeRepo();
    db.rename.mockResolvedValue(null);
    expect((await handleRenameProject("9", "1", { name: "x" }, { db })).code).toBe(100100);
  });
});

describe("handleDeleteProject", () => {
  it("删成 → 200 + data:null", async () => {
    const db = makeRepo();
    db.delete.mockResolvedValue(true);
    const result = await handleDeleteProject("9", "1", { db });
    expect(result).toEqual({ code: 200, msg: null, data: null });
  });

  it("找不到 → 100100", async () => {
    const db = makeRepo();
    db.delete.mockResolvedValue(false);
    expect((await handleDeleteProject("9", "1", { db })).code).toBe(100100);
  });
});
