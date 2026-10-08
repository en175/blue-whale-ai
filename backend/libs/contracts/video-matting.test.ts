// IKHK7F：video_matting（智能抠像，火山 MediaKit matte-portrait-video /
// matte-greenscreen-video 双端点）跨进程契约双端一致性断言。防漂移约定（沿用
// video-scene-split.test.ts / video-enhance.test.ts 读种子文本的同源断言模式）：
// TS 侧常量直接 import 断言值；worker-java 无法 import TS 常量，本测试直接读 Java
// 源码文本逐值对账——任一侧改动未同步即红。官方 API 口径 = 火山引擎 AI MediaKit
// 「智能处理·视频抠图」官方开发指南 PDF（提交人像 /api/v1/tools/matte-portrait-video、
// 提交绿幕 /api/v1/tools/matte-greenscreen-video、共用查询 /api/v1/tasks/{task_id}；
// format 三选一 WEBM/MOV/MP4——本仓不暴露 MOV，background_color black/white/green，
// result = video_url + resolution + duration）。
// 后续票（创建入口 / worker 执行 / 前端编辑态）照抄本契约与 video-matting.ts，
// 不得发明字段名。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { VIDEO_MATTING_TAG } from "../shared/generation/queue.constants.js";
import {
  ERROR_CODES,
  ERROR_VIDEO_MATTING_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  VIDEO_MATTING_BACKGROUND_COLORS,
  VIDEO_MATTING_CLIENT_TOKEN_PATTERN,
  VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR,
  VIDEO_MATTING_DEFAULT_FORMAT,
  VIDEO_MATTING_FORMATS,
  VIDEO_MATTING_INPUT_KEYS,
  VIDEO_MATTING_JOB_TYPE,
  VIDEO_MATTING_MAX_DURATION_MS,
  VIDEO_MATTING_MODES,
  VIDEO_MATTING_MODEL_NAMES,
  VIDEO_MATTING_POLL_PATH_PREFIX,
  VIDEO_MATTING_RESULT_KEYS,
  VIDEO_MATTING_SOURCE,
  VIDEO_MATTING_SUBMIT_KEYS,
  VIDEO_MATTING_SUBMIT_PATHS,
  videoMattingInputSchema,
  videoMattingResultSchema,
  videoMattingSubmitSchema,
} from "./video-matting.js";

// 读 worker-java 侧常量源码（对账基准；3 级 .. = 仓库根）。
const contractJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/VideoMattingContract.java",
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
// tag 字面量单处定义在 GenerationMqRoute（VideoMattingContract.TAG 只做转发），故 tag 的对账基准读该枚举。
const mqRouteJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/GenerationMqRouteEnum.java",
    import.meta.url,
  ),
  "utf8",
);

describe("video_matting 契约不变量（官方 PDF 口径，TS 侧）", () => {
  it("任务类型 / MQ tag 同值 video_matting，来源值 = 专属创建入口 video_matting", () => {
    expect(VIDEO_MATTING_JOB_TYPE).toBe("video_matting");
    expect(VIDEO_MATTING_TAG).toBe(VIDEO_MATTING_JOB_TYPE);
    expect(VIDEO_MATTING_SOURCE).toBe("video_matting");
  });

  it("模式枚举 portrait / greenscreen；双端点提交路径集中一处映射（网关票 IKHK9O 定稿回填）", () => {
    expect([...VIDEO_MATTING_MODES]).toEqual(["portrait", "greenscreen"]);
    // portrait（人像）→ matte-portrait-video、greenscreen（绿幕）→ matte-greenscreen-video：
    // 端点映射 = 模式分流提交路径（模式不进提交参数），对齐 segment-scenes → /v1/mediakit/{tool} 规律。
    expect(VIDEO_MATTING_SUBMIT_PATHS).toEqual({
      portrait: "/v1/mediakit/matte-portrait-video",
      greenscreen: "/v1/mediakit/matte-greenscreen-video",
    });
    // 两模式共用 MediaKit 家族查询路由（路径不含 async 段）。
    expect(VIDEO_MATTING_POLL_PATH_PREFIX).toBe("/v1/mediakit/tasks/");
  });

  it("对客模型名按模式收敛为契约常量（候选值，以网关配置票 IKHK9O 为准）", () => {
    expect(VIDEO_MATTING_MODEL_NAMES).toEqual({
      portrait: "mediakit-matte-portrait-video",
      greenscreen: "mediakit-matte-greenscreen-video",
    });
  });

  it("格式两档 WEBM / MP4（无 MOV——ProRes 4444 Chrome 无法预览，ADR-0112），默认 WEBM", () => {
    expect([...VIDEO_MATTING_FORMATS]).toEqual(["WEBM", "MP4"]);
    expect(VIDEO_MATTING_DEFAULT_FORMAT).toBe("WEBM");
  });

  it("背景色三值 white / black / green，默认 white（不采用官方人像 green / 绿幕 black 口径，ADR-0112）", () => {
    expect([...VIDEO_MATTING_BACKGROUND_COLORS]).toEqual(["white", "black", "green"]);
    expect(VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR).toBe("white");
  });

  it("client_token 幂等键：≤64 可打印 ASCII、大小写敏感（家族 video_scene_split 同款 pattern）", () => {
    expect(VIDEO_MATTING_CLIENT_TOKEN_PATTERN).toEqual(/^[\x20-\x7E]{1,64}$/);
    expect(VIDEO_MATTING_CLIENT_TOKEN_PATTERN.test("abc-DEF_123.~")).toBe(true);
    expect(VIDEO_MATTING_CLIENT_TOKEN_PATTERN.test("a".repeat(64))).toBe(true);
    // 超长 / 非打印 / 空串拒（本仓不做归一化，逐字节比对）。
    expect(VIDEO_MATTING_CLIENT_TOKEN_PATTERN.test("a".repeat(65))).toBe(false);
    expect(VIDEO_MATTING_CLIENT_TOKEN_PATTERN.test("token-中文")).toBe(false);
    expect(VIDEO_MATTING_CLIENT_TOKEN_PATTERN.test("tok\ten")).toBe(false);
    expect(VIDEO_MATTING_CLIENT_TOKEN_PATTERN.test("")).toBe(false);
  });

  it("提交键名冻结：video_url / format / background_color（两模式共用官方参数）", () => {
    expect(Object.values(VIDEO_MATTING_SUBMIT_KEYS)).toEqual([
      "video_url",
      "format",
      "background_color",
    ]);
  });

  it("提交 schema：WEBM 无背景色过、MP4 三底色过；strict 多余键拒、video_url 空拒、MOV 拒、MP4 缺背景色拒、WEBM 带背景色拒、幂等键非法拒", () => {
    // WEBM（透明默认档）不带背景色：合法主路径。
    const webm = {
      video_url: "https://example.com/your_portrait_video.mp4",
      format: "WEBM",
      client_token: "idem-key-001",
    };
    expect(videoMattingSubmitSchema.parse(webm)).toEqual(webm);
    // MP4（纯色）三底色全过。
    for (const backgroundColor of VIDEO_MATTING_BACKGROUND_COLORS) {
      expect(
        videoMattingSubmitSchema.safeParse({
          video_url: "https://example.com/v.mp4",
          format: "MP4",
          background_color: backgroundColor,
          client_token: "idem-key-001",
        }).success,
      ).toBe(true);
    }
    // refine 两条：MP4 必填背景色、WEBM 不接受背景色。
    expect(
      videoMattingSubmitSchema.safeParse({
        video_url: "https://example.com/v.mp4",
        format: "MP4",
        client_token: "idem-key-001",
      }).success,
    ).toBe(false);
    expect(
      videoMattingSubmitSchema.safeParse({
        video_url: "https://example.com/v.mp4",
        format: "WEBM",
        background_color: "white",
        client_token: "idem-key-001",
      }).success,
    ).toBe(false);
    // strict：多余键拒。
    expect(
      videoMattingSubmitSchema.safeParse({ ...webm, extra: 1 }).success,
    ).toBe(false);
    // video_url 必填：缺失与空串拒。
    expect(
      videoMattingSubmitSchema.safeParse({
        format: "WEBM",
        client_token: "idem-key-001",
      }).success,
    ).toBe(false);
    expect(
      videoMattingSubmitSchema.safeParse({ ...webm, video_url: "" }).success,
    ).toBe(false);
    // 格式枚举外拒：官方有 MOV 但本仓不暴露（ADR-0112），非法值明确拒绝不给隐式降档。
    for (const format of ["MOV", "mov", "webm", 1, null]) {
      expect(
        videoMattingSubmitSchema.safeParse({ ...webm, format }).success,
      ).toBe(false);
    }
    // 背景色枚举外拒。
    expect(
      videoMattingSubmitSchema.safeParse({
        video_url: "https://example.com/v.mp4",
        format: "MP4",
        background_color: "GREEN",
        client_token: "idem-key-001",
      }).success,
    ).toBe(false);
    // client_token：缺失与超长拒（校验写法见上方 pattern 用例）。
    expect(
      videoMattingSubmitSchema.safeParse({
        video_url: "https://example.com/v.mp4",
        format: "WEBM",
      }).success,
    ).toBe(false);
    expect(
      videoMattingSubmitSchema.safeParse({
        ...webm,
        client_token: "a".repeat(65),
      }).success,
    ).toBe(false);
  });

  it("result 键名冻结：video_url / resolution / duration", () => {
    expect(Object.values(VIDEO_MATTING_RESULT_KEYS)).toEqual([
      "video_url",
      "resolution",
      "duration",
    ]);
  });

  it("input 键名冻结（IKHK98 创建入口冻结形态）：source_asset_id / target_node_id / mode / format / background_color", () => {
    expect(Object.values(VIDEO_MATTING_INPUT_KEYS)).toEqual([
      "source_asset_id",
      "target_node_id",
      "mode",
      "format",
      "background_color",
    ]);
  });

  it("input schema（冻结后形态）：双模式×双格式过、MP4 必填背景色、WEBM 拒背景色、MOV / 非法 mode 拒、strict 拒、资产 id 非数字拒、target_node_id 空、门槛常量 = 10 分钟", () => {
    // 合法主路径：portrait / greenscreen × WEBM / MP4（MP4 三底色）。
    for (const mode of VIDEO_MATTING_MODES) {
      expect(
        videoMattingInputSchema.safeParse({
          source_asset_id: "88",
          target_node_id: "node-1",
          mode,
          format: "WEBM",
        }).success,
      ).toBe(true);
      for (const backgroundColor of VIDEO_MATTING_BACKGROUND_COLORS) {
        expect(
          videoMattingInputSchema.safeParse({
            source_asset_id: "88",
            target_node_id: "node-1",
            mode,
            format: "MP4",
            background_color: backgroundColor,
          }).success,
        ).toBe(true);
      }
    }
    // mode 必填无默认（入口下拉直选），枚举外拒。
    for (const mode of [undefined, "human", 1, null]) {
      expect(
        videoMattingInputSchema.safeParse({
          source_asset_id: "88",
          target_node_id: "node-1",
          format: "WEBM",
          ...(mode === undefined ? {} : { mode }),
        }).success,
      ).toBe(false);
    }
    // format 枚举外拒（MOV 档不暴露，非法值明确拒绝不给隐式降档）。
    expect(
      videoMattingInputSchema.safeParse({
        source_asset_id: "88",
        target_node_id: "node-1",
        mode: "portrait",
        format: "MOV",
      }).success,
    ).toBe(false);
    // refine 两条与提交 schema 同口径：MP4 缺背景色拒、WEBM 带背景色拒。
    expect(
      videoMattingInputSchema.safeParse({
        source_asset_id: "88",
        target_node_id: "node-1",
        mode: "portrait",
        format: "MP4",
      }).success,
    ).toBe(false);
    expect(
      videoMattingInputSchema.safeParse({
        source_asset_id: "88",
        target_node_id: "node-1",
        mode: "portrait",
        format: "WEBM",
        background_color: VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR,
      }).success,
    ).toBe(false);
    expect(
      videoMattingInputSchema.safeParse({
        source_asset_id: "88",
        target_node_id: "node-1",
        mode: "portrait",
        format: "WEBM",
        client_token: "tok-001",
      }).success,
    ).toBe(false);
    // source_asset_id 非数字串拒、target_node_id 空拒。
    expect(
      videoMattingInputSchema.safeParse({
        source_asset_id: "08x",
        target_node_id: "node-1",
        mode: "portrait",
        format: "WEBM",
      }).success,
    ).toBe(false);
    expect(
      videoMattingInputSchema.safeParse({
        source_asset_id: "88",
        target_node_id: "",
        mode: "portrait",
        format: "WEBM",
      }).success,
    ).toBe(false);
    // 时长门槛：10 分钟产品上限（对齐去字幕口径，ADR-0112；官方无时长限制）。
    expect(VIDEO_MATTING_MAX_DURATION_MS).toBe(10 * 60 * 1000);
  });

  it("result schema：官方 result 三键同名透传（video_url 为转存自有存储后地址）、strict 多余键拒、时长负数拒", () => {
    const result = {
      video_url: "https://tos.example.com/matted-output.webm",
      resolution: "1080p",
      duration: 15.5,
    };
    expect(videoMattingResultSchema.parse(result)).toEqual(result);
    // strict：多余键拒。
    expect(videoMattingResultSchema.safeParse({ ...result, extra: 1 }).success).toBe(false);
    // 分辨率档位缺失 / 空串拒（官方字符串档位如 "1080p"）。
    expect(
      videoMattingResultSchema.safeParse({ ...result, resolution: "" }).success,
    ).toBe(false);
    // 时长：负数拒（Number，秒）。
    expect(videoMattingResultSchema.safeParse({ ...result, duration: -1 }).success).toBe(
      false,
    );
    // 产物地址：空串拒（自有存储公开读 URL；官方 24h 临时链接不跨进程落库）。
    expect(
      videoMattingResultSchema.safeParse({ ...result, video_url: "" }).success,
    ).toBe(false);
  });
});

describe("video_matting 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("JobType 枚举含 VIDEO_MATTING(\"video_matting\")", () => {
    expect(jobTypeJava).toContain('VIDEO_MATTING("video_matting")');
  });

  it("GenerationMqRoute 含 VIDEO_MATTING(generation-task, video_matting)", () => {
    expect(mqRouteJava).toContain(
      `VIDEO_MATTING("${"generation-task"}", "${VIDEO_MATTING_TAG}")`,
    );
  });

  it("VideoMattingContract：tag / source 与 TS 同值", () => {
    expect(contractJava).toContain("String TAG = GenerationMqRouteEnum.VIDEO_MATTING.tag();");
    expect(contractJava).toContain('String SOURCE = "video_matting";');
  });

  it("VideoMattingContract：模式两值与 TS 同值", () => {
    expect(contractJava).toContain('List.of("portrait", "greenscreen")');
  });

  it("VideoMattingContract：双端点提交路径、查询前缀、按模式模型名与 TS 同值", () => {
    for (const mode of VIDEO_MATTING_MODES) {
      expect(contractJava).toContain(`"${mode}", "${VIDEO_MATTING_SUBMIT_PATHS[mode]}"`);
      expect(contractJava).toContain(`"${mode}", "${VIDEO_MATTING_MODEL_NAMES[mode]}"`);
    }
    expect(contractJava).toContain(`String POLL_PATH_PREFIX = "${VIDEO_MATTING_POLL_PATH_PREFIX}";`);
  });

  it("VideoMattingContract：格式两值、默认 WEBM、背景色三值、默认 white 与 TS 同值", () => {
    expect(contractJava).toContain('List.of("WEBM", "MP4")');
    expect(contractJava).toContain('String DEFAULT_FORMAT = "WEBM";');
    expect(contractJava).toContain('List.of("white", "black", "green")');
    expect(contractJava).toContain('String DEFAULT_BACKGROUND_COLOR = "white";');
  });

  it("VideoMattingContract：提交 / result 键名与 TS 同值（跨进程提交参数与结果契约）", () => {
    for (const key of [...Object.values(VIDEO_MATTING_SUBMIT_KEYS), ...Object.values(VIDEO_MATTING_RESULT_KEYS)]) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("VideoMattingContract：五 input 键名与 TS 同值（冻结形态跨进程单源，先例同场景切分/去字幕）", () => {
    for (const key of Object.values(VIDEO_MATTING_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("执行面兜底码 video_matting_failed → 1050（1049 已由 !820 插帧先行合入占用，让号取 1050），Java 契约侧常量同步", () => {
    expect(ERROR_VIDEO_MATTING_FAILED).toBe("video_matting_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_VIDEO_MATTING_FAILED]).toBe(1050);
    expect(ERROR_CODES[1050]).toBeTruthy();
    // worker 执行面引用侧防漂移：Java 契约常量与错误类常量同值口径（先例
    // VideoSceneSplitError；本票契约先行只落契约类常量，错误类由 worker 票注册时引用本值）。
    expect(contractJava).toContain(
      'String ERROR_VIDEO_MATTING_FAILED = "video_matting_failed";',
    );
  });
});
