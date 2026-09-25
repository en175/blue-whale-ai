import { describe, expect, it } from "vitest";

import {
  availableAspectRatiosForSize,
  mapImageChannelRequest,
  validateRequestMapping,
} from "./image-channel-parser.js";

/** 工单 IKDBYY 灌数：GPT 全量交叉格。空串 = 未填。 */
const GPT_FULL_MATRIX = {
  "1k": {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "4:3": "1536x1024",
    "3:4": "1024x1536",
  },
  "2k": {
    "1:1": "2048x2048",
    "16:9": "2048x1152",
    "9:16": "1152x2048",
    "3:2": "2048x1360",
    "2:3": "1360x2048",
    "4:3": "2048x1536",
    "3:4": "1536x2048",
    "21:9": "2048x880",
  },
  "4k": {
    "16:9": "3840x2160",
    "9:16": "2160x3840",
  },
} as const;

describe("mapImageChannelRequest gpt", () => {
  const gpt = {
    parser: "gpt" as const,
    matrix: GPT_FULL_MATRIX,
    defaultSizeId: "1k",
    defaultRatioId: "1:1",
  };

  it("1K+1:1 写入 1024x1024", () => {
    expect(mapImageChannelRequest(gpt, "1k", "1:1")).toEqual({
      ok: true,
      size: "1024x1024",
    });
  });

  it("2K+16:9 写入 2048x1152，不钳回 1K", () => {
    expect(mapImageChannelRequest(gpt, "2k", "16:9")).toEqual({
      ok: true,
      size: "2048x1152",
    });
  });

  it("1K+16:9 空格回退默认交叉格 1K×1:1", () => {
    expect(mapImageChannelRequest(gpt, "1k", "16:9")).toEqual({
      ok: true,
      size: "1024x1024",
    });
  });

  it("请求格与默认交叉格都空则拒绝，不直传展示字符串", () => {
    const emptyDefault = {
      parser: "gpt" as const,
      matrix: { "1k": { "16:9": "2048x1152" } },
      defaultSizeId: "1k",
      defaultRatioId: "1:1",
    };
    expect(mapImageChannelRequest(emptyDefault, "1k", "21:9")).toEqual({
      ok: false,
      code: "empty_mapping",
    });
  });
});

describe("mapImageChannelRequest banana", () => {
  const banana = {
    parser: "banana" as const,
    quality: { "1k": "1k", "2k": "2k", "4k": "4k" },
    size: { "1:1": "1x1", "16:9": "16x9" },
    defaultSizeId: "1k",
    defaultRatioId: "1:1",
  };

  it("1K+1:1 写入 quality=1k 且 size=1x1", () => {
    expect(mapImageChannelRequest(banana, "1k", "1:1")).toEqual({
      ok: true,
      size: "1x1",
      quality: "1k",
    });
  });

  it("缺尺寸映射时回退默认尺寸的 quality", () => {
    expect(mapImageChannelRequest(banana, "missing", "16:9")).toEqual({
      ok: true,
      size: "16x9",
      quality: "1k",
    });
  });

  it("默认 quality 也空则拒绝", () => {
    const empty = {
      parser: "banana" as const,
      quality: {},
      size: { "1:1": "1x1" },
      defaultSizeId: "1k",
      defaultRatioId: "1:1",
    };
    expect(mapImageChannelRequest(empty, "1k", "1:1")).toEqual({
      ok: false,
      code: "empty_mapping",
    });
  });
});

describe("availableAspectRatiosForSize", () => {
  const configured = ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "21:9"];

  it("GPT 全量 1K 不露出未填的 16:9 / 9:16", () => {
    expect(
      availableAspectRatiosForSize(
        {
          parser: "gpt",
          matrix: GPT_FULL_MATRIX,
          defaultSizeId: "1k",
          defaultRatioId: "1:1",
        },
        "1k",
        configured,
      ),
    ).toEqual(["1:1", "3:2", "2:3", "4:3", "3:4"]);
  });

  it("GPT 全量 2K 露出已填的 16:9", () => {
    expect(
      availableAspectRatiosForSize(
        {
          parser: "gpt",
          matrix: GPT_FULL_MATRIX,
          defaultSizeId: "1k",
          defaultRatioId: "1:1",
        },
        "2k",
        configured,
      ),
    ).toContain("16:9");
  });

  it("GPT light 格子填 auto 仍按已填组合展示", () => {
    expect(
      availableAspectRatiosForSize(
        {
          parser: "gpt",
          matrix: { "1k": { "1:1": "auto", "16:9": "auto" } },
          defaultSizeId: "1k",
          defaultRatioId: "1:1",
        },
        "1k",
        configured,
      ),
    ).toEqual(["1:1", "16:9"]);
  });

  it("seedream 不读目录交叉格，配置过的比例全部可用", () => {
    expect(
      availableAspectRatiosForSize({ parser: "seedream" }, "1k", [
        "1:1",
        "16:9",
      ]),
    ).toEqual(["1:1", "16:9"]);
  });
});

/* ── seedream 矩阵键的写侧闸门 ────────────────────────────────────────────────
 *
 * worker 的查找链是「按 id 命中 supported_sizes 条目 → 取 api_value 当 providerSize
 * → 用它当矩阵查找键」，所以键的拼写错了这一档就解不出尺寸（上游 400 Invalid size），
 * 而界面上看不出异常。实测漏过一次（`2` / `1.5` 这种既不是 id 也不是 api_value 的陈旧键），
 * 根因是本函数此前对 seedream 直接 `return null` —— 完全不校验。
 */
describe("validateRequestMapping seedream 矩阵键", () => {
  /** 5.0 Pro 的能力行形态：id 与 api_value 只有大小写差异。 */
  const SIZES = [
    { id: "1k", label: "1K", api_value: "1K" },
    { id: "1.5k", label: "1.5K", api_value: "1.5K" },
    { id: "2k", label: "2K", api_value: "2K" },
  ];

  it("键等于 api_value：放行（大小写不敏感）", () => {
    expect(
      validateRequestMapping(
        "seedream",
        { matrix: { "1K": { "1:1": "1024x1024" }, "2k": { "1:1": "2048x2048" } } },
        SIZES,
      ),
    ).toBeNull();
  });

  it("★ 陈旧拼写（既不是 id 也不是 api_value）：拒绝，且报错点出那个键", () => {
    const error = validateRequestMapping(
      "seedream",
      { matrix: { "1k": { "1:1": "1024x1024" }, "2": { "1:1": "2048x2048" } } },
      SIZES,
    );
    expect(error).toContain("2");
    expect(error).toContain("api_value");
  });

  it("api_value 缺失时回落 id", () => {
    expect(
      validateRequestMapping("seedream", { matrix: { "1k": { "1:1": "1024x1024" } } }, [
        { id: "1k", label: "1K" },
      ]),
    ).toBeNull();
  });

  it("拿不到 supported_sizes 时不拦（宁可不查，也不把正常保存拦死）", () => {
    expect(
      validateRequestMapping("seedream", { matrix: { 任意: { "1:1": "1x1" } } }),
    ).toBeNull();
  });

  it("矩阵横排不是对象：拒绝", () => {
    expect(
      validateRequestMapping("seedream", { matrix: { "1k": "1024x1024" } }, SIZES),
    ).toContain("须为对象");
  });

  it("没有 matrix（或整个 mapping 为空）：放行 —— seedream 的矩阵是可选的", () => {
    expect(validateRequestMapping("seedream", null, SIZES)).toBeNull();
    expect(validateRequestMapping("seedream", {}, SIZES)).toBeNull();
  });
});
