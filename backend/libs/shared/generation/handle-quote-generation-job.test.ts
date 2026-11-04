import { describe, expect, it, vi } from "vitest";

import { RESOURCE_NOT_FOUND_CODE } from "@lib/contracts";

import type { BillingClient } from "../billing/billing-client.js";
import { createBillingCharge } from "../billing/billing-charge.js";
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

const AUDIO_BODY = {
  type: "audio",
  expected_output_count: 1,
  parameters: {
    prompt: "你好 世界",
    model_id: "seed-audio-1.0",
  },
};

function fakeBilling() {
  const charge = vi
    .fn()
    .mockResolvedValue({ chargedCredits: 0, catalogVersion: 1, duplicated: false });
  const quote = vi.fn().mockResolvedValue({ credits: 42n, catalogVersion: 1 });
  const queryBalance = vi.fn();
  return {
    client: { charge, quote, queryBalance } as unknown as BillingClient,
    charge,
    quote,
    queryBalance,
  };
}

const logger = { warn: vi.fn() };

function modelWhitelist(videoRow: Record<string, unknown> = {}) {
  return vi
    .fn()
    .mockResolvedValue([
      { model_id: MODEL_ID, version: 345, features: { audio: true, video_reference: true, video_reference_max: 3 }, ...videoRow },
      { model_id: IMAGE_MODEL_ID, features: { image_reference_max: 10 } },
      {
        model_id: "seed-audio-1.0",
        version: 9,
        features: { audio_reference_max: 3, image_reference_max: 1 },
        pricing: {
          baseUnit: "usage.characters",
          basePrice: { kind: "const", value: 19000 },
          unitDenominator: 100,
          quantityStep: 100,
          minCredits: 1,
        },
      },
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

function createDeps(
  client: BillingClient,
  resolveTier: (userId: string) => Promise<string>,
  assetsOverride?: { resolveInputAssets: unknown },
  models?: ReturnType<typeof modelWhitelist>,
) {
  const createJob = vi.fn(
    async (
      _input: unknown,
      options?: { billing?: { charge: (jobId: number) => Promise<void> } },
    ) => {
      await options?.billing?.charge(1);
      return { generation_job_id: "1", cursor: 1 };
    },
  );
  const deps = {
    projects: { findOwnedById: ownedProject() },
    models: { listEnabledByType: models ?? modelWhitelist() },
    command: { createJob },
    assets:
      assetsOverride ??
      ({
        resolveInputAssets: vi.fn(async (ids: string[]) =>
          ids.map((id) => ({ id, type: "image" })),
        ),
      } as unknown),
    billing: {
      charge: createBillingCharge({ client, resolveTier, logger }),
      release: vi.fn(async () => {}),
    },
  };
  return deps as unknown as Parameters<typeof handleCreateGenerationJob>[4];
}

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
    const { client, charge, quote, queryBalance } = fakeBilling();
    const resolveTier = vi.fn().mockResolvedValue("pro");

    const created = await handleCreateGenerationJob(
      USER_ID,
      PROJECT_ID,
      VIDEO_BODY,
      null,
      createDeps(client, resolveTier),
    );
    expect(created.code).toBe(200);

    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      VIDEO_BODY,
      previewDeps(client, resolveTier),
    );

    const holdArg = charge.mock.calls[0]?.[0] as unknown as HoldArgs;
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;

    const { prompt: _prompt, ...holdPricingSpecs } = holdArg.specs;
    expect(quoteArg.specs).toEqual(holdPricingSpecs);
    expect(quoteArg.specs).toMatchObject({
      model_id: MODEL_ID,
      aspect_ratio: "16:9",
      resolution: "720p",
      duration: "8",
      generate_audio: "true",
      expected_output_count: "1",
    });
    expect(resolveTier).toHaveBeenCalledTimes(2);
    expect(quoteArg.tier).toBe(holdArg.tier);
    expect(quoteArg.tier).toBe("pro");
    expect(quoteArg.modelId).toBe(holdArg.modelId);
    expect(quoteArg.taskType).toBe(holdArg.taskType);

    expect(quote).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(queryBalance).not.toHaveBeenCalled();
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: 42, quote_revision: expect.any(String) });
  });

  it("★ 音频报价把文本折成去空白的 prompt_characters，不再按 0 字落到下限", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      AUDIO_BODY,
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    expect(result.code).toBe(200);
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as {
      specs: Record<string, string>;
      taskType: string;
    };
    expect(quoteArg.taskType).toBe("audio");
    expect(quoteArg.specs.prompt_characters).toBe("4");
    expect(quoteArg.specs).not.toHaveProperty("prompt");
    expect(quoteArg.specs.reference_count).toBe("0");
  });

  it("★ 图片参考图进报价规格 —— 参考图是定价维度，漏了预览就比实扣低", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      IMAGE_BODY,
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    expect(result.code).toBe(200);
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.reference_count).toBe("3");
    expect(quoteArg.taskType).toBe("image");
  });

  it("★ 画布图片面板不带 prompt 也出价 —— 报价不套「提交必填项」", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      {
        type: "image",
        expected_output_count: 1,
        references: [{ role: "reference", type: "image", asset_id: "4" }],
        parameters: {
          model_id: IMAGE_MODEL_ID,
          size: "2k",
          aspect_ratio: "1:1",
        },
      },
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: 42, quote_revision: expect.any(String) });
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.taskType).toBe("image");
    expect(quoteArg.specs.size).toBe("2k");
    expect(quoteArg.specs.image_reference).toBe("1");
  });

  it("★ 画布视频面板不带 prompt 也出价（未绑定节点时同样不带）", async () => {
    const { client, quote } = fakeBilling();
    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      {
        type: "video",
        expected_output_count: 1,
        parameters: {
          model_id: MODEL_ID,
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          generate_audio: true,
          mode: "text2video",
        },
      },
      previewDeps(client, vi.fn().mockResolvedValue("free")),
    );

    expect(result.code).toBe(200);
    expect(result.data?.credits).toBe(42);
    expect(quote.mock.calls[0]?.[0]).toMatchObject({ taskType: "video" });
  });

  it("★ 图片文本带入参考：报价与实扣同口径（image_reference=1，reference_count=2）", async () => {
    const { client, quote } = fakeBilling();
    const deps = {
      ...previewDeps(client, vi.fn().mockResolvedValue("free")),
      canvas: {
        getByProject: vi.fn().mockResolvedValue({
          id: "9",
          project_id: "1",
          version: 3,
          viewport: null,
          nodes: JSON.stringify([
            { id: "media-1", type: "mediaNode", data: { mediaType: "image" } },
            {
              id: "text-a",
              type: "textNode",
              data: {
                text: "参考这张图",
                mediaMentions: [{ start: 0, end: 2, nodeId: "media-2", assetId: "2" }],
                mediaRefs: [
                  { nodeId: "media-2", assetId: "2", mediaType: "image", name: "源图", url: "http://v/2.png" },
                ],
              },
            },
            { id: "media-2", type: "mediaNode", data: { mediaType: "image" } },
          ]),
          edges: JSON.stringify([
            { id: "e-attach", source: "text-a", target: "media-1" },
            { id: "e-index", source: "media-2", target: "text-a", data: { textIndex: true } },
          ]),
        }),
      },
    } as unknown as Parameters<typeof handleQuoteGenerationJob>[3];

    const result = await handleQuoteGenerationJob(
      USER_ID,
      PROJECT_ID,
      {
        ...IMAGE_BODY,
        references: [{ role: "reference", type: "image", asset_id: "4" }],
        target_node_id: "media-1",
      },
      deps,
    );

    expect(result.code).toBe(200);
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.reference_count).toBe("2");
    expect(quoteArg.specs.image_reference).toBe("1");
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

    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: null, quote_revision: null });
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

describe("handleQuoteGenerationJob 样片模式（IKIZQ7）", () => {
  const SAMPLE_MODEL_ID = "doubao-seedance-2-5-260628";

  function sampleWhitelist(features: Record<string, unknown> | null = { sample_mode: true, video_reference: true, video_reference_max: 3 }) {
    return vi.fn().mockResolvedValue([
      { model_id: SAMPLE_MODEL_ID, version: 345, ...(features ? { features } : {}) },
    ]);
  }

  function sampleDeps(client: BillingClient, models = sampleWhitelist()) {
    return previewDeps(client, vi.fn().mockResolvedValue("free"), models);
  }

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

    const b = fakeBilling();
    const revInput = (
      await handleQuoteGenerationJob(
        USER_ID,
        PROJECT_ID,
        SAMPLE_BODY({ duration: 8 }),
        sampleDeps(b.client),
      )
    ).data?.quote_revision;

    const c = fakeBilling();
    const revTier = (
      await handleQuoteGenerationJob(
        USER_ID,
        PROJECT_ID,
        SAMPLE_BODY(),
        previewDeps(c.client, vi.fn().mockResolvedValue("pro"), sampleWhitelist()),
      )
    ).data?.quote_revision;

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

  it("★ 视频报价指纹不含提示词字数（IKRH5I）：提示词形态变化不使报价失效", async () => {
    const prompts = [
      "人物走过街角",
      "&7&走过街角",
      "图片1走过街角",
      "文本1：外景说明人物走过街角",
    ];
    const revisions: Array<string | null | undefined> = [];
    for (const prompt of prompts) {
      const billing = fakeBilling();
      revisions.push(
        (
          await handleQuoteGenerationJob(
            USER_ID,
            PROJECT_ID,
            SAMPLE_BODY({ prompt }),
            sampleDeps(billing.client),
          )
        ).data?.quote_revision,
      );
    }
    expect(revisions.every((revision) => typeof revision === "string")).toBe(true);
    expect(new Set(revisions).size).toBe(1);
  });
});

describe("IKJ797 编辑/延长任务报价时长口径", () => {
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
    expect(quoteArg.specs.duration).toBe("13");
    expect(quoteArg.specs.reference_seconds).toBe("0");
    expect(result.data).toEqual({ credits: 42, quote_revision: expect.any(String), duration_basis: "source_video" });
  });

  it("★ 编辑单预扣同口径 —— 默认 4 秒档不再按 4 秒冻结（透支漏洞堵住）", async () => {
    const { client, charge } = fakeBilling();
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

    const holdArg = charge.mock.calls[0]?.[0] as unknown as HoldArgs;
    expect(holdArg.specs.duration).toBe("13");
    expect(holdArg.specs.reference_seconds).toBe("0");
  });

  it("★ 编辑单「预览价 = 实扣价」—— 同一请求体两路交给 billing 的规格逐字相等", async () => {
    const { client, charge, quote } = fakeBilling();
    const resolveTier = vi.fn().mockResolvedValue("pro");
    const body = video25Body("把背景替换成海边");
    const videoAssets = {
      resolveInputAssets: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({ id, type: "video", duration: 13 })),
      ),
    };

    await handleCreateGenerationJob(USER_ID, PROJECT_ID, body, null, createDeps(client, resolveTier, videoAssets));
    await handleQuoteGenerationJob(USER_ID, PROJECT_ID, body, previewDeps(client, resolveTier));

    const holdArg = charge.mock.calls[0]?.[0] as unknown as HoldArgs;
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

describe("IKJGE6 画布文本带入合并报价口径", () => {
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
        options?: { billing?: { charge: (jobId: number) => Promise<void> } },
      ) => {
        await options?.billing?.charge(1);
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
        charge: createBillingCharge({ client, resolveTier, logger }),
        release: vi.fn(async () => {}),
      },
      quote: createBillingQuote({ client, resolveTier, logger }),
    } as unknown as Parameters<typeof handleCreateGenerationJob>[4];
    return { quoteDeps, createDeps, createJob, getByProject, resolveInputAssets };
  }

  it("★ 结构化 references（无 target_node_id）也计入参考秒（IKR4O5）", async () => {
    const { client, charge, quote } = fakeBilling();
    const resolveTier = vi.fn().mockResolvedValue("free");
    const models = vi.fn().mockResolvedValue([TEXT_REF_ROW]);
    const resolveInputAssets = vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, type: "video" as const, duration: 4.4 })),
    );
    const body = {
      type: "video",
      expected_output_count: 1,
      references: [{ role: "reference", type: "video", asset_id: "8496" }],
      parameters: {
        prompt: "人物走过街角",
        model_id: MODEL_25_ID,
        aspect_ratio: "16:9",
        resolution: "480p",
        duration: 5,
      },
    };
    const createJob = vi.fn(
      async (
        _input: unknown,
        options?: { billing?: { charge: (jobId: number) => Promise<void> } },
      ) => {
        await options?.billing?.charge(1);
        return { generation_job_id: "1", cursor: 1 };
      },
    );
    const quoteDeps = {
      projects: { findOwnedById: ownedProject() },
      models: { listEnabledByType: models },
      canvas: { getByProject: vi.fn() },
      assets: { resolveInputAssets },
      quote: createBillingQuote({ client, resolveTier, logger }),
    } as unknown as QuoteGenerationJobDeps;
    const createDeps = {
      projects: { findOwnedById: ownedProject() },
      models: { listEnabledByType: models },
      command: { createJob },
      assets: { resolveInputAssets },
      billing: {
        charge: createBillingCharge({ client, resolveTier, logger }),
        release: vi.fn(async () => {}),
      },
      quote: createBillingQuote({ client, resolveTier, logger }),
    } as unknown as Parameters<typeof handleCreateGenerationJob>[4];

    const created = await handleCreateGenerationJob(USER_ID, PROJECT_ID, body, null, createDeps);
    expect(created.code).toBe(200);
    const result = await handleQuoteGenerationJob(USER_ID, PROJECT_ID, body, quoteDeps);

    const holdArg = charge.mock.calls[0]?.[0] as unknown as HoldArgs;
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(holdArg.specs.reference_seconds).toBe("4");
    expect(quoteArg.specs.reference_seconds).toBe("4");
    expect(quoteArg.specs.duration).toBe(holdArg.specs.duration);
    expect(result.data?.credits).toBe(42);
  });

  it("★ 触发场景：预览计价时长 = 源视频时长（edit 口径），报价与 Hold specs 同口径、带源时长标记", async () => {
    const { client, charge, quote } = fakeBilling();
    const resolveTier = vi.fn().mockResolvedValue("pro");
    const h = textRefHarness(client, resolveTier);

    const created = await handleCreateGenerationJob(USER_ID, PROJECT_ID, TEXT_REF_BODY, null, h.createDeps);
    expect(created.code).toBe(200);
    const result = await handleQuoteGenerationJob(USER_ID, PROJECT_ID, TEXT_REF_BODY, h.quoteDeps);

    const holdArg = charge.mock.calls[0]?.[0] as unknown as HoldArgs;
    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.duration).toBe("13");
    expect(quoteArg.specs.reference_seconds).toBe("0");
    expect(holdArg.specs.duration).toBe("13");
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

    const quoted = await handleQuoteGenerationJob(USER_ID, PROJECT_ID, body, h.quoteDeps);
    expect(quoted.data?.duration_basis).toBe("source_video");

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

  it("素材数不齐（resolveInputAssets 短回——建任务侧会 400）→ 整个不回填，回落旧口径", async () => {
    const { client, quote } = fakeBilling();
    const h = textRefHarness(client, vi.fn().mockResolvedValue("free"), 13);
    h.resolveInputAssets.mockImplementation(async (ids: string[]) =>
      ids.slice(1).map((id) => ({ id, type: "video" as const, duration: 13 })),
    );

    const result = await handleQuoteGenerationJob(USER_ID, PROJECT_ID, TEXT_REF_BODY, h.quoteDeps);

    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.duration).toBe("4");
    expect(result.data?.duration_basis).toBeUndefined();
  });

  it.each([0, -5])("源时长为 %d 秒（非正数）→ 双闸拦下，回落用户所选", async (badDuration) => {
    const { client, quote } = fakeBilling();
    const h = textRefHarness(client, vi.fn().mockResolvedValue("free"), badDuration);

    const result = await handleQuoteGenerationJob(USER_ID, PROJECT_ID, TEXT_REF_BODY, h.quoteDeps);

    const quoteArg = quote.mock.calls[0]?.[0] as unknown as QuoteArgs;
    expect(quoteArg.specs.duration).toBe("4");
    expect(result.data?.duration_basis).toBeUndefined();
  });
});

describe("报价按能力行配置校验（IKRQYW）", () => {
  const VALID_MODEL_ID = "doubao-seedance-2-5-260628";

  const modelRow = (overrides: Record<string, unknown> = {}) => ({
    model_id: VALID_MODEL_ID,
    version: 7,
    supported_sizes: [{ id: "720p", label: "720P", api_value: "720p" }],
    supported_aspect_ratios: ["16:9"],
    supported_durations: { min: 4, max: 30, step: 1 },
    features: {
      video_reference: true,
      video_reference_max: 10,
      audio_reference: true,
      audio_reference_max: 10,
      image_reference_max: 30,
      task_types: { text2video: {}, image_reference: {}, extend: {} },
    },
    ...overrides,
  });

  const quoteBody = (parameters: Record<string, unknown> = {}) => ({
    type: "video" as const,
    expected_output_count: 1,
    parameters: {
      prompt: "人物走过街角",
      model_id: VALID_MODEL_ID,
      aspect_ratio: "16:9",
      resolution: "720p",
      duration: 5,
      ...parameters,
    },
  });

  const run = (
    body: unknown,
    models: Array<Record<string, unknown>> = [modelRow()],
  ) => {
    const { client, quote } = fakeBilling();
    return {
      quote,
      result: handleQuoteGenerationJob(
        USER_ID,
        PROJECT_ID,
        body as never,
        previewDeps(client, vi.fn().mockResolvedValue("free"), vi.fn().mockResolvedValue(models)),
      ),
    };
  };

  it("时长 31 秒超上界 → 不报价", async () => {
    const { quote, result } = run(quoteBody({ duration: 31 }));
    expect((await result).data).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("时长 3 秒低于下界 → 不报价", async () => {
    const { quote, result } = run(quoteBody({ duration: 3 }));
    expect((await result).data).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  const quoteBodyWithVideoRef = (parameters: Record<string, unknown> = {}) => ({
    ...quoteBody(parameters),
    references: [{ role: "reference", type: "video", material_id: "asset-vid-1" }],
  });

  it("显式模式未在能力行配置 → 不报价", async () => {
    const models = [
      modelRow({
        features: {
          ...modelRow().features,
          task_types: { text2video: {}, image_reference: {} },
        },
      }),
    ];
    const { quote, result } = run(quoteBodyWithVideoRef({ mode: "extend" }), models);
    expect((await result).data).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("同一参考素材换用已配置模式 → 正常报价（排除参考校验误伤）", async () => {
    const models = [
      modelRow({
        features: {
          ...modelRow().features,
          task_types: { text2video: {}, image_reference: {} },
        },
      }),
    ];
    const { quote, result } = run(quoteBodyWithVideoRef({ mode: "image_reference" }), models);
    expect((await result).data?.credits).toBe(42);
    expect(quote).toHaveBeenCalled();
  });

  it("提交侧同样拒绝未配置的显式模式 → 1060", async () => {
    const models = vi.fn().mockResolvedValue([
      modelRow({
        features: {
          ...modelRow().features,
          task_types: { text2video: {}, image_reference: {} },
        },
      }),
    ]);
    const { client } = fakeBilling();
    const created = await handleCreateGenerationJob(
      USER_ID,
      PROJECT_ID,
      quoteBodyWithVideoRef({ mode: "extend" }) as never,
      null,
      createDeps(client, vi.fn().mockResolvedValue("free"), undefined, models),
    );
    expect(created.code).toBe(1060);
  });

  it("合法组合仍正常报价", async () => {
    const { quote, result } = run(quoteBody({ duration: 15 }));
    expect((await result).data?.credits).toBe(42);
    expect(quote).toHaveBeenCalled();
  });

  it("不带 prompt 时上限校验照样生效（画布面板报价）", async () => {
    const { prompt: _dropped, ...noPrompt } = quoteBody().parameters;
    const { quote, result } = run({ ...quoteBody(), parameters: { ...noPrompt, duration: 31 } });
    expect((await result).data).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("不带 prompt 且参数合法 → 正常报价（画布面板报价）", async () => {
    const { prompt: _dropped, ...noPrompt } = quoteBody().parameters;
    const { quote, result } = run({ ...quoteBody(), parameters: noPrompt });
    expect((await result).data?.credits).toBe(42);
    expect(quote).toHaveBeenCalled();
  });
});
