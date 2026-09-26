/* ============================================
 * 价格预览（Quote）的接线钉板
 *
 * ★ 这里最要紧的一条：**报价与预扣用同一套 specs、同一个 tier**。
 *   预览价与实际会冻的钱出自同一个数，是本端点存在的全部理由；
 *   所以本文件不单测「报价返回了什么」，而是让**同一条请求体**分别走
 *   「真实建任务管线 + 真实 Hold 装配」与「报价端点」，再逐字比对两边交给 billing 的规格。
 * ============================================ */
import { describe, expect, it, vi } from "vitest";

import { RESOURCE_NOT_FOUND_CODE } from "@lib/contracts";

import type { BillingClient } from "../billing/billing-client.js";
import { createBillingHold } from "../billing/billing-hold.js";
import { createBillingQuote } from "../billing/billing-quote.js";
import { handleCreateGenerationJob } from "./handle-create-generation-job.js";
import {
  handleQuoteGenerationJob,
  type QuoteGenerationJobDeps,
} from "./handle-quote-generation-job.js";

const USER_ID = "42";
const PROJECT_ID = "1";
const MODEL_ID = "doubao-seedance-2-0-260128";
const IMAGE_MODEL_ID = "doubao-seedream-5-0-pro-260628";

/** 图片请求体：参考图是**定价维度**（Pro 首张免费、第 2 张起 0.02 元/张）。
 *  ⚠️ 图片的参考图落在 `input.input_asset_ids`，报价侧必须按同一媒介分支投影进去 ——
 *  这里就是钉那条投影的（把它改回 `referenceAssetIds: []`，下面那条断言立刻红）。 */
const IMAGE_BODY = {
  type: "image",
  expected_output_count: 1,
  references: [
    { role: "reference", type: "image", asset_id: "1" },
    { role: "reference", type: "image", asset_id: "2" },
    { role: "reference", type: "image", asset_id: "3" },
  ],
  parameters: {
    prompt: "把这三张融合成一张",
    model_id: IMAGE_MODEL_ID,
    size: "1k",
    aspect_ratio: "1:1",
  },
};

/** 视频请求体：创建与报价**同一份**（面板也是同一份），两边必须因此得出同一个规格。 */
const VIDEO_BODY = {
  type: "video",
  expected_output_count: 1,
  parameters: {
    prompt: "人物走过街角",
    model_id: MODEL_ID,
    aspect_ratio: "16:9",
    resolution: "720p",
    duration: 8,
    generate_audio: true,
  },
};

/** 记下两个 RPC 的假客户端（另有余额探针：报价**不该**碰它）。 */
function fakeBilling() {
  const hold = vi
    .fn()
    .mockResolvedValue({ reservedCredits: 0, catalogVersion: 1, duplicated: false });
  const quote = vi.fn().mockResolvedValue({ credits: 42n, catalogVersion: 1 });
  const queryBalance = vi.fn();
  return {
    client: { hold, quote, queryBalance } as unknown as BillingClient,
    hold,
    quote,
    queryBalance,
  };
}

const logger = { warn: vi.fn() };

/** 能力行带 `features.audio` —— 与建任务同源：generate_audio 冻不冻由它决定。 */
function modelWhitelist() {
  return vi
    .fn()
    .mockResolvedValue([
      { model_id: MODEL_ID, features: { audio: true } },
      { model_id: IMAGE_MODEL_ID, features: { image_reference_max: 10 } },
    ]);
}

const ownedProject = () =>
  vi.fn().mockResolvedValue({ id: "1", name: "项目", thumb: null });

/** 预览侧依赖：真实 `createBillingQuote` 装配（等级解析与规格归一的唯一实现）。 */
function previewDeps(client: BillingClient, resolveTier: (userId: string) => Promise<string>) {
  return {
    projects: { findOwnedById: ownedProject() },
    models: { listEnabledByType: modelWhitelist() },
    quote: createBillingQuote({ client, resolveTier, logger }),
  } as unknown as QuoteGenerationJobDeps;
}

/** 创建侧依赖：真实 `createBillingHold` 装配 + 假 repo（createJob 内调 hold —— 与真 repo 同序）。 */
function createDeps(
  client: BillingClient,
  resolveTier: (userId: string) => Promise<string>,
) {
  const createJob = vi.fn(
    async (
      _input: unknown,
      options?: { billing?: { hold: (jobId: number) => Promise<void> } },
    ) => {
      await options?.billing?.hold(1);
      return { generation_job_id: "1", cursor: 1 };
    },
  );
  const deps = {
    projects: { findOwnedById: ownedProject() },
    models: { listEnabledByType: modelWhitelist() },
    command: { createJob },
    assets: {
      resolveInputAssets: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({ id, type: "image" })),
      ),
    },
    billing: {
      hold: createBillingHold({ client, resolveTier, logger }),
      release: vi.fn(async () => {}),
    },
  };
  return deps as unknown as Parameters<typeof handleCreateGenerationJob>[4];
}

/** billing 的 Hold 入参（只取本文件断言用到的字段）。 */
interface HoldArgs {
  modelId: string;
  taskType: string;
  specs: Record<string, string>;
  tier: string;
}

interface QuoteArgs {
  modelId: string;
  taskType: string;
  specs: Record<string, string>;
  tier: string;
}

describe("handleQuoteGenerationJob", () => {
  it("★ 与 Hold 同一套 specs、同一个 tier —— 「预览价 = 实扣价」的唯一保证", async () => {
    const { client, hold, quote, queryBalance } = fakeBilling();
    const resolveTier = vi.fn().mockResolvedValue("pro");

    // 1) 真实建任务管线：冻结 input → 真实 Hold 装配 → billing
    const created = await handleCreateGenerationJob(
      USER_ID,
      PROJECT_ID,
      VIDEO_BODY,
      null,
      createDeps(client, resolveTier),
    );
    expect(created.code).toBe(200);

    // 2) 同一个 body 走报价端点
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      VIDEO_BODY,
      previewDeps(client, resolveTier),
    );

    const holdArg = hold.mock.calls[0]?.[0] as unknown as HoldArgs;
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;

    // ⚠️ 唯一的例外是 prompt：提示词是创作内容、不是定价维度，预览刻意不带它
    //    （带上它，前端的查询键就要随每一次打字变化 = 每敲一个字重新报价）。
    const { prompt: _prompt, ...holdPricingSpecs } = holdArg.specs;
    expect(quoteArg.specs).toEqual(holdPricingSpecs);
    // 定价维度逐个点名：改了 composeInput 却没同步投影，这里就红
    expect(quoteArg.specs).toMatchObject({
      model_id: MODEL_ID,
      aspect_ratio: "16:9",
      resolution: "720p",
      duration: "8",
      generate_audio: "true",
      expected_output_count: "1",
    });
    // 等级同一个来源、同一档 —— 一边 pro 一边 free 就是「预览一个价、实扣另一个价」
    expect(resolveTier).toHaveBeenCalledTimes(2);
    expect(quoteArg.tier).toBe(holdArg.tier);
    expect(quoteArg.tier).toBe("pro");
    // 模型与任务类型也必须是同一个
    expect(quoteArg.modelId).toBe(holdArg.modelId);
    expect(quoteArg.taskType).toBe(holdArg.taskType);

    // 3) 只算不扣：报价这一趟没碰余额、没增出第二笔冻结
    expect(quote).toHaveBeenCalledTimes(1);
    expect(hold).toHaveBeenCalledTimes(1); // 那一次来自建任务，不是报价
    expect(queryBalance).not.toHaveBeenCalled();
    // 回给前端的只有**一个整数积分**（不返折扣系数、不返明细）
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: 42 });
  });

  it("★ 图片参考图进报价规格 —— 参考图是定价维度，漏了预览就比实扣低", async () => {
    // 这一条钉的是**报价侧**的投影（`projectQuoteInput`）。它原先写死
    // `referenceAssetIds: []`，那时参考图还不计价；现在 Pro 按张收（首张免费、
    // 第 2 张起 0.02 元），写死就等于预览少算 2 × 0.02 元。
    // ⚠️ 图片的参考落 `input.input_asset_ids`，视频/音频落 `input.references` ——
    //    报价必须走与建任务**同一个** `resolveReferenceAssets`，而不是自己数一遍。
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      IMAGE_BODY,
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    expect(result.code).toBe(200);
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    // 3 张参考 —— 预扣侧读的也是这个规格键（`UsageDim.REFERENCE_COUNT` 的契约量来源）
    expect(quoteArg.specs.reference_count).toBe("3");
    expect(quoteArg.taskType).toBe("image");
  });

  it("★ 算不出价（UNPRICEABLE 定价漏配）→ credits: null，不报错、不阻断", async () => {
    const { client, quote } = fakeBilling();
    quote.mockRejectedValue(new Error("invalid_argument: UNPRICEABLE"));
    logger.warn.mockClear();

    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      VIDEO_BODY,
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    // 预览的失败不等于提交的失败：回「没有报价」让前端不显示价格，而不是甩一个错误
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: null });
    // 但要在日志里留下痕迹：漏配清单就是从这类日志里攒出来的
    expect(logger.warn).toHaveBeenCalled();
  });

  it("★ billing 不可用（UNAVAILABLE）→ 同样 credits: null（这条路径一分钱都不动）", async () => {
    const { client, quote } = fakeBilling();
    quote.mockRejectedValue(new Error("unavailable"));

    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      VIDEO_BODY,
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    expect(result.data).toEqual({ credits: null });
  });

  it("模型不在能力目录 → 无报价（那个组合本就提交不了，不必报个价骗人）", async () => {
    const { client } = fakeBilling();
    const deps = {
      projects: { findOwnedById: ownedProject() },
      models: { listEnabledByType: vi.fn().mockResolvedValue([]) },
      quote: createBillingQuote({
        client,
        resolveTier: vi.fn().mockResolvedValue("free"),
        logger,
      }),
    } as unknown as QuoteGenerationJobDeps;

    const result = await handleQuoteGenerationJob(USER_ID, PROJECT_ID, VIDEO_BODY, deps);

    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: null });
  });

  it("请求体缺少 parameters → 无报价（不抛）", async () => {
    const { client } = fakeBilling();

    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      { type: "video", expected_output_count: 1 },
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    expect(result.data).toEqual({ credits: null });
  });

  it("项目不存在（或不属于该用户）→ 与建任务同一道归属校验", async () => {
    const { client } = fakeBilling();
    const deps = {
      projects: { findOwnedById: vi.fn().mockResolvedValue(null) },
      models: { listEnabledByType: modelWhitelist() },
      quote: createBillingQuote({
        client,
        resolveTier: vi.fn().mockResolvedValue("free"),
        logger,
      }),
    } as unknown as QuoteGenerationJobDeps;

    const result = await handleQuoteGenerationJob(USER_ID, PROJECT_ID, VIDEO_BODY, deps);

    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });
});
