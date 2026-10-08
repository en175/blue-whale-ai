import { describe, expect, it } from "vitest";

import {
  multiResultNodeId,
  outputNodeIdForKey,
  outputSlotNodeId,
  projectVirtualOutputs,
  segmentOutputKey,
  slotOutputKey,
  trackOutputKey,
} from "./canvas-recovery-multi-output.js";

const SUBMISSION = "0a1b2c3d-0000-4000-8000-00000000a001";
const TARGET = "node-target";

function fakeTx(args: {
  logs?: Array<{ generation_job_id: bigint; status: string; payload: unknown; occurred_at: number }>;
  slots?: Array<{ id: bigint; project_id: bigint; generation_job_id: bigint; slot_index: number; status: string; asset_id: bigint | null; retry_of_slot_id?: bigint | null }>;
}) {
  const slots = (args.slots ?? []).map(slot => ({ retry_of_slot_id: null, ...slot }));
  return {
    generation_job_logs: {
      findFirst: async ({ where }: { where: { generation_job_id: bigint; status: string } }) =>
        (args.logs ?? [])
          .filter(log => log.generation_job_id === where.generation_job_id && log.status === where.status)
          .sort((a, b) => b.occurred_at - a.occurred_at)[0] ?? null,
    },
    generation_output_slots: {
      findMany: async ({ where }: { where: { generation_job_id?: bigint | { in: bigint[] }; id?: { in: bigint[] } } }) => {
        const jobIds = where.generation_job_id === undefined
          ? null
          : typeof where.generation_job_id === "bigint"
            ? new Set([where.generation_job_id.toString()])
            : new Set(where.generation_job_id.in.map(id => id.toString()));
        if (jobIds !== null) {
          return slots.filter(slot => jobIds.has(slot.generation_job_id.toString()));
        }
        const wanted = new Set((where.id?.in ?? []).map(id => id.toString()));
        return slots.filter(slot => wanted.has(slot.id.toString()));
      },
    },
  } as never;
}

function sceneSplitJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 9001n,
    type: "video_scene_split",
    status: "succeeded",
    output_asset_ids: ["701", "702"],
    input: { source_asset_id: "5", target_node_id: "t", granularity: "standard" },
    ...overrides,
  };
}

function sceneSplitLog(payload: unknown, occurredAt = 1) {
  return { generation_job_id: 9001n, status: "succeeded", payload, occurred_at: occurredAt };
}

function vocalJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 9002n,
    type: "vocal_split",
    status: "succeeded",
    output_asset_ids: ["801", "802", "803"],
    input: { source_asset_id: "5", scene: "drama", output_format: "aac" },
    ...overrides,
  };
}

describe("输出键与节点身份（B.4 output_key 表）", () => {
  it("slot/segment/track 键与 generation-result / generation-output 节点身份", () => {
    expect(slotOutputKey("501")).toBe("slot:501");
    expect(segmentOutputKey(2)).toBe("segment:2");
    expect(trackOutputKey("voice")).toBe("track:voice");
    expect(outputSlotNodeId("501")).toBe("generation-output:501");
    expect(multiResultNodeId(SUBMISSION, "segment:2"))
      .toBe(`generation-result:${SUBMISSION}:segment:2`);
    expect(multiResultNodeId(SUBMISSION, "track:voice"))
      .toBe(`generation-result:${SUBMISSION}:track:voice`);
  });

  it("outputNodeIdForKey：$target/primary 复用目标节点，其余走规范身份", () => {
    const ctx = { submissionId: SUBMISSION, targetNodeId: TARGET };
    expect(outputNodeIdForKey("$target", ctx)).toBe(TARGET);
    expect(outputNodeIdForKey("primary", ctx)).toBe(TARGET);
    expect(outputNodeIdForKey("slot:501", ctx)).toBe("generation-output:501");
    expect(outputNodeIdForKey("segment:3", ctx)).toBe(`generation-result:${SUBMISSION}:segment:3`);
    expect(outputNodeIdForKey("track:sfx", ctx)).toBe(`generation-result:${SUBMISSION}:track:sfx`);
  });
});

describe("场景切分投影（segment:<index>，序号来自可信终态 result）", () => {
  const payload = {
    duration: 12.5,
    segments: [
      { segment_index: 1, start_time: 0, end_time: 5, segment_asset_id: "701" },
      { segment_index: 2, start_time: 5, end_time: 12.5, segment_asset_id: "702" },
    ],
  };

  it("成功任务按 result.segments 投影 segment 项（node 规范身份、资产来自段引用）", async () => {
    const projection = await projectVirtualOutputs(fakeTx({ logs: [sceneSplitLog(payload)] }), {
      submissionId: SUBMISSION, targetNodeId: TARGET, job: sceneSplitJob(),
    });
    expect(projection).toEqual({
      kind: "ok",
      items: [
        { outputKey: "segment:1", nodeId: `generation-result:${SUBMISSION}:segment:1`, assetId: "701", slotId: null },
        { outputKey: "segment:2", nodeId: `generation-result:${SUBMISSION}:segment:2`, assetId: "702", slotId: null },
      ],
    });
  });

  it("未成功任务无输出投影（占位保留，非歧义）", async () => {
    const projection = await projectVirtualOutputs(fakeTx({}), {
      submissionId: SUBMISSION, targetNodeId: TARGET, job: sceneSplitJob({ status: "running" }),
    });
    expect(projection).toEqual({ kind: "ok", items: [] });
  });

  it("成功但缺终态日志 → invalid（缺产物）", async () => {
    const projection = await projectVirtualOutputs(fakeTx({}), {
      submissionId: SUBMISSION, targetNodeId: TARGET, job: sceneSplitJob(),
    });
    expect(projection).toEqual({ kind: "invalid" });
  });

  it("payload 与契约 result schema 不符 → invalid", async () => {
    const projection = await projectVirtualOutputs(
      fakeTx({ logs: [sceneSplitLog({ duration: 1, segments: [{ segment_index: 1 }] })] }),
      { submissionId: SUBMISSION, targetNodeId: TARGET, job: sceneSplitJob() },
    );
    expect(projection).toEqual({ kind: "invalid" });
  });

  it("重复 segment_index → invalid（重复键）", async () => {
    const projection = await projectVirtualOutputs(
      fakeTx({
        logs: [sceneSplitLog({
          duration: 10,
          segments: [
            { segment_index: 1, start_time: 0, end_time: 5, segment_asset_id: "701" },
            { segment_index: 1, start_time: 5, end_time: 10, segment_asset_id: "702" },
          ],
        })],
      }),
      { submissionId: SUBMISSION, targetNodeId: TARGET, job: sceneSplitJob() },
    );
    expect(projection).toEqual({ kind: "invalid" });
  });
});

describe("人声分离投影（track:<type>，轨序 = 契约 scene 轨序）", () => {
  it("drama 三轨按契约轨序 zip output_asset_ids", async () => {
    const projection = await projectVirtualOutputs(fakeTx({}), {
      submissionId: SUBMISSION, targetNodeId: TARGET, job: vocalJob(),
    });
    expect(projection).toEqual({
      kind: "ok",
      items: [
        { outputKey: "track:voice", nodeId: `generation-result:${SUBMISSION}:track:voice`, assetId: "801", slotId: null },
        { outputKey: "track:music", nodeId: `generation-result:${SUBMISSION}:track:music`, assetId: "802", slotId: null },
        { outputKey: "track:sfx", nodeId: `generation-result:${SUBMISSION}:track:sfx`, assetId: "803", slotId: null },
      ],
    });
  });

  it("audio 两轨", async () => {
    const projection = await projectVirtualOutputs(fakeTx({}), {
      submissionId: SUBMISSION, targetNodeId: TARGET,
      job: vocalJob({ input: { source_asset_id: "5", scene: "audio", output_format: "aac" }, output_asset_ids: ["801", "802"] }),
    });
    expect(projection.kind).toBe("ok");
    if (projection.kind === "ok") {
      expect(projection.items.map(item => item.outputKey)).toEqual(["track:voice", "track:background"]);
    }
  });

  it("轨数与产物数不齐 → invalid（缺产物）", async () => {
    const projection = await projectVirtualOutputs(fakeTx({}), {
      submissionId: SUBMISSION, targetNodeId: TARGET,
      job: vocalJob({ output_asset_ids: ["801"] }),
    });
    expect(projection).toEqual({ kind: "invalid" });
  });

  it("input.scene 非法 → invalid（无法证明归属）", async () => {
    const projection = await projectVirtualOutputs(fakeTx({}), {
      submissionId: SUBMISSION, targetNodeId: TARGET, job: vocalJob({ input: { scene: "nope" } }),
    });
    expect(projection).toEqual({ kind: "invalid" });
  });
});

describe("生成输出槽投影（slot:<slot_id>，沿用既有槽位身份）", () => {
  function imageJob(overrides: Record<string, unknown> = {}) {
    return {
      id: 9003n,
      type: "image",
      status: "succeeded",
      output_asset_ids: ["601", "602"],
      input: { prompt: "whale", expected_output_count: 2 },
      ...overrides,
    };
  }

  function slot(id: bigint, slotIndex: number, status: string, assetId: bigint | null, overrides: Record<string, unknown> = {}) {
    return { id, project_id: 91n, generation_job_id: 9003n, slot_index: slotIndex, status, asset_id: assetId, retry_of_slot_id: null, ...overrides };
  }

  it("有成功槽行 → 逐槽 slot 项（node=generation-output:<id>，slotId 同源）", async () => {
    const projection = await projectVirtualOutputs(
      fakeTx({ slots: [slot(501n, 0, "succeeded", 601n), slot(502n, 1, "succeeded", 602n)] }),
      { submissionId: SUBMISSION, targetNodeId: TARGET, job: imageJob() },
    );
    expect(projection).toEqual({
      kind: "ok",
      items: [
        { outputKey: "slot:501", nodeId: "generation-output:501", assetId: "601", slotId: "501" },
        { outputKey: "slot:502", nodeId: "generation-output:502", assetId: "602", slotId: "502" },
      ],
    });
  });

  it("同一 slot_index 的历史尝试折叠：成功槽永久占据，失败尝试不产生键（稳定身份不依赖数组顺序）", async () => {
    const projection = await projectVirtualOutputs(
      fakeTx({ slots: [slot(502n, 1, "succeeded", 602n), slot(501n, 0, "failed", null), slot(503n, 0, "succeeded", 601n)] }),
      { submissionId: SUBMISSION, targetNodeId: TARGET, job: imageJob() },
    );
    expect(projection.kind).toBe("ok");
    if (projection.kind === "ok") {
      expect(projection.items.map(item => item.outputKey)).toEqual(["slot:503", "slot:502"]);
    }
  });

  it("未成功槽不投影（只投成功槽）", async () => {
    const projection = await projectVirtualOutputs(
      fakeTx({ slots: [slot(501n, 0, "succeeded", 601n), slot(502n, 1, "failed", null)] }),
      { submissionId: SUBMISSION, targetNodeId: TARGET, job: imageJob() },
    );
    expect(projection.kind).toBe("ok");
    if (projection.kind === "ok") {
      expect(projection.items.map(item => item.outputKey)).toEqual(["slot:501"]);
    }
  });

  it("重试只补 failed 槽：祖辈 job 的成功槽沿 retry_of_slot_id 上溯一并投影", async () => {
    const projection = await projectVirtualOutputs(
      fakeTx({
        slots: [
          slot(501n, 0, "succeeded", 601n, { generation_job_id: 9000n }),
          slot(502n, 1, "failed", null, { generation_job_id: 9000n }),
          slot(601n, 1, "succeeded", 701n, { generation_job_id: 9003n, retry_of_slot_id: 502n }),
        ],
      }),
      { submissionId: SUBMISSION, targetNodeId: TARGET, job: imageJob() },
    );
    expect(projection.kind).toBe("ok");
    if (projection.kind === "ok") {
      expect(projection.items.map(item => item.outputKey)).toEqual(["slot:501", "slot:601"]);
    }
  });

  it("expected_output_count ≤1（含缺省）→ 一对一 primary（有槽行也不改身份，不为单输出伪造 slot）", async () => {
    const projection = await projectVirtualOutputs(
      fakeTx({ slots: [slot(501n, 0, "succeeded", 601n)] }),
      { submissionId: SUBMISSION, targetNodeId: TARGET, job: imageJob({ input: { prompt: "whale", expected_output_count: 1 } }) },
    );
    expect(projection).toEqual({
      kind: "ok",
      items: [{ outputKey: "primary", nodeId: TARGET, assetId: null, slotId: null }],
    });
  });

  it("声明多输出却无槽行 → invalid（槽表是输出数权威，归属无法证明）", async () => {
    const projection = await projectVirtualOutputs(fakeTx({}), {
      submissionId: SUBMISSION, targetNodeId: TARGET, job: imageJob(),
    });
    expect(projection).toEqual({ kind: "invalid" });
  });
});
