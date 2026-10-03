// IKJJQW：媒体工具共享受理段的单测（先例：handle-create-generation-job.test.ts 的 mock 口径）。
// 只测外部可见行为：剥离/摘要纯函数、受理主体的事务编排次序、重放/冲突/受控错误分支。
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lockMock, writeRowsMock, bindingViewMock, readIdemMock, writeIdemMock } = vi.hoisted(() => ({
  lockMock: vi.fn(),
  writeRowsMock: vi.fn(),
  bindingViewMock: vi.fn(),
  readIdemMock: vi.fn(),
  writeIdemMock: vi.fn(),
}));

vi.mock("@lib/shared/persistence/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lib/shared/persistence/index.js")>();
  return {
    ...actual,
    lockCanvasRecoveryForAcceptance: lockMock,
    writeCanvasRecoveryRows: writeRowsMock,
    canvasBindingView: bindingViewMock,
    readCreateIdempotency: readIdemMock,
    // 事务直通（媒体工具事务内无外部等待，测试只验编排次序）。
    transactionWithUniqueRetry: (_prisma: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn(_prisma),
  };
});

vi.mock("@lib/shared/persistence/generation-job-idempotency.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lib/shared/persistence/generation-job-idempotency.js")>();
  return { ...actual, writeCreateIdempotency: writeIdemMock };
});

import {
  createMediaToolJobWithRecovery,
  mediaToolRequestHash,
  readAcceptedMediaToolReplay,
  renderMediaToolReplay,
  stripCanvasBinding,
  takeCanvasBinding,
  type MediaToolRecovery,
} from "./media-tool-recovery.js";
import { RecoveryContractError } from "@lib/shared/persistence/index.js";
import type { CanvasBinding } from "@lib/contracts";

const BINDING: CanvasBinding = {
  protocol_version: 1,
  submission_id: "0a1b2c3d-0000-4000-8000-00000000a001",
  target_node_id: "node-1",
  expected_binding_revision: 0,
  recovery_seed: {
    target: { role: "result-placeholder", x: 0, y: 0, width: 100, height: 100, name: "" },
    sources: [],
  },
};

const RECOVERY: MediaToolRecovery = {
  projectId: "55",
  userId: "9",
  taskType: "image_erase",
  operation: "image_erase.create",
  requestHash: "hash-1",
  binding: BINDING,
};

function makePrisma(status = "queued") {
  return {
    generation_jobs: {
      findUnique: vi.fn().mockResolvedValue({ status }),
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("takeCanvasBinding：canvas_binding 剥离与纯载荷校验", () => {
  it("passes the body through when canvas_binding is absent", () => {
    const out = takeCanvasBinding({ source_asset_id: "88" });
    expect(out.binding).toBeNull();
    expect(out.invalid).toBe(false);
    expect(out.rest).toEqual({ source_asset_id: "88" });
  });

  it("strips a valid canvas_binding out of the business body", () => {
    const out = takeCanvasBinding({ source_asset_id: "88", canvas_binding: BINDING });
    expect(out.binding).toEqual(BINDING);
    expect(out.rest).toEqual({ source_asset_id: "88" });
  });

  it("flags an invalid canvas_binding without touching the rest", () => {
    const out = takeCanvasBinding({ source_asset_id: "88", canvas_binding: { protocol_version: 2 } });
    expect(out.binding).toBeNull();
    expect(out.invalid).toBe(true);
    expect(out.rest.source_asset_id).toBe("88");
  });
});

describe("stripCanvasBinding：三段校验收敛（IKJLTZ）", () => {
  it("passes and strips when the carrier key equals submission_id", () => {
    const gate = stripCanvasBinding(
      { source_asset_id: "88", canvas_binding: BINDING },
      "Idempotency-Key",
      BINDING.submission_id,
    );
    expect(gate.error).toBeNull();
    expect(gate.binding).toEqual(BINDING);
    expect(gate.rest).toEqual({ source_asset_id: "88" });
  });

  it("returns the fixed 400 envelope for an invalid canvas_binding", () => {
    const gate = stripCanvasBinding(
      { canvas_binding: { protocol_version: 2 } },
      "Idempotency-Key",
      BINDING.submission_id,
    );
    expect(gate.error).toMatchObject({
      code: 400,
      msg: "canvas_binding 载荷无效",
      data: { reason: "invalid_recovery_payload" },
    });
  });

  it("returns a 400 envelope naming the carrier label on mismatch", () => {
    const gate = stripCanvasBinding(
      { canvas_binding: BINDING },
      "client_token",
      "not-the-submission-id",
    );
    expect(gate.error).toMatchObject({
      code: 400,
      msg: "client_token 必须等于 canvas_binding.submission_id",
      data: { reason: "invalid_recovery_payload" },
    });
  });

  it("compares the carrier value strictly without trimming", () => {
    // 防抹平契约：trim 口径归调用方（头形态 trim / client_token 严格原值——其 pattern 允许
    // 空白），helper 内统一 trim 会放行带空白 client_token，行为变化。
    const gate = stripCanvasBinding(
      { canvas_binding: BINDING },
      "client_token",
      ` ${BINDING.submission_id} `,
    );
    expect(gate.error?.msg).toContain("必须等于 canvas_binding.submission_id");
  });
});

describe("mediaToolRequestHash：摘要确定性与覆盖面", () => {
  it("is stable across key-order drift in the same payload", () => {
    const a = mediaToolRequestHash("image_erase.create", "55", "/image-erasures", {
      source_asset_id: "88",
      canvas_binding: BINDING,
    });
    const b = mediaToolRequestHash("image_erase.create", "55", "/image-erasures", {
      canvas_binding: BINDING,
      source_asset_id: "88",
    });
    expect(a).toBe(b);
  });

  it("changes when canvas_binding content changes", () => {
    const a = mediaToolRequestHash("op", "55", "/p", { canvas_binding: BINDING });
    const b = mediaToolRequestHash("op", "55", "/p", {
      canvas_binding: { ...BINDING, target_node_id: "node-2" },
    });
    expect(a).not.toBe(b);
  });
});

describe("createMediaToolJobWithRecovery：受理主体编排", () => {
  it("runs the legacy no-idempotency path without a transaction", async () => {
    const prisma = makePrisma();
    const createJob = vi.fn().mockResolvedValue({ jobId: "400", status: "queued" });
    const out = await createMediaToolJobWithRecovery(prisma, null, createJob);
    expect(out).toEqual({ kind: "ok", jobId: "400", status: "queued", bindingView: null });
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(lockMock).not.toHaveBeenCalled();
  });

  it("accepts with recovery: lock → createJob → recovery rows → idempotency row in one tx", async () => {
    const prisma = makePrisma();
    readIdemMock.mockResolvedValue(null);
    const plan = { acceptance: RECOVERY, bindingRevision: 1, previousTargetSnapshot: null, supersededSubmissionId: null };
    lockMock.mockResolvedValue({ kind: "plan", plan });
    bindingViewMock.mockResolvedValue({
      protocol_version: 1,
      submission_id: BINDING.submission_id,
      target_node_id: "node-1",
      binding_revision: 1,
      job_id: "400",
      is_current: true,
    });
    const createJob = vi.fn().mockResolvedValue({ jobId: "400", status: "queued" });
    const out = await createMediaToolJobWithRecovery(prisma, RECOVERY, createJob);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.bindingView?.is_current).toBe(true);
    // 编排次序：锁 → 建行 → 恢复行 → 幂等行；建行拿到的是事务 client。
    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(createJob).toHaveBeenCalledTimes(1);
    const txArg = createJob.mock.calls[0][0];
    expect(txArg).toBe(prisma);
    expect(writeRowsMock).toHaveBeenCalledWith(prisma, plan, 400n);
    expect(writeIdemMock).toHaveBeenCalledWith(
      prisma,
      { projectId: "55", jobId: 400n, acceptedCursor: "0" },
      { key: BINDING.submission_id, requestHash: "hash-1" },
      "image_erase.create",
    );
  });

  it("replays a same-key same-hash acceptance without any writes", async () => {
    const prisma = makePrisma("processing");
    readIdemMock.mockResolvedValue({ generation_job_id: "400", cursor: 0 });
    bindingViewMock.mockResolvedValue(null);
    const createJob = vi.fn();
    const out = await createMediaToolJobWithRecovery(prisma, RECOVERY, createJob);
    expect(out).toEqual({
      kind: "ok",
      jobId: "400",
      status: "processing",
      bindingView: null,
    });
    // 重放回原关联（现查视图），零建行零恢复行零幂等行写入。
    expect(bindingViewMock).toHaveBeenCalledWith(prisma, "55", BINDING.submission_id);
    expect(createJob).not.toHaveBeenCalled();
    expect(lockMock).not.toHaveBeenCalled();
    expect(writeRowsMock).not.toHaveBeenCalled();
    expect(writeIdemMock).not.toHaveBeenCalled();
  });

  it("returns idempotency_conflict for a same-key different-hash replay", async () => {
    const prisma = makePrisma();
    readIdemMock.mockResolvedValue({ kind: "idempotency_conflict" });
    const out = await createMediaToolJobWithRecovery(prisma, RECOVERY, vi.fn());
    expect(out).toEqual({ kind: "idempotency_conflict" });
  });

  it("surfaces a controlled recovery error envelope from the lock section", async () => {
    const prisma = makePrisma();
    readIdemMock.mockResolvedValue(null);
    lockMock.mockRejectedValue(
      new RecoveryContractError({
        code: 409,
        msg: "目标节点承接版本已变化，请刷新后重试",
        data: { reason: "canvas_binding_conflict", currentBindingRevision: 3 },
      }),
    );
    const out = await createMediaToolJobWithRecovery(prisma, RECOVERY, vi.fn());
    expect(out.kind).toBe("envelope");
    if (out.kind !== "envelope") return;
    expect(out.envelope.code).toBe(409);
    expect(out.envelope.data.reason).toBe("canvas_binding_conflict");
    // 冲突在任务写入与恢复行之前（B.3 步骤 2-4）。
    expect(writeRowsMock).not.toHaveBeenCalled();
  });

  it("keeps the legacy client_token idempotency shape without recovery", async () => {
    const prisma = makePrisma();
    readIdemMock.mockResolvedValue(null);
    const createJob = vi.fn().mockResolvedValue({ jobId: "401", status: "queued" });
    const out = await createMediaToolJobWithRecovery(prisma, null, createJob, {
      projectId: "55",
      operation: "video_matting.create",
      requestHash: "hash-vm",
      key: "token-1",
    });
    expect(out).toEqual({ kind: "ok", jobId: "401", status: "queued", bindingView: null });
    expect(lockMock).not.toHaveBeenCalled();
    expect(writeIdemMock).toHaveBeenCalledWith(
      prisma,
      { projectId: "55", jobId: 401n, acceptedCursor: "0" },
      { key: "token-1", requestHash: "hash-vm" },
      "video_matting.create",
    );
  });
});

describe("readAcceptedMediaToolReplay / renderMediaToolReplay：前置幂等回读（IKJLTX）", () => {
  it("replays the original job with the binding view on a hit", async () => {
    const prisma = makePrisma("processing");
    readIdemMock.mockResolvedValue({ generation_job_id: "400", cursor: 0 });
    bindingViewMock.mockResolvedValue({
      protocol_version: 1,
      submission_id: BINDING.submission_id,
      target_node_id: "node-1",
      binding_revision: 1,
      job_id: "400",
      is_current: true,
    });
    const replay = await readAcceptedMediaToolReplay(prisma, RECOVERY);
    expect(replay).toEqual({
      kind: "ok",
      jobId: "400",
      status: "processing",
      bindingView: expect.objectContaining({ job_id: "400", is_current: true }),
    });
    // 渲染与各服务建行成功响应同口径（job_id / status / canvas_binding）。
    const rendered = renderMediaToolReplay(replay!);
    expect(rendered.code).toBe(200);
    expect(rendered.data).toMatchObject({
      job_id: "400",
      status: "processing",
      canvas_binding: { job_id: "400", is_current: true },
    });
  });

  it("returns null on a miss so the caller keeps its mutable-state checks", async () => {
    const prisma = makePrisma();
    readIdemMock.mockResolvedValue(null);
    expect(await readAcceptedMediaToolReplay(prisma, RECOVERY)).toBeNull();
  });

  it("reports a same-key different-hash conflict without touching the binding view", async () => {
    const prisma = makePrisma();
    readIdemMock.mockResolvedValue({ kind: "idempotency_conflict" });
    const replay = await readAcceptedMediaToolReplay(prisma, RECOVERY);
    expect(replay).toEqual({ kind: "idempotency_conflict" });
    expect(bindingViewMock).not.toHaveBeenCalled();
    expect(renderMediaToolReplay(replay!).code).toBe(100409);
  });

  it("covers the legacy client_token lookup shape without a binding view", async () => {
    const prisma = makePrisma();
    readIdemMock.mockResolvedValue({ generation_job_id: "401", cursor: 0 });
    const replay = await readAcceptedMediaToolReplay(prisma, {
      projectId: "55",
      operation: "video_matting.create",
      requestHash: "hash-vm",
      key: "token-1",
    });
    expect(replay).toEqual({ kind: "ok", jobId: "401", status: "queued", bindingView: null });
    // legacy 冲突口径：video-mattings 传入既有码与文案的 fail 工厂。
    const conflict = renderMediaToolReplay({ kind: "idempotency_conflict" }, () => ({
      code: 100302,
      msg: "client_token 已被使用（同 token 仅可重放相同参数）",
      data: null,
    }));
    expect(conflict.code).toBe(100302);
  });
});
