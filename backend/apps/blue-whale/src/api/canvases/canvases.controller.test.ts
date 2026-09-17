import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";

import { CanvasesController } from "./canvases.controller.js";
import { NewApiError } from "@lib/core";
import { DATA_NOT_EXIST_CODE, DomainError } from "@lib/contracts";
import type { CanvasService } from "@lib/shared/canvas/canvas.service.js";

// 控制器层专项：save 改写为 @Res() 手动写出后，成功/冲突两条分支的**状态码 + 响应体**
// 都成了本文件的职责——服务层单测只看得到返回值，看不到它们怎么落到 HTTP 上。
// 这里用假 Response 捕获实际写出的内容，不挂 Nest、不连库，任何环境都能跑。

type SaveResult = Record<string, unknown>;

function makeController(outcome: SaveResult | Error) {
  const save = vi.fn();
  if (outcome instanceof Error) save.mockRejectedValue(outcome);
  else save.mockResolvedValue(outcome);
  const canvas = { save } as unknown as CanvasService;
  const controller = new CanvasesController(canvas);
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  return { controller, canvas, res };
}

const USER = { userId: "100" } as never;

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

  // save() 现在只可能回「成功信封」或「412」——not-found 已改成抛 DomainError 走统一投影
  // （见 canvas.service.ts），所以这条只剩防御性：非 412 的信封照原样按 200 写出。
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
