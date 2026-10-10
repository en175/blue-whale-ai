import { describe, expect, it, vi } from "vitest";

import {
  assertMaterialLinkable,
  type UpstreamMaterialAsset,
  type UploadMaterialGateDeps,
} from "./material-upload-gate.js";


const MATERIAL = "asset-20260820153209-6c9z8";
const GROUP = "group-20260827113901-cbkmf";
const NOT_APPROVED = "该素材未审核通过，不能用于视频生成";
const UNAVAILABLE = "素材状态校验失败，请稍后重试";

type GateRow = {
  id: string;
  materialId: string;
  userId: string;
  materialGroupId: string;
  status: "Processing" | "Active" | "Failed";
  errorCode: string | null;
  errorMessage: string | null;
  statusCheckedAt: Date | null;
} | null;

function deps(row: GateRow, upstream: UpstreamMaterialAsset | null = null) {
  const findByMaterialId = vi.fn().mockResolvedValue(row);
  const mirrorStatus = vi.fn().mockResolvedValue(undefined);
  const upsertProcessing = vi.fn().mockResolvedValue(undefined);
  const fetchUpstream = vi.fn().mockResolvedValue(upstream);
  return {
    gateDeps: {
      repo: { findByMaterialId, mirrorStatus, upsertProcessing },
      fetchUpstream,
    } as unknown as UploadMaterialGateDeps,
    findByMaterialId,
    mirrorStatus,
    upsertProcessing,
    fetchUpstream,
  };
}

function rowOf(status: "Processing" | "Active" | "Failed") {
  return {
    id: "1",
    materialId: MATERIAL,
    userId: "9",
    materialGroupId: GROUP,
    status,
    errorCode: null,
    errorMessage: null,
    statusCheckedAt: null,
  };
}

describe("assertMaterialLinkable（上传口素材闸）", () => {
  it("本地行 Active → 放行，且**不打上游**", async () => {
    const { gateDeps, fetchUpstream } = deps(rowOf("Active"));
    const result = await assertMaterialLinkable(gateDeps, "9", MATERIAL);
    expect(result).toEqual({ ok: true });
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it("本地行 Failed → 拒绝，且不打上游", async () => {
    const { gateDeps, fetchUpstream } = deps(rowOf("Failed"));
    const result = await assertMaterialLinkable(gateDeps, "9", MATERIAL);
    expect(result).toEqual({
      ok: false,
      reason: "not_approved",
      message: NOT_APPROVED,
    });
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it("本地行 Processing + 上游 Active → 回写后放行", async () => {
    const { gateDeps, mirrorStatus } = deps(rowOf("Processing"), {
      status: "Active",
      groupId: GROUP,
    });
    const result = await assertMaterialLinkable(gateDeps, "9", MATERIAL);
    expect(mirrorStatus).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "9", materialId: MATERIAL, status: "Active" }),
    );
    expect(result.ok).toBe(true);
  });

  it("无记录 + 上游 Active 带 GroupId → **补建行**并放行（上传口独有）", async () => {
    const { gateDeps, upsertProcessing, mirrorStatus } = deps(null, {
      status: "Active",
      groupId: GROUP,
    });
    const result = await assertMaterialLinkable(gateDeps, "9", MATERIAL);
    expect(upsertProcessing).toHaveBeenCalledWith({
      userId: "9",
      materialId: MATERIAL,
      materialGroupId: GROUP,
    });
    expect(mirrorStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "Active" }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("无记录 + 上游已经 Failed → 补行后仍然拒绝", async () => {
    const { gateDeps, upsertProcessing } = deps(null, {
      status: "Failed",
      groupId: GROUP,
      errorCode: "ContentRisk",
      errorMessage: "被判风险",
    });
    const result = await assertMaterialLinkable(gateDeps, "9", MATERIAL);
    expect(upsertProcessing).toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      reason: "not_approved",
      message: NOT_APPROVED,
    });
  });

  it("本地行 Processing + 上游仍 Processing → 拒绝，reason=pending（未到终态，不是判失败）", async () => {
    const { gateDeps } = deps(rowOf("Processing"), {
      status: "Processing",
      groupId: GROUP,
    });
    const result = await assertMaterialLinkable(gateDeps, "9", MATERIAL);
    expect(result).toEqual({
      ok: false,
      reason: "pending",
      message: NOT_APPROVED,
    });
  });

  it("无记录 + 上游不可达 → 拒绝，且**不造行**（坏响应不配留下痕迹）", async () => {
    const { gateDeps, upsertProcessing } = deps(null, null);
    const result = await assertMaterialLinkable(gateDeps, "9", MATERIAL);
    expect(result).toEqual({
      ok: false,
      reason: "unavailable",
      message: UNAVAILABLE,
    });
    expect(upsertProcessing).not.toHaveBeenCalled();
  });

  it("无记录 + 上游 Active 但没给 GroupId → 放行，只是补不了行（material_assets 那列 NOT NULL）", async () => {
    const { gateDeps, upsertProcessing } = deps(null, {
      status: "Active",
      groupId: null,
    });
    const result = await assertMaterialLinkable(gateDeps, "9", MATERIAL);
    expect(result).toEqual({ ok: true });
    expect(upsertProcessing).not.toHaveBeenCalled();
  });
});
