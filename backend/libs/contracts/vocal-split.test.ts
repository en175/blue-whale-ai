// IKHA2C：vocal_split（人声背景分离）跨进程契约双端一致性断言。
// 防漂移约定（沿用 media-extract.test.ts 读种子文本的同源断言模式）：TS 侧常量直接
// import 断言值；worker-java 无法 import TS 常量，本测试直接读 Java 源码文本逐值对账——
// 任一侧改动未同步即红。
// 官方 API 口径 = 火山引擎 AI MediaKit「人声背景音分离」官方 PDF（scene 四档
// Audio/Music/Drama/Narrate、格式 aac/mp3/wav/m4a/flac 默认 aac、二分法两轨 / 三分法三轨）。
// 后续票（IKHA2J worker 编排 / 创建入口 / 前端）照抄本契约与 vocal-split.ts，不得发明字段名。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { VOCAL_SPLIT_TAG } from "../shared/generation/queue.constants.js";
import {
  ERROR_CODES,
  ERROR_VOCAL_SPLIT_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT,
  VOCAL_SPLIT_DEFAULT_SCENE,
  VOCAL_SPLIT_INPUT_KEYS,
  VOCAL_SPLIT_JOB_TYPE,
  VOCAL_SPLIT_OUTPUT_FORMATS,
  VOCAL_SPLIT_POLL_PATH_PREFIX,
  VOCAL_SPLIT_SCENE_TRACKS,
  VOCAL_SPLIT_SCENE_UPSTREAM_MAP,
  VOCAL_SPLIT_SCENES,
  VOCAL_SPLIT_SOURCE,
  VOCAL_SPLIT_SUBMIT_PATH,
  VOCAL_SPLIT_TRACK_TYPES,
  vocalSplitInputSchema,
} from "./vocal-split.js";

// 读 worker-java 侧常量源码（对账基准；3 级 .. = 仓库根）。
const contractJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/VocalSplitContract.java",
    import.meta.url,
  ),
  "utf8",
);
const vocalSplitErrorJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/error/VocalSplitError.java",
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
// tag 字面量单处定义在 GenerationMqRoute（VocalSplitContract.TAG 只做转发），故 tag 的对账基准读该枚举。
const mqRouteJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/GenerationMqRouteEnum.java",
    import.meta.url,
  ),
  "utf8",
);

describe("vocal_split 契约不变量（官方 PDF 口径，TS 侧）", () => {
  it("任务类型 / MQ tag 同值 vocal_split，来源值为专属来源值模式", () => {
    expect(VOCAL_SPLIT_JOB_TYPE).toBe("vocal_split");
    expect(VOCAL_SPLIT_TAG).toBe(VOCAL_SPLIT_JOB_TYPE);
    // 专属来源值（claim source 白名单模式，video_subtitle_erase / video_enhance 同款）；
    // media_extract 的 "dock" 是存量迁移特例，新工具不沿用。
    expect(VOCAL_SPLIT_SOURCE).toBe("vocal_split");
  });

  it("scene 四档 audio/music/drama/narrate，默认 audio，出站映射官方 Audio/Music/Drama/Narrate", () => {
    expect([...VOCAL_SPLIT_SCENES]).toEqual(["audio", "music", "drama", "narrate"]);
    expect(VOCAL_SPLIT_DEFAULT_SCENE).toBe("audio");
    expect(VOCAL_SPLIT_SCENE_UPSTREAM_MAP).toEqual({
      audio: "Audio",
      music: "Music",
      drama: "Drama",
      narrate: "Narrate",
    });
    // 出站映射的值域与产品键域一一对应（无多余键、无遗漏键）。
    expect(Object.keys(VOCAL_SPLIT_SCENE_UPSTREAM_MAP).sort()).toEqual([...VOCAL_SPLIT_SCENES].sort());
    expect(new Set(Object.values(VOCAL_SPLIT_SCENE_UPSTREAM_MAP)).size).toBe(VOCAL_SPLIT_SCENES.length);
  });

  it("多轨结果结构：轨类型四值；通用/音乐两轨（voice+background），短剧/口播三轨（voice+music+sfx）", () => {
    expect([...VOCAL_SPLIT_TRACK_TYPES]).toEqual(["voice", "background", "music", "sfx"]);
    expect(VOCAL_SPLIT_SCENE_TRACKS.audio).toEqual(["voice", "background"]);
    expect(VOCAL_SPLIT_SCENE_TRACKS.music).toEqual(["voice", "background"]);
    expect(VOCAL_SPLIT_SCENE_TRACKS.drama).toEqual(["voice", "music", "sfx"]);
    expect(VOCAL_SPLIT_SCENE_TRACKS.narrate).toEqual(["voice", "music", "sfx"]);
    // 四档轨序全覆盖（键域 = scene 枚举），voice 恒首轨，轨数恒 2/3（expected_output_count 口径）。
    expect(Object.keys(VOCAL_SPLIT_SCENE_TRACKS).sort()).toEqual([...VOCAL_SPLIT_SCENES].sort());
    for (const scene of VOCAL_SPLIT_SCENES) {
      const tracks = VOCAL_SPLIT_SCENE_TRACKS[scene];
      expect(tracks[0]).toBe("voice");
      expect(tracks.length === 2 || tracks.length === 3).toBe(true);
      // 轨类型都在四值枚举内且不重复。
      expect(new Set(tracks).size).toBe(tracks.length);
      for (const track of tracks) {
        expect((VOCAL_SPLIT_TRACK_TYPES as readonly string[]).includes(track)).toBe(true);
      }
    }
  });

  it("output_format 枚举五值 aac/mp3/wav/m4a/flac（有 aac 无 ogg），默认 aac", () => {
    expect([...VOCAL_SPLIT_OUTPUT_FORMATS]).toEqual(["aac", "mp3", "wav", "m4a", "flac"]);
    expect(VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT).toBe("aac");
    // 与 media_extract 枚举面互斥面核对：本工具有 aac 无 ogg（extract-audio 恰好相反）。
    expect(VOCAL_SPLIT_OUTPUT_FORMATS).not.toContain("ogg");
  });

  it("网关端点：提交路径家族惯例预占位（网关票定稿后回填）、查询共用 /v1/mediakit/tasks/", () => {
    expect(VOCAL_SPLIT_SUBMIT_PATH).toBe("/v1/mediakit/separate-voice");
    // MediaKit 异步工具共用查询路由；网关路径 ≠ 火山上游路径（IKH67T，混用即 404）。
    expect(VOCAL_SPLIT_POLL_PATH_PREFIX).toBe("/v1/mediakit/tasks/");
  });

  it("input 键名冻结：source_asset_id / scene / output_format（提交参数名区别于 extract-audio 的 format）", () => {
    expect(Object.values(VOCAL_SPLIT_INPUT_KEYS)).toEqual([
      "source_asset_id",
      "scene",
      "output_format",
    ]);
  });

  it("schema：三键合法样本过、strict 多余键拒、source_asset_id 非 id 串拒", () => {
    const valid = { source_asset_id: "88", scene: "drama", output_format: "aac" };
    expect(vocalSplitInputSchema.parse(valid)).toEqual(valid);
    expect(vocalSplitInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(vocalSplitInputSchema.safeParse({ ...valid, source_asset_id: "abc" }).success).toBe(
      false,
    );
    expect(vocalSplitInputSchema.safeParse({ ...valid, source_asset_id: "0" }).success).toBe(false);
  });

  it("schema：scene 四值与格式五值全过；枚举外一律拒（含官方大写值 Audio 不内收，非法不静默回退）", () => {
    for (const scene of VOCAL_SPLIT_SCENES) {
      for (const format of VOCAL_SPLIT_OUTPUT_FORMATS) {
        expect(
          vocalSplitInputSchema.safeParse({ source_asset_id: "88", scene, output_format: format })
            .success,
        ).toBe(true);
      }
    }
    for (const scene of ["Audio", "通用", "", null, 42]) {
      expect(
        vocalSplitInputSchema.safeParse({ source_asset_id: "88", scene, output_format: "aac" })
          .success,
      ).toBe(false);
    }
    for (const format of ["ogg", "m4b", "AAC", "", null, 42]) {
      expect(
        vocalSplitInputSchema.safeParse({ source_asset_id: "88", scene: "audio", output_format: format })
          .success,
      ).toBe(false);
    }
  });

  it("执行兜底码 vocal_split_failed → 1046，与既有各工具兜底码不冲突，文案表同步", () => {
    expect(ERROR_VOCAL_SPLIT_FAILED).toBe("vocal_split_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_VOCAL_SPLIT_FAILED]).toBe(1046);
    expect(ERROR_CODES[1046]).toBeTruthy();
    // 1046 是 1045（video_enhance）之后的下一空号，不与任何既有码撞位。
    for (const [code, numeric] of Object.entries(GENERATION_ERROR_NUMERIC_CODES)) {
      if (code !== ERROR_VOCAL_SPLIT_FAILED) {
        expect(numeric).not.toBe(1046);
      }
    }
  });
});

describe("vocal_split 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("JobType 枚举含 VOCAL_SPLIT(\"vocal_split\")（新任务类型注册）", () => {
    expect(jobTypeJava).toContain('VOCAL_SPLIT("vocal_split")');
  });

  it("GenerationMqRoute 含 VOCAL_SPLIT(generation-task, vocal_split)", () => {
    expect(mqRouteJava).toContain(
      `VOCAL_SPLIT("${"generation-task"}", "${VOCAL_SPLIT_TAG}")`,
    );
  });

  it("VocalSplitContract：tag / source 与 TS 同值", () => {
    expect(contractJava).toContain("String TAG = GenerationMqRouteEnum.VOCAL_SPLIT.tag();");
    expect(contractJava).toContain('String SOURCE = "vocal_split";');
  });

  it("VocalSplitContract：三 input 键名与 TS 同值", () => {
    for (const key of Object.values(VOCAL_SPLIT_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("VocalSplitContract：scene 枚举四值、默认 audio、出站映射与 TS 同值", () => {
    expect(contractJava).toContain('List.of("audio", "music", "drama", "narrate")');
    expect(contractJava).toContain('String DEFAULT_SCENE = "audio";');
    for (const [productKey, upstream] of Object.entries(VOCAL_SPLIT_SCENE_UPSTREAM_MAP)) {
      expect(contractJava).toContain(`"${productKey}", "${upstream}"`);
    }
  });

  it("VocalSplitContract：多轨结构（轨类型四值 + scene 轨序）与 TS 同值", () => {
    expect(contractJava).toContain('List.of("voice", "background", "music", "sfx")');
    for (const [scene, tracks] of Object.entries(VOCAL_SPLIT_SCENE_TRACKS)) {
      expect(contractJava).toContain(`"${scene}", List.of(${tracks.map((t) => `"${t}"`).join(", ")})`);
    }
  });

  it("VocalSplitContract：格式枚举五值与默认 aac 与 TS 同值", () => {
    expect(contractJava).toContain('List.of("aac", "mp3", "wav", "m4a", "flac")');
    expect(contractJava).toContain('String DEFAULT_OUTPUT_FORMAT = "aac";');
  });

  it("VocalSplitContract：火山端点两常量与 TS 同值", () => {
    expect(contractJava).toContain(`String SUBMIT_PATH = "${VOCAL_SPLIT_SUBMIT_PATH}";`);
    expect(contractJava).toContain(`String POLL_PATH_PREFIX = "${VOCAL_SPLIT_POLL_PATH_PREFIX}";`);
  });

  it("VocalSplitContract 与 VocalSplitError：兜底错误码与 TS 同值", () => {
    expect(contractJava).toContain(
      'String ERROR_VOCAL_SPLIT_FAILED = "vocal_split_failed";',
    );
    expect(vocalSplitErrorJava).toContain(
      'String VOCAL_SPLIT_FAILED = "vocal_split_failed";',
    );
  });
});
