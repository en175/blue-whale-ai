// IKH8BH：video_scene_split（视频场景切分，火山 MediaKit segment-scenes）跨进程契约
// 双端一致性断言。防漂移约定（沿用 video-enhance.test.ts / video-subtitle-erase.test.ts /
// media-extract.test.ts 读种子文本的同源断言模式）：TS 侧常量直接 import 断言值；
// worker-java 无法 import TS 常量，本测试直接读 Java 源码文本逐值对账——任一侧改动未同步即红。
// 官方 API 口径 = 火山引擎 AI MediaKit「提交场景切分任务 API」官方 PDF（segment_threshold
// 范围 [0,100) 推荐经验值 10、视频时长 ≤2 小时、result = duration + segments[]）。
// 后续票（创建入口 / worker 执行 / 前端扇出）照抄本契约与 video-scene-split.ts，不得发明字段名。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { VIDEO_SCENE_SPLIT_TAG } from "../shared/generation/queue.constants.js";
import {
  ERROR_CODES,
  ERROR_VIDEO_SCENE_SPLIT_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  VIDEO_SCENE_SPLIT_DEFAULT_GRANULARITY,
  VIDEO_SCENE_SPLIT_GRANULARITIES,
  VIDEO_SCENE_SPLIT_INPUT_KEYS,
  VIDEO_SCENE_SPLIT_JOB_TYPE,
  VIDEO_SCENE_SPLIT_MAX_DURATION_MS,
  VIDEO_SCENE_SPLIT_MODEL_NAME,
  VIDEO_SCENE_SPLIT_POLL_PATH_PREFIX,
  VIDEO_SCENE_SPLIT_RESULT_KEYS,
  VIDEO_SCENE_SPLIT_SEGMENT_KEYS,
  VIDEO_SCENE_SPLIT_SEGMENT_THRESHOLD,
  VIDEO_SCENE_SPLIT_SOURCE,
  VIDEO_SCENE_SPLIT_SUBMIT_PATH,
  videoSceneSplitInputSchema,
  videoSceneSplitResultSchema,
} from "./video-scene-split.js";

// 读 worker-java 侧常量源码（对账基准；3 级 .. = 仓库根）。
const contractJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/VideoSceneSplitContract.java",
    import.meta.url,
  ),
  "utf8",
);
const jobTypeJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/JobTypeEnum.java",
    import.meta.url,
  ),
  "utf8",
);
// tag 字面量单处定义在 GenerationMqRoute（VideoSceneSplitContract.TAG 只做转发），故 tag 的对账基准读该枚举。
const mqRouteJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/GenerationMqRouteEnum.java",
    import.meta.url,
  ),
  "utf8",
);

describe("video_scene_split 契约不变量（官方 PDF 口径，TS 侧）", () => {
  it("任务类型 / MQ tag 同值 video_scene_split，来源值 = 专属创建入口 video_scene_split", () => {
    expect(VIDEO_SCENE_SPLIT_JOB_TYPE).toBe("video_scene_split");
    expect(VIDEO_SCENE_SPLIT_TAG).toBe(VIDEO_SCENE_SPLIT_JOB_TYPE);
    expect(VIDEO_SCENE_SPLIT_SOURCE).toBe("video_scene_split");
  });

  it("粒度三档 fine/standard/coarse，默认档 standard；三档映射 segment_threshold 细=5 / 标准=10 / 粗=20（契约初值）", () => {
    expect([...VIDEO_SCENE_SPLIT_GRANULARITIES]).toEqual(["fine", "standard", "coarse"]);
    expect(VIDEO_SCENE_SPLIT_DEFAULT_GRANULARITY).toBe("standard");
    // 细=5（低于推荐值切得更碎）、标准=10（官方推荐经验值）、粗=20（高于推荐值切得更粗）。
    expect(VIDEO_SCENE_SPLIT_SEGMENT_THRESHOLD).toEqual({
      fine: 5,
      standard: 10,
      coarse: 20,
    });
    // 默认档必须落在映射表内且等于官方推荐值 10。
    expect(VIDEO_SCENE_SPLIT_SEGMENT_THRESHOLD[VIDEO_SCENE_SPLIT_DEFAULT_GRANULARITY]).toBe(10);
  });

  it("网关端点：提交 /v1/mediakit/{tool}、查询 /v1/mediakit/tasks/（IKH67T 实测校准）", () => {
    expect(VIDEO_SCENE_SPLIT_SUBMIT_PATH).toBe("/v1/mediakit/segment-scenes");
    // 四个 MediaKit 异步工具共用同一条查询路由；网关路径 ≠ 火山上游路径（混用即 404）。
    expect(VIDEO_SCENE_SPLIT_POLL_PATH_PREFIX).toBe("/v1/mediakit/tasks/");
  });

  it("对客模型名收敛为契约常量 mediakit-segment-scenes（候选值，以网关配置票为准）", () => {
    expect(VIDEO_SCENE_SPLIT_MODEL_NAME).toBe("mediakit-segment-scenes");
  });

  it("input 键名冻结：source_asset_id / target_node_id / granularity（IKH8BO 扩展占位卡绑定键）", () => {
    expect(Object.values(VIDEO_SCENE_SPLIT_INPUT_KEYS)).toEqual([
      "source_asset_id",
      "target_node_id",
      "granularity",
    ]);
  });

  it("input schema：三键合法样本过、strict 多余键拒、source_asset_id 非 id 串拒、枚举外粒度拒、占位卡绑定缺失/空拒", () => {
    const valid = { source_asset_id: "88", target_node_id: "node-1", granularity: "standard" };
    expect(videoSceneSplitInputSchema.parse(valid)).toEqual(valid);
    expect(videoSceneSplitInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(videoSceneSplitInputSchema.safeParse({ ...valid, source_asset_id: "abc" }).success).toBe(
      false,
    );
    expect(videoSceneSplitInputSchema.safeParse({ ...valid, source_asset_id: "0" }).success).toBe(
      false,
    );
    expect(videoSceneSplitInputSchema.safeParse({ ...valid, granularity: "10" }).success).toBe(
      false,
    );
    // 占位卡绑定键：缺失与空串都拒（前端发送前本地建占位卡，节点 id 恒有值）。
    expect(
      videoSceneSplitInputSchema.safeParse({ source_asset_id: "88", granularity: "standard" })
        .success,
    ).toBe(false);
    expect(
      videoSceneSplitInputSchema.safeParse({ ...valid, target_node_id: "" }).success,
    ).toBe(false);
    // 三档全过（threshold 是产品语义档位，非 API 原生值——数值 5/10/20 不进输入键）。
    for (const granularity of VIDEO_SCENE_SPLIT_GRANULARITIES) {
      expect(
        videoSceneSplitInputSchema.safeParse({
          source_asset_id: "88",
          target_node_id: "node-1",
          granularity,
        }).success,
      ).toBe(true);
    }
  });

  it("result 键名冻结：duration / segments；段内 segment_index / start_time / end_time / segment_asset_id", () => {
    expect(Object.values(VIDEO_SCENE_SPLIT_RESULT_KEYS)).toEqual(["duration", "segments"]);
    expect(Object.values(VIDEO_SCENE_SPLIT_SEGMENT_KEYS)).toEqual([
      "segment_index",
      "start_time",
      "end_time",
      "segment_asset_id",
    ]);
  });

  it("result schema：1 段与 N 段同构不特判、起止秒为 Number、段序 1 起正整数、strict 多余键拒", () => {
    const singleSegment = {
      duration: 185.5,
      segments: [
        { segment_index: 1, start_time: 0, end_time: 185.5, segment_asset_id: "201" },
      ],
    };
    expect(videoSceneSplitResultSchema.parse(singleSegment)).toEqual(singleSegment);
    const multiSegment = {
      duration: 185.5,
      segments: [
        { segment_index: 1, start_time: 0, end_time: 15.2, segment_asset_id: "201" },
        { segment_index: 2, start_time: 15.2, end_time: 45.8, segment_asset_id: "202" },
        { segment_index: 3, start_time: 45.8, end_time: 185.5, segment_asset_id: "203" },
      ],
    };
    expect(videoSceneSplitResultSchema.parse(multiSegment)).toEqual(multiSegment);
    // 空段列表拒（segments 恒为数组、min(1)——1 段照常扇出，0 段是异常结果）。
    expect(
      videoSceneSplitResultSchema.safeParse({ duration: 185.5, segments: [] }).success,
    ).toBe(false);
    // strict：顶层与段内多余键一律拒。
    expect(
      videoSceneSplitResultSchema.safeParse({ ...singleSegment, extra: 1 }).success,
    ).toBe(false);
    expect(
      videoSceneSplitResultSchema.safeParse({
        duration: 185.5,
        segments: [{ ...singleSegment.segments[0], extra: 1 }],
      }).success,
    ).toBe(false);
    // 段序：0 / 负数 / 非整数拒（1 起正整数）。
    for (const segmentIndex of [0, -1, 1.5, "1", null]) {
      expect(
        videoSceneSplitResultSchema.safeParse({
          duration: 185.5,
          segments: [
            { segment_index: segmentIndex, start_time: 0, end_time: 1, segment_asset_id: "201" },
          ],
        }).success,
      ).toBe(false);
    }
    // 段资产引用：非 id 串拒（自有存储 Asset id；官方 24h 临时链接不进契约）。
    expect(
      videoSceneSplitResultSchema.safeParse({
        duration: 185.5,
        segments: [
          { segment_index: 1, start_time: 0, end_time: 1, segment_asset_id: "https://volc" },
        ],
      }).success,
    ).toBe(false);
    // 总时长与起止秒：负数拒（Number，秒）。
    expect(
      videoSceneSplitResultSchema.safeParse({
        duration: -1,
        segments: [
          { segment_index: 1, start_time: 0, end_time: 1, segment_asset_id: "201" },
        ],
      }).success,
    ).toBe(false);
  });

  it("输入门槛：视频时长 ≤2 小时（官方 PDF 使用限制表；缺失放行不误拦）", () => {
    expect(VIDEO_SCENE_SPLIT_MAX_DURATION_MS).toBe(2 * 60 * 60 * 1000);
  });
});

describe("video_scene_split 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("JobType 枚举含 VIDEO_SCENE_SPLIT(\"video_scene_split\")", () => {
    expect(jobTypeJava).toContain('VIDEO_SCENE_SPLIT("video_scene_split")');
  });

  it("GenerationMqRoute 含 VIDEO_SCENE_SPLIT(generation-task, video_scene_split)", () => {
    expect(mqRouteJava).toContain(
      `VIDEO_SCENE_SPLIT("${"generation-task"}", "${VIDEO_SCENE_SPLIT_TAG}")`,
    );
  });

  it("VideoSceneSplitContract：tag / source 与 TS 同值", () => {
    expect(contractJava).toContain("String TAG = GenerationMqRouteEnum.VIDEO_SCENE_SPLIT.tag();");
    expect(contractJava).toContain('String SOURCE = "video_scene_split";');
  });

  it("VideoSceneSplitContract：三 input 键名与 TS 同值", () => {
    for (const key of Object.values(VIDEO_SCENE_SPLIT_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("VideoSceneSplitContract：粒度三值、默认 standard 与三档 threshold 映射与 TS 同值", () => {
    expect(contractJava).toContain('List.of("fine", "standard", "coarse")');
    expect(contractJava).toContain('String DEFAULT_GRANULARITY = "standard";');
    expect(contractJava).toContain('"fine", 5,');
    expect(contractJava).toContain('"standard", 10,');
    expect(contractJava).toContain('"coarse", 20);');
  });

  it("VideoSceneSplitContract：火山端点两常量与对客模型名与 TS 同值", () => {
    expect(contractJava).toContain(`String SUBMIT_PATH = "${VIDEO_SCENE_SPLIT_SUBMIT_PATH}";`);
    expect(contractJava).toContain(`String POLL_PATH_PREFIX = "${VIDEO_SCENE_SPLIT_POLL_PATH_PREFIX}";`);
    expect(contractJava).toContain(`String MODEL_NAME = "${VIDEO_SCENE_SPLIT_MODEL_NAME}";`);
  });

  it("VideoSceneSplitContract：result / 段内键名与 TS 同值（跨进程结果契约）", () => {
    for (const key of [...Object.values(VIDEO_SCENE_SPLIT_RESULT_KEYS), ...Object.values(VIDEO_SCENE_SPLIT_SEGMENT_KEYS)]) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("VideoSceneSplitContract：时长门槛 2 小时与 TS 同值", () => {
    expect(contractJava).toContain("long MAX_INPUT_DURATION_MS = 2L * 60 * 60 * 1000;");
  });

  it("执行面兜底码 video_scene_split_failed → 1046（1045 已由视频 HD 高清占用），Java 契约侧常量同步", () => {
    expect(ERROR_VIDEO_SCENE_SPLIT_FAILED).toBe("video_scene_split_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_VIDEO_SCENE_SPLIT_FAILED]).toBe(1046);
    expect(ERROR_CODES[1046]).toBeTruthy();
    // worker 执行面（IKH8BP）引用侧防漂移：Java 契约常量与错误类常量同值口径（先例
    // VideoEnhanceError；本票契约先行只落契约类常量，错误类由 worker 票注册时引用本值）。
    expect(contractJava).toContain(
      'String ERROR_VIDEO_SCENE_SPLIT_FAILED = "video_scene_split_failed";',
    );
  });
});
