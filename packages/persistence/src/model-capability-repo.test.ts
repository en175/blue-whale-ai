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
});
