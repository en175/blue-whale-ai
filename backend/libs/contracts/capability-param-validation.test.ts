// IKE7JP：生成参数对能力目录的结构性校验测试（纯函数）。
// 覆盖视频（resolution + aspect_ratio + duration）与图片（size + aspect_ratio）两条提交路径，
// 以及时长档位数组 / {min,max,step} 范围两种 DB 形态。
import { describe, expect, it } from "vitest";

import {
  checkGenerationParamLimit,
  frozenVideoTaskTypeOf,
  parsePixels,
  normalizeSpecKey,
  parseSpecKey,
  resolveOutputPixels,
  resolveVideoTaskType,
  specKeyOf,
  TASK_TYPE_PARAM_CONSTRAINT_MESSAGE,
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

// IKFPYX：任务类型约束闭环——features.task_types 命中时覆盖基础比例/时长校验，
// 并放行 duration=-1（自动时长，仅 edit/prolong 合法）；未命中回落基础能力行。
describe("checkGenerationParamLimit 任务类型约束（IKFPYX）", () => {
  /** 2.5 形态：基础比例含 adaptive，任务类型各有约束。 */
  const taskCapability: CapabilityLimitInput = {
    supported_sizes: [{ id: "1080p", api_value: "1080p" }],
    supported_aspect_ratios: ["16:9", "9:16", "adaptive"],
    supported_durations: { min: 4, max: 30, step: 1 },
    task_types: {
      default: { allowed_ratios: ["16:9", "9:16", "adaptive"], allowed_durations: [4, 5, 10, 30] },
      first_frame: { allowed_ratios: ["adaptive"] },
      first_last_frame: { allowed_ratios: ["adaptive"] },
      edit: { allowed_ratios: ["adaptive"], allowed_durations: [-1] },
      prolong: { allowed_ratios: ["adaptive"], allowed_durations: [4, 5, 10, -1] },
    },
  };

  it("首帧任务：非 adaptive 比例被拒（任务约束覆盖基础比例）", () => {
    const err = checkGenerationParamLimit(taskCapability, {
      size: "1080p",
      aspect_ratio: "16:9",
      duration: 5,
      task_type: "first_frame",
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
        task_type: "first_frame",
      }),
    ).toBeNull();
  });

  it("edit 任务：duration=-1 放行（任务 allowed_durations 含 -1）", () => {
    expect(
      checkGenerationParamLimit(taskCapability, {
        size: "1080p",
        aspect_ratio: "adaptive",
        duration: -1,
        task_type: "edit",
      }),
    ).toBeNull();
  });

  it("edit 任务：duration=5 被拒（该任务只允许 -1）", () => {
    const err = checkGenerationParamLimit(taskCapability, {
      size: "1080p",
      aspect_ratio: "adaptive",
      duration: 5,
      task_type: "edit",
    });
    expect(err?.field).toBe("duration");
  });

  it("default 任务：duration=-1 被拒（基础范围只收正数）", () => {
    const err = checkGenerationParamLimit(taskCapability, {
      size: "1080p",
      aspect_ratio: "16:9",
      duration: -1,
      task_type: "default",
    });
    expect(err?.field).toBe("duration");
  });

  it("prolong 任务：duration=-1 与 4/10 均可（清单同时含两者）", () => {
    for (const d of [-1, 4, 10]) {
      expect(
        checkGenerationParamLimit(taskCapability, {
          size: "1080p",
          aspect_ratio: "adaptive",
          duration: d,
          task_type: "prolong",
        }),
      ).toBeNull();
    }
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
        task_type: "edit",
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
      default: { allowed_ratios: ["16:9", "9:16", "adaptive"] },
      edit: { allowed_ratios: ["adaptive"] },
      prolong: { allowed_ratios: ["adaptive"] },
    },
  };

  it.each(["edit", "prolong"] as const)("%s + 非 adaptive 比例 → task_type_param_constraint + 用户向文案", (taskType) => {
    const err = checkGenerationParamLimit(taskCapability, {
      size: "1080p",
      aspect_ratio: "9:16",
      task_type: taskType,
    });
    expect(err?.code).toBe("task_type_param_constraint");
    expect(err?.reason).toBe(TASK_TYPE_PARAM_CONSTRAINT_MESSAGE);
    // 用户向文案不出现内部词（前端直接展示）
    expect(err?.reason).not.toContain("edit");
    expect(err?.reason).not.toContain("adaptive");
  });

  it("edit + adaptive 放行", () => {
    expect(
      checkGenerationParamLimit(taskCapability, {
        size: "1080p",
        aspect_ratio: "adaptive",
        task_type: "edit",
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
        task_type: "edit",
      }),
    ).toBeNull();
  });
});

describe("frozenVideoTaskTypeOf（IKJ795）", () => {
  it("存量快照无该字段 → default（不重算历史）", () => {
    expect(frozenVideoTaskTypeOf({ prompt: "旧任务", aspect_ratio: "9:16" })).toBe("default");
  });

  it("冻结值原样透出", () => {
    expect(frozenVideoTaskTypeOf({ video_task_type: "edit" })).toBe("edit");
    expect(frozenVideoTaskTypeOf({ video_task_type: "prolong" })).toBe("prolong");
    expect(frozenVideoTaskTypeOf({ video_task_type: "first_last_frame" })).toBe("first_last_frame");
  });

  it("非法值 / 非对象 → default", () => {
    expect(frozenVideoTaskTypeOf({ video_task_type: "nonsense" })).toBe("default");
    expect(frozenVideoTaskTypeOf(null)).toBe("default");
    expect(frozenVideoTaskTypeOf("edit")).toBe("default");
  });
});

describe("resolveVideoTaskType（IKFPYX）", () => {
  const ref = (role: string, type: string) => ({ role, type });

  it("首帧 / 首尾帧按 references 角色判定", () => {
    expect(resolveVideoTaskType([ref("first_frame", "image")], "")).toBe("first_frame");
    expect(
      resolveVideoTaskType([ref("first_frame", "image"), ref("last_frame", "image")], ""),
    ).toBe("first_last_frame");
  });

  it("参考视频 + 延长意图 → prolong（优先于编辑）", () => {
    expect(resolveVideoTaskType([ref("reference", "video")], "向后延长这个视频")).toBe("prolong");
  });

  it("参考视频 + 编辑意图 → edit", () => {
    expect(resolveVideoTaskType([ref("reference", "video")], "把背景改成海边")).toBe("edit");
  });

  it("参考视频但无意图关键词 → default", () => {
    expect(resolveVideoTaskType([ref("reference", "video")], "参考它的运镜")).toBe("default");
  });

  it("无参考视频（仅图片参考）→ default（即使提示词含编辑词）", () => {
    expect(resolveVideoTaskType([ref("reference", "image")], "修改一下")).toBe("default");
  });

  /* 关键词表逐字对齐火山方舟 Seedance 2.5 提示词指南。以下两条钉住**曾经放宽过的词**：
     放宽会让「用户没要求编辑/延长」的提示词也落进 edit/prolong，进而被按编辑任务的锁定额处理。 */

  it("裸「编辑」不算编辑意图（官方那条是「编辑视频」）", () => {
    expect(resolveVideoTaskType([ref("reference", "video")], "编辑一下这个镜头")).toBe("default");
  });

  it("裸「向前」不算延长意图（用户说的是运镜，不是要延长视频）", () => {
    expect(resolveVideoTaskType([ref("reference", "video")], "镜头向前推进")).toBe("default");
  });

  it("官方延长词是完整词组「向前延长 / 向后延长」", () => {
    expect(resolveVideoTaskType([ref("reference", "video")], "向前延长 3 秒")).toBe("prolong");
    expect(resolveVideoTaskType([ref("reference", "video")], "向后延长这个视频")).toBe("prolong");
    // 官方的另外两个词仍然保留
    expect(resolveVideoTaskType([ref("reference", "video")], "续写这段")).toBe("prolong");
  });

  /* IKJ78C：否定防护——裸子串匹配会把「禁止修改」这类约束句误判成编辑意图（default 即官方 reference）。 */

  it("IKJ78C 否定约束句不判编辑（六词闭集逐一覆盖）", () => {
    expect(resolveVideoTaskType([ref("reference", "video")], "禁止修改人物形象")).toBe("default");
    expect(resolveVideoTaskType([ref("reference", "video")], "不得替换背景")).toBe("default");
    expect(resolveVideoTaskType([ref("reference", "video")], "不要替换背景")).toBe("default");
    expect(resolveVideoTaskType([ref("reference", "video")], "不能去掉人物")).toBe("default");
    expect(resolveVideoTaskType([ref("reference", "video")], "请勿删除水印")).toBe("default");
    expect(resolveVideoTaskType([ref("reference", "video")], "无需增加字幕")).toBe("default");
  });

  it("IKJ78C 混合句按肯定判：否定词与关键词跨子句不剔除（中英标点同权）", () => {
    expect(resolveVideoTaskType([ref("reference", "video")], "禁止修改人物，把背景替换成海边"))
      .toBe("edit");
    expect(resolveVideoTaskType([ref("reference", "video")], "不要改人物,把背景替换成海边"))
      .toBe("edit");
  });

  it("IKJ78C 否定延长词同样剔除", () => {
    expect(resolveVideoTaskType([ref("reference", "video")], "不要延续这个故事")).toBe("default");
  });
});

describe("task_types.default 约束生效（IKFPYX）", () => {
  const cap: CapabilityLimitInput = {
    supported_sizes: [{ id: "1080p", api_value: "1080p" }],
    supported_aspect_ratios: ["16:9", "adaptive"],
    supported_durations: { min: 4, max: 30, step: 1 },
    task_types: { default: { allowed_durations: [4, 5, 10, 30] } },
  };

  it("default 任务按配置的时长清单校验：7 秒被拒（基础范围本可放行）", () => {
    const err = checkGenerationParamLimit(cap, {
      size: "1080p",
      aspect_ratio: "16:9",
      duration: 7,
      task_type: "default",
    });
    expect(err?.field).toBe("duration");
  });

  it("default 任务清单内（10 秒）放行", () => {
    expect(
      checkGenerationParamLimit(cap, {
        size: "1080p",
        aspect_ratio: "16:9",
        duration: 10,
        task_type: "default",
      }),
    ).toBeNull();
  });
});

/* 输出像素表：键/值解析，以及按 (分辨率, 比例) 查宽高。
   这张表原先住在定价目录（`tokenEstimate.dimensions`），本轮搬进能力行——
   测试要同时钉住「搬迁没改语义」这件事，所以键格式与 adaptive 的行为都逐条钉。 */
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
    // 少一个轴：永远匹配不上，留着只会让人以为配了
    expect(parseSpecKey("resolution=480p")).toBeNull();
    // 多一个轴：那是另一种表，悄悄忽略会按错的像素预扣
    expect(parseSpecKey("resolution=480p|aspect_ratio=16:9|video=1")).toBeNull();
    // 空值 / 无等号 / 重复轴
    expect(parseSpecKey("resolution=|aspect_ratio=16:9")).toBeNull();
    expect(parseSpecKey("resolution480p|aspect_ratio=16:9")).toBeNull();
    expect(parseSpecKey("resolution=480p|resolution=720p|aspect_ratio=16:9")).toBeNull();
  });

  it("parsePixels 只认 宽x高（正整数）", () => {
    expect(parsePixels("864x496")).toEqual({ width: 864, height: 496 });
    expect(parsePixels("0x496")).toBeNull();
    expect(parsePixels("864X496")).toBeNull(); // 分隔符是小写 x
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
    // 档位存在但这一格没配 → null（调用方据此走「预扣算不出」的拒绝路径）
    expect(resolveOutputPixels(table, "480p", "9:16")).toBeNull();
    expect(resolveOutputPixels(table, "720p", "16:9")).toBeNull();
    // 表本身没配 / 形态不对
    expect(resolveOutputPixels(null, "480p", "16:9")).toBeNull();
    expect(resolveOutputPixels([], "480p", "16:9")).toBeNull();
    expect(resolveOutputPixels(table, "480p", "16:9")).toEqual({ width: 864, height: 496 });
  });

  it("adaptive 走**显式键**，不在代码里做「取该档位 16:9」的推断", () => {
    // 目录时代就是显式键，搬迁不改行为：配了才命中
    const table = {
      "resolution=480p|aspect_ratio=16:9": "864x496",
      "resolution=480p|aspect_ratio=adaptive": "864x496",
    };
    expect(resolveOutputPixels(table, "480p", "adaptive")).toEqual({ width: 864, height: 496 });

    // 只配了 16:9、没配 adaptive → adaptive 查不到，**不是**悄悄拿了 16:9 那格
    const only169 = { "resolution=480p|aspect_ratio=16:9": "864x496" };
    expect(resolveOutputPixels(only169, "480p", "adaptive")).toBeNull();
  });
});

/* ⚠️ 回归：档位大小写两处不一致是**常态**，不是脏数据。
   能力行的 `api_value` 写 `4K`，而像素表的键是从定价目录搬来的 `resolution=4k|...`。
   搬迁时漏了 billing 原有的 `trim().toLowerCase()` 归一，实测后果：
   **`2.0 + 4K/16:9` 从 379 积分变成「算不出价」**（宽高冻不上 → billing 估不出 token）。
   下面两条钉住这个行为，别再退回去。 */
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
