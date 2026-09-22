// IKHLK3：video_frame_interpolation（视频插帧，火山 MediaKit video-frame-interpolation）跨进程契约
// 双端一致性断言（父需求 IKHLES）。防漂移约定（沿用 video-enhance.test.ts 读 Java 源码文本的同源
// 断言模式）：TS 侧常量直接 import 断言值；worker-java 无法 import TS 常量，本测试直接读 Java 源码
// 文本逐值对账——任一侧改动未同步即红。
// 官方 API 口径 = 火山引擎 AI MediaKit 参数级 API 参考页（提交视频插帧任务 API / 查询任务信息 API /
// 事件回调 / 错误码）四页，结论落盘 docs/specs/2026-09-21-video-frame-interpolation-mediakit.md；
// fps 官方取值范围 [15,120]（建议不超过原片 4 倍，低于原片时先插帧再降帧），本仓产品面收窄为
// 30/60/120 三档（ADR-0113）。
// 后续票（worker 执行 IKHLKJ / 前端面板）照抄本契约与 video-frame-interpolation.ts，不得发明字段名。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { VIDEO_FRAME_INTERPOLATION_TAG } from "../shared/generation/queue.constants.js";
import {
  ERROR_CODES,
  ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS,
  VIDEO_FRAME_INTERPOLATION_FPS_VALUES,
  VIDEO_FRAME_INTERPOLATION_INPUT_KEYS,
  VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
  VIDEO_FRAME_INTERPOLATION_POLL_PATH_PREFIX,
  VIDEO_FRAME_INTERPOLATION_RECOVERY_RESPONSE_KEYS,
  VIDEO_FRAME_INTERPOLATION_RECOVERY_ROUTE_SEGMENT,
  VIDEO_FRAME_INTERPOLATION_RESULT_KEYS,
  VIDEO_FRAME_INTERPOLATION_SOURCE,
  VIDEO_FRAME_INTERPOLATION_SUBMIT_PATH,
  videoFrameInterpolationInputSchema,
  videoFrameInterpolationRecoveryQuerySchema,
} from "./video-frame-interpolation.js";

// 读 worker-java 侧常量源码（对账基准；3 级 .. = 仓库根）。
const contractJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/VideoFrameInterpolationContract.java",
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
// tag 字面量单处定义在 GenerationMqRoute（Contract.TAG 只做转发），故 tag 的对账基准读该枚举。
const mqRouteJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/GenerationMqRouteEnum.java",
    import.meta.url,
  ),
  "utf8",
);

describe("video_frame_interpolation 契约不变量（官方参数级 API 参考页口径，TS 侧）", () => {
  it("任务类型 / MQ tag 同值 video_frame_interpolation，来源值 = 专属创建入口 video_frame_interpolation", () => {
    expect(VIDEO_FRAME_INTERPOLATION_JOB_TYPE).toBe("video_frame_interpolation");
    expect(VIDEO_FRAME_INTERPOLATION_TAG).toBe(VIDEO_FRAME_INTERPOLATION_JOB_TYPE);
    expect(VIDEO_FRAME_INTERPOLATION_SOURCE).toBe("video_frame_interpolation");
  });

  it("目标帧率三档 30/60/120（官方 [15,120] 的产品真子集），默认档 60", () => {
    expect([...VIDEO_FRAME_INTERPOLATION_FPS_VALUES]).toEqual([30, 60, 120]);
    expect(VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS).toBe(60);
  });

  it("网关端点：提交 /v1/mediakit/{tool}（假设值待 IKHLLB 对齐）、查询 /v1/mediakit/tasks/", () => {
    expect(VIDEO_FRAME_INTERPOLATION_SUBMIT_PATH).toBe("/v1/mediakit/video-frame-interpolation");
    // MediaKit 异步工具共用同一条查询路由；网关路径 ≠ 火山上游路径（video_enhance IKH67T 实测混用即 404）。
    expect(VIDEO_FRAME_INTERPOLATION_POLL_PATH_PREFIX).toBe("/v1/mediakit/tasks/");
  });

  it("input 键名冻结：source_asset_id / target_node_id / fps（整型直传，无 resolution / bitrate 键）", () => {
    expect(Object.values(VIDEO_FRAME_INTERPOLATION_INPUT_KEYS)).toEqual([
      "source_asset_id",
      "target_node_id",
      "fps",
    ]);
  });

  it("result 键名冻结：video_url / duration / resolution / fps（官方「异步任务结果」表四字段）", () => {
    expect(Object.values(VIDEO_FRAME_INTERPOLATION_RESULT_KEYS)).toEqual([
      "video_url",
      "duration",
      "resolution",
      "fps",
    ]);
  });

  it("schema：两键合法样本过、三档帧率全过、strict 多余键拒、源素材 id 非 id 串拒、目标节点空串拒", () => {
    const valid = { source_asset_id: "88", target_node_id: "node-1", fps: 60 };
    expect(videoFrameInterpolationInputSchema.parse(valid)).toEqual(valid);
    for (const fps of VIDEO_FRAME_INTERPOLATION_FPS_VALUES) {
      expect(
        videoFrameInterpolationInputSchema.safeParse({
          source_asset_id: "88",
          target_node_id: "node-1",
          fps,
        }).success,
      ).toBe(true);
    }
    expect(videoFrameInterpolationInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(
      videoFrameInterpolationInputSchema.safeParse({ ...valid, source_asset_id: "abc" }).success,
    ).toBe(false);
    expect(videoFrameInterpolationInputSchema.safeParse({ ...valid, source_asset_id: "0" }).success).toBe(
      false,
    );
    expect(videoFrameInterpolationInputSchema.safeParse({ ...valid, target_node_id: "" }).success).toBe(
      false,
    );
  });

  it("schema：fps 缺省（键缺失或显式 undefined）补默认 60 —— 与 HD 高清 resolution 必填口径不同", () => {
    const omitted = { source_asset_id: "88", target_node_id: "node-1" };
    expect(videoFrameInterpolationInputSchema.parse(omitted)).toEqual({ ...omitted, fps: 60 });
    expect(videoFrameInterpolationInputSchema.parse({ ...omitted, fps: undefined })).toEqual({
      ...omitted,
      fps: 60,
    });
  });

  it("schema：枚举外 fps 一律拒——含官方合法但产品未暴露的 45 与字符串 / 小数值形态", () => {
    // 45 在官方 [15,120] 内但被产品三档裁掉（ADR-0113），创建入口明确拒绝；其余为非法值形态。
    for (const fps of [45, 15, 120.5, "60", null, 0, -60, true]) {
      expect(
        videoFrameInterpolationInputSchema.safeParse({
          source_asset_id: "88",
          target_node_id: "node-1",
          fps,
        }).success,
        `fps=${JSON.stringify(fps)} 必须被拒`,
      ).toBe(false);
    }
  });
});

describe("video_frame_interpolation 恢复查询契约（IKHSFE：按项目 + 目标节点查回当前任务）", () => {
  it("路由段 current；响应键冻结 job_id / status / progress / created_at——不含 input（凭证不外泄）", () => {
    expect(VIDEO_FRAME_INTERPOLATION_RECOVERY_ROUTE_SEGMENT).toBe("current");
    expect(Object.values(VIDEO_FRAME_INTERPOLATION_RECOVERY_RESPONSE_KEYS)).toEqual([
      "job_id",
      "status",
      "progress",
      "created_at",
    ]);
  });

  it("schema：target_node_id 单键必填非空；strict 多余键拒、空串拒", () => {
    expect(videoFrameInterpolationRecoveryQuerySchema.parse({ target_node_id: "node-1" })).toEqual({
      target_node_id: "node-1",
    });
    expect(videoFrameInterpolationRecoveryQuerySchema.safeParse({}).success).toBe(false);
    expect(videoFrameInterpolationRecoveryQuerySchema.safeParse({ target_node_id: "" }).success).toBe(
      false,
    );
    expect(videoFrameInterpolationRecoveryQuerySchema.safeParse({ foo: 1 }).success).toBe(false);
    // 查询键与创建 input 的目标节点键同名（不另造键名）。
    expect(VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId).toBe("target_node_id");
  });
});

describe("video_frame_interpolation 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("JobType 枚举含 VIDEO_FRAME_INTERPOLATION(\"video_frame_interpolation\")", () => {
    expect(jobTypeJava).toContain('VIDEO_FRAME_INTERPOLATION("video_frame_interpolation")');
  });

  it("GenerationMqRoute 含 VIDEO_FRAME_INTERPOLATION(generation-task, video_frame_interpolation)", () => {
    expect(mqRouteJava).toContain(
      `VIDEO_FRAME_INTERPOLATION("${"generation-task"}", "${VIDEO_FRAME_INTERPOLATION_TAG}")`,
    );
  });

  it("VideoFrameInterpolationContract：tag / source 与 TS 同值", () => {
    expect(contractJava).toContain(
      "String TAG = GenerationMqRouteEnum.VIDEO_FRAME_INTERPOLATION.tag();",
    );
    expect(contractJava).toContain('String SOURCE = "video_frame_interpolation";');
  });

  it("VideoFrameInterpolationContract：三 input 键名与 TS 同值", () => {
    for (const key of Object.values(VIDEO_FRAME_INTERPOLATION_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("VideoFrameInterpolationContract：四 result 键名与 TS 同值", () => {
    for (const key of Object.values(VIDEO_FRAME_INTERPOLATION_RESULT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("VideoFrameInterpolationContract：帧率三值与默认 60 与 TS 同值", () => {
    expect(contractJava).toContain("List.of(30, 60, 120)");
    expect(contractJava).toContain("int DEFAULT_FPS = 60;");
  });

  it("VideoFrameInterpolationContract：火山端点两常量与 TS 同值", () => {
    expect(contractJava).toContain(
      `String SUBMIT_PATH = "${VIDEO_FRAME_INTERPOLATION_SUBMIT_PATH}";`,
    );
    expect(contractJava).toContain(
      `String POLL_PATH_PREFIX = "${VIDEO_FRAME_INTERPOLATION_POLL_PATH_PREFIX}";`,
    );
  });

  it("执行面兜底码 video_frame_interpolation_failed → 1049（1045-1048 已占用），Java 契约侧常量同步", () => {
    expect(ERROR_VIDEO_FRAME_INTERPOLATION_FAILED).toBe("video_frame_interpolation_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_VIDEO_FRAME_INTERPOLATION_FAILED]).toBe(1049);
    expect(ERROR_CODES[1049]).toBe("视频插帧失败，请重试");
    // worker 执行面（IKHLKJ）引用侧防漂移：Java 契约常量与错误类常量同值
    expect(contractJava).toContain(
      'String ERROR_VIDEO_FRAME_INTERPOLATION_FAILED = "video_frame_interpolation_failed";',
    );
    expect(
      readFileSync(
        new URL(
          "../../../worker-java/src/main/java/com/bluewhale/worker/domain/error/VideoFrameInterpolationError.java",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toContain('String VIDEO_FRAME_INTERPOLATION_FAILED = "video_frame_interpolation_failed";');
  });
});
