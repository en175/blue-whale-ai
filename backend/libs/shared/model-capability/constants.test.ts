import { describe, expect, it } from "vitest";

import { parseModelCreateBody, parseModelUpdateBody } from "./constants.js";

describe("parseModelCreateBody", () => {
  it("不接 provider_id，系统写死 new-api", () => {
    const parsed = parseModelCreateBody({
      model_id: "gpt-image-2",
      capability_type: "image",
      model_label: "GPT Image 2",
      icon: null,
      channel: "gpt-image",
      request_mapping: { matrix: { "1k": { "1:1": "1024x1024" } } },
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: { provider_id: "new-api", channel: "gpt-image" },
    });
  });

  it("客户端传入的 provider_id 被忽略", () => {
    const parsed = parseModelCreateBody({
      provider_id: "volcengine",
      model_id: "gpt-image-2",
      capability_type: "image",
      model_label: "GPT",
      icon: null,
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: { provider_id: "new-api", channel: "seedream-image" },
    });
  });

  it("拒绝未知渠道", () => {
    const parsed = parseModelCreateBody({
      model_id: "x",
      capability_type: "image",
      model_label: "x",
      icon: null,
      channel: "jsonpath",
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("渠道(channel)只支持");
  });

  it("★ 已退役的 channel_parser 传了也不认（它不是入参，避免两个事实源）", () => {
    const parsed = parseModelCreateBody({
      model_id: "x",
      capability_type: "image",
      model_label: "x",
      icon: null,
      channel_parser: "gpt",
    });
    expect(parsed).toMatchObject({ ok: true, value: { channel: "seedream-image" } });
    if (parsed.ok) expect("channel_parser" in parsed.value).toBe(false);
  });

  it("★ 媒体闸门：渠道的媒介必须与行的类型一致（视频行不能配图片渠道）", () => {
    const parsed = parseModelCreateBody({
      model_id: "seedance-2-5",
      capability_type: "video",
      model_label: "Seedance 2.5",
      icon: null,
      channel: "gpt-image",
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("gpt-image");
  });

  it("★ 视频行不配渠道 → 落到该媒介的缺省渠道（不是图片渠道）", () => {
    expect(
      parseModelCreateBody({
        model_id: "seedance-2-5",
        capability_type: "video",
        model_label: "Seedance 2.5",
        icon: null,
      }),
    ).toMatchObject({ ok: true, value: { channel: "seedream-video" } });
  });

  it("GPT 交叉格拒绝非官方 size", () => {
    const parsed = parseModelCreateBody({
      model_id: "gpt-image-2",
      capability_type: "image",
      model_label: "GPT",
      icon: null,
      channel: "gpt-image",
      request_mapping: { matrix: { "1k": { "1:1": "1K" } } },
    });
    expect(parsed.ok).toBe(false);
  });
});

describe("时长形态闸门（IKG4UR）", () => {
  const base = {
    model_id: "doubao-seedance-2-5-260628",
    capability_type: "video",
    model_label: "Seedance 2.5",
    icon: null,
  };

  it("create/update：对象形态 {min,max,step} 放行——后台按原形态写回才不会被 400 顶回", () => {
    expect(parseModelCreateBody({ ...base, supported_durations: { min: 4, max: 30, step: 1 } }))
      .toMatchObject({ ok: true, value: { supported_durations: { min: 4, max: 30, step: 1 } } });
    expect(parseModelUpdateBody({ supported_durations: { min: 4, max: 30 } }))
      .toMatchObject({ ok: true, value: { supported_durations: { min: 4, max: 30 } } });
  });

  it("create：数组形态与 null 仍然放行（旧行为不变）", () => {
    expect(parseModelCreateBody({ ...base, supported_durations: [5, 10] }))
      .toMatchObject({ ok: true, value: { supported_durations: [5, 10] } });
    expect(parseModelCreateBody({ ...base, supported_durations: null }))
      .toMatchObject({ ok: true, value: { supported_durations: null } });
  });

  it("create：非法对象被拒——min/max 非数字、负值、min>max、step<=0、非对象", () => {
    for (const bad of [
      { min: "4", max: 30 },
      { min: 4 },
      { min: -1, max: 30 },
      { min: 30, max: 4 },
      { min: 4, max: 30, step: 0 },
      "4-30",
    ]) {
      const parsed = parseModelCreateBody({ ...base, supported_durations: bad });
      expect(parsed.ok).toBe(false);
    }
  });

  it("create：非法数组被拒——这些形态会造出「滑杆消失 + 全时长 400」的坏行", () => {
    for (const bad of [
      [], // [].includes(d) 恒 false → 该模型任何时长都被拒
      [5], // 滑杆消失，只有 5 能过
      [30, 4], // max<min → toDurationRange 返回 null、durationInRange 恒 false
      [-1, 30], // -1 是「智能时长」哨兵，不是区间端点
      [5, 30, 0], // step 0 会把滑杆钉死在 min
      [5, 30, -1],
    ]) {
      const parsed = parseModelCreateBody({ ...base, supported_durations: bad });
      expect(parsed.ok).toBe(false);
    }
  });

  it("create：合法数组仍放行（存量历史形态，读侧按 [min,max,step] 解析）", () => {
    for (const good of [
      [5, 10],
      [4, 30, 1],
    ]) {
      const parsed = parseModelCreateBody({ ...base, supported_durations: good });
      expect(parsed.ok).toBe(true);
    }
  });
});

describe("parseModelUpdateBody", () => {
  // IKHEXG：default_size / default_aspect_ratio 是 NOT NULL（VarChar）列，「未配」的形态是空串。
  // 表单对非图片/视频行恒发 null（清空尺寸框的图片行也发 null），旧闸门只收字符串
  // → 音频/文生文行从后台保存必然 400（实测 PUT /api/admin/models/23）。
  it("default_size / default_aspect_ratio 收 null，归一为空串（NOT NULL 列）", () => {
    const parsed = parseModelUpdateBody({
      default_size: null,
      default_aspect_ratio: null,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.default_size).toBe("");
    expect(parsed.value.default_aspect_ratio).toBe("");
  });

  it("default_size / default_aspect_ratio 仍拒非字符串非 null（防脏值落库）", () => {
    for (const bad of [5, true, [], {}]) {
      expect(parseModelUpdateBody({ default_size: bad }).ok).toBe(false);
      expect(parseModelUpdateBody({ default_aspect_ratio: bad }).ok).toBe(false);
    }
  });

  it("default_size / default_aspect_ratio 超长仍被拒（列宽 32 / 16）", () => {
    expect(parseModelUpdateBody({ default_size: "x".repeat(33) }).ok).toBe(false);
    expect(parseModelUpdateBody({ default_aspect_ratio: "x".repeat(17) }).ok).toBe(false);
  });

  // IKHEXG：上面把两个值提到了 `if` 外面算（为了让返回值用归一后的值），于是「字段缺席」与
  // 「字段清空」只差 spread 上那个 `body.default_size !== undefined` 的守卫。少了这条钉子，
  // 日后顺手把守卫删掉，**每次更新都会写一遍空串**，把所有行的默认尺寸静默清掉。
  it("未携带该字段 → 不提交（缺席 ≠ 清空）", () => {
    const parsed = parseModelUpdateBody({ model_label: "新名字" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("default_size" in parsed.value).toBe(false);
    expect("default_aspect_ratio" in parsed.value).toBe(false);
  });

  it("真实改动仍原样提交（往返不被吞掉）", () => {
    const parsed = parseModelUpdateBody({
      default_size: "2K",
      default_aspect_ratio: "16:9",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.default_size).toBe("2K");
    expect(parsed.value.default_aspect_ratio).toBe("16:9");
  });

  it("更新为 gpt 时必须带 request_mapping", () => {
    const parsed = parseModelUpdateBody(
      { channel: "gpt-image" },
      { capability_type: "image", channel: "seedream-image" },
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toBe("request_mapping 不能为空");
  });

  // IKH BDO：更新是 diff 提交，没改过的渠道不在 body 里，映射校验必须按**库中该行**的
  // 渠道判定，否则整段校验被跳过（脏值直接落库）。
  it("库中 gpt 行：只改展示名（不带 mapping）→ 放行，且不提交 mapping", () => {
    const parsed = parseModelUpdateBody(
      { model_label: "新名字" },
      { capability_type: "image", channel: "gpt-image" },
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect("request_mapping" in parsed.value).toBe(false);
  });

  it("库中 gpt 行：显式清空 mapping（null）→ 拒绝", () => {
    expect(
      parseModelUpdateBody(
        { request_mapping: null },
        { capability_type: "image", channel: "gpt-image" },
      ).ok,
    ).toBe(false);
  });

  it("库中 gpt 行：空交叉格 {matrix:{}} → 拒绝（落库后该模型每次请求都 400）", () => {
    expect(
      parseModelUpdateBody(
        { request_mapping: { matrix: {} } },
        { capability_type: "image", channel: "gpt-image" },
      ).ok,
    ).toBe(false);
  });

  it("库中 seedream 行：mapping 传 null 视为「不改」，不透传给 repo", () => {
    const parsed = parseModelUpdateBody(
      { model_label: "x", request_mapping: null },
      { capability_type: "image", channel: "seedream-image" },
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect("request_mapping" in parsed.value).toBe(false);
  });

  it("库中 seedream 行：mapping 传对象 → 原样写入", () => {
    const matrix = { matrix: { "1K": { "1:1": "1024x1024" } } };
    const parsed = parseModelUpdateBody(
      { request_mapping: matrix },
      { capability_type: "image", channel: "seedream-image" },
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.request_mapping).toEqual(matrix);
  });

  // 「null 视为不改」只对**本来就是 seedream** 的行成立。从 gpt 切到 seedream 时，
  // 那个 null 就是「gpt 矩阵不再适用」的唯一表达——照「不改」处理会把上一族的矩阵
  // 留在行里，worker 拿它去算 seedream 尺寸，而界面没有任何入口能清掉。
  it("库中 gpt 行：切到 seedream 且 mapping 传 null → 照实清空，不留上一族的矩阵", () => {
    const parsed = parseModelUpdateBody(
      { channel: "seedream-image", request_mapping: null },
      { capability_type: "image", channel: "gpt-image" },
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.channel).toBe("seedream-image");
      expect(parsed.value.request_mapping).toBeNull();
    }
  });

  // IKH BDO：闸门此前只覆盖 9 个键，能力行主流键任意类型都能入库。
  it("features 闸门补键：脏类型 → 拒绝", () => {
    const dirty = [
      { image_reference_max: "abc" },
      { image_reference_max: 1.5 },
      { quantity_max: 1.5 },
      { quantity_max: 0 },
      { reference_image: "yes" },
      { watermark: 1 },
      { audio: "true" },
      { tools: "no" },
      { first_frame: 0 },
      { last_frame: 1 },
      { first_last_frame: [] },
      { sequential_image_generation: "x" },
      { stream: "x" },
    ];
    for (const features of dirty) {
      expect(parseModelUpdateBody({ features }).ok).toBe(false);
    }
  });

  it("features 闸门补键：合法值与 camelCase 键形 → 放行", () => {
    expect(
      parseModelUpdateBody({
        features: {
          image_reference_max: 14,
          quantity_max: 10,
          reference_image: true,
          watermark: false,
          audio: true,
          tools: true,
          first_frame: true,
          first_last_frame: false,
          sequential_image_generation: false,
          stream: false,
          image_protocol: "openai-images",
          imageReferenceMax: 14,
          quantityMax: 10,
          imageProtocol: "inline-image",
        },
      }).ok,
    ).toBe(true);
  });
});

// IKESD6 / ADR-0085：features 扩展键写侧闸门（读侧宽容降级，写侧必须拒绝脏类型）。
describe("features 扩展键闸门（i2i_model_name / max_prompt_length）", () => {
  const createBase = {
    model_id: "gpt-image-2-x",
    capability_type: "image",
    model_label: "GPT",
    icon: null,
  };

  it("create：合法两新键通过", () => {
    const parsed = parseModelCreateBody({
      ...createBase,
      features: { i2i_model_name: "gpt-image-2-edit", max_prompt_length: 32000 },
    });
    expect(parsed.ok).toBe(true);
  });

  it("create：别名空串 / 非字符串 → 拒绝", () => {
    expect(
      parseModelCreateBody({ ...createBase, features: { i2i_model_name: " " } })
        .ok,
    ).toBe(false);
    expect(
      parseModelCreateBody({ ...createBase, features: { i2i_model_name: 42 } })
        .ok,
    ).toBe(false);
  });

  it("create：max_prompt_length 非正整数 / 越界 → 拒绝", () => {
    for (const bad of [0, -1, 1.5, "32000", 65536]) {
      expect(
        parseModelCreateBody({
          ...createBase,
          features: { max_prompt_length: bad },
        }).ok,
      ).toBe(false);
    }
  });

  it("update：camelCase 键形同样受闸门约束；null 放行（清除配置）", () => {
    expect(
      parseModelUpdateBody({ features: { maxPromptLength: 0 } }).ok,
    ).toBe(false);
    expect(
      parseModelUpdateBody({
        features: { i2i_model_name: null, max_prompt_length: null },
      }).ok,
    ).toBe(true);
  });

  it("未知 features 键不受约束（行为袋向后兼容）", () => {
    const parsed = parseModelCreateBody({
      ...createBase,
      features: { some_future_flag: true },
    });
    expect(parsed.ok).toBe(true);
  });
});

describe("seedream 矩阵键闸门（写侧）", () => {
  const SIZES = [
    { id: "1k", label: "1K", api_value: "1K" },
    { id: "2k", label: "2K", api_value: "2K" },
  ];

  it("create：矩阵键不是任何档位的 api_value/id → 400", () => {
    const parsed = parseModelCreateBody({
      model_id: "doubao-seedream-5-0-pro-260628",
      capability_type: "image",
      model_label: "Seedream 5.0 Pro",
      channel: "seedream-image",
      supported_sizes: SIZES,
      request_mapping: { matrix: { "2": { "1:1": "2048x2048" } } },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("api_value");
  });

  it("create：键对得上 → 放行", () => {
    const parsed = parseModelCreateBody({
      model_id: "doubao-seedream-5-0-pro-260628",
      capability_type: "image",
      model_label: "Seedream 5.0 Pro",
      channel: "seedream-image",
      supported_sizes: SIZES,
      request_mapping: { matrix: { "2k": { "1:1": "2048x2048" } } },
    });
    expect(parsed.ok).toBe(true);
  });

  // ⚠️ 更新是 diff 提交：没改过的 supported_sizes 不在 body 里。少了这个回落，
  //    「只改矩阵」的保存会因为拿不到档位而跳过校验 —— 闸门形同虚设。
  it("★ update：body 没带 supported_sizes 时回落到**库中那一行**的档位", () => {
    const parsed = parseModelUpdateBody(
      { request_mapping: { matrix: { "2": { "1:1": "2048x2048" } } } },
      { capability_type: "image", channel: "seedream-image", supported_sizes: SIZES },
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("api_value");
  });

  it("update：库里那一行的档位也对不上、但请求体给了新档位 → 按请求体判", () => {
    const parsed = parseModelUpdateBody(
      {
        supported_sizes: SIZES,
        request_mapping: { matrix: { "2k": { "1:1": "2048x2048" } } },
      },
      { capability_type: "image", channel: "seedream-image", supported_sizes: [{ id: "旧档" }] },
    );
    expect(parsed.ok).toBe(true);
  });
});

/* ── R4：按渠道收窄写闸门之后，**库里现有的每一条规则都还得存得回去** ──────────────
 *
 * 下面这七份 `pricing` 是 2026-09-26 从开发库 `blue_whale.generation_model_capability`
 * 里逐字抄出来的（19 行去重到 7 种形态，其余 6 行 pricing 为 NULL、走 diff 提交不校验）。
 *
 * 为什么必须有这一条：收窄闸门的产物是「保存被拒」，而运营打开一个模型、什么都没改、
 * 点保存就被拒，是他们完全无从下手的一种故障。改闸门之前先拿真实数据跑一遍，是这件事
 * 唯一的预防手段。
 *
 * ⚠️ 加渠道 / 加计价形态时，**先把新形态的真实行补进来再改闸门**。
 */
describe("★ R4：库里现有规则的形态全部通过按渠道的写闸门", () => {
  /** 销售侧真实行的 ( capability_type, channel, pricing )；pricing 逐字抄自库。 */
  const EXISTING: Array<{
    type: "image" | "video" | "text" | "audio";
    channel: string;
    model: string;
    pricing: Record<string, unknown>;
  }> = [
    {
      type: "image",
      channel: "seedream-image",
      model: "doubao-seedream-5-0-260128",
      // 2026-09-26 起：官方 0.22 元/张，按**张**收、与尺寸无关（见迁移 044）。
      // 原值挂在 `by:["size"]` 上但三档填同一个数 —— 那根轴没有读方。
      pricing: {
        baseUnit: "usage.succeededSlots",
        basePrice: { kind: "const", value: 3300 },
        minCredits: 1,
        unitDenominator: 1,
      },
    },
    {
      type: "image",
      channel: "seedream-image",
      model: "doubao-seedream-5-0-pro-260628",
      // 2026-09-26 起：输出图按像素分档（0.3 / 0.6 元）+ 参考图**首张免费、第 2 张起 0.02 元/张**
      // （迁移 045）。`dimPrices` 就是为第二项加的 —— `dims` 是相对量，表达不了
      // 「与 basePrice 无关的固定单价」：同一个 0.02 元在 0.3 / 0.6 两档下是同一个数。
      pricing: {
        baseUnit: "usage.succeededSlots",
        basePrice: {
          by: ["size"],
          kind: "table",
          table: { "size=1k": 4500, "size=1.5k": 4500, "size=2k": 9000 },
        },
        dimPrices: { "usage.referenceCount": { unitMc: 300, firstFree: true } },
        minCredits: 1,
        unitDenominator: 1,
      },
    },
    {
      type: "image",
      channel: "seedream-image",
      model: "doubao-seedream-4-5-251128",
      pricing: {
        baseUnit: "constant:1",
        basePrice: { kind: "const", value: 30000 },
        minCredits: 1,
        unitDenominator: 1,
      },
    },
    {
      type: "video",
      channel: "seedream-video",
      model: "doubao-seedance-2-0-260128",
      pricing: {
        baseUnit: "usage.c",
        basePrice: {
          by: ["resolution", "video"],
          kind: "table",
          table: { "resolution=4k|video=0": 390000, "resolution=480p|video=1": 420000 },
        },
        minCredits: 1,
        tokenEstimate: { fps: 24, divisor: 1024 },
      },
    },
    {
      type: "text",
      channel: "seedream-text",
      model: "MiniMax-M3",
      pricing: { baseUnit: "constant:1", basePrice: { kind: "const", value: 10000 }, minCredits: 1, unitDenominator: 1 },
    },
    {
      type: "audio",
      channel: "seedream-audio",
      model: "seed-audio-1.0",
      // 2026-09-26 起改为按**产出秒数**（官方 0.3 元/分钟 → 75 mc/秒，见迁移 043）。
      // ⚠️ maxCredits 是**必配项**不是调优项：音频时长提交时刻取不到，没有上限
      //    billing 就每次拒单 —— 下面有一组专门钉这条的断言。
      pricing: {
        baseUnit: "usage.seconds",
        basePrice: { kind: "const", value: 75 },
        minCredits: 1,
        unitDenominator: 1,
        maxCredits: 12,
      },
    },
    {
      type: "image",
      channel: "gpt-image-openai",
      model: "gpt-image-2",
      pricing: { baseUnit: "constant:1", basePrice: { kind: "const", value: 30000 }, minCredits: 1, unitDenominator: 1 },
    },
    {
      type: "image",
      channel: "banana-image",
      model: "nano-banana-2-t2i",
      pricing: { baseUnit: "constant:1", basePrice: { kind: "const", value: 30000 }, minCredits: 1, unitDenominator: 1 },
    },
  ];

  it.each(EXISTING)("$model（$channel）原样保存 → 放行", ({ type, channel, pricing }) => {
    const parsed = parseModelUpdateBody(
      { pricing },
      { capability_type: type, channel },
    );
    expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
  });

  it("★ 新增一行时走的是同一条闸门（create 路径同样放行）", () => {
    const { pricing } = EXISTING[2]!;
    expect(
      parseModelCreateBody({
        model_id: "doubao-seedance-2-5-260628",
        capability_type: "video",
        model_label: "Seedance 2.5",
        channel: "seedream-video",
        pricing,
      }).ok,
    ).toBe(true);
  });
});

describe("★ 按渠道收窄计价形状（形状，不是金额）", () => {
  const tokenPricing = {
    baseUnit: "usage.c",
    basePrice: { kind: "const", value: 100 },
    tokenEstimate: { divisor: 1024, fps: 24 },
  };
  const plainPricing = { baseUnit: "constant:1", basePrice: { kind: "const", value: 30000 } };

  const update = (pricing: unknown, type: "image" | "video", channel: string) =>
    parseModelUpdateBody({ pricing }, { capability_type: type, channel });

  it("★ 图片渠道不许带 tokenEstimate（配了也没人读）", () => {
    const parsed = update(tokenPricing, "image", "seedream-image");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("只在视频渠道上成立");
  });

  it("★ 视频渠道照常放行（这条规则本来就是视频的）", () => {
    expect(update(tokenPricing, "video", "seedream-video").ok).toBe(true);
  });

  it("★ unitDenominator ≠ 1 必须与 tokenEstimate 同时出现（否则单价缩小一百万倍）", () => {
    const parsed = update(
      { ...plainPricing, unitDenominator: 1000000 },
      "image",
      "seedream-image",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("unitDenominator");
  });

  it("★ tokenEstimate 是封闭形状：退役的键（dimensions）存不进去", () => {
    const parsed = update(
      { ...tokenPricing, tokenEstimate: { divisor: 1024, fps: 24, dimensions: { "a": "1x1" } } },
      "video",
      "seedream-video",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("dimensions");
  });

  it("★ 渠道未知（历史行 / 未迁移行）→ 整段跳过，不因此拦下运营的编辑", () => {
    expect(parseModelUpdateBody({ pricing: tokenPricing }).ok).toBe(true);
    expect(parseModelUpdateBody({ pricing: tokenPricing }, { capability_type: "video" }).ok).toBe(true);
  });

  /* ── 按秒计价的音频：maxCredits 不是可选项 ────────────────────────────────────
   *
   * 音频时长在提交时刻**取不到**（TTS 由文案决定，请求里没有 duration），
   * billing 只有「规则配了上限」才转「按上限冻结、结算按实际重算」——
   * 没配上限的后果不是少收，是**这个模型每一次提交都被拒**（UNPRICEABLE 400）。
   * 运营看到的会是「音频功能坏了」，根因却在一段 JSON 里，所以在这里当场拦住。 */
  const audioPricing = {
    baseUnit: "usage.seconds",
    basePrice: { kind: "const", value: 75 },
    minCredits: 1,
    unitDenominator: 1,
    maxCredits: 12,
  };
  const audioUpdate = (pricing: unknown) =>
    parseModelUpdateBody({ pricing }, { capability_type: "audio", channel: "seedream-audio" });

  it("★ 音频按秒 + 配了 maxCredits → 放行", () => {
    expect(audioUpdate(audioPricing).ok).toBe(true);
  });

  it("★ 音频按秒 + 漏配 maxCredits → 拒，且说清「每次提交都会被拒」", () => {
    const { maxCredits: _omitted, ...withoutCap } = audioPricing;
    const parsed = audioUpdate(withoutCap);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("maxCredits");
  });

  it("★ 别的媒介按秒计价不受这条限制（只有音频的时长是提交时刻结构性取不到的）", () => {
    // 视频的 usage.seconds 是契约量（edit/prolong 的 duration=-1 是**这次**取不到，
    // 不是结构性取不到），它与 tokenEstimate 一起工作，不走这条闸门。
    const parsed = update(
      { baseUnit: "usage.seconds", basePrice: { kind: "const", value: 1 }, unitDenominator: 1 },
      "video",
      "seedream-video",
    );
    expect(parsed.ok).toBe(true);
  });

  /* ── dimPrices：维度的**绝对**加价（Seedream 5.0 Pro 的参考图按张收费）──────────
   *
   * 它存在的理由只有一个：`dims` 是**相对**量（金额 = 万分比 × basePrice），
   * 所以「每个单位 0.02 元」在 basePrice 分档的规则里表达不了 —— 两档要两个万分比。
   * 绝对加价与 basePrice 解耦，两档下都是 300 mc。 */
  const withDimPrices = (dimPrices: unknown, extra: Record<string, unknown> = {}) => ({
    baseUnit: "usage.succeededSlots",
    basePrice: { kind: "const", value: 3000 },
    unitDenominator: 1,
    minCredits: 1,
    dimPrices,
    ...extra,
  });
  const imageUpdate = (pricing: unknown) =>
    parseModelUpdateBody({ pricing }, { capability_type: "image", channel: "seedream-image" });

  it("★ 合法形态放行（钉住真实那条的键与形状）", () => {
    const parsed = imageUpdate(
      withDimPrices({ "usage.referenceCount": { unitMc: 300, firstFree: true } }),
    );
    expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
  });

  it("★ unitMc 必须是**正**整数 —— 0 与负数都拒", () => {
    // 0 等于「这个维度免费」，而免费应当由「不写这个维度」表达：
    // 写一个 0 出来，下一个读配置的人只会当成配漏了。
    for (const bad of [0, -300, 12.5]) {
      const parsed = imageUpdate(withDimPrices({ "usage.referenceCount": { unitMc: bad } }));
      expect(parsed.ok, `unitMc=${bad} 应当被拒`).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain("unitMc");
    }
  });

  it("★ 维度键必须在基准维度白名单里", () => {
    const parsed = imageUpdate(withDimPrices({ "usage.nosuchDim": { unitMc: 300 } }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("dimPrices");
  });

  it("★ firstFree 只能是布尔（缺省 = 不免费）", () => {
    expect(imageUpdate(withDimPrices({ "usage.referenceCount": { unitMc: 300 } })).ok).toBe(true);
    const parsed = imageUpdate(
      withDimPrices({ "usage.referenceCount": { unitMc: 300, firstFree: "yes" } }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("firstFree");
  });

  it("★ dimPrices 与 maxCredits 互斥 —— 同时配会让结算超出预扣并记应收（少收且静默）", () => {
    // 上限计价（capDetailed）跳过用量计算，算不到这份绝对加价 ⇒ 预扣冻的是一份
    // **不含加价**的上限，而结算会把加价算进去。这条在闸门与 billing 的 CompiledRule
    // 构造里各拦一次（两道，因为脏配置可能绕过写闸门直接改库进来）。
    const parsed = imageUpdate(
      withDimPrices({ "usage.referenceCount": { unitMc: 300, firstFree: true } }, { maxCredits: 50 }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("maxCredits");
  });
});
