// IKE7JP：生成参数对能力目录的结构性校验测试（纯函数）。
// 覆盖视频（resolution + aspect_ratio + duration）与图片（size + aspect_ratio）两条提交路径，
// 以及时长档位数组 / {min,max,step} 范围两种 DB 形态。
import { describe, expect, it } from "vitest";

import {
  checkGenerationParamLimit,
  toGenerationParamCheckInput,
  type CapabilityLimitInput,
} from "./capability-param-validation.js";

/** 视频能力行（分辨率档 id + api_value，时长范围）。 */
const videoCapability: CapabilityLimitInput = {
  supported_sizes: [
    { id: "1k", api_value: "720p" },
    { id: "2k", api_value: "1080p" },
    { id: "4k", api_value: "2160p" },
  ],
  supported_aspect_ratios: ["16:9", "9:16", "1:1"],
  supported_durations: { min: 5, max: 10, step: 5 },
};

/** 图片能力行（尺寸档 id + api_value，无时长）。 */
const imageCapability: CapabilityLimitInput = {
  supported_sizes: [
    { id: "1k", api_value: "1024x1024" },
    { id: "2k", api_value: "2048x2048" },
  ],
  supported_aspect_ratios: ["1:1", "16:9"],
  supported_durations: null,
};

describe("checkGenerationParamLimit", () => {
  it("视频合法参数通过（resolution 命中 api_value）", () => {
    expect(
      checkGenerationParamLimit(videoCapability, {
        size: "1080p",
        aspect_ratio: "16:9",
        duration: 5,
      }),
    ).toBeNull();
  });

  it("视频尺寸档 id 命中同样通过（Dock 传 resolution=api_value / size=id 归一）", () => {
    expect(
      checkGenerationParamLimit(videoCapability, {
        size: "2k",
        aspect_ratio: "16:9",
        duration: 5,
      }),
    ).toBeNull();
  });

  it("分辨率越界：返回带可用值的 size 失败原因", () => {
    const failure = checkGenerationParamLimit(videoCapability, {
      size: "8k",
      aspect_ratio: "16:9",
      duration: 5,
    });
    expect(failure?.field).toBe("size");
    expect(failure?.reason).toContain("8k");
    expect(failure?.reason).toContain("720p");
  });

  it("比例越界：返回带可用值的 aspect_ratio 失败原因", () => {
    const failure = checkGenerationParamLimit(videoCapability, {
      size: "1080p",
      aspect_ratio: "4:3",
      duration: 5,
    });
    expect(failure?.field).toBe("aspect_ratio");
    expect(failure?.reason).toContain("4:3");
    expect(failure?.reason).toContain("16:9");
  });

  it("时长超出范围：返回时长失败原因（{min,max} 形态）", () => {
    const failure = checkGenerationParamLimit(videoCapability, {
      size: "1080p",
      aspect_ratio: "16:9",
      duration: 12,
    });
    expect(failure?.field).toBe("duration");
    expect(failure?.reason).toContain("12");
    expect(failure?.reason).toContain("5-10");
  });

  it("时长为 0 / 负数：拒绝（不落入范围判断）", () => {
    const failure = checkGenerationParamLimit(videoCapability, {
      size: "1080p",
      aspect_ratio: "16:9",
      duration: 0,
    });
    expect(failure?.field).toBe("duration");
  });

  it("时长档位数组形态：仅接受档位内值", () => {
    const capability: CapabilityLimitInput = {
      supported_sizes: [{ id: "1k", api_value: "720p" }],
      supported_aspect_ratios: ["16:9"],
      supported_durations: [3, 5, 10],
    };
    expect(
      checkGenerationParamLimit(capability, {
        size: "720p",
        aspect_ratio: "16:9",
        duration: 5,
      }),
    ).toBeNull();
    expect(
      checkGenerationParamLimit(capability, {
        size: "720p",
        aspect_ratio: "16:9",
        duration: 7,
      })?.field,
    ).toBe("duration");
  });

  it("图片：尺寸与比例都合法则通过；尺寸越界拒绝", () => {
    expect(
      checkGenerationParamLimit(imageCapability, {
        size: "1024x1024",
        aspect_ratio: "1:1",
      }),
    ).toBeNull();
    const failure = checkGenerationParamLimit(imageCapability, {
      size: "4096x4096",
      aspect_ratio: "1:1",
    });
    expect(failure?.field).toBe("size");
    expect(failure?.reason).toContain("4096x4096");
  });

  it("图片：比例越界拒绝", () => {
    const failure = checkGenerationParamLimit(imageCapability, {
      size: "1024x1024",
      aspect_ratio: "4:3",
    });
    expect(failure?.field).toBe("aspect_ratio");
  });

  it("能力行未配置 supported_sizes / durations 时放行（worker 兜底）", () => {
    const sparse: CapabilityLimitInput = {
      supported_sizes: [],
      supported_aspect_ratios: [],
      supported_durations: null,
    };
    expect(
      checkGenerationParamLimit(sparse, {
        size: "anything",
        aspect_ratio: "any",
        duration: 99,
      }),
    ).toBeNull();
  });

  it("非整数时长（5.5）在能力范围内通过——步进约束由前端 slider 保证，服务端不重复校验", () => {
    expect(
      checkGenerationParamLimit(videoCapability, {
        size: "1080p",
        aspect_ratio: "16:9",
        duration: 5.5,
      }),
    ).toBeNull();
  });
});

describe("toGenerationParamCheckInput", () => {
  it("视频扁平字段（resolution）归一成 size", () => {
    expect(
      toGenerationParamCheckInput({
        resolution: "1080p",
        aspect_ratio: "16:9",
        duration: 5,
      }),
    ).toEqual({ size: "1080p", aspect_ratio: "16:9", duration: 5 });
  });

  it("size 缺省回退（plan/scene_card 兼容）", () => {
    expect(
      toGenerationParamCheckInput({ size: "2k", aspect_ratio: "1:1" }),
    ).toEqual({ size: "2k", aspect_ratio: "1:1", duration: undefined });
  });

  it("aspect_ratio 缺失返回 null（调用方不校验）", () => {
    expect(
      toGenerationParamCheckInput({ resolution: "1080p", duration: 5 }),
    ).toBeNull();
  });

  it("IKE7JP review：仅 duration（无 resolution/size）仍进入校验，不因 size 空漏掉时长越界", () => {
    expect(
      toGenerationParamCheckInput({ aspect_ratio: "16:9", duration: 30 }),
    ).toEqual({ size: "", aspect_ratio: "16:9", duration: 30 });
  });

  it("IKE7JP review：无 size 无 duration 返回 null（无参数可校验）", () => {
    expect(
      toGenerationParamCheckInput({ aspect_ratio: "16:9" }),
    ).toBeNull();
  });
});
