import { describe, expect, it } from "vitest";

import {
  availableAspectRatiosForSize,
  mapImageChannelRequest,
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
