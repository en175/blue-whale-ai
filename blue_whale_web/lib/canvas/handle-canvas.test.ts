import { describe, expect, it, vi } from "vitest";

import { handleGetCanvas, handleSaveCanvas } from "./handle-canvas.js";

// Canvas 路由处理器：先验 project 归属，再 get/save canvas。
function makeDeps() {
  return {
    project: {
      listByOwner: vi.fn(),
      create: vi.fn(),
      findOwnedById: vi.fn(),
      rename: vi.fn(),
      delete: vi.fn(),
    },
    canvas: {
      getByProject: vi.fn(),
      save: vi.fn(),
    },
  };
}

describe("handleGetCanvas", () => {
  it("project 归属对 → 200 + CanvasView", async () => {
    const deps = makeDeps();
    deps.project.findOwnedById.mockResolvedValue({ id: "1", name: "p", thumb: null, created_at: "x" });
    deps.canvas.getByProject.mockResolvedValue({ id: "7", project_id: "1", viewport: "{}", nodes: "[]" });
    const result = await handleGetCanvas("9", "1", deps);
    expect(result.code).toBe(200);
    expect(deps.canvas.getByProject).toHaveBeenCalledWith("1");
  });

  it("project 不属该用户 → 100100", async () => {
    const deps = makeDeps();
    deps.project.findOwnedById.mockResolvedValue(null);
    const result = await handleGetCanvas("9", "1", deps);
    expect(result.code).toBe(100100);
    expect(deps.canvas.getByProject).not.toHaveBeenCalled();
  });
});

describe("handleSaveCanvas", () => {
  it("归属对 → 200，透传 viewport/nodes 字符串", async () => {
    const deps = makeDeps();
    deps.project.findOwnedById.mockResolvedValue({ id: "1", name: "p", thumb: null, created_at: "x" });
    deps.canvas.save.mockResolvedValue({ id: "7", project_id: "1", viewport: '{"x":0}', nodes: "[]" });
    const result = await handleSaveCanvas("9", "1", { viewport: '{"x":0}', nodes: "[]" }, deps);
    expect(result.code).toBe(200);
    expect(deps.canvas.save).toHaveBeenCalledWith("1", '{"x":0}', "[]");
  });

  it("非字符串 viewport → 当 null 存", async () => {
    const deps = makeDeps();
    deps.project.findOwnedById.mockResolvedValue({ id: "1", name: "p", thumb: null, created_at: "x" });
    deps.canvas.save.mockResolvedValue({ id: "7", project_id: "1", viewport: null, nodes: null });
    await handleSaveCanvas("9", "1", { viewport: 123 }, deps);
    expect(deps.canvas.save).toHaveBeenCalledWith("1", null, null);
  });

  it("归属不对 → 100100", async () => {
    const deps = makeDeps();
    deps.project.findOwnedById.mockResolvedValue(null);
    expect((await handleSaveCanvas("9", "1", {}, deps)).code).toBe(100100);
  });
});
