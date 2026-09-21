// IKHB6F：audio_trim（音频截取，画布音频卡「截取」，火山 MediaKit trim-audio）跨进程契约
// 双端一致性断言。防漂移约定（沿用 media-extract.test.ts / video-enhance.test.ts 读种子文本
// 的同源断言模式）：TS 侧常量直接 import 断言值；worker-java 无法 import TS 常量，本测试
// 直接读 Java 源码文本逐值对账——任一侧改动未同步即红。
// 官方 API 口径 = 火山引擎 AI MediaKit「提交音频裁剪任务 API」官方 PDF（format 枚举
// mp3/m4a/ogg/flac/wav、默认 m4a；start_time 默认 0 / end_time 默认片尾；两值单位秒、
// 最多两位小数、start_time 必须小于 end_time）。产品口径 = ADR-0111（默认跟随源格式、
// 贴边省略提交、精度三级）。后续票（IKHB6N web / IKHB6Y backend / IKHB7A worker）照抄
// 本契约与 audio-trim.ts，不得发明字段名。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  ERROR_AUDIO_TRIM_FAILED,
  ERROR_MEDIA_EXTRACT_PROVIDER_FAILED,
  ERROR_VIDEO_ENHANCE_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  AUDIO_TRIM_FALLBACK_OUTPUT_FORMAT,
  AUDIO_TRIM_INPUT_KEYS,
  AUDIO_TRIM_JOB_TYPE,
  AUDIO_TRIM_OUTPUT_FORMATS,
  AUDIO_TRIM_POLL_PATH_PREFIX,
  AUDIO_TRIM_SUBMIT_PATH,
  audioTrimInputSchema,
  buildAudioTrimTimeParams,
  defaultAudioTrimOutputFormat,
  roundAudioTrimSeconds,
} from "./audio-trim.js";

// 读 worker-java 侧常量源码（对账基准；3 级 .. = 仓库根）。
const contractJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/AudioTrimContract.java",
    import.meta.url,
  ),
  "utf8",
);
const audioTrimErrorJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/error/AudioTrimError.java",
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
const mqRouteJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/GenerationMqRouteEnum.java",
    import.meta.url,
  ),
  "utf8",
);

describe("audio_trim 契约不变量（官方 PDF 口径，TS 侧）", () => {
  it("任务类型 audio_trim（generation_jobs.type 与 MQ tag 同值口径）", () => {
    expect(AUDIO_TRIM_JOB_TYPE).toBe("audio_trim");
  });

  it("输出格式五值枚举 mp3/m4a/ogg/flac/wav（官方列举顺序），回退 m4a（官方默认值）", () => {
    expect([...AUDIO_TRIM_OUTPUT_FORMATS]).toEqual(["mp3", "m4a", "ogg", "flac", "wav"]);
    expect(AUDIO_TRIM_FALLBACK_OUTPUT_FORMAT).toBe("m4a");
  });

  it("input 键名冻结：source_asset_id / start_time / end_time / output_format", () => {
    expect(Object.values(AUDIO_TRIM_INPUT_KEYS)).toEqual([
      "source_asset_id",
      "start_time",
      "end_time",
      "output_format",
    ]);
  });

  it("网关端点：提交 /v1/mediakit/trim-audio、查询 /v1/mediakit/tasks/（IKH67T 实测校准）", () => {
    // 网关路径 ≠ 火山上游路径 POST /api/v1/tools/trim-audio（混用即 404）。
    expect(AUDIO_TRIM_SUBMIT_PATH).toBe("/v1/mediakit/trim-audio");
    expect(AUDIO_TRIM_POLL_PATH_PREFIX).toBe("/v1/mediakit/tasks/");
  });
});

describe("默认输出格式推导（ADR-0111：默认跟随源音频格式，按源文件名后缀）", () => {
  it("源格式在枚举内：五格式后缀各返回同格式（截取不改变格式）", () => {
    expect(defaultAudioTrimOutputFormat("podcast.mp3")).toBe("mp3");
    expect(defaultAudioTrimOutputFormat("voice-note.m4a")).toBe("m4a");
    expect(defaultAudioTrimOutputFormat("bgm.ogg")).toBe("ogg");
    expect(defaultAudioTrimOutputFormat("lossless.flac")).toBe("flac");
    expect(defaultAudioTrimOutputFormat("raw.wav")).toBe("wav");
  });

  it("后缀大小写不敏感：.MP3 / .M4A 同推小写格式", () => {
    expect(defaultAudioTrimOutputFormat("PODCAST.MP3")).toBe("mp3");
    expect(defaultAudioTrimOutputFormat("Voice.M4A")).toBe("m4a");
  });

  it("源格式不在枚举内（如 aac）/ 无后缀 / 空文件名：一律回退 m4a", () => {
    expect(defaultAudioTrimOutputFormat("record.aac")).toBe("m4a");
    expect(defaultAudioTrimOutputFormat("clip.wma")).toBe("m4a");
    expect(defaultAudioTrimOutputFormat("video-source.mp4")).toBe("m4a");
    expect(defaultAudioTrimOutputFormat("noextension")).toBe("m4a");
    expect(defaultAudioTrimOutputFormat("")).toBe("m4a");
    expect(defaultAudioTrimOutputFormat(".")).toBe("m4a");
  });
});

describe("提交精度收口（官方 PDF：秒，最多两位小数）", () => {
  it("整数与两位小数内原值返回（60 → 60、60.5 → 60.5、180.75 → 180.75）", () => {
    expect(roundAudioTrimSeconds(60)).toBe(60);
    expect(roundAudioTrimSeconds(60.5)).toBe(60.5);
    expect(roundAudioTrimSeconds(180.75)).toBe(180.75);
    expect(roundAudioTrimSeconds(0)).toBe(0);
  });

  it("超两位小数量化为两位（59.999 → 60、60.554 → 60.55；60.555 双精度近似略低于半分位 → 60.55）", () => {
    expect(roundAudioTrimSeconds(59.999)).toBe(60);
    expect(roundAudioTrimSeconds(60.554)).toBe(60.55);
    // 60.555 的双精度近似 ≈ 60.55499…，最近舍入向下（Math.round(x*100)/100 同值同向）；
    // 官方只约束「最多两位小数」，量化结果恒合法（显示面 0.1 秒精度下无感知差异）。
    expect(roundAudioTrimSeconds(60.555)).toBe(60.55);
  });

  it("量化幂等且吸收浮点尾差（0.1+0.2 形态 → 0.3，量化后再量化不变）", () => {
    expect(roundAudioTrimSeconds(0.30000000000000004)).toBe(0.3);
    expect(roundAudioTrimSeconds(2.675)).toBe(2.67); // ≈2.67499…，向下——同上口径
    for (const value of [59.999, 60.555, 0.30000000000000004, 1.005, 180.75]) {
      const once = roundAudioTrimSeconds(value);
      expect(roundAudioTrimSeconds(once)).toBe(once);
    }
  });
});

describe("贴边省略（ADR-0111：左缘贴 0 省 start_time、右缘贴源全长省 end_time）", () => {
  it("选区左缘贴 0：省略 start_time、照常传 end_time（走官方默认片头 =0）", () => {
    expect(buildAudioTrimTimeParams({ start: 0, end: 120.25, sourceDuration: 300 })).toEqual({
      end_time: 120.25,
    });
  });

  it("选区右缘贴源全长：照常传 start_time、省略 end_time（走官方默认片尾，规避整秒精度超界）", () => {
    expect(buildAudioTrimTimeParams({ start: 60.5, end: 300, sourceDuration: 300 })).toEqual({
      start_time: 60.5,
    });
  });

  it("全选（左贴 0 且右贴全长）：两键都省略，空参数提交", () => {
    expect(buildAudioTrimTimeParams({ start: 0, end: 300, sourceDuration: 300 })).toEqual({});
  });

  it("中间段：照常传两值（官方示例形态 start 60.5 / end 180.75）", () => {
    expect(
      buildAudioTrimTimeParams({ start: 60.5, end: 180.75, sourceDuration: 300 }),
    ).toEqual({ start_time: 60.5, end_time: 180.75 });
  });

  it("判定在先、量化在后：贴边判定用全精度精确相等，未省略值才收口两位小数", () => {
    // 左缘非 0（0.004 不贴边）→ start_time 保留并量化；右缘贴全长 → 省略。
    expect(
      buildAudioTrimTimeParams({ start: 0.004, end: 300, sourceDuration: 300 }),
    ).toEqual({ start_time: 0 });
    // 全精度中间段值出站必经两位小数量化。
    expect(
      buildAudioTrimTimeParams({ start: 1.23456, end: 9.87654, sourceDuration: 300 }),
    ).toEqual({ start_time: 1.23, end_time: 9.88 });
  });
});

describe("input schema（冻结后形态复核）", () => {
  it("四键合法样本过（官方示例形态）", () => {
    const valid = { source_asset_id: "88", start_time: 60.5, end_time: 180.75, output_format: "mp3" };
    expect(audioTrimInputSchema.parse(valid)).toEqual(valid);
  });

  it("贴边省略形态过：省 start_time 三键、双贴边两键（start_time/end_time 可选）", () => {
    const noStart = { source_asset_id: "88", end_time: 120.25, output_format: "wav" };
    expect(audioTrimInputSchema.parse(noStart)).toEqual(noStart);
    const neither = { source_asset_id: "88", output_format: "m4a" };
    expect(audioTrimInputSchema.parse(neither)).toEqual(neither);
  });

  it("strict 多余键拒、source_asset_id 非 id 串拒", () => {
    const valid = { source_asset_id: "88", output_format: "mp3" };
    expect(audioTrimInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(audioTrimInputSchema.safeParse({ ...valid, source_asset_id: "abc" }).success).toBe(false);
    expect(audioTrimInputSchema.safeParse({ ...valid, source_asset_id: "0" }).success).toBe(false);
  });

  it("五种格式全过、枚举外一律拒（aac 等源格式回退只发生在默认推导，显式传值明确拒绝）", () => {
    for (const format of AUDIO_TRIM_OUTPUT_FORMATS) {
      expect(
        audioTrimInputSchema.safeParse({ source_asset_id: "88", output_format: format }).success,
      ).toBe(true);
    }
    for (const format of ["aac", "wma", "MP3", "", null, 42, undefined]) {
      expect(
        audioTrimInputSchema.safeParse({ source_asset_id: "88", output_format: format }).success,
      ).toBe(false);
    }
  });

  it("时间值超两位小数拒（含浮点换算尾差 0.1+0.2 形态——强制消费方先经精度收口）", () => {
    for (const value of [1.234, 60.555, 0.30000000000000004]) {
      expect(
        audioTrimInputSchema.safeParse({
          source_asset_id: "88",
          start_time: value,
          output_format: "mp3",
        }).success,
      ).toBe(false);
    }
    // 量化后的值过（收口函数与 schema 同一口径）。
    expect(
      audioTrimInputSchema.safeParse({
        source_asset_id: "88",
        start_time: roundAudioTrimSeconds(0.30000000000000004),
        output_format: "mp3",
      }).success,
    ).toBe(true);
  });

  it("时间值负数 / NaN 拒", () => {
    for (const value of [-0.01, Number.NaN]) {
      expect(
        audioTrimInputSchema.safeParse({
          source_asset_id: "88",
          start_time: value,
          output_format: "mp3",
        }).success,
      ).toBe(false);
    }
  });

  it("两值同传时必须 start_time < end_time（官方「必须小于/必须大于」），相等也拒", () => {
    expect(
      audioTrimInputSchema.safeParse({
        source_asset_id: "88",
        start_time: 180.75,
        end_time: 60.5,
        output_format: "mp3",
      }).success,
    ).toBe(false);
    expect(
      audioTrimInputSchema.safeParse({
        source_asset_id: "88",
        start_time: 60.5,
        end_time: 60.5,
        output_format: "mp3",
      }).success,
    ).toBe(false);
    // 省略其一时不做跨值比较（省略值由官方默认补：片头 0 / 片尾全长）。
    expect(
      audioTrimInputSchema.safeParse({
        source_asset_id: "88",
        end_time: 0,
        output_format: "mp3",
      }).success,
    ).toBe(true);
  });
});

describe("执行面兜底码（error-codes.ts 注册）", () => {
  it("audio_trim_failed → 1048（1046 场景切分/1047 人声分离已先后占用〔!789/!787 先入 release〕，两次让号取下一空号），文案表同步", () => {
    expect(ERROR_AUDIO_TRIM_FAILED).toBe("audio_trim_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_AUDIO_TRIM_FAILED]).toBe(1048);
    expect(ERROR_CODES[1048]).toBeTruthy();
    // 家族相邻码不冲突（号位唯一）。
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_MEDIA_EXTRACT_PROVIDER_FAILED]).toBe(1044);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_VIDEO_ENHANCE_FAILED]).toBe(1045);
    expect(
      new Set(Object.values(GENERATION_ERROR_NUMERIC_CODES)).size,
    ).toBe(Object.keys(GENERATION_ERROR_NUMERIC_CODES).length);
  });
});

describe("audio_trim 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("AudioTrimContract：tag 转发 GenerationMqRouteEnum.AUDIO_TRIM（字面量单处在该枚举，video_enhance 先例）", () => {
    expect(contractJava).toContain(
      "String TAG = GenerationMqRouteEnum.AUDIO_TRIM.tag();",
    );
  });

  it("AudioTrimContract：四 input 键名与 TS 同值", () => {
    for (const key of Object.values(AUDIO_TRIM_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("AudioTrimContract：格式枚举五值（官方列举顺序）与回退 m4a 与 TS 同值", () => {
    expect(contractJava).toContain('List.of("mp3", "m4a", "ogg", "flac", "wav")');
    expect(contractJava).toContain('String FALLBACK_OUTPUT_FORMAT = "m4a";');
  });

  it("AudioTrimContract：网关端点两常量与 TS 同值", () => {
    expect(contractJava).toContain(`String SUBMIT_PATH = "${AUDIO_TRIM_SUBMIT_PATH}";`);
    expect(contractJava).toContain(`String POLL_PATH_PREFIX = "${AUDIO_TRIM_POLL_PATH_PREFIX}";`);
  });

  it("AudioTrimContract 与 AudioTrimError：兜底错误码与 TS 同值", () => {
    expect(contractJava).toContain('String ERROR_AUDIO_TRIM_FAILED = "audio_trim_failed";');
    expect(audioTrimErrorJava).toContain('String AUDIO_TRIM_FAILED = "audio_trim_failed";');
  });

  it("已接线：两侧枚举注册 audio_trim（JobTypeEnum 与 GenerationMqRouteEnum，tag = TS 任务类型同值）", () => {
    expect(jobTypeJava).toContain("audio_trim");
    expect(mqRouteJava).toContain(`("${"generation-task"}", "${AUDIO_TRIM_JOB_TYPE}")`);
  });
});
