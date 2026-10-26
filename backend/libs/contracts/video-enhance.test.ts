import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { VIDEO_ENHANCE_TAG } from "../shared/generation/queue.constants.js";
import {
  ERROR_CODES,
  ERROR_VIDEO_ENHANCE_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  VIDEO_ENHANCE_BITRATE_LEVEL,
  VIDEO_ENHANCE_DEFAULT_RESOLUTION,
  VIDEO_ENHANCE_INPUT_KEYS,
  VIDEO_ENHANCE_JOB_TYPE,
  VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX,
  VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX,
  VIDEO_ENHANCE_MIN_INPUT_LONG_SIDE_PX,
  VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX,
  VIDEO_ENHANCE_POLL_PATH_PREFIX,
  VIDEO_ENHANCE_RESOLUTIONS,
  VIDEO_ENHANCE_SOURCE,
  VIDEO_ENHANCE_SUBMIT_PATH,
  videoEnhanceInputSchema,
} from "./video-enhance.js";

const contractJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/VideoEnhanceContract.java",
    import.meta.url,
  ),
  "utf8",
);
const jobTypeJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/JobTypeEnum.java",
    import.meta.url,
  ),
  "utf8",
);
const mqRouteJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/GenerationMqRouteEnum.java",
    import.meta.url,
  ),
  "utf8",
);

describe("video_enhance 契约不变量（官方 PDF 口径，TS 侧）", () => {
  it("任务类型 / MQ tag 同值 video_enhance，来源值 = 专属创建入口 video_enhance", () => {
    expect(VIDEO_ENHANCE_JOB_TYPE).toBe("video_enhance");
    expect(VIDEO_ENHANCE_TAG).toBe(VIDEO_ENHANCE_JOB_TYPE);
    expect(VIDEO_ENHANCE_SOURCE).toBe("video_enhance");
  });

  it("resolution 枚举三值 1080p/2k/4k（API 原生值，720p 被产品裁掉不暴露），默认档 1080p（非官方默认 720p）", () => {
    expect([...VIDEO_ENHANCE_RESOLUTIONS]).toEqual(["1080p", "2k", "4k"]);
    expect(VIDEO_ENHANCE_DEFAULT_RESOLUTION).toBe("1080p");
  });

  it("网关端点：提交 /v1/mediakit/{tool}、查询 /v1/mediakit/tasks/（IKH67T 实测校准）", () => {
    expect(VIDEO_ENHANCE_SUBMIT_PATH).toBe("/v1/mediakit/enhance-video-generative");
    expect(VIDEO_ENHANCE_POLL_PATH_PREFIX).toBe("/v1/mediakit/tasks/");
  });

  it("input 键名冻结：source_asset_id / target_node_id / resolution", () => {
    expect(Object.values(VIDEO_ENHANCE_INPUT_KEYS)).toEqual([
      "source_asset_id",
      "target_node_id",
      "resolution",
    ]);
  });

  it("schema：三键合法样本过、strict 多余键拒、source_asset_id 非 id 串拒、target_node_id 空串拒", () => {
    const valid = { source_asset_id: "88", target_node_id: "node-1", resolution: "1080p" };
    expect(videoEnhanceInputSchema.parse(valid)).toEqual(valid);
    expect(videoEnhanceInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(videoEnhanceInputSchema.safeParse({ ...valid, source_asset_id: "abc" }).success).toBe(
      false,
    );
    expect(videoEnhanceInputSchema.safeParse({ ...valid, source_asset_id: "0" }).success).toBe(
      false,
    );
    expect(videoEnhanceInputSchema.safeParse({ ...valid, target_node_id: "" }).success).toBe(
      false,
    );
  });

  it("schema：三档分辨率全过、枚举外一律拒——含被产品裁掉的官方默认 720p", () => {
    for (const resolution of VIDEO_ENHANCE_RESOLUTIONS) {
      expect(
        videoEnhanceInputSchema.safeParse({
          source_asset_id: "88",
          target_node_id: "node-1",
          resolution,
        }).success,
      ).toBe(true);
    }
    for (const resolution of ["720p", "1080P", "2K", "4K", "", null, 42, undefined]) {
      expect(
        videoEnhanceInputSchema.safeParse({
          source_asset_id: "88",
          target_node_id: "node-1",
          resolution,
        }).success,
      ).toBe(false);
    }
  });

  it("出站固定码率档位 medium（不进输入键；fps 不传保持原片帧率——ADR-0105）", () => {
    expect(VIDEO_ENHANCE_BITRATE_LEVEL).toBe("medium");
  });

  it("输入门槛：短边 [360,1080]、长边 [360,1920]（官方 PDF video_url 输入视频限制节）", () => {
    expect(VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX).toBe(360);
    expect(VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX).toBe(1080);
    expect(VIDEO_ENHANCE_MIN_INPUT_LONG_SIDE_PX).toBe(360);
    expect(VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX).toBe(1920);
  });
});

describe("video_enhance 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("JobType 枚举含 VIDEO_ENHANCE(\"video_enhance\")", () => {
    expect(jobTypeJava).toContain('VIDEO_ENHANCE("video_enhance")');
  });

  it("GenerationMqRoute 含 VIDEO_ENHANCE(generation-task, video_enhance)", () => {
    expect(mqRouteJava).toContain(
      `VIDEO_ENHANCE("${"generation-task"}", "${VIDEO_ENHANCE_TAG}")`,
    );
  });

  it("VideoEnhanceContract：tag / source 与 TS 同值", () => {
    expect(contractJava).toContain("String TAG = GenerationMqRouteEnum.VIDEO_ENHANCE.tag();");
    expect(contractJava).toContain('String SOURCE = "video_enhance";');
  });

  it("VideoEnhanceContract：三 input 键名与 TS 同值", () => {
    for (const key of Object.values(VIDEO_ENHANCE_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("VideoEnhanceContract：分辨率三值与默认 1080p 与 TS 同值", () => {
    expect(contractJava).toContain('List.of("1080p", "2k", "4k")');
    expect(contractJava).toContain('String DEFAULT_RESOLUTION = "1080p";');
  });

  it("VideoEnhanceContract：火山端点两常量与 TS 同值", () => {
    expect(contractJava).toContain(`String SUBMIT_PATH = "${VIDEO_ENHANCE_SUBMIT_PATH}";`);
    expect(contractJava).toContain(`String POLL_PATH_PREFIX = "${VIDEO_ENHANCE_POLL_PATH_PREFIX}";`);
  });

  it("VideoEnhanceContract：出站固定码率与输入门槛常量与 TS 同值", () => {
    expect(contractJava).toContain('String BITRATE_LEVEL = "medium";');
    expect(contractJava).toContain("int MIN_INPUT_SHORT_SIDE_PX = 360;");
    expect(contractJava).toContain("int MAX_INPUT_SHORT_SIDE_PX = 1080;");
    expect(contractJava).toContain("int MIN_INPUT_LONG_SIDE_PX = 360;");
    expect(contractJava).toContain("int MAX_INPUT_LONG_SIDE_PX = 1920;");
  });

  it("执行面兜底码 video_enhance_failed → 1045（1044 已由音视频分离占用），Java 契约侧常量同步", () => {
    expect(ERROR_VIDEO_ENHANCE_FAILED).toBe("video_enhance_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_VIDEO_ENHANCE_FAILED]).toBe(1045);
    expect(ERROR_CODES[1045]).toBeTruthy();
    expect(contractJava).toContain(
      'String ERROR_VIDEO_ENHANCE_FAILED = "video_enhance_failed";',
    );
    expect(
      readFileSync(
        new URL(
          "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/error/VideoEnhanceError.java",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toContain('String VIDEO_ENHANCE_FAILED = "video_enhance_failed";');
  });
});
