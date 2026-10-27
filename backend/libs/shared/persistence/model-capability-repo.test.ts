import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { capabilityDigest } from "./capability-digest.js";
import { getModelCapabilityList } from "./model-capability-cache.js";
import { createModelCapabilityRepo } from "./model-capability-repo.js";

vi.mock("./model-capability-cache.js", () => ({
  getModelCapabilityList: vi.fn().mockResolvedValue(null),
  setModelCapabilityList: vi.fn().mockResolvedValue(undefined),
}));

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
    catalog_models: { findMany: vi.fn().mockResolvedValue(rows) },
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

  it("sample_mode 缺省关闭；camelCase / snake_case 显式 true 才放行", async () => {
    const { repo } = repoWith([
      buildRow(),
      buildRow({ features: { sampleMode: true } }),
      buildRow({ features: { sample_mode: true } }),
    ]);
    const views = await repo.listEnabledByType("video");

    expect(views.map((view) => view.features.sample_mode)).toEqual([
      false,
      true,
      true,
    ]);
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

  it("★ 裸字符串（存量行）投影成 { id, label }（ADR-0123）", async () => {
    const { repo } = repoWith([buildRow()]);
    const [view] = await repo.listEnabledByType("image");
    expect(view.supported_aspect_ratios).toEqual([
      { id: "1:1", label: "1:1" },
      { id: "16:9", label: "16:9" },
    ]);
  });

  it("★ 对象与裸字符串混在一行里都认，label 空白回落 id（ADR-0123）", async () => {
    const { repo } = repoWith([
      buildRow({
        supported_aspect_ratios: [
          { id: "16:9", label: "横屏" },
          { id: "9:16", label: "   " },
          "1:1",
        ],
      }),
    ]);
    const [view] = await repo.listEnabledByType("image");
    expect(view.supported_aspect_ratios).toEqual([
      { id: "16:9", label: "横屏" },
      { id: "9:16", label: "9:16" },
      { id: "1:1", label: "1:1" },
    ]);
  });

  it("★ 缓存命中的是旧形态（滚动发布窗口）时，读侧照样归一", async () => {
    vi.mocked(getModelCapabilityList).mockResolvedValueOnce([
      {
        ...buildRow(),
        supported_aspect_ratios: ["1:1"],
      },
    ] as never);
    const { repo, prisma } = repoWith([buildRow()]);

    const [view] = await repo.listEnabledByType("image");

    expect(view.supported_aspect_ratios).toEqual([{ id: "1:1", label: "1:1" }]);
    expect(prisma.catalog_models.findMany).not.toHaveBeenCalled();
  });

  it("digest === capabilityDigest(同一 8 字段输入)——用真实函数交叉断言，不写死", async () => {
    const { repo } = repoWith([buildRow()]);
    const [view] = await repo.listEnabledByType("image");
    expect(view.digest).toBe(capabilityDigest(CAP_FIELDS));
  });

  it("跨 repo 一致性：与 scene-card 漂移检测复算的 digest 同源（同输入同输出）", async () => {
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
    expect(a.digest).toBe(b.digest);
    expect(c.digest).not.toBe(a.digest);
  });

  it("features 不进 digest（features 变更不改变 digest）", async () => {
    const { repo: repoA } = repoWith([buildRow({ features: { quantity_max: 4 } })]);
    const { repo: repoB } = repoWith([buildRow({ features: { quantity_max: 99 } })]);
    const [a] = await repoA.listEnabledByType("image");
    const [b] = await repoB.listEnabledByType("image");
    expect(a.digest).toBe(b.digest);
  });

  it("features 缺 image_reference_max 时按行类型兜底：图片行 10", async () => {
    const { repo } = repoWith([
      buildRow({ features: { reference_image: true, watermark: true, quantity_max: 4 } }),
    ]);

    const [view] = await repo.listEnabledByType("image");

    expect(view.features.reference_image).toBe(true);
    expect(view.features.image_reference_max).toBe(10);
  });

  it("features 缺 image_reference_max 时按行类型兜底：音频行 1（IKHEXG）", async () => {
    const { repo } = repoWith([buildRow({ features: { watermark: true } })]);

    const [view] = await repo.listEnabledByType("audio");

    expect(view.features.image_reference_max).toBe(1);
  });

  it("显式配置 image_reference_max 时原样透出（不被兜底覆盖，IK6PA5）", async () => {
    const { repo } = repoWith([
      buildRow({
        features: {
          reference_image: true,
          image_reference_max: 10,
          watermark: false,
          quantity_max: 4,
        },
      }),
    ]);

    const [view] = await repo.listEnabledByType("image");

    expect(view.features.image_reference_max).toBe(10);
  });

  it("camelCase imageReferenceMax 同样被识别（IK6PA5）", async () => {
    const { repo } = repoWith([
      buildRow({ features: { reference_image: true, imageReferenceMax: 6 } }),
    ]);

    const [view] = await repo.listEnabledByType("image");

    expect(view.features.image_reference_max).toBe(6);
  });

  it("features 为 NULL 时兜底 10 且 reference_image 为 false（IK6PA5 / IKA72G）", async () => {
    const { repo } = repoWith([buildRow({ features: null })]);

    const [view] = await repo.listEnabledByType("image");

    expect(view.features.reference_image).toBe(false);
    expect(view.features.image_reference_max).toBe(10);
  });

  it("i2i_model_name 与 max_prompt_length 正常解析（snake_case）", async () => {
    const { repo } = repoWith([
      buildRow({
        features: { i2i_model_name: "gpt-image-2-edit", max_prompt_length: 32000 },
      }),
    ]);

    const [view] = await repo.listEnabledByType("image");

    expect(view.features.i2i_model_name).toBe("gpt-image-2-edit");
    expect(view.features.max_prompt_length).toBe(32000);
  });

  it("camelCase 键形同样识别", async () => {
    const { repo } = repoWith([
      buildRow({ features: { i2iModelName: "m-edit", maxPromptLength: 500 } }),
    ]);

    const [view] = await repo.listEnabledByType("image");

    expect(view.features.i2i_model_name).toBe("m-edit");
    expect(view.features.max_prompt_length).toBe(500);
  });

  it("缺省 / 脏值（空白串、0、负数、非整数、字符串数字）一律降级 null=未配置", async () => {
    const { repo } = repoWith([
      buildRow({ features: {} }),
      buildRow({
        features: {
          i2i_model_name: "   ",
          max_prompt_length: 0,
        },
      }),
      buildRow({
        features: {
          i2i_model_name: 42,
          max_prompt_length: "32000",
        },
      }),
      buildRow({
        features: { i2i_model_name: "m-edit", max_prompt_length: 1.5 },
      }),
    ]);

    const views = await repo.listEnabledByType("image");

    expect(views.map((v) => v.features.i2i_model_name)).toEqual([
      null,
      null,
      null,
      "m-edit",
    ]);
    expect(views.map((v) => v.features.max_prompt_length)).toEqual([
      null,
      null,
      null,
      null,
    ]);
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
      catalog_models: {
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
      makeRow({ supported_durations: [10, 5] }),
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
      catalog_models: { findMany },
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

    expect(isDefault).toBe(notDefault);
    expect(isDefault).toBe(capabilityDigest(CAP_FIELDS));
  });
});
