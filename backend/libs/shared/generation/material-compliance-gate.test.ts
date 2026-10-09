import { describe, expect, it, vi } from "vitest";
import {
  MATERIAL_NOT_APPROVED_MESSAGE,
  MATERIAL_STATUS_UNAVAILABLE_MESSAGE,
  assertMaterialsUsable,
  collectLocalAssetIds,
  collectMaterialIds,
  createMaterialGate,
  isMaterialLevelRejection,
  type MaterialComplianceDeps,
} from "./material-compliance-gate.js";

function makeDeps(opts: {
  row?: { status: string } | null;
  upstream?: { status: string; errorCode?: string | null; errorMessage?: string | null } | null;
}) {
  const repo = {
    findByMaterialId: vi.fn().mockResolvedValue(
      opts.row === undefined
        ? null
        : opts.row === null
          ? null
          : { userId: "9", materialId: "asset-1", materialGroupId: "group-1", errorCode: null, errorMessage: null, statusCheckedAt: null, id: "1", ...opts.row },
    ),
    mirrorStatus: vi.fn().mockResolvedValue(undefined),
  };
  const fetchUpstreamStatus = vi.fn().mockResolvedValue(opts.upstream ?? null);
  return { repo, fetchUpstreamStatus } as unknown as MaterialComplianceDeps & {
    repo: { findByMaterialId: ReturnType<typeof vi.fn>; mirrorStatus: ReturnType<typeof vi.fn> };
    fetchUpstreamStatus: ReturnType<typeof vi.fn>;
  };
}

describe("assertMaterialsUsable（IKFYHJ / ADR-0087 决策 2）", () => {
  it("表内 Active：放行，且不查上游", async () => {
    const deps = makeDeps({ row: { status: "Active" } });
    await expect(assertMaterialsUsable(deps, "9", ["asset-1"])).resolves.toEqual({ ok: true });
    expect(deps.fetchUpstreamStatus).not.toHaveBeenCalled();
  });

  it("表内 Failed：拒绝，且不查上游", async () => {
    const deps = makeDeps({ row: { status: "Failed" } });
    await expect(assertMaterialsUsable(deps, "9", ["asset-1"])).resolves.toEqual({
      ok: false,
      message: MATERIAL_NOT_APPROVED_MESSAGE,
    });
    expect(deps.fetchUpstreamStatus).not.toHaveBeenCalled();
  });

  it("表内 Processing：实时查上游，Active 则放行并回写", async () => {
    const deps = makeDeps({ row: { status: "Processing" }, upstream: { status: "Active" } });
    await expect(assertMaterialsUsable(deps, "9", ["asset-1"])).resolves.toEqual({ ok: true });
    expect(deps.fetchUpstreamStatus).toHaveBeenCalledWith("asset-1");
    expect(deps.repo.mirrorStatus).toHaveBeenCalledWith({
      userId: "9",
      materialId: "asset-1",
      status: "Active",
      errorCode: null,
      errorMessage: null,
    });
  });

  it("表内 Processing：上游已 Failed → 拒绝，并回写状态与失败原文", async () => {
    const deps = makeDeps({
      row: { status: "Processing" },
      upstream: { status: "Failed", errorCode: "Sensitive", errorMessage: "命中审核" },
    });
    await expect(assertMaterialsUsable(deps, "9", ["asset-1"])).resolves.toEqual({
      ok: false,
      message: MATERIAL_NOT_APPROVED_MESSAGE,
    });
    expect(deps.repo.mirrorStatus).toHaveBeenCalledWith({
      userId: "9",
      materialId: "asset-1",
      status: "Failed",
      errorCode: "Sensitive",
      errorMessage: "命中审核",
    });
  });

  it("无记录：实时查上游；Active 放行，但不凭空造行", async () => {
    const deps = makeDeps({ row: null, upstream: { status: "Active" } });
    await expect(assertMaterialsUsable(deps, "9", ["asset-1"])).resolves.toEqual({ ok: true });
    expect(deps.fetchUpstreamStatus).toHaveBeenCalledWith("asset-1");
    expect(deps.repo.mirrorStatus).not.toHaveBeenCalled();
  });

  it("无记录且上游 Failed：拒绝", async () => {
    const deps = makeDeps({ row: null, upstream: { status: "Failed" } });
    await expect(assertMaterialsUsable(deps, "9", ["asset-1"])).resolves.toEqual({
      ok: false,
      message: MATERIAL_NOT_APPROVED_MESSAGE,
    });
  });

  it("上游不可达：fail-closed，给可重试文案（不赌它可用）", async () => {
    const deps = makeDeps({ row: { status: "Processing" }, upstream: null });
    await expect(assertMaterialsUsable(deps, "9", ["asset-1"])).resolves.toEqual({
      ok: false,
      message: MATERIAL_STATUS_UNAVAILABLE_MESSAGE,
    });
  });

  it("认不出的上游状态按未就绪处理，不误判为可用", async () => {
    const deps = makeDeps({ row: null, upstream: { status: "Weird" } });
    await expect(assertMaterialsUsable(deps, "9", ["asset-1"])).resolves.toEqual({
      ok: false,
      message: MATERIAL_NOT_APPROVED_MESSAGE,
    });
  });

  it("多素材：命中第一个不可用即返回，不再继续", async () => {
    const deps = makeDeps({ row: { status: "Failed" } });
    await expect(
      assertMaterialsUsable(deps, "9", ["asset-1", "asset-2"]),
    ).resolves.toEqual({ ok: false, message: MATERIAL_NOT_APPROVED_MESSAGE });
    expect(deps.repo.findByMaterialId).toHaveBeenCalledTimes(1);
  });

  it("空集合：直接放行（无引用需校验）", async () => {
    const deps = makeDeps({ row: null });
    await expect(assertMaterialsUsable(deps, "9", [])).resolves.toEqual({ ok: true });
    expect(deps.repo.findByMaterialId).not.toHaveBeenCalled();
  });

  it("查询始终带 user_id 谓词（ADR-0087 决策 1 的纵深防御）", async () => {
    const deps = makeDeps({ row: { status: "Active" } });
    await assertMaterialsUsable(deps, "42", ["asset-1"]);
    expect(deps.repo.findByMaterialId).toHaveBeenCalledWith("42", "asset-1");
  });
});

describe("collectMaterialIds（IKFYHJ）", () => {
  it("合并三条来源并去重保序：references / 旧首尾帧字段 / 本地 Asset 转换", () => {
    expect(
      collectMaterialIds({
        references: [{ material_id: "asset-a" }, { asset_id: "100" }, { material_id: "asset-b" }],
        firstFrameMaterialId: "asset-c",
        lastFrameMaterialId: undefined,
        referenceMaterials: [{ id: "asset-a" }, { id: "asset-d" }],
        materialIdsFromLocalAssets: ["asset-e", "asset-a"],
      }),
    ).toEqual(["asset-a", "asset-b", "asset-c", "asset-d", "asset-e"]);
  });

  it("忽略非字符串与空串", () => {
    expect(
      collectMaterialIds({
        references: [{ material_id: 123 }, { material_id: "" }, {}],
        firstFrameMaterialId: null,
      }),
    ).toEqual([]);
  });

  it("无任何来源时返回空数组", () => {
    expect(collectMaterialIds({})).toEqual([]);
  });
});

describe("collectLocalAssetIds（IKFYHJ：本地 Asset 那条绕过路径）", () => {
  it("合并 references.asset_id / 旧首尾帧字段 / reference_asset_ids", () => {
    expect(
      collectLocalAssetIds({
        references: [{ asset_id: "100" }, { material_id: "asset-x" }, { asset_id: "101" }],
        first_frame_asset_id: "102",
        reference_asset_ids: ["100", "103"],
      }),
    ).toEqual(["100", "101", "102", "103"]);
  });

  it("素材库 id 与非法值不算本地 Asset", () => {
    expect(
      collectLocalAssetIds({ references: [{ asset_id: "asset-x" }, { asset_id: "" }, { asset_id: 5 }] }),
    ).toEqual([]);
  });
});

describe("createMaterialGate（IKFYHJ 接线层）", () => {
  const baseDeps = () => ({
    repo: {
      findByMaterialId: vi.fn().mockResolvedValue({ status: "Active" }),
      mirrorStatus: vi.fn().mockResolvedValue(undefined),
    },
    fetchUpstreamStatus: vi.fn().mockResolvedValue(null),
    resolveLocalAssetMaterialIds: vi.fn().mockResolvedValue([]),
  });

  it("无任何素材引用：放行，且不查任何东西", async () => {
    const deps = baseDeps();
    const gate = createMaterialGate(deps as never);
    await expect(gate.assertInputUsable({ userId: "9", jobType: "video", jobInput: { prompt: "x" } })).resolves.toBeNull();
    expect(deps.repo.findByMaterialId).not.toHaveBeenCalled();
  });

  it("直接声明的素材引用可用：放行", async () => {
    const deps = baseDeps();
    const gate = createMaterialGate(deps as never);
    await expect(
      gate.assertInputUsable({ userId: "9", jobType: "video", jobInput: { references: [{ material_id: "asset-a" }] } }),
    ).resolves.toBeNull();
    expect(deps.repo.findByMaterialId).toHaveBeenCalledWith("9", "asset-a");
  });

  it("本地 Asset 已绑素材库素材：解析后一并过门（前端拦不住的那条）", async () => {
    const deps = baseDeps();
    deps.resolveLocalAssetMaterialIds.mockResolvedValue(["asset-from-local"]);
    deps.repo.findByMaterialId.mockResolvedValue({ status: "Failed" });
    const gate = createMaterialGate(deps as never);

    await expect(
      gate.assertInputUsable({ userId: "9", jobType: "video", jobInput: { first_frame_asset_id: "100" } }),
    ).resolves.toBe(MATERIAL_NOT_APPROVED_MESSAGE);
    expect(deps.resolveLocalAssetMaterialIds).toHaveBeenCalledWith("9", ["100"]);
    expect(deps.repo.findByMaterialId).toHaveBeenCalledWith("9", "asset-from-local");
  });

  it("缺 resolveLocalAssetMaterialIds：本地 Asset 那条不过门（接线方显式取舍）", async () => {
    const deps = baseDeps();
    const gate = createMaterialGate({ repo: deps.repo, fetchUpstreamStatus: deps.fetchUpstreamStatus } as never);
    await expect(
      gate.assertInputUsable({ userId: "9", jobType: "video", jobInput: { first_frame_asset_id: "100" } }),
    ).resolves.toBeNull();
    expect(deps.repo.findByMaterialId).not.toHaveBeenCalled();
  });

  it.each(["audio", "image"])(
    "%s 任务直接短路：连本地 Asset 解析都不跑（不误伤非视频路径）",
    async (jobType) => {
      const deps = baseDeps();
      deps.resolveLocalAssetMaterialIds.mockResolvedValue(["asset-from-local"]);
      deps.repo.findByMaterialId.mockResolvedValue({ status: "Failed" });
      const gate = createMaterialGate(deps as never);

      await expect(
        gate.assertInputUsable({
          userId: "9",
          jobType,
          jobInput: {
            references: [{ material_id: "asset-a", asset_id: "100" }],
            first_frame_asset_id: "100",
          },
        }),
      ).resolves.toBeNull();
      expect(deps.resolveLocalAssetMaterialIds).not.toHaveBeenCalled();
      expect(deps.repo.findByMaterialId).not.toHaveBeenCalled();
      expect(deps.fetchUpstreamStatus).not.toHaveBeenCalled();
    },
  );
});

describe("isMaterialLevelRejection（上游错误码分类）", () => {
  it.each([
    "NotFound.asset_id",
    "InvalidParameter.AssetID",
    "notfound.asset_id",
  ])("%s → 终局拒绝", (code) => {
    expect(isMaterialLevelRejection(code)).toBe(true);
  });

  it.each([
    "FeatureNotEnabled",
    "LimitExceeded",
    "InternalError",
    "Unauthorized",
    "Forbidden",
    "NotFound",
    "",
  ])("%s → 不认作素材级，按本轮未知", (code) => {
    expect(isMaterialLevelRejection(code)).toBe(false);
  });

  it("null / undefined → 不认作素材级", () => {
    expect(isMaterialLevelRejection(null)).toBe(false);
    expect(isMaterialLevelRejection(undefined)).toBe(false);
  });
});
