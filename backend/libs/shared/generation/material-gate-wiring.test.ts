import { describe, expect, it, vi } from "vitest";

import { createRequestMaterialGate } from "./material-gate-wiring.js";
import {
  MATERIAL_NOT_APPROVED_MESSAGE,
  MATERIAL_STATUS_UNAVAILABLE_MESSAGE,
} from "./material-compliance-gate.js";

// IKF YHJ：这一组钉的是**生产实际跑的那段接线**（信封解析 + 终局/可重试分类 + 失败处置
// 的触发 + 把上游异常咽成 null）。抽取前它是控制器里的私有方法，零测试覆盖——
// 内核、仓库层、worker 都有测试，唯独真正跑在线上的这层没有。

function makeDeps(callResult: unknown) {
  const callAction = vi.fn().mockResolvedValue(callResult);
  const onMaterialFailure = vi.fn().mockResolvedValue(undefined);
  const repo = {
    findByMaterialId: vi.fn().mockResolvedValue(null),
    mirrorStatus: vi.fn().mockResolvedValue(undefined),
  };
  return { callAction, onMaterialFailure, repo };
}

const gateInput = (materialId: string) => ({
  userId: "9",
  jobType: "video",
  jobInput: { reference_materials: [{ id: materialId, type: "image" }] },
});

/** 上游 2xx + Result.Status 的成功信封。 */
const okEnvelope = (status: string, error?: Record<string, unknown>) => ({
  status: 200,
  body: {
    ResponseMetadata: { Action: "GetAsset" },
    Result: { Id: "asset-a", Status: status, ...(error ? { Error: error } : {}) },
  },
});

describe("createRequestMaterialGate —— 生产接线（IKFYHJ）", () => {
  it("上游 Active：放行，且不触发失败处置", async () => {
    const deps = makeDeps(okEnvelope("Active"));
    const gate = createRequestMaterialGate(deps as never);

    await expect(gate.assertInputUsable(gateInput("asset-a"))).resolves.toBeNull();
    expect(deps.onMaterialFailure).not.toHaveBeenCalled();
  });

  it("上游 Failed：拒绝，并按三步处置（含删上游）", async () => {
    const deps = makeDeps(okEnvelope("Failed", { Code: "Sensitive", Message: "命中审核" }));
    const gate = createRequestMaterialGate(deps as never);

    await expect(gate.assertInputUsable(gateInput("asset-a"))).resolves.toBe(
      MATERIAL_NOT_APPROVED_MESSAGE,
    );
    expect(deps.onMaterialFailure).toHaveBeenCalledWith({
      materialId: "asset-a",
      errorCode: "Sensitive",
      errorMessage: "命中审核",
      deleteUpstream: true,
    });
  });

  it("上游 Processing：拒绝，但**不**触发处置（还没定论，别删）", async () => {
    const deps = makeDeps(okEnvelope("Processing"));
    const gate = createRequestMaterialGate(deps as never);

    await expect(gate.assertInputUsable(gateInput("asset-a"))).resolves.toBe(
      MATERIAL_NOT_APPROVED_MESSAGE,
    );
    expect(deps.onMaterialFailure).not.toHaveBeenCalled();
  });

  it("上游 NotFound.asset_id：终局拒绝 + 处置但**不重复删**上游（本来就没有）", async () => {
    const deps = makeDeps({
      status: 404,
      body: {
        ResponseError: {
          Code: "NotFound.asset_id",
          Message: "The specified asset asset-a is not found.",
        },
      },
    });
    const gate = createRequestMaterialGate(deps as never);

    await expect(gate.assertInputUsable(gateInput("asset-a"))).resolves.toBe(
      MATERIAL_NOT_APPROVED_MESSAGE,
    );
    expect(deps.onMaterialFailure).toHaveBeenCalledWith({
      materialId: "asset-a",
      errorCode: "NotFound.asset_id",
      errorMessage: "The specified asset asset-a is not found.",
      deleteUpstream: false,
    });
  });

  it("坏凭证（new_api_error 信封，无 ResponseError）：可重试，不误标素材失败", async () => {
    const deps = makeDeps({
      status: 401,
      body: { error: { code: "", message: "Invalid token", type: "new_api_error" } },
    });
    const gate = createRequestMaterialGate(deps as never);

    await expect(gate.assertInputUsable(gateInput("asset-a"))).resolves.toBe(
      MATERIAL_STATUS_UNAVAILABLE_MESSAGE,
    );
    expect(deps.onMaterialFailure).not.toHaveBeenCalled();
  });

  it.each([
    ["租户未开通", { ResponseError: { Code: "FeatureNotEnabled" } }],
    ["限流", { ResponseError: { Code: "LimitExceeded" } }],
    ["5xx", { ResponseError: { Code: "InternalError" } }],
    ["非 JSON 体", "<html>500</html>"],
    ["缺 Status 的信封", { Result: { Id: "asset-a" } }],
  ])("上游 %s：按「本轮未知」可重试，绝不标记素材失败", async (_label, body) => {
    const deps = makeDeps({ status: 500, body });
    const gate = createRequestMaterialGate(deps as never);

    await expect(gate.assertInputUsable(gateInput("asset-a"))).resolves.toBe(
      MATERIAL_STATUS_UNAVAILABLE_MESSAGE,
    );
    expect(deps.onMaterialFailure).not.toHaveBeenCalled();
  });

  it("callAction 抛错（网络失败/缺凭证）：咽成 null 走可重试，不冒成 503/500", async () => {
    const deps = makeDeps(null);
    deps.callAction.mockRejectedValue(new Error("素材库服务不可达"));
    const gate = createRequestMaterialGate(deps as never);

    await expect(gate.assertInputUsable(gateInput("asset-a"))).resolves.toBe(
      MATERIAL_STATUS_UNAVAILABLE_MESSAGE,
    );
    expect(deps.onMaterialFailure).not.toHaveBeenCalled();
  });

  it("本地已有 Failed 行：直接拒绝，连上游都不打（与 GetAsset 本地优先同一口径）", async () => {
    const deps = makeDeps(okEnvelope("Active"));
    deps.repo.findByMaterialId.mockResolvedValue({ status: "Failed" });
    const gate = createRequestMaterialGate(deps as never);

    await expect(gate.assertInputUsable(gateInput("asset-a"))).resolves.toBe(
      MATERIAL_NOT_APPROVED_MESSAGE,
    );
    expect(deps.callAction).not.toHaveBeenCalled();
  });

  it("非 video 任务：短路放行，不查任何东西", async () => {
    const deps = makeDeps(okEnvelope("Failed"));
    const gate = createRequestMaterialGate(deps as never);

    await expect(
      gate.assertInputUsable({
        userId: "9",
        jobType: "audio",
        jobInput: { reference_materials: [{ id: "asset-a", type: "image" }] },
      }),
    ).resolves.toBeNull();
    expect(deps.callAction).not.toHaveBeenCalled();
    expect(deps.repo.findByMaterialId).not.toHaveBeenCalled();
  });
});
