import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createModelCapabilityRepo } from "./model-capability-repo.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    model_id: "doubao-seedance-2-0-260128",
    provider_id: "volcengine",
    model_label: "豆包 Seedance 2.0",
    icon: null,
    supported_sizes: [],
    supported_aspect_ratios: ["16:9"],
    supported_durations: [5, 10, 1],
    supported_formats: ["mp4"],
    default_size: "",
    default_format: null,
    default_aspect_ratio: "16:9",
    default_duration: 5,
    features: { stream: true },
    ...overrides,
  };
}

describe("ModelCapabilityRepo.listEnabledByType 时长归一化", () => {
  function repoWith(rows: unknown[]) {
    const prisma = {
      generation_model_capability: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
    } as unknown as PrismaClient;
    return createModelCapabilityRepo(prisma);
  }

  it("数组 [min,max] 归一为 {min,max,step:1}", async () => {
    const [row] = await repoWith([makeRow()]).listEnabledByType("video");
    expect(row.supported_durations).toEqual({ min: 5, max: 10, step: 1 });
  });

  it("数组 [min,max,step] 保留 step", async () => {
    const [row] = await repoWith([
      makeRow({ supported_durations: [5, 10, 2] }),
    ]).listEnabledByType("video");
    expect(row.supported_durations).toEqual({ min: 5, max: 10, step: 2 });
  });

  it("对象 {min,max,step}（历史契约）原样通过", async () => {
    const [row] = await repoWith([
      makeRow({ supported_durations: { min: 3, max: 15, step: 3 } }),
    ]).listEnabledByType("video");
    expect(row.supported_durations).toEqual({ min: 3, max: 15, step: 3 });
  });

  it("缺省 / 非法（图片模型或脏数据）→ null", async () => {
    const [image] = await repoWith([
      makeRow({ model_id: "img", supported_durations: null }),
    ]).listEnabledByType("image");
    expect(image.supported_durations).toBeNull();

    const [reversed] = await repoWith([
      makeRow({ supported_durations: [10, 5] }), // max < min
    ]).listEnabledByType("video");
    expect(reversed.supported_durations).toBeNull();

    const [garbage] = await repoWith([
      makeRow({ supported_durations: { min: "x" } }),
    ]).listEnabledByType("video");
    expect(garbage.supported_durations).toBeNull();
  });

  it("过滤 capability_type + enabled + 未软删", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      generation_model_capability: { findMany },
    } as unknown as PrismaClient;
    await createModelCapabilityRepo(prisma).listEnabledByType("text");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          capability_type: "text",
          enabled: true,
          is_delete: false,
        },
      }),
    );
  });
});
