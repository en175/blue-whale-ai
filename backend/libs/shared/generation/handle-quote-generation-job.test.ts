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
const MODEL_25_ID = "doubao-seedance-2-5-260628";

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

/** 能力行带 `features.audio` —— 与建任务同源：generate_audio 冻不冻由它决定。
 *  version=345：quote_revision 的能力行版本段（金标 G03 示例 `cap-345`）；
 *  videoRow 供样片用例覆盖能力行（如 features.sample_mode）。
 *  IKJ797：加 Seedance 2.5 行（带 task_types.edit / prolong 约束与参考上限，
 *  与 002_seed 的能力目录同构）——编辑单时长口径按它分叉。 */
function modelWhitelist(videoRow: Record<string, unknown> = {}) {
  return vi
    .fn()
    .mockResolvedValue([
      { model_id: MODEL_ID, version: 345, features: { audio: true }, ...videoRow },
      { model_id: IMAGE_MODEL_ID, features: { image_reference_max: 10 } },
      {
        model_id: MODEL_25_ID,
        features: {
          audio: true,
          video_reference: true,
          video_reference_max: 10,
          audio_reference: false,
          audio_reference_max: 10,
          image_reference_max: 30,
          max_reference_duration_sec: 30,
          task_types: {
            default: { allowed_ratios: ["adaptive", "16:9"] },
            first_frame: { allowed_ratios: ["adaptive"] },
            first_last_frame: { allowed_ratios: ["adaptive"] },
            edit: { allowed_ratios: ["adaptive"] },
            prolong: { allowed_ratios: ["adaptive"] },
          },
        },
      },
    ]);
}

const ownedProject = () =>
  vi.fn().mockResolvedValue({ id: "1", name: "项目", thumb: null });

/** 预览侧依赖：真实 `createBillingQuote` 装配（等级解析与规格归一的唯一实现）。 */
function previewDeps(
  client: BillingClient,
  resolveTier: (userId: string) => Promise<string>,
  models = modelWhitelist(),
) {
  return {
    projects: { findOwnedById: ownedProject() },
    models: { listEnabledByType: models },
    quote: createBillingQuote({ client, resolveTier, logger }),
  } as unknown as QuoteGenerationJobDeps;
}

/** 创建侧依赖：真实 `createBillingHold` 装配 + 假 repo（createJob 内调 hold —— 与真 repo 同序）。
 *  IKJ797：`assetsOverride` 供带视频参考的用例注入 type=video 的素材解析（默认形态沿用图片）。 */
function createDeps(
  client: BillingClient,
  resolveTier: (userId: string) => Promise<string>,
  assetsOverride?: { resolveInputAssets: unknown },
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
    assets:
      assetsOverride ??
      ({
        resolveInputAssets: vi.fn(async (ids: string[]) =>
          ids.map((id) => ({ id, type: "image" })),
        ),
      } as unknown),
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
    // 回给前端的只有**一个整数积分**（不返折扣系数、不返明细）；quote_revision 是
    // IKIZQ7 并入的报价版本指纹（契约 StageQuoteView），供后续提交核对。
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: 42, quote_revision: expect.any(String) });
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
    expect(result.data).toEqual({ credits: null, quote_revision: null });
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

    expect(result.data).toEqual({ credits: null, quote_revision: null });
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
    expect(result.data).toEqual({ credits: null, quote_revision: null });
  });

  it("请求体缺少 parameters → 无报价（不抛）", async () => {
    const { client } = fakeBilling();

    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      { type: "video", expected_output_count: 1 },
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    expect(result.data).toEqual({ credits: null, quote_revision: null });
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

// ═══════════════════════════════════════════════════════════════
// IKIZQ7：样片报价与默认关闭门控（契约 video-sample-mode.ts；报价 fail open——
// 门控未放行/形态不合契约一律**空报价**，不给出可提交金额，也不抢在建任务前面报错）。
// ═══════════════════════════════════════════════════════════════
describe("handleQuoteGenerationJob 样片模式（IKIZQ7）", () => {
  const SAMPLE_MODEL_ID = "doubao-seedance-2-5-260628";

  /** 样片白名单：能力行声明 features.sample_mode（放行态，运营显式配置）+ 乐观锁版本。
   *  缺省 features 即「未放行」——目录里没有这一位 = 样片默认关闭。 */
  function sampleWhitelist(features: Record<string, unknown> | null = { sample_mode: true }) {
    return vi.fn().mockResolvedValue([
      { model_id: SAMPLE_MODEL_ID, version: 345, ...(features ? { features } : {}) },
    ]);
  }

  function sampleDeps(client: BillingClient, models = sampleWhitelist()) {
    return previewDeps(client, vi.fn().mockResolvedValue("free"), models);
  }

  /** 样片请求体（与创建同形）：单输出 + sample_mode=true + 480p；references 区分四种现有模式。 */
  const SAMPLE_BODY = (
    parameters: Record<string, unknown> = {},
    references?: unknown,
  ) => ({
    type: "video",
    expected_output_count: 1,
    ...(references !== undefined ? { references } : {}),
    parameters: {
      prompt: "人物走过街角",
      model_id: SAMPLE_MODEL_ID,
      aspect_ratio: "16:9",
      resolution: "480p",
      duration: 5,
      sample_mode: true,
      ...parameters,
    },
  });

  /** 四种现有模式（父规格「范围与门控」：文生 / 图生首帧 / 首尾帧 / 全能参考）。 */
  const FOUR_MODE_REFERENCES: Array<[string, unknown]> = [
    ["文生视频（无参考）", undefined],
    ["图生首帧", [{ role: "first_frame", asset_id: "7", type: "image" }]],
    [
      "首尾帧",
      [
        { role: "first_frame", asset_id: "7", type: "image" },
        { role: "last_frame", asset_id: "8", type: "image" },
      ],
    ],
    [
      "全能参考",
      [
        { role: "reference", asset_id: "7", type: "image" },
        { role: "reference", asset_id: "9", type: "video", duration: 3 },
      ],
    ],
  ];

  it.each(FOUR_MODE_REFERENCES)(
    "★ 放行 + 480p（%s）→ 整数积分 + quote_revision，规格按 480p 报价",
    async (_label, references) => {
      const { client, quote } = fakeBilling();
      const result = await handleQuoteGenerationJob(
        USER_ID,
        PROJECT_ID,
        SAMPLE_BODY({}, references),
        sampleDeps(client),
      );

      expect(result.code).toBe(200);
      expect(result.data?.credits).toBe(42);
      expect(result.data?.quote_revision).toMatch(
        /^catalog-1:cap-345:tier-free:input-[0-9a-f]{12}$/,
      );
      const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
      expect(quoteArg.specs).toMatchObject({
        model_id: SAMPLE_MODEL_ID,
        resolution: "480p",
        expected_output_count: "1",
      });
    },
  );

  it("★ 能力未放行（目录缺省无 sample_mode 位）→ 空报价双 null，不碰 billing", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      SAMPLE_BODY(),
      sampleDeps(client, sampleWhitelist(null)),
    );

    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("其他模型（白名单外）→ 空报价（与普通报价同一条白名单闸）", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      SAMPLE_BODY({ model_id: "some-other-model" }),
      sampleDeps(client),
    );

    expect(result.data).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it.each([
    ["resolution 非 480p", { resolution: "1080p" }],
    ["sample_mode 非字面 true", { sample_mode: "true" }],
    ["sample_mode 为 null", { sample_mode: null }],
  ])("形态不合契约（%s）→ 空报价（创建侧会 400，报价不给可提交金额）", async (_label, patch) => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      SAMPLE_BODY(patch as Record<string, unknown>),
      sampleDeps(client),
    );

    expect(result.data).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("非视频类型携带 sample_mode → 空报价（样片仅视频四模式）", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      { ...SAMPLE_BODY(), type: "image" },
      sampleDeps(client),
    );

    expect(result.data).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("多输出（expected_output_count=2）→ 空报价（样片固定单输出）", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      { ...SAMPLE_BODY(), expected_output_count: 2 },
      sampleDeps(client),
    );

    expect(result.data).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("★ 旧请求兼容：sample_mode=false → 普通视频报价语义（credits + quote_revision）", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      SAMPLE_BODY({ sample_mode: false, resolution: "720p" }),
      sampleDeps(client),
    );

    expect(result.code).toBe(200);
    expect(result.data?.credits).toBe(42);
    expect(typeof result.data?.quote_revision).toBe("string");
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.resolution).toBe("720p");
  });

  it("★ quote_revision 随冻结输入 / 等级 / 能力行版本变化（任一变即旧报价失效）", async () => {
    const a = fakeBilling();
    const revA = (
      await handleQuoteGenerationJob(USER_ID, PROJECT_ID, SAMPLE_BODY(), sampleDeps(a.client))
    ).data?.quote_revision;

    // 冻结输入变化（时长 5 → 8）
    const b = fakeBilling();
    const revInput = (
      await handleQuoteGenerationJob(
        USER_ID,
        PROJECT_ID,
        SAMPLE_BODY({ duration: 8 }),
        sampleDeps(b.client),
      )
    ).data?.quote_revision;

    // 用户等级变化（free → pro）
    const c = fakeBilling();
    const revTier = (
      await handleQuoteGenerationJob(
        USER_ID,
        PROJECT_ID,
        SAMPLE_BODY(),
        previewDeps(c.client, vi.fn().mockResolvedValue("pro"), sampleWhitelist()),
      )
    ).data?.quote_revision;

    // 能力行版本变化（345 → 346，运营改配）
    const d = fakeBilling();
    const revCap = (
      await handleQuoteGenerationJob(
        USER_ID,
        PROJECT_ID,
        SAMPLE_BODY(),
        sampleDeps(
          d.client,
          vi.fn().mockResolvedValue([
            { model_id: SAMPLE_MODEL_ID, version: 346, features: { sample_mode: true } },
          ]),
        ),
      )
    ).data?.quote_revision;

    expect(new Set([revA, revInput, revTier, revCap]).size).toBe(4);
  });
});

describe("IKJ797 编辑/延长任务报价时长口径", () => {
  /** Seedance 2.5 + 13 秒参考视频 + 用户所选 4 秒（默认档）——TEMP FIX 透支的标准场景：
   *  编辑单实际输出跟随源视频出十几秒，按 4 秒预估 = 预扣与结算的差额平台垫付。 */
  const video25Body = (prompt: string) => ({
    type: "video" as const,
    expected_output_count: 1,
    references: [{ role: "reference", type: "video", asset_id: "5", duration: 13 }],
    parameters: {
      prompt,
      model_id: MODEL_25_ID,
      aspect_ratio: "adaptive",
      resolution: "720p",
      duration: 4,
    },
  });

  it("★ 编辑单报价 duration 入参 = 源参考视频最长时长，响应带「按源视频时长预估」标记", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      video25Body("把背景替换成海边"),
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    // 交给 billing 的时长是源视频的 13 秒，不是用户所选的 4 秒；输入时长那一项照旧叠加（官方公式两头都收）
    expect(quoteArg.specs.duration).toBe("13");
    expect(quoteArg.specs.video_input_seconds).toBe("13");
    expect(result.data).toEqual({ credits: 42, quote_revision: expect.any(String), duration_basis: "source_video" });
  });

  it("★ 编辑单预扣同口径 —— 默认 4 秒档不再按 4 秒冻结（透支漏洞堵住）", async () => {
    const { client, hold } = fakeBilling();
    const created = await handleCreateGenerationJob(
      USER_ID,
      PROJECT_ID,
      video25Body("把背景替换成海边"),
      null,
      createDeps(client, vi.fn().mockResolvedValue("free"), {
        resolveInputAssets: vi.fn(async (ids: string[]) =>
          ids.map((id) => ({ id, type: "video", duration: 13 })),
        ),
      }),
    );
    expect(created.code).toBe(200);

    const holdArg = hold.mock.calls[0]?.[0] as unknown as HoldArgs;
    expect(holdArg.specs.duration).toBe("13");
    expect(holdArg.specs.video_input_seconds).toBe("13");
  });

  it("★ 编辑单「预览价 = 实扣价」—— 同一请求体两路交给 billing 的规格逐字相等", async () => {
    const { client, hold, quote } = fakeBilling();
    const resolveTier = vi.fn().mockResolvedValue("pro");
    const body = video25Body("把背景替换成海边");
    const videoAssets = {
      resolveInputAssets: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({ id, type: "video", duration: 13 })),
      ),
    };

    await handleCreateGenerationJob(USER_ID, PROJECT_ID, body, null, createDeps(client, resolveTier, videoAssets));
    await handleQuoteGenerationJob(USER_ID, PROJECT_ID, body, previewDeps(client, resolveTier));

    const holdArg = hold.mock.calls[0]?.[0] as unknown as HoldArgs;
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs).toEqual(holdArg.specs);
    expect(quoteArg.tier).toBe(holdArg.tier);
  });

  it("延长单取用户所选时长（官方 extend 允许时长自选），无标记", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      video25Body("把这个视频向后延长"),
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.duration).toBe("4");
    expect(result.data).toEqual({ credits: 42, quote_revision: expect.any(String) });
  });

  it("纯参考单取用户所选时长，无标记", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      video25Body("参考这条视频里的运镜节奏"),
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.duration).toBe("4");
    expect(result.data).toEqual({ credits: 42, quote_revision: expect.any(String) });
  });

  it("否定约束句（IKJ78C 衔接）不判编辑 → 取用户所选时长", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      video25Body("禁止修改人物动作，保持原样"),
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.duration).toBe("4");
    expect(result.data).toEqual({ credits: 42, quote_revision: expect.any(String) });
  });

  it("模型未配 task_types.edit（Seedance 2.0）→ 编辑类提示词仍按用户所选（按模型分叉走能力行）", async () => {
    const { client, quote } = fakeBilling();
    const body = {
      ...video25Body("把背景替换成海边"),
      parameters: { ...video25Body("把背景替换成海边").parameters, model_id: MODEL_ID },
    };
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      body,
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.duration).toBe("4");
    expect(result.data).toEqual({ credits: 42, quote_revision: expect.any(String) });
  });

  it("参考视频未带时长（量不到源时长）→ 回落用户所选，不按 0 估也不拒单", async () => {
    const { client, quote } = fakeBilling();
    const body = {
      ...video25Body("把背景替换成海边"),
      references: [{ role: "reference", type: "video", asset_id: "5" }],
    };
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      body,
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.duration).toBe("4");
    expect(result.data).toEqual({ credits: 42, quote_revision: expect.any(String) });
  });
});

// ═══════════════════════════════════════════════════════════════
// IKJGE6：画布文本带入合并的报价口径——「参考视频仅来自画布文本带入 + 编辑意图提示词」
// 时，报价判定输入与建任务合并后引用集合同源：预览计价时长 = 源视频时长（edit 口径），
// 样片提交确认复算不误拒。此前报价按原始请求体投影，画布文本带入的视频参考进不了
// 判定输入，编辑单被误判 default 按用户所选时长出价，实扣却按源视频时长冻结。
// ═══════════════════════════════════════════════════════════════
describe("IKJGE6 画布文本带入合并报价口径", () => {
  // 画布：目标视频卡 media-1 ← 文本卡 text-a（正文提及 media-2 的视频素材，快照齐备）
  // + 索引线 media-2 → text-a——文本带入参考由此派生（与建任务测试的 TEXT_REF_CANVAS 同构）。
  const CANVAS = {
    nodes: JSON.stringify([
      { id: "media-1", type: "mediaNode", data: { mediaType: "video" } },
      {
        id: "text-a",
        type: "textNode",
        data: {
          text: "参考这段素材",
          mediaMentions: [{ start: 0, end: 2, nodeId: "media-2", assetId: "2" }],
          mediaRefs: [
            { nodeId: "media-2", assetId: "2", mediaType: "video", name: "源视频", url: "http://v/2.mp4" },
          ],
        },
      },
      { id: "media-2", type: "mediaNode", data: { mediaType: "video" } },
    ]),
    edges: JSON.stringify([
      { id: "e-attach", source: "text-a", target: "media-1" },
      { id: "e-index", source: "media-2", target: "text-a", data: { textIndex: true } },
    ]),
  };

  /** Seedance 2.5 能力行（edit 约束 + 参考位 + 样片开关；supported_* 供建任务档位校验）。 */
  const TEXT_REF_ROW = {
    model_id: MODEL_25_ID,
    version: 345,
    supported_sizes: [{ id: "480p", api_value: "480p" }, { id: "720p", api_value: "720p" }],
    supported_aspect_ratios: ["16:9", "9:16", "adaptive"],
    supported_durations: { min: 4, max: 30, step: 1 },
    features: {
      audio: true,
      sample_mode: true,
      video_reference: true,
      video_reference_max: 10,
      audio_reference: false,
      audio_reference_max: 10,
      image_reference_max: 30,
      max_reference_duration_sec: 30,
      task_types: {
        default: { allowed_ratios: ["16:9", "9:16", "adaptive"] },
        edit: { allowed_ratios: ["adaptive"] },
        prolong: { allowed_ratios: ["adaptive"] },
      },
    },
  };

  /** 触发场景请求体：references 里没有视频——它只来自画布文本带入（触发条件 1）；
   *  提示词带编辑意图（条件 2）；用户所选 4 秒（源视频 13 秒长于它 → 修复前预览少算）。 */
  const TEXT_REF_BODY = {
    type: "video",
    expected_output_count: 1,
    target_node_id: "media-1",
    parameters: {
      prompt: "把背景替换成海边",
      model_id: MODEL_25_ID,
      aspect_ratio: "adaptive",
      resolution: "720p",
      duration: 4,
    },
  };

  /** 同一套画布/素材/能力行喂两侧：报价与建任务取到同一个数，才谈得上同源。 */
  function textRefHarness(
    client: BillingClient,
    resolveTier: (userId: string) => Promise<string>,
    assetDuration: number | null = 13,
  ) {
    const getByProject = vi.fn().mockResolvedValue({
      id: "9", project_id: "1", version: 3, viewport: null, nodes: CANVAS.nodes, edges: CANVAS.edges,
    });
    const resolveInputAssets = vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, type: "video" as const, duration: assetDuration })));
    const models = vi.fn().mockResolvedValue([TEXT_REF_ROW]);
    const quoteDeps = {
      projects: { findOwnedById: ownedProject() },
      models: { listEnabledByType: models },
      canvas: { getByProject },
      assets: { resolveInputAssets },
      quote: createBillingQuote({ client, resolveTier, logger }),
    } as unknown as QuoteGenerationJobDeps;
    const createJob = vi.fn(
      async (
        _input: unknown,
        options?: { billing?: { hold: (jobId: number) => Promise<void> } },
      ) => {
        await options?.billing?.hold(1);
        return { generation_job_id: "1", cursor: 1 };
      },
    );
    const createDeps = {
      projects: { findOwnedById: ownedProject() },
      models: { listEnabledByType: models },
      command: { createJob },
      canvas: { getByProject },
      assets: { resolveInputAssets },
      billing: {
        hold: createBillingHold({ client, resolveTier, logger }),
        release: vi.fn(async () => {}),
      },
      quote: createBillingQuote({ client, resolveTier, logger }),
    } as unknown as Parameters<typeof handleCreateGenerationJob>[4];
    return { quoteDeps, createDeps, createJob, getByProject };
  }

  it("★ 触发场景：预览计价时长 = 源视频时长（edit 口径），报价与 Hold specs 同口径、带源时长标记", async () => {
    const { client, hold, quote } = fakeBilling();
    const resolveTier = vi.fn().mockResolvedValue("pro");
    const h = textRefHarness(client, resolveTier);

    const created = await handleCreateGenerationJob(USER_ID, PROJECT_ID, TEXT_REF_BODY, null, h.createDeps);
    expect(created.code).toBe(200);
    const result = await handleQuoteGenerationJob(USER_ID, PROJECT_ID, TEXT_REF_BODY, h.quoteDeps);

    const holdArg = hold.mock.calls[0]?.[0] as unknown as HoldArgs;
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    // 交给 billing 的时长是回填后的源视频 13 秒（不是用户所选的 4 秒）；输入时长同样吃到
    expect(quoteArg.specs.duration).toBe("13");
    expect(quoteArg.specs.video_input_seconds).toBe("13");
    expect(holdArg.specs.duration).toBe("13");
    // 除建任务侧的非定价标量（prompt 惯例剥除 + target_node_id/text_input_signature 快照键）外
    // 逐字相等——「预览价 = 实扣价」的规格级证明。
    const {
      prompt: _prompt,
      target_node_id: _target,
      text_input_signature: _signature,
      ...holdPricingSpecs
    } = holdArg.specs;
    expect(quoteArg.specs).toEqual(holdPricingSpecs);
    expect(result.data).toEqual({
      credits: 42,
      quote_revision: expect.any(String),
      duration_basis: "source_video",
    });
  });

  it("★ 样片提交确认同源：报价端点给出的 credits/quote_revision → 建任务复算不误拒", async () => {
    const { client } = fakeBilling();
    const resolveTier = vi.fn().mockResolvedValue("free");
    const h = textRefHarness(client, resolveTier);
    const body = {
      ...TEXT_REF_BODY,
      parameters: { ...TEXT_REF_BODY.parameters, resolution: "480p", sample_mode: true },
    };

    // 1) 用户在面板看到的报价（合并后 edit 口径 + 源时长标记）
    const quoted = await handleQuoteGenerationJob(USER_ID, PROJECT_ID, body, h.quoteDeps);
    expect(quoted.data?.duration_basis).toBe("source_video");

    // 2) 携带确认两字段提交：复算必须重走同一合并 + 同一编辑口径改写，否则 quote_stale 误拒
    const result = await handleCreateGenerationJob(
      USER_ID,
      PROJECT_ID,
      {
        ...body,
        expected_credits: quoted.data?.credits ?? 0,
        quote_revision: quoted.data?.quote_revision ?? "",
      },
      null,
      h.createDeps,
    );
    expect(result.code).toBe(200);
    expect(result.data?.generation_job_id).toBe("1");
  });

  it("无 target_node_id → 不读画布，报价行为同旧（时长 = 用户所选，无源时长标记）", async () => {
    const { client, quote } = fakeBilling();
    const h = textRefHarness(client, vi.fn().mockResolvedValue("free"));
    const { target_node_id: _dropped, ...body } = TEXT_REF_BODY;

    const result = await handleQuoteGenerationJob(USER_ID, PROJECT_ID, body, h.quoteDeps);

    expect(h.getByProject).not.toHaveBeenCalled();
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.duration).toBe("4");
    expect(result.data?.duration_basis).toBeUndefined();
  });

  it("合并校验失败（首尾帧与文本带入互斥——建任务会 400）→ 空报价，不给出可提交金额", async () => {
    const { client, quote } = fakeBilling();
    const h = textRefHarness(client, vi.fn().mockResolvedValue("free"));
    const body = {
      ...TEXT_REF_BODY,
      references: [{ role: "first_frame", asset_id: "3", type: "image" }],
    };

    const result = await handleQuoteGenerationJob(USER_ID, PROJECT_ID, body, h.quoteDeps);

    expect(result.data).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("量不到源时长（素材无 duration）→ 回落用户所选时长，不按 0 估也不拒单", async () => {
    const { client, quote } = fakeBilling();
    const h = textRefHarness(client, vi.fn().mockResolvedValue("free"), null);

    const result = await handleQuoteGenerationJob(USER_ID, PROJECT_ID, TEXT_REF_BODY, h.quoteDeps);

    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.duration).toBe("4");
    expect(result.data?.duration_basis).toBeUndefined();
  });
});
