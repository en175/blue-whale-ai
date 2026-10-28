import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";

import { CanvasesController } from "./canvases.controller.js";
import { NewApiError } from "@lib/core";
import { DATA_NOT_EXIST_CODE, DomainError } from "@lib/contracts";
import type { CanvasService } from "@lib/shared/canvas/canvas.service.js";


type SaveResult = Record<string, unknown>;

function makeController(outcome: SaveResult | Error, applyOutcome: SaveResult | Error = {}) {
  const save = vi.fn();
  if (outcome instanceof Error) save.mockRejectedValue(outcome);
  else save.mockResolvedValue(outcome);
  const apply = vi.fn();
  if (applyOutcome instanceof Error) apply.mockRejectedValue(applyOutcome);
  else apply.mockResolvedValue(applyOutcome);
  const canvas = { save, apply } as unknown as CanvasService;
  const controller = new CanvasesController(canvas);
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  return { controller, canvas, res };
}

const USER = { userId: "100" } as never;

describe("CanvasesController.applyChanges 版本前置", () => {
  it("带 If-Match 透传 expectedVersion，成功按 200 写出", async () => {
    const { controller, canvas, res } = makeController({}, { code: 200, msg: "ok", data: { version: 4 } });

    await controller.applyChanges(USER, "523", { upsert_nodes: [] }, '"3"', res);

    expect(canvas.apply).toHaveBeenCalledWith("100", "523", { upsert_nodes: [], expectedVersion: 3 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("missing 哨兵透传 null", async () => {
    const { controller, canvas, res } = makeController({}, { code: 200, msg: "ok", data: { version: 1 } });

    await controller.applyChanges(USER, "523", {}, '"missing"', res);

    expect(canvas.apply).toHaveBeenCalledWith("100", "523", { expectedVersion: null });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("过期版本 → 412 且响应体带当前版本", async () => {
    const { controller, res } = makeController({}, {
      code: 412,
      msg: "Canvas 版本冲突",
      data: { version: 7 },
    });

    await controller.applyChanges(USER, "523", {}, '"3"', res);

    expect(res.status).toHaveBeenCalledWith(412);
    expect(res.json).toHaveBeenCalledWith({ code: 412, msg: "Canvas 版本冲突", data: { version: 7 } });
  });

  it("不带 If-Match → 不传 expectedVersion", async () => {
    const { controller, canvas, res } = makeController({}, { code: 200, msg: "ok", data: { version: 1 } });

    await controller.applyChanges(USER, "523", {}, undefined, res);

    expect(canvas.apply).toHaveBeenCalledWith("100", "523", {});
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("无效 If-Match → 400 且不调用服务", async () => {
    const { controller, canvas, res } = makeController({}, {});

    await expect(controller.applyChanges(USER, "523", {}, "v3", res)).rejects.toBeInstanceOf(NewApiError);
    expect(canvas.apply).not.toHaveBeenCalled();
  });
});

describe("CanvasesController.save 响应写出", () => {
  it("版本冲突 → HTTP 412，且响应体 data.version 为服务端当前版本", async () => {
    const { controller, res } = makeController({
      code: 412,
      msg: "Canvas 版本冲突",
      data: { version: 7 },
    });

    await controller.save(USER, "523", { nodes: "[]" }, '"3"', res);

    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(412);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      code: 412,
      msg: "Canvas 版本冲突",
      data: { version: 7 },
    });
  });

  it("空覆盖防护 → HTTP 422，信封原样写出（IKIIWN）", async () => {
    const { controller, res } = makeController({
      code: 422,
      msg: "画布非空，本次保存会清空全部节点；确认清空请携带 confirmEmpty",
      data: null,
    });

    await controller.save(USER, "523", { nodes: "[]" }, '"3"', res);

    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      code: 422,
      msg: "画布非空，本次保存会清空全部节点；确认清空请携带 confirmEmpty",
      data: null,
    });
  });

  it("确认清空缺 If-Match → HTTP 428，信封原样写出（IKIMQJ）", async () => {
    const { controller, res } = makeController({
      code: 428,
      msg: "确认清空必须携带 If-Match 数值版本",
      data: null,
    });

    await controller.save(USER, "523", { nodes: "[]", confirmEmpty: true }, undefined, res);

    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(428);
    expect(res.json).toHaveBeenCalledWith({
      code: 428,
      msg: "确认清空必须携带 If-Match 数值版本",
      data: null,
    });
  });

  it("保存成功 → HTTP 200，信封与 data.version 原样透传（与成功路径字段一致）", async () => {
    const { controller, res } = makeController({
      code: 200,
      msg: null,
      data: { id: "900", project_id: "523", version: 8 },
    });

    await controller.save(USER, "523", { nodes: "[]" }, '"7"', res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      code: 200,
      msg: null,
      data: { id: "900", project_id: "523", version: 8 },
    });
  });

  it("非 412 的信封（防御分支）→ 原样 200 写出，不擅自改状态码", async () => {
    const { controller, res } = makeController({
      code: 100100,
      msg: "项目不存在",
      data: null,
    });

    await controller.save(USER, "523", { nodes: "[]" }, undefined, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ code: 100100, msg: "项目不存在", data: null });
  });

  it("项目不属于调用方 → 服务层抛 DomainError，控制器不吞、不写出响应（交给 AllExceptionsFilter）", async () => {
    const { controller, res } = makeController(
      new DomainError(DATA_NOT_EXIST_CODE, "项目不存在"),
    );

    await expect(
      controller.save(USER, "523", { nodes: "[]" }, undefined, res),
    ).rejects.toThrow(DomainError);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("If-Match 换版本号：\"missing\" → expectedVersion=null，缺失 → 不传该字段", async () => {
    const missing = makeController({ code: 200, msg: null, data: { version: 0 } });
    await missing.controller.save(USER, "523", { nodes: "[]" }, '"missing"', missing.res);
    expect(missing.canvas.save).toHaveBeenCalledWith("100", "523", {
      nodes: "[]",
      expectedVersion: null,
    });

    const absent = makeController({ code: 200, msg: null, data: { version: 0 } });
    await absent.controller.save(USER, "523", { nodes: "[]" }, undefined, absent.res);
    expect(absent.canvas.save).toHaveBeenCalledWith("100", "523", { nodes: "[]" });
  });

  it("If-Match 格式非法 → 400，不触碰服务层", async () => {
    const { controller, canvas, res } = makeController({ code: 200, msg: null, data: null });

    await expect(
      controller.save(USER, "523", { nodes: "[]" }, 'W/"3"', res),
    ).rejects.toThrow(new NewApiError("无效的 If-Match", 400));
    expect(canvas.save).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe("CanvasesController.listGenerationRecovery 受控信封直写（IKJKUA）", () => {
  it("受控错误（409 + data.reason）→ 按信封 code 直写状态码，信封原样透传", async () => {
    const envelope = {
      code: 409,
      msg: "画布存在未收口的恢复冲突",
      data: { reason: "canvas_recovery_conflict" },
    };
    const canvas = {
      listGenerationRecovery: vi.fn().mockResolvedValue(envelope),
    } as unknown as CanvasService;
    const controller = new CanvasesController(canvas);
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

    await controller.listGenerationRecovery(USER, "523", res, undefined, undefined);

    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(envelope);
  });
});
