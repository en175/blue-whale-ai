// IKGZ7Z：video_subtitle_erase（视频智能去字幕）跨进程契约双端一致性断言。
// 防漂移约定（沿用 image-cutout.test.ts 读种子文本的同源断言模式）：TS 侧常量直接 import 断言值；
// worker-java 无法 import TS 常量，本测试直接读 Java 源码文本逐值对账——任一侧改动未同步即红。
// 契约权威章节：docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md §17（冻结增量）；
// 官方 API 口径 = 火山引擎 AI MediaKit「提交字幕擦除（精细化版）任务 API」官方 PDF。
// 后续票（Z80 创建入口 / Z81 worker 执行 / 前端）照抄本契约与 video-subtitle-erase.ts，不得发明字段名。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { VIDEO_SUBTITLE_ERASE_TAG } from "../shared/generation/queue.constants.js";
import {
  ERROR_CODES,
  ERROR_VIDEO_SUBTITLE_ERASE_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  VIDEO_SUBTITLE_ERASE_BOX_KEYS,
  VIDEO_SUBTITLE_ERASE_DETECT_MODES,
  VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN,
  VIDEO_SUBTITLE_ERASE_INPUT_KEYS,
  VIDEO_SUBTITLE_ERASE_JOB_TYPE,
  VIDEO_SUBTITLE_ERASE_MAX_BOXES,
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MODE,
  VIDEO_SUBTITLE_ERASE_MODEL_VERSION,
  VIDEO_SUBTITLE_ERASE_OUTPUT_ENCODE_MODE,
  VIDEO_SUBTITLE_ERASE_SOURCE,
  videoSubtitleEraseInputSchema,
} from "./video-subtitle-erase.js";

// 读 worker-java 侧常量源码（对账基准；3 级 .. = 仓库根）。
const jobTypeJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/entity/JobType.java",
    import.meta.url,
  ),
  "utf8",
);
const contractJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/entity/VideoSubtitleEraseContract.java",
    import.meta.url,
  ),
  "utf8",
);
// tag 字面量已上移到 GenerationMqRoute（VideoSubtitleEraseContract.TAG 只做转发），故 tag 的对账基准改读该枚举。
const mqRouteJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/entity/GenerationMqRoute.java",
    import.meta.url,
  ),
  "utf8",
);

describe("video_subtitle_erase 契约不变量（官方 PDF 口径，TS 侧）", () => {
  it("任务类型 / MQ tag / 来源值三处同值 video_subtitle_erase", () => {
    expect(VIDEO_SUBTITLE_ERASE_JOB_TYPE).toBe("video_subtitle_erase");
    expect(VIDEO_SUBTITLE_ERASE_TAG).toBe(VIDEO_SUBTITLE_ERASE_JOB_TYPE);
    expect(VIDEO_SUBTITLE_ERASE_SOURCE).toBe(VIDEO_SUBTITLE_ERASE_JOB_TYPE);
  });

  it("检测模式枚举仅本期两值：subtitle_smart / text_full（本仓语义名，映射官方 Subtitle / Text）", () => {
    expect([...VIDEO_SUBTITLE_ERASE_DETECT_MODES]).toEqual(["subtitle_smart", "text_full"]);
    expect(VIDEO_SUBTITLE_ERASE_MODE).toEqual({
      subtitle_smart: "Subtitle",
      text_full: "Text",
    });
  });

  it("出站固定参数：model_version=v5、output_encode_mode=Quality（服务端常量，不从前端传入）", () => {
    expect(VIDEO_SUBTITLE_ERASE_MODEL_VERSION).toBe("v5");
    expect(VIDEO_SUBTITLE_ERASE_OUTPUT_ENCODE_MODE).toBe("Quality");
  });

  it("擦除框上限 20（官方 erase_ratio_location「最多支持 20 个擦除框」）", () => {
    expect(VIDEO_SUBTITLE_ERASE_MAX_BOXES).toBe(20);
  });

  it("输入限制：2K 像素口径短边 1440 / 长边 2560（竖屏合法），10 分钟产品上限", () => {
    expect(VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX).toBe(1440);
    expect(VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX).toBe(2560);
    expect(VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS).toBe(10 * 60 * 1000);
  });

  it("input 键名冻结：source_asset_id / target_node_id / detect_mode / erase_boxes", () => {
    expect(Object.values(VIDEO_SUBTITLE_ERASE_INPUT_KEYS)).toEqual([
      "source_asset_id",
      "target_node_id",
      "detect_mode",
      "erase_boxes",
    ]);
  });

  it("Location 框键名冻结（官方 Location 对象同名同值，出站原样透传）", () => {
    expect(Object.values(VIDEO_SUBTITLE_ERASE_BOX_KEYS)).toEqual([
      "top_left_x",
      "top_left_y",
      "bottom_right_x",
      "bottom_right_y",
    ]);
  });

  it("edge origin：纯视觉来源边标记 video-subtitle-erase（参考推导跳过）", () => {
    expect(VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN).toBe("video-subtitle-erase");
  });

  it("schema：智能模式（无框）四键合法样本过、空数组合法", () => {
    const valid = {
      source_asset_id: "123",
      target_node_id: "node-abc",
      detect_mode: "subtitle_smart",
      erase_boxes: [],
    };
    expect(videoSubtitleEraseInputSchema.parse(valid)).toEqual(valid);
    // strict：未知键拒；time_segment_filter 本期不实现，传入即拒（结构扩展位仅留类型）。
    expect(videoSubtitleEraseInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(
      videoSubtitleEraseInputSchema.safeParse({ ...valid, time_segment_filter: {} }).success,
    ).toBe(false);
    // 源素材 id 沿用 Asset id 口径（非 0 开头数字串）。
    expect(videoSubtitleEraseInputSchema.safeParse({ ...valid, source_asset_id: "0" }).success).toBe(
      false,
    );
    expect(
      videoSubtitleEraseInputSchema.safeParse({ ...valid, source_asset_id: "abc" }).success,
    ).toBe(false);
    expect(
      videoSubtitleEraseInputSchema.safeParse({ ...valid, target_node_id: "" }).success,
    ).toBe(false);
    // 范围外检测模式值拒（乱值 / 官方原始值 Subtitle 也不进 input）。
    for (const mode of ["bogus", "", "Subtitle", "Text"]) {
      expect(
        videoSubtitleEraseInputSchema.safeParse({ ...valid, detect_mode: mode }).success,
      ).toBe(false);
    }
  });

  it("schema：有框合法样本过、坐标越界拒、第 21 个框拒、框内多键拒", () => {
    const box = {
      top_left_x: 0.1,
      top_left_y: 0.8,
      bottom_right_x: 0.9,
      bottom_right_y: 0.95,
    };
    const valid = {
      source_asset_id: "123",
      target_node_id: "node-abc",
      detect_mode: "text_full",
      erase_boxes: [box],
    };
    expect(videoSubtitleEraseInputSchema.parse(valid)).toEqual(valid);
    // 坐标 [0,1] 越界拒（官方取值范围；失败示例 bottom_right_x > 1）。
    expect(
      videoSubtitleEraseInputSchema.safeParse({
        ...valid,
        erase_boxes: [{ ...box, bottom_right_x: 1.01 }],
      }).success,
    ).toBe(false);
    expect(
      videoSubtitleEraseInputSchema.safeParse({
        ...valid,
        erase_boxes: [{ ...box, top_left_y: -0.1 }],
      }).success,
    ).toBe(false);
    // 超过 20 个框拒。
    expect(
      videoSubtitleEraseInputSchema.safeParse({ ...valid, erase_boxes: Array(21).fill(box) })
        .success,
    ).toBe(false);
    expect(
      videoSubtitleEraseInputSchema.safeParse({ ...valid, erase_boxes: Array(20).fill(box) })
        .success,
    ).toBe(true);
    // 框对象 strict：未知键拒。
    expect(
      videoSubtitleEraseInputSchema.safeParse({
        ...valid,
        erase_boxes: [{ ...box, extra: 1 }],
      }).success,
    ).toBe(false);
  });

  it("兜底错误码 video_subtitle_erase_failed → 1043（1039-1042 已由高清/擦除/扩图/抠图占用），文案表同步", () => {
    expect(ERROR_VIDEO_SUBTITLE_ERASE_FAILED).toBe("video_subtitle_erase_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_VIDEO_SUBTITLE_ERASE_FAILED]).toBe(1043);
    expect(ERROR_CODES[1043]).toBeTruthy();
  });
});

describe("video_subtitle_erase 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("JobType 枚举含 VIDEO_SUBTITLE_ERASE(\"video_subtitle_erase\")", () => {
    expect(jobTypeJava).toContain('VIDEO_SUBTITLE_ERASE("video_subtitle_erase")');
  });

  it("VideoSubtitleEraseContract：tag / source 与 TS 同值", () => {
    expect(mqRouteJava).toContain(
      `VIDEO_SUBTITLE_ERASE("generation-task", "${VIDEO_SUBTITLE_ERASE_TAG}")`,
    );
    expect(contractJava).toContain(
      "String TAG = GenerationMqRoute.VIDEO_SUBTITLE_ERASE.tag();",
    );
    expect(contractJava).toContain('String SOURCE = "video_subtitle_erase";');
  });

  it("VideoSubtitleEraseContract：四 input 键名与 TS 同值", () => {
    for (const key of Object.values(VIDEO_SUBTITLE_ERASE_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("VideoSubtitleEraseContract：Location 框四键名与 TS 同值", () => {
    for (const key of Object.values(VIDEO_SUBTITLE_ERASE_BOX_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("VideoSubtitleEraseContract：检测模式两值与 mode 映射与 TS 同值", () => {
    expect(contractJava).toContain('String DETECT_MODE_SUBTITLE_SMART = "subtitle_smart";');
    expect(contractJava).toContain('String DETECT_MODE_TEXT_FULL = "text_full";');
    expect(contractJava).toContain('DETECT_MODE_SUBTITLE_SMART, "Subtitle",');
    expect(contractJava).toContain('DETECT_MODE_TEXT_FULL, "Text"');
  });

  it("VideoSubtitleEraseContract：出站固定参数 / 框上限与 TS 同值", () => {
    expect(contractJava).toContain('String MODEL_VERSION = "v5";');
    expect(contractJava).toContain('String OUTPUT_ENCODE_MODE = "Quality";');
    expect(contractJava).toContain("int MAX_BOXES = 20;");
  });

  it("VideoSubtitleEraseContract：输入限制镜像与 TS 同值（2K 两边 / 10 分钟时长）", () => {
    expect(contractJava).toContain("int MAX_INPUT_SHORT_SIDE_PX = 1440;");
    expect(contractJava).toContain("int MAX_INPUT_LONG_SIDE_PX = 2560;");
    expect(contractJava).toContain("long MAX_INPUT_DURATION_MS = 10L * 60 * 1000;");
  });

  it("VideoSubtitleEraseContract：兜底错误码与 TS 同值", () => {
    expect(contractJava).toContain(
      'String ERROR_VIDEO_SUBTITLE_ERASE_FAILED = "video_subtitle_erase_failed";',
    );
  });
});
