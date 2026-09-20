import { describe, expect, it } from "vitest";

import { parseModelCreateBody, parseModelUpdateBody } from "./constants.js";

describe("parseModelCreateBody", () => {
  it("不接 provider_id，系统写死 new-api", () => {
    const parsed = parseModelCreateBody({
      model_id: "gpt-image-2",
      capability_type: "image",
      model_label: "GPT Image 2",
      icon: null,
      channel_parser: "gpt",
      request_mapping: { matrix: { "1k": { "1:1": "1024x1024" } } },
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: { provider_id: "new-api", channel_parser: "gpt" },
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
      value: { provider_id: "new-api", channel_parser: "seedream" },
    });
  });

  it("拒绝未知解析器", () => {
    const parsed = parseModelCreateBody({
      model_id: "x",
      capability_type: "image",
      model_label: "x",
      icon: null,
      channel_parser: "jsonpath",
    });
    expect(parsed.ok).toBe(false);
  });

  it("GPT 交叉格拒绝非官方 size", () => {
    const parsed = parseModelCreateBody({
      model_id: "gpt-image-2",
      capability_type: "image",
      model_label: "GPT",
      icon: null,
      channel_parser: "gpt",
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
  it("更新为 gpt 时必须带 request_mapping", () => {
    const parsed = parseModelUpdateBody({
      channel_parser: "gpt",
    });
    expect(parsed.ok).toBe(false);
  });

  // IKH BDO：更新是 diff 提交，没改过的 channel_parser 不在 body 里，映射校验
  // 必须按**库中该行**的解析器判定，否则整段校验被跳过（脏值直接落库）。
  it("库中 gpt 行：只改展示名（不带 mapping）→ 放行，且不提交 mapping", () => {
    const parsed = parseModelUpdateBody(
      { model_label: "新名字" },
      { channel_parser: "gpt" },
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect("request_mapping" in parsed.value).toBe(false);
  });

  it("库中 gpt 行：显式清空 mapping（null）→ 拒绝", () => {
    expect(
      parseModelUpdateBody(
        { request_mapping: null },
        { channel_parser: "gpt" },
      ).ok,
    ).toBe(false);
  });

  it("库中 gpt 行：空交叉格 {matrix:{}} → 拒绝（落库后该模型每次请求都 400）", () => {
    expect(
      parseModelUpdateBody(
        { request_mapping: { matrix: {} } },
        { channel_parser: "gpt" },
      ).ok,
    ).toBe(false);
  });

  it("库中 seedream 行：mapping 传 null 视为「不改」，不透传给 repo", () => {
    const parsed = parseModelUpdateBody(
      { model_label: "x", request_mapping: null },
      { channel_parser: "seedream" },
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect("request_mapping" in parsed.value).toBe(false);
  });

  it("库中 seedream 行：mapping 传对象 → 原样写入", () => {
    const matrix = { matrix: { "1K": { "1:1": "1024x1024" } } };
    const parsed = parseModelUpdateBody(
      { request_mapping: matrix },
      { channel_parser: "seedream" },
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.request_mapping).toEqual(matrix);
  });

  // IKH BDO：闸门此前只覆盖 9 个键，能力行主流键任意类型都能入库。
  it("features 闸门补键：脏类型 → 拒绝", () => {
    const dirty = [
      { max_reference_images: "abc" },
      { max_reference_images: 1.5 },
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
      { image_protocol: 42 },
      { image_protocol: "  " },
    ];
    for (const features of dirty) {
      expect(parseModelUpdateBody({ features }).ok).toBe(false);
    }
  });

  it("features 闸门补键：合法值与 camelCase 键形 → 放行", () => {
    expect(
      parseModelUpdateBody({
        features: {
          max_reference_images: 14,
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
          maxReferenceImages: 14,
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
