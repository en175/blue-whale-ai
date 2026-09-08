import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { capabilityDigest } from "./capability-digest.js";
import { createModelCapabilityRepo } from "./model-capability-repo.js";

// 与 scene-card-generation-repo.test.ts / plan-application-facts 同源的 8 字段集——
// digest 只覆盖这 8 个参数字段，features 明确不在内（改字段集会让历史快照全部误判漂移）。
const CAP_FIELDS = {
  supported_sizes: [{ id: "2k", label: "2K", api_value: "2K" }],
  supported_aspect_ratios: ["1:1", "16:9"],
  supported_durations: null,
  supported_formats: ["png"],
  default_size: "2k",
  default_format: "png",
  default_aspect_ratio: "1:1",
  default_duration: null,
};

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    model_id: "doubao-seedream-5-0",
    provider_id: "volc",
    model_label: "Seedream 5.0",
    icon: null,
    sort_order: 0,
    ...CAP_FIELDS,
    features: { quantity_max: 4 },
    version: 3,
    ...overrides,
  };
}

function repoWith(rows: Record<string, unknown>[]) {
  const prisma = {
    generation_model_capability: { findMany: vi.fn().mockResolvedValue(rows) },
  } as unknown as PrismaClient;
  return { repo: createModelCapabilityRepo(prisma), prisma };
}

describe("createModelCapabilityRepo.listEnabledByType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("投影出 version 与 digest 字段", async () => {
    const { repo } = repoWith([buildRow({ version: 7 })]);
    const [view] = await repo.listEnabledByType("image");
    expect(view.version).toBe(7);
    expect(typeof view.digest).toBe("string");
    expect(view.digest).toMatch(/^sha256:[0-9a-f]+$/);
  });

  it("last_frame 缺省时按不支持处理", async () => {
    const { repo } = repoWith([buildRow()]);
    const [view] = await repo.listEnabledByType("video");

    expect(view.features.last_frame).toBe(false);
  });

  it("独立解析 camelCase 与 snake_case 的 last_frame 能力", async () => {
    const { repo } = repoWith([
      buildRow({ features: { first_frame: false, lastFrame: true } }),
      buildRow({ features: { first_frame: false, last_frame: true } }),
    ]);

    const views = await repo.listEnabledByType("video");

    expect(views.map((view) => view.features.last_frame)).toEqual([true, true]);
    expect(views.map((view) => view.features.first_frame)).toEqual([
      false,
      false,
    ]);
  });

  it("digest === capabilityDigest(同一 8 字段输入)——用真实函数交叉断言，不写死", async () => {
    const { repo } = repoWith([buildRow()]);
    const [view] = await repo.listEnabledByType("image");
    // 若 repo 误用 toSizes()/toFeatures() 转换后的 View 字段算 digest，
    // 对象形状会多出 width/height 等键 → canonical JSON 不同 → 此处断言失败。
    expect(view.digest).toBe(capabilityDigest(CAP_FIELDS));
  });

  it("跨 repo 一致性：与 scene-card 漂移检测复算的 digest 同源（同输入同输出）", async () => {
    // scene-card-generation-repo.regenerateSceneCard 用同一 capabilityDigest + 同一 8 字段集
    // 从 DB 原始行复算漂移；本 repo 投影的 digest 必须与之逐字一致，
    // 否则前端本地预判与后端事务复算错位，全部模型误判漂移。
    const { repo } = repoWith([buildRow()]);
    const [view] = await repo.listEnabledByType("image");
    const recomputed = capabilityDigest({
      supported_sizes: CAP_FIELDS.supported_sizes,
      supported_aspect_ratios: CAP_FIELDS.supported_aspect_ratios,
      supported_durations: CAP_FIELDS.supported_durations,
      supported_formats: CAP_FIELDS.supported_formats,
      default_size: CAP_FIELDS.default_size,
      default_format: CAP_FIELDS.default_format,
      default_aspect_ratio: CAP_FIELDS.default_aspect_ratio,
      default_duration: CAP_FIELDS.default_duration,
    });
    expect(view.digest).toBe(recomputed);
  });

  it("能力内容稳定则 digest 稳定，任一参数字段变更则 digest 必变（AC#2）", async () => {
    const { repo: repoA } = repoWith([buildRow()]);
    const { repo: repoB } = repoWith([buildRow()]);
    const { repo: repoC } = repoWith([
      buildRow({ supported_aspect_ratios: ["16:9"] }),
    ]);
    const [a] = await repoA.listEnabledByType("image");
    const [b] = await repoB.listEnabledByType("image");
    const [c] = await repoC.listEnabledByType("image");
    expect(a.digest).toBe(b.digest); // 同内容 → 同 digest
    expect(c.digest).not.toBe(a.digest); // 内容变 → digest 变
  });

  it("features 不进 digest（features 变更不改变 digest）", async () => {
    const { repo: repoA } = repoWith([buildRow({ features: { quantity_max: 4 } })]);
    const { repo: repoB } = repoWith([buildRow({ features: { quantity_max: 99 } })]);
    const [a] = await repoA.listEnabledByType("image");
    const [b] = await repoB.listEnabledByType("image");
    expect(a.digest).toBe(b.digest);
  });

  it("features 缺 max_reference_images 时兜底 10（与网关/ARK 上限对齐，IKA72G）", async () => {
    const { repo } = repoWith([
      buildRow({ features: { reference_image: true, watermark: true, quantity_max: 4 } }),
    ]);

    const [view] = await repo.listEnabledByType("image");

    expect(view.features.reference_image).toBe(true);
    expect(view.features.max_reference_images).toBe(10);
  });

  it("显式配置 max_reference_images 时原样透出（不被兜底覆盖，IK6PA5）", async () => {
    const { repo } = repoWith([
      buildRow({
        features: {
          reference_image: true,
          max_reference_images: 10,
          watermark: false,
          quantity_max: 4,
        },
      }),
    ]);

    const [view] = await repo.listEnabledByType("image");

    expect(view.features.max_reference_images).toBe(10);
  });

  it("camelCase maxReferenceImages 同样被识别（IK6PA5）", async () => {
    const { repo } = repoWith([
      buildRow({ features: { reference_image: true, maxReferenceImages: 6 } }),
    ]);

    const [view] = await repo.listEnabledByType("image");

    expect(view.features.max_reference_images).toBe(6);
  });

  it("features 为 NULL 时兜底 10 且 reference_image 为 false（IK6PA5 / IKA72G）", async () => {
    const { repo } = repoWith([buildRow({ features: null })]);

    const [view] = await repo.listEnabledByType("image");

    expect(view.features.reference_image).toBe(false);
    expect(view.features.max_reference_images).toBe(10);
  });
});

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

  it("过滤 capability_type + enabled + 未软删 + 按 sort_order 升序", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      generation_model_capability: { findMany },
    } as unknown as PrismaClient;
    await createModelCapabilityRepo(prisma).listEnabledByType("text");
    expect(findMany).toHaveBeenCalledWith({
      where: {
        capability_type: "text",
        enabled: true,
        is_delete: false,
      },
      orderBy: { sort_order: "asc" },
    });
  });
});

describe("显式默认标记（IKE0VX）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("投影出 is_default；列缺省（老库尚未迁移）按 false 处理", async () => {
    const { repo } = repoWith([
      buildRow({ model_id: "a", is_default: true }),
      buildRow({ model_id: "b", is_default: false }),
      buildRow({ model_id: "c" }),
    ]);
    const rows = await repo.listEnabledByType("text");
    expect(rows.map((r) => r.is_default)).toEqual([true, false, false]);
  });

  it("is_default 不进 digest：标记谁是默认不算能力漂移", async () => {
    const { repo } = repoWith([buildRow({ is_default: false })]);
    const notDefault = (await repo.listEnabledByType("text"))[0].digest;

    vi.clearAllMocks();
    const { repo: repo2 } = repoWith([buildRow({ is_default: true })]);
    const isDefault = (await repo2.listEnabledByType("text"))[0].digest;

    // 这条比「digest 没变」更重要：digest 是冻结快照的比对口径，把一个运营开关
    // 算进去，会让所有历史快照在有人点一次「设为默认」之后集体误判漂移。
    expect(isDefault).toBe(notDefault);
    expect(isDefault).toBe(capabilityDigest(CAP_FIELDS));
  });
});
