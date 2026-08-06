import { describe, expect, it, vi } from "vitest";
import type { ModelCapabilityView } from "@blue-whale/persistence";

import { handleCreateGenerationJob } from "./handle-create-generation-job.js";
import { handleCancelGenerationJob } from "./handle-cancel-generation-job.js";
import { handleRetryGenerationJob } from "./handle-retry-generation-job.js";

// 生成命令处理器：create（建 job+日志+预留）/ cancel（软取消）。
// 对齐本仓 Java GenerationJobCommandController/Service 字段与状态语义。

function makeDeps() {
  return {
    projects: { findOwnedById: vi.fn() },
    command: {
      createJob: vi.fn(),
      requestCancel: vi.fn(),
      retryJob: vi.fn(),
      appendLog: vi.fn(),
    },
    models: {
      // 白名单默认：image 收录 seedream、video 收录 seedance 真实 id（与各用例 body 一致）。
      listEnabledByType: vi.fn(
        async (type: string): Promise<ModelCapabilityView[]> =>
          type === "video"
            ? ([
                { model_id: "doubao-seedance-2-0-260128" },
              ] as ModelCapabilityView[])
            : ([{ model_id: "doubao-seedream-4-0" }] as ModelCapabilityView[]),
      ),
    },
  };
}

const validBody = {
  type: "image",
  input_asset_ids: [],
  parameters: {
    prompt: "一只猫",
    aspect_ratio: "1:1",
    model_id: "doubao-seedream-4-0",
    size: "1K",
  },
  expected_output_count: 1,
};

describe("handleCreateGenerationJob", () => {
  it("合法 image 请求 + 归属 → 202 + {generation_job_id, cursor}", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({
      generation_job_id: "200",
      cursor: 0,
    });
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      validBody,
      "key-1",
      deps,
    );
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ generation_job_id: "200", cursor: 0 });
    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "55",
        userId: "9",
        type: "image",
        expectedOutputCount: 1,
      }),
    );
  });

  it("image model_id 不在启用目录 → 400，不建任务", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      {
        ...validBody,
        parameters: { ...validBody.parameters, model_id: "no-such-model" },
      },
      "k",
      deps,
    );
    expect(result).toEqual({
      code: 400,
      msg: "model_id 不在可用模型白名单或已停用",
      data: null,
    });
    expect(deps.command.createJob).not.toHaveBeenCalled();
  });

  it("已停用模型（不在 enabled 列表）→ 400，不建任务", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    // 模拟该模型已停用：listEnabledByType 只返回启用行，此处不含它。
    deps.models.listEnabledByType.mockResolvedValue([]);
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      validBody,
      "k",
      deps,
    );
    expect(result.code).toBe(400);
    expect(deps.command.createJob).not.toHaveBeenCalled();
  });

  it("capability_type 与生成类型不匹配（video 用 image 模型）→ 400", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [],
        parameters: {
          prompt: "动起来",
          model_id: "doubao-seedream-4-0", // image 模型，视频白名单不含
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "k",
      deps,
    );
    expect(result.code).toBe(400);
    expect(deps.command.createJob).not.toHaveBeenCalled();
  });

  it("视频别名先解析成真实 model_id 再过白名单（别名不绕过）", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    // 白名单只收录真实 model_id；别名 seedance-2 未收录——能 200 证明先解析后校验。
    deps.models.listEnabledByType.mockResolvedValue([
      { model_id: "doubao-seedance-2-0-260128" },
    ] as ModelCapabilityView[]);
    deps.command.createJob.mockResolvedValue({
      generation_job_id: "208",
      cursor: 0,
    });
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [],
        parameters: {
          prompt: "动起来",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "k",
      deps,
    );
    expect(result.code).toBe(200);
    expect(deps.models.listEnabledByType).toHaveBeenCalledWith("video");
  });

  it("project 不归属 → 100301", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue(null);
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      validBody,
      "key-1",
      deps,
    );
    expect(result).toEqual({ code: 100301, msg: "资源不存在", data: null });
    expect(deps.command.createJob).not.toHaveBeenCalled();
  });

  it("type 非法 → 400", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      { ...validBody, type: "3d" },
      "k",
      deps,
    );
    expect(result.code).toBe(400);
  });

  it("prompt 缺失 → 400", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "image",
        input_asset_ids: [],
        parameters: { aspect_ratio: "1:1" },
        expected_output_count: 1,
      },
      "k",
      deps,
    );
    expect(result.code).toBe(400);
  });

  it("expected_output_count 超出 1-4 → 400", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      { ...validBody, expected_output_count: 8 },
      "k",
      deps,
    );
    expect(result.code).toBe(400);
  });

  it("video 参考图 > 1 → 400", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [1, 2],
        parameters: { prompt: "x", aspect_ratio: "16:9" },
        expected_output_count: 1,
      },
      "k",
      deps,
    );
    expect(result.code).toBe(400);
  });

  it("video 将历史 UI 模型别名规范化为 new-api 的真实 model_id", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({
      generation_job_id: "201",
      cursor: 0,
    });

    await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [41],
        parameters: {
          prompt: "让图片动起来",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "k",
      deps,
      { providerCredential: "sealed-token" },
    );

    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          model_id: "doubao-seedance-2-0-260128",
          provider_credential: "sealed-token",
          reference_asset_ids: [41],
        }),
      }),
    );
  });

  it("video 拒绝首尾帧与普通参考素材混用", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({
      generation_job_id: "202",
      cursor: 0,
    });
    const body = {
      type: "video",
      input_asset_ids: [],
      first_frame_asset_id: "11",
      last_frame_asset_id: "12",
      reference_asset_ids: ["13"],
      parameters: {
        prompt: "从首帧过渡到尾帧",
        model_id: "seedance-2",
        aspect_ratio: "16:9",
        resolution: "720p",
        duration: 5,
      },
      expected_output_count: 1,
    };

    const result = await handleCreateGenerationJob(
      "9",
      "55",
      body,
      "key-frames",
      deps,
      {
        providerCredential: "sealed-token",
      },
    );

    expect(result).toEqual({
      code: 400,
      msg: "首尾帧模式不能与普通参考素材混用",
      data: null,
    });
    expect(deps.command.createJob).not.toHaveBeenCalled();
  });

  it("video 显式首帧不会从兼容 input_asset_ids 重复投影为普通参考图", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({
      generation_job_id: "203",
      cursor: 0,
    });

    await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [11],
        first_frame_asset_id: 11,
        parameters: {
          prompt: "让首帧动起来",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "key-first-frame",
      deps,
      { providerCredential: "sealed-token" },
    );

    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ first_frame_asset_id: "11" }),
      }),
    );
    expect(deps.command.createJob.mock.calls[0]?.[0].input).not.toHaveProperty(
      "reference_asset_ids",
    );
  });

  it("video 显式首帧忽略兼容 input_asset_ids 中的额外身份", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({
      generation_job_id: "206",
      cursor: 0,
    });

    const result = await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [11, 13],
        first_frame_asset_id: 11,
        parameters: {
          prompt: "让首帧参考另一个素材动起来",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "key-first-frame-with-reference",
      deps,
      { providerCredential: "sealed-token" },
    );

    expect(result.code).toBe(200);
    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ first_frame_asset_id: "11" }),
      }),
    );
    expect(deps.command.createJob.mock.calls[0]?.[0].input).not.toHaveProperty(
      "reference_asset_ids",
    );
  });

  it("video 显式普通参考素材保持唯一顺序且不被兼容字段扩充", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({
      generation_job_id: "204",
      cursor: 0,
    });

    const result = await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [1, 2, 3],
        reference_asset_ids: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
        parameters: {
          prompt: "使用十二个有序参考素材生成视频",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "key-twelve-video-assets",
      deps,
      { providerCredential: "sealed-token" },
    );

    expect(result.code).toBe(200);
    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          reference_asset_ids: [
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
            "10",
            "11",
            "12",
            "13",
            "14",
          ],
        }),
      }),
    );
  });

  it("video 拒绝十三个普通参考素材", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });

    const result = await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [],
        reference_asset_ids: Array.from(
          { length: 13 },
          (_, index) => index + 1,
        ),
        parameters: {
          prompt: "参考素材过多",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "key-thirteen-video-assets",
      deps,
    );

    expect(result.code).toBe(400);
    expect(deps.command.createJob).not.toHaveBeenCalled();
  });

  it("video 拒绝只有尾帧没有首帧", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });

    const result = await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [],
        last_frame_asset_id: 12,
        parameters: {
          prompt: "缺少首帧",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "key-last-frame-only",
      deps,
    );

    expect(result.code).toBe(400);
    expect(deps.command.createJob).not.toHaveBeenCalled();
  });

  it("video 显式普通参考素材交给 Worker 做 provider 能力判定", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({
      generation_job_id: "205",
      cursor: 0,
    });

    const result = await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [13, 14],
        reference_asset_ids: [13, 14],
        parameters: {
          prompt: "用两个参考素材生成视频",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "key-multi-reference-video",
      deps,
      { providerCredential: "sealed-token" },
    );

    expect(result.code).toBe(200);
    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          reference_asset_ids: ["13", "14"],
        }),
      }),
    );
  });
});

describe("actionIdentity 列宽回归", () => {
  // 回归:bottom-dock:sha256(76 字符)写入 correlation_id VarChar(64) 触发 Prisma P2000 → 生成任务 500。
  // actionIdentity 同时写 action_identity/project_action_identity(均 128)与 correlation_id(64),
  // 故其长度须 ≤ 64。bottom-dock 前缀无任何代码消费,来源由 event_type/aggregate_type 记录。
  it("actionIdentity 长度须 ≤ correlation_id 列宽 64", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({
      generation_job_id: "207",
      cursor: 0,
    });
    await handleCreateGenerationJob("9", "55", validBody, "key-1", deps);
    const cmdInput = deps.command.createJob.mock.calls[0]?.[0];
    expect(cmdInput.actionIdentity.length).toBeLessThanOrEqual(64);
  });
});

describe("handleCancelGenerationJob", () => {
  it("命中可取消任务 → 200", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.requestCancel.mockResolvedValue(true);
    const result = await handleCancelGenerationJob("9", "55", "200", deps);
    expect(result.code).toBe(200);
    expect(deps.command.requestCancel).toHaveBeenCalledWith("200", "9");
  });

  it("不可取消/不存在 → 100301", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.requestCancel.mockResolvedValue(false);
    const result = await handleCancelGenerationJob("9", "55", "999", deps);
    expect(result).toEqual({ code: 100301, msg: "资源不存在", data: null });
  });
});

describe("handleRetryGenerationJob", () => {
  it("project 不归属 → 100301 且不触发重试", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue(null);
    const result = await handleRetryGenerationJob(
      "9",
      "56",
      "200",
      "key-r1",
      deps,
    );
    expect(result).toEqual({ code: 100301, msg: "资源不存在", data: null });
    expect(deps.command.retryJob).not.toHaveBeenCalled();
  });

  it("非本人终态任务 → 100301（retryJob 按 userId 校验）", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.retryJob.mockResolvedValue(null);
    const result = await handleRetryGenerationJob(
      "9",
      "55",
      "999",
      "key-r2",
      deps,
    );
    expect(result).toEqual({ code: 100301, msg: "资源不存在", data: null });
    expect(deps.command.retryJob).toHaveBeenCalledWith("999", "9", "key-r2");
  });

  it("本人终态失败任务 → 200 + 新 job", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.retryJob.mockResolvedValue({
      generation_job_id: "201",
      type: "image",
      cursor: 0,
    });
    const result = await handleRetryGenerationJob(
      "9",
      "55",
      "200",
      "key-r3",
      deps,
    );
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({
      generation_job_id: "201",
      type: "image",
    });
  });
});
