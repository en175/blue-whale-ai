


import { describe, expect, it } from "vitest";

import {
  aspectRatioIds,
  checkGenerationParamLimit,
  frozenVideoModeOf,
  parsePixels,
  normalizeSpecKey,
  parseSpecKey,
  resolveOutputPixels,
  resolveVideoMode,
  specKeyOf,
  TASK_TYPE_PARAM_CONSTRAINT_MESSAGE,
  toGenerationParamCheckInput,
  type CapabilityLimitInput,
} from "./capability-param-validation.js";


const videoCapability: CapabilityLimitInput = {
  supported_sizes: [
    { id: "1k", api_value: "720p" },
    { id: "2k", api_value: "1080p" },
    { id: "4k", api_value: "2160p" },
  ],
  supported_aspect_ratios: ["16:9", "9:16", "1:1"],
  supported_durations: { min: 5, max: 10, step: 5 },
};


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

  it("不符合能力步长的非整数时长被拒", () => {
    expect(checkGenerationParamLimit(videoCapability, {
      size: "1080p", aspect_ratio: "16:9", duration: 5.5,
    })?.field).toBe("duration");
  });

  it.each([
    [4, 0.1, 5],
    [4, 0.2, 10],
    [4, 0.3, 4.9],
    [4.1, 0.1, 4.2],
  ])("小数步长合法时长通过：min=%s step=%s duration=%s", (min, step, duration) => {
    expect(checkGenerationParamLimit({
      ...videoCapability,
      supported_durations: { min, max: 30, step },
    }, {
      size: "1080p", aspect_ratio: "16:9", duration,
    })).toBeNull();
  });

  it.each([4.05, 5.1, 3.8, 30.2])("小数步长仍拒绝错步长或越界时长：%s", (duration) => {
    expect(checkGenerationParamLimit({
      ...videoCapability,
      supported_durations: { min: 4, max: 30, step: 0.2 },
    }, {
      size: "1080p", aspect_ratio: "16:9", duration,
    })?.field).toBe("duration");
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



describe("checkGenerationParamLimit 任务类型约束（IKFPYX）", () => {

  const taskCapability: CapabilityLimitInput = {
    supported_sizes: [{ id: "1080p", api_value: "1080p" }],
    supported_aspect_ratios: ["16:9", "9:16", "adaptive"],
    supported_durations: { min: 4, max: 30, step: 1 },
    task_types: {
      text2video: { allowed_ratios: ["16:9", "9:16", "adaptive"] },
      first_frame: { allowed_ratios: ["adaptive"] },
      first_last_frame: { allowed_ratios: ["adaptive"] },
      edit: { allowed_ratios: ["adaptive"], allowed_durations: [-1] },
      extend: { allowed_ratios: ["adaptive"], allow_auto_duration: true },
    },
  };

  it("首帧任务：非 adaptive 比例被拒（任务约束覆盖基础比例）", () => {
    const err = checkGenerationParamLimit(taskCapability, {
      size: "1080p",
      aspect_ratio: "16:9",
      duration: 5,
      mode: "first_frame",
    });
    expect(err?.field).toBe("aspect_ratio");
    expect(err?.reason).toContain("adaptive");
  });

  it("首帧任务：adaptive 比例放行（duration 走基础范围）", () => {
    expect(
      checkGenerationParamLimit(taskCapability, {
        size: "1080p",
        aspect_ratio: "adaptive",
        duration: 5,
        mode: "first_frame",
      }),
    ).toBeNull();
  });

  it("edit 任务：duration=-1 放行（任务 allowed_durations 含 -1）", () => {
    expect(
      checkGenerationParamLimit(taskCapability, {
        size: "1080p",
        aspect_ratio: "adaptive",
        duration: -1,
        mode: "edit",
      }),
    ).toBeNull();
  });

  it("edit 任务：duration=5 被拒（该任务只允许 -1）", () => {
    const err = checkGenerationParamLimit(taskCapability, {
      size: "1080p",
      aspect_ratio: "adaptive",
      duration: 5,
      mode: "edit",
    });
    expect(err?.field).toBe("duration");
  });

  it("text2video 任务：duration=-1 被拒（基础范围只收正数）", () => {
    const err = checkGenerationParamLimit(taskCapability, {
      size: "1080p",
      aspect_ratio: "16:9",
      duration: -1,
      mode: "text2video",
    });
    expect(err?.field).toBe("duration");
  });

  it.each([-1, 4, 10, 30])("延长允许自动或基础范围内的 %s 秒", (duration) => {
    expect(checkGenerationParamLimit(taskCapability, {
      size: "1080p", aspect_ratio: "adaptive", duration, mode: "extend",
    })).toBeNull();
  });

  it.each([3, 31, 0, -2, 4.5])("延长拒绝非法时长 %s", (duration) => {
    expect(checkGenerationParamLimit(taskCapability, {
      size: "1080p", aspect_ratio: "adaptive", duration, mode: "extend",
    })?.field).toBe("duration");
  });

  it.each([undefined, null, false])("未开放自动时长的配置 %s 不接受 -1", (allow_auto_duration) => {
    expect(checkGenerationParamLimit({ ...taskCapability,
      task_types: { extend: { allow_auto_duration } },
    }, { size: "1080p", aspect_ratio: "adaptive", duration: -1, mode: "extend" })?.field).toBe("duration");
  });

  it("只能自动优先，自动可选不覆盖步长", () => {
    expect(checkGenerationParamLimit({ ...taskCapability,
      task_types: { edit: { allowed_durations: [-1], allow_auto_duration: true } },
    }, { size: "1080p", aspect_ratio: "adaptive", duration: 10, mode: "edit" })?.field).toBe("duration");
    expect(checkGenerationParamLimit({ ...taskCapability,
      supported_durations: { min: 4, max: 30, step: 2 },
    }, { size: "1080p", aspect_ratio: "adaptive", duration: 5, mode: "extend" })?.field).toBe("duration");
  });

  it("未配 task_types → 回落基础能力行（-1 仍被拒）", () => {
    const plain: CapabilityLimitInput = {
      supported_sizes: [{ id: "1080p", api_value: "1080p" }],
      supported_aspect_ratios: ["16:9", "adaptive"],
      supported_durations: { min: 4, max: 30, step: 1 },
    };
    expect(
      checkGenerationParamLimit(plain, {
        size: "1080p",
        aspect_ratio: "adaptive",
        duration: -1,
        mode: "edit",
      })?.field,
    ).toBe("duration");
  });
});

describe("编辑/延长比例拒单换结构化码（IKJ795）", () => {
  const taskCapability: CapabilityLimitInput = {
    supported_sizes: [{ id: "1080p", api_value: "1080p" }],
    supported_aspect_ratios: ["16:9", "9:16", "adaptive"],
    supported_durations: { min: 4, max: 30, step: 1 },
    task_types: {
      text2video: { allowed_ratios: ["16:9", "9:16", "adaptive"] },
      edit: { allowed_ratios: ["adaptive"] },
      extend: { allowed_ratios: ["adaptive"] },
    },
  };

  it.each(["edit", "extend"] as const)("%s + 非 adaptive 比例 → task_type_param_constraint + 用户向文案", (taskType) => {
    const err = checkGenerationParamLimit(taskCapability, {
      size: "1080p",
      aspect_ratio: "9:16",
      mode: taskType,
    });
    expect(err?.code).toBe("task_type_param_constraint");
    expect(err?.reason).toBe(TASK_TYPE_PARAM_CONSTRAINT_MESSAGE);

    expect(err?.reason).not.toContain("edit");
    expect(err?.reason).not.toContain("adaptive");
  });

  it("edit + adaptive 放行", () => {
    expect(
      checkGenerationParamLimit(taskCapability, {
        size: "1080p",
        aspect_ratio: "adaptive",
        mode: "edit",
      }),
    ).toBeNull();
  });

  it("非任务类型的比例越界仍走 capability_unsupported_ratio（两码语义不混）", () => {
    const err = checkGenerationParamLimit(taskCapability, {
      size: "1080p",
      aspect_ratio: "21:9",
    });
    expect(err?.code).toBe("capability_unsupported_ratio");
    expect(err?.reason).toContain("21:9");
  });

  it("2.0 形态（无 task_types）+ edit 判定 + 固定比例 → 不拒（官方允许 2.0 编辑任务指定比例）", () => {
    const plain: CapabilityLimitInput = {
      supported_sizes: [{ id: "1080p", api_value: "1080p" }],
      supported_aspect_ratios: ["16:9", "9:16"],
      supported_durations: { min: 4, max: 30, step: 1 },
    };
    expect(
      checkGenerationParamLimit(plain, {
        size: "1080p",
        aspect_ratio: "9:16",
        mode: "edit",
      }),
    ).toBeNull();
  });
});

describe("frozenVideoModeOf（IKJ795）", () => {
  it("存量快照无该字段 → default（不重算历史）", () => {
    expect(frozenVideoModeOf({ prompt: "旧任务", aspect_ratio: "9:16" })).toBe("text2video");
  });

  it("冻结值原样透出", () => {
    expect(frozenVideoModeOf({ video_mode: "edit" })).toBe("edit");
    expect(frozenVideoModeOf({ video_mode: "extend" })).toBe("extend");
    expect(frozenVideoModeOf({ video_mode: "first_last_frame" })).toBe("first_last_frame");
  });

  it("非法值 / 非对象 → default", () => {
    expect(frozenVideoModeOf({ video_mode: "nonsense" })).toBe("text2video");
    expect(frozenVideoModeOf(null)).toBe("text2video");
    expect(frozenVideoModeOf("edit")).toBe("text2video");
  });
});

describe("resolveVideoMode（IKFPYX）", () => {
  const ref = (role: string, type: string) => ({ role, type });

  it("首帧 / 首尾帧按 references 角色判定", () => {
    expect(resolveVideoMode([ref("first_frame", "image")], "")).toBe("first_frame");
    expect(
      resolveVideoMode([ref("first_frame", "image"), ref("last_frame", "image")], ""),
    ).toBe("first_last_frame");
  });

  it("参考视频 + 延长意图 → prolong（优先于编辑）", () => {
    expect(resolveVideoMode([ref("reference", "video")], "向后延长这个视频")).toBe("extend");
  });

  it("参考视频 + 编辑意图 → edit", () => {
    expect(resolveVideoMode([ref("reference", "video")], "把背景改成海边")).toBe("edit");
  });

  it("参考视频但无意图关键词 → default", () => {
    expect(resolveVideoMode([ref("reference", "video")], "参考它的运镜")).toBe("omni");
  });

  it("IKL406 编辑模式只数参考视频段数：1 段视频 + N 张图片 + 编辑词仍为 edit", () => {
    expect(
      resolveVideoMode(
        [
          ref("reference", "video"),
          ref("reference", "image"),
          ref("reference", "image"),
        ],
        "把背景改成海边",
      ),
    ).toBe("edit");

    expect(
      resolveVideoMode(
        [ref("reference", "video"), ref("reference", "video"), ref("reference", "image")],
        "把背景改成海边",
      ),
    ).toBe("omni");
  });

  it("IKL406 参考视频 > 1 段 → omni（个数判定先于意图词）", () => {
    const twoVideos = [ref("reference", "video"), ref("reference", "video")];
    expect(resolveVideoMode(twoVideos, "把背景改成海边")).toBe("omni");
    expect(resolveVideoMode(twoVideos, "向后延长这个视频")).toBe("omni");
    expect(resolveVideoMode(twoVideos, "")).toBe("omni");
  });

  it("无参考视频（仅图片参考）→ default（即使提示词含编辑词）", () => {
    expect(resolveVideoMode([ref("reference", "image")], "修改一下")).toBe("image_reference");
  });




  it("裸「编辑」不算编辑意图（官方那条是「编辑视频」）", () => {
    expect(resolveVideoMode([ref("reference", "video")], "编辑一下这个镜头")).toBe("omni");
  });

  it("裸「向前」不算延长意图（用户说的是运镜，不是要延长视频）", () => {
    expect(resolveVideoMode([ref("reference", "video")], "镜头向前推进")).toBe("omni");
  });

  it("官方延长词是完整词组「向前延长 / 向后延长」", () => {
    expect(resolveVideoMode([ref("reference", "video")], "向前延长 3 秒")).toBe("extend");
    expect(resolveVideoMode([ref("reference", "video")], "向后延长这个视频")).toBe("extend");

    expect(resolveVideoMode([ref("reference", "video")], "续写这段")).toBe("extend");
  });



  it("IKJ78C 否定约束句不判编辑（六词闭集逐一覆盖）", () => {
    expect(resolveVideoMode([ref("reference", "video")], "禁止修改人物形象")).toBe("omni");
    expect(resolveVideoMode([ref("reference", "video")], "不得替换背景")).toBe("omni");
    expect(resolveVideoMode([ref("reference", "video")], "不要替换背景")).toBe("omni");
    expect(resolveVideoMode([ref("reference", "video")], "不能去掉人物")).toBe("omni");
    expect(resolveVideoMode([ref("reference", "video")], "请勿删除水印")).toBe("omni");
    expect(resolveVideoMode([ref("reference", "video")], "无需增加字幕")).toBe("omni");
  });

  it("IKJ78C 混合句按肯定判：否定词与关键词跨子句不剔除（中英标点同权）", () => {
    expect(resolveVideoMode([ref("reference", "video")], "禁止修改人物，把背景替换成海边"))
      .toBe("edit");
    expect(resolveVideoMode([ref("reference", "video")], "不要改人物,把背景替换成海边"))
      .toBe("edit");
  });

  it("IKJ78C 否定延长词同样剔除", () => {
    expect(resolveVideoMode([ref("reference", "video")], "不要延续这个故事")).toBe("omni");
  });
});

describe("task_types 空对象 = 开放且无额外约束（IKK1T4）", () => {
  const cap: CapabilityLimitInput = {
    supported_sizes: [{ id: "1080p", api_value: "1080p" }],
    supported_aspect_ratios: ["16:9", "adaptive"],
    supported_durations: { min: 4, max: 30, step: 1 },
    task_types: { text2video: {} },
  };

  it("空对象回落基础能力行：区间内任何时长都放行", () => {
    expect(
      checkGenerationParamLimit(cap, {
        size: "1080p",
        aspect_ratio: "16:9",
        duration: 7,
        mode: "text2video",
      }),
    ).toBeNull();
  });

  it("空对象回落基础能力行：区间外仍被拒", () => {
    const err = checkGenerationParamLimit(cap, {
      size: "1080p",
      aspect_ratio: "16:9",
      duration: 99,
      mode: "text2video",
    });
    expect(err?.field).toBe("duration");
  });
});




describe("输出像素表（video_dimensions）", () => {
  it("parseSpecKey 认两个轴、且顺序无关", () => {
    expect(parseSpecKey("resolution=480p|aspect_ratio=16:9")).toEqual({
      resolution: "480p",
      aspect_ratio: "16:9",
    });
    expect(parseSpecKey("aspect_ratio=16:9|resolution=480p")).toEqual({
      resolution: "480p",
      aspect_ratio: "16:9",
    });
  });

  it("parseSpecKey 对形态不对的一律返回 null（不勉强认出来）", () => {

    expect(parseSpecKey("resolution=480p")).toBeNull();

    expect(parseSpecKey("resolution=480p|aspect_ratio=16:9|video=1")).toBeNull();

    expect(parseSpecKey("resolution=|aspect_ratio=16:9")).toBeNull();
    expect(parseSpecKey("resolution480p|aspect_ratio=16:9")).toBeNull();
    expect(parseSpecKey("resolution=480p|resolution=720p|aspect_ratio=16:9")).toBeNull();
  });

  it("parsePixels 只认 宽x高（正整数）", () => {
    expect(parsePixels("864x496")).toEqual({ width: 864, height: 496 });
    expect(parsePixels("0x496")).toBeNull();
    expect(parsePixels("864X496")).toBeNull();
    expect(parsePixels("864 x 496")).toBeNull();
    expect(parsePixels("")).toBeNull();
  });

  it("specKeyOf 与 parseSpecKey 往返一致", () => {
    const key = specKeyOf("1080p", "adaptive");
    expect(key).toBe("resolution=1080p|aspect_ratio=adaptive");
    expect(parseSpecKey(key)).toEqual({ resolution: "1080p", aspect_ratio: "adaptive" });
  });

  it("resolveOutputPixels 命中 / 未配返回 null", () => {
    const table = { "resolution=480p|aspect_ratio=16:9": "864x496" };
    expect(resolveOutputPixels(table, "480p", "16:9")).toEqual({ width: 864, height: 496 });

    expect(resolveOutputPixels(table, "480p", "9:16")).toBeNull();
    expect(resolveOutputPixels(table, "720p", "16:9")).toBeNull();

    expect(resolveOutputPixels(null, "480p", "16:9")).toBeNull();
    expect(resolveOutputPixels([], "480p", "16:9")).toBeNull();
    expect(resolveOutputPixels(table, "480p", "16:9")).toEqual({ width: 864, height: 496 });
  });

  it("adaptive 走**显式键**，不在代码里做「取该档位 16:9」的推断", () => {

    const table = {
      "resolution=480p|aspect_ratio=16:9": "864x496",
      "resolution=480p|aspect_ratio=adaptive": "864x496",
    };
    expect(resolveOutputPixels(table, "480p", "adaptive")).toEqual({ width: 864, height: 496 });


    const only169 = { "resolution=480p|aspect_ratio=16:9": "864x496" };
    expect(resolveOutputPixels(only169, "480p", "adaptive")).toBeNull();
  });
});






describe("规格键归一（大小写 / 空白不敏感）", () => {
  it("normalizeSpecKey 小写化并按轴名排序", () => {
    expect(normalizeSpecKey("resolution=4K|aspect_ratio=16:9")).toBe("aspect_ratio=16:9|resolution=4k");
    expect(normalizeSpecKey(" Aspect_Ratio=16:9 |Resolution=4k ")).toBe(
      "aspect_ratio=16:9|resolution=4k",
    );
  });

  it("resolveOutputPixels 跨大小写命中（4K ↔ 4k）", () => {
    const lower = { "resolution=4k|aspect_ratio=16:9": "3840x2160" };
    expect(resolveOutputPixels(lower, "4K", "16:9")).toEqual({ width: 3840, height: 2160 });

    const upper = { "resolution=4K|aspect_ratio=16:9": "3840x2160" };
    expect(resolveOutputPixels(upper, "4k", "16:9")).toEqual({ width: 3840, height: 2160 });
  });

  it("归一不放松语义：轴不同 / 比例不同仍然取不到", () => {
    const table = { "resolution=4k|aspect_ratio=16:9": "3840x2160" };
    expect(resolveOutputPixels(table, "4k", "9:16")).toBeNull();
    expect(resolveOutputPixels(table, "4k", "adaptive")).toBeNull();
  });
});

describe("aspectRatioIds（ADR-0123）", () => {
  it("裸字符串（存量形态）", () => {
    expect(aspectRatioIds(["16:9", "9:16"])).toEqual(["16:9", "9:16"]);
  });

  it("{ id, label }（新形态）只取 id", () => {
    expect(
      aspectRatioIds([
        { id: "16:9", label: "横屏" },
        { id: "9:16", label: "竖屏" },
      ]),
    ).toEqual(["16:9", "9:16"]);
  });

  it("两种形态混在一行里也认（迁移窗口）", () => {
    expect(aspectRatioIds(["1:1", { id: "16:9", label: "横屏" }])).toEqual([
      "1:1",
      "16:9",
    ]);
  });

  it("非数组 / 脏元素返回空或跳过，不抛", () => {
    expect(aspectRatioIds(null)).toEqual([]);
    expect(aspectRatioIds("16:9")).toEqual([]);
    expect(aspectRatioIds([null, 42, {}, { label: "无 id" }, { id: "" }])).toEqual(
      [],
    );
  });
});
