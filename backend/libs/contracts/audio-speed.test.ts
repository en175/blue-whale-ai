// IKHW48：audio_speed（音频调速，画布音频卡「调速」，火山 MediaKit adjust-audio-speed）
// 跨进程契约一致性断言。对齐 audio-trim.test.ts 接缝（TS 侧常量直接 import 断言值；
// 零新增测试设施）。防漂移约定（audio-trim.test.ts 同款）：worker-java 无法 import TS
// 常量，下方「双端一致性」组直接读 Java 源码文本逐值对账——任一侧改动未同步即红
// （AudioSpeedContract.java 已随执行票 IKHW5A 落地，对账组同步补齐；audio-trim.test.ts
// 「已接线」组的演进先例）。backend 入队 tag（queue.constants.ts 的 AUDIO_SPEED_TAG）
// 由 IKHW59 落地，mq-route-parity.test.ts 对枚举表自动对账。
// 官方 API 口径 = 火山引擎 AI MediaKit adjust-audio-speed 官方 CLI 参考文档
// （volcengine/mediakit-cli 仓库，Cloud 模式契约）：speed 范围 [0.1, 4] 默认 1；
// 终态 result.audio_url（24h 临时链接）/ result.duration（秒）——字段名已对官方文档逐字复核
// 证实（非视频侧示例推测）；官方另有可选 format 参数（默认 m4a），本产品不传、产物格式
// 跟随官方输出。产品口径 = 父单 IKHVYO「实现决策」2、3（分段中点映射、0.05 步进）：
// https://e.gitee.com/hangzhou-xuanfu_1/issues/IKHVYO 。贴原速省略是 buildAudioSpeedInput 的防御性收口。后续票（IKHW59 backend / IKHW5C+IKHW5S web）照抄本契约
// 与 audio-speed.ts，不得发明字段名。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  ERROR_AUDIO_SPEED_FAILED,
  ERROR_AUDIO_TRIM_FAILED,
  ERROR_VIDEO_MATTING_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  AUDIO_SPEED_INPUT_KEYS,
  AUDIO_SPEED_JOB_TYPE,
  AUDIO_SPEED_MAX_SPEED,
  AUDIO_SPEED_MIN_SPEED,
  AUDIO_SPEED_OUTPUT_FORMAT,
  AUDIO_SPEED_POLL_PATH_PREFIX,
  AUDIO_SPEED_SLIDER_MAX_POS,
  AUDIO_SPEED_SLIDER_MID_POS,
  AUDIO_SPEED_SLIDER_MIN_POS,
  AUDIO_SPEED_SOURCE,
  AUDIO_SPEED_SUBMIT_PATH,
  audioSpeedInputSchema,
  buildAudioSpeedInput,
  posToSpeed,
  roundAudioSpeed,
  speedToPos,
} from "./audio-speed.js";

// 读 worker-java 侧常量源码（对账基准；3 级 .. = 仓库根；IKHW5A 已落地）。
const contractJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/AudioSpeedContract.java",
    import.meta.url,
  ),
  "utf8",
);
const audioSpeedErrorJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/error/AudioSpeedError.java",
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

describe("audio_speed 契约不变量（官方 CLI 参考文档口径，TS 侧）", () => {
  it("任务类型 audio_speed（generation_jobs.type 与 MQ tag 同值口径），来源 dock", () => {
    expect(AUDIO_SPEED_JOB_TYPE).toBe("audio_speed");
    expect(AUDIO_SPEED_SOURCE).toBe("dock");
  });

  it("input 键名冻结：source_asset_id / speed", () => {
    expect(Object.values(AUDIO_SPEED_INPUT_KEYS)).toEqual(["source_asset_id", "speed"]);
  });

  it("网关端点：提交 /v1/mediakit/adjust-audio-speed、查询 /v1/mediakit/tasks/（IKH67T 实测校准）", () => {
    // 网关路径 ≠ 火山上游路径 POST /api/v1/tools/adjust-audio-speed（混用即 404）；
    // 对客路径按家族规律 /v1/mediakit/{上游同名工具段} 取值，网关配置票定稿后回填。
    expect(AUDIO_SPEED_SUBMIT_PATH).toBe("/v1/mediakit/adjust-audio-speed");
    expect(AUDIO_SPEED_POLL_PATH_PREFIX).toBe("/v1/mediakit/tasks/");
  });

  it("产物输出格式默认 m4a（官方 format 节默认值，本产品不传；审查修复 D 进契约单源）", () => {
    expect(AUDIO_SPEED_OUTPUT_FORMAT).toBe("m4a");
  });
});

describe("滑杆分段映射（父单 IKHVYO 实现决策 3 原型定稿函数，契约层单源）", () => {
  it("posToSpeed 端点与中点：0 → 0.10、1000 → 4.00、500 → 1.00（分段线性，原速视觉中点）", () => {
    expect(posToSpeed(0)).toBe(0.1);
    expect(posToSpeed(1000)).toBe(4.0);
    expect(posToSpeed(500)).toBe(1.0);
    // 与滑杆位置域常量互锁（引用方刻度/区间定位不自造字面量）。
    expect(posToSpeed(AUDIO_SPEED_SLIDER_MIN_POS)).toBe(AUDIO_SPEED_MIN_SPEED);
    expect(posToSpeed(AUDIO_SPEED_SLIDER_MAX_POS)).toBe(AUDIO_SPEED_MAX_SPEED);
    expect(posToSpeed(AUDIO_SPEED_SLIDER_MID_POS)).toBe(1.0);
  });

  it("speedToPos 端点与中点：0.10 → 0、4.00 → 1000、1.00 → 500（posToSpeed 逆映射）", () => {
    expect(speedToPos(0.1)).toBe(0);
    expect(speedToPos(4.0)).toBe(1000);
    expect(speedToPos(1.0)).toBe(500);
    // 父单 IKHVYO「用户故事」13 /「实现决策」3 刻度档位定位值：0.5x / 2.0x 刻度落位（四舍五入取整位置）。
    expect(speedToPos(0.5)).toBe(222);
    expect(speedToPos(2.0)).toBe(667);
  });

  it("0.05 步进量化：任意整数位置的产物恒为 0.05 网格点且两位小数内、夹在 [0.1, 4.0]", () => {
    for (let pos = AUDIO_SPEED_SLIDER_MIN_POS; pos <= AUDIO_SPEED_SLIDER_MAX_POS; pos += 1) {
      const speed = posToSpeed(pos);
      expect(speed).toBeGreaterThanOrEqual(AUDIO_SPEED_MIN_SPEED);
      expect(speed).toBeLessThanOrEqual(AUDIO_SPEED_MAX_SPEED);
      expect(Number(speed.toFixed(2))).toBe(speed); // 两位小数内（无第三位尾差）
      expect(Math.round(speed * 100) % 5).toBe(0); // 0.05 网格点
    }
  });

  it("往返一致：全部 0.05 网格点 speedToPos → posToSpeed 还原原值（79 档全覆盖）", () => {
    for (let i = 2; i <= 80; i += 1) {
      const speed = Number((i * 0.05).toFixed(2)); // 0.10 ~ 4.00 步进 0.05
      expect(posToSpeed(speedToPos(speed)), `speed=${speed}`).toBe(speed);
    }
  });
});

describe("提交精度收口（产品契约口径：最多两位小数，0.05 步进天然满足）", () => {
  it("整数与两位小数内原值返回（1 → 1、1.35 → 1.35、0.1 → 0.1、4 → 4）", () => {
    expect(roundAudioSpeed(1)).toBe(1);
    expect(roundAudioSpeed(1.35)).toBe(1.35);
    expect(roundAudioSpeed(0.1)).toBe(0.1);
    expect(roundAudioSpeed(4)).toBe(4);
  });

  it("超两位小数量化为两位、吸收浮点尾差（网格乘法 0.05×k 形态）且幂等", () => {
    expect(roundAudioSpeed(1.356)).toBe(1.36);
    expect(roundAudioSpeed(0.30000000000000004)).toBe(0.3);
    expect(roundAudioSpeed(3 * 0.05)).toBe(0.15);
    expect(roundAudioSpeed(41 * 0.05)).toBe(2.05);
    for (const value of [1.356, 0.30000000000000004, 3 * 0.05, 41 * 0.05]) {
      const once = roundAudioSpeed(value);
      expect(roundAudioSpeed(once)).toBe(once);
    }
  });
});

describe("贴原速省略 + 冻结 input 构造（buildAudioSpeedInput，口径同截取贴边省略）", () => {
  it("非 1.0 倍速：双键全出（尾差先量化两位小数），产物恒过 schema", () => {
    const input = buildAudioSpeedInput({ sourceAssetId: "88", speed: 41 * 0.05 });
    expect(input).toEqual({ source_asset_id: "88", speed: 2.05 });
    expect(audioSpeedInputSchema.parse(input)).toEqual(input);
  });

  it("恰为 1.0（= 官方默认值）：省略 speed 键走官方默认 1（判定在先、量化在后）", () => {
    expect(buildAudioSpeedInput({ sourceAssetId: "88", speed: 1 })).toEqual({
      source_asset_id: "88",
    });
  });

  it("键名恒等 AUDIO_SPEED_INPUT_KEYS（工厂内不自造键名字面量）", () => {
    const input = buildAudioSpeedInput({ sourceAssetId: "5", speed: 0.75 });
    expect(Object.keys(input).sort()).toEqual([...Object.values(AUDIO_SPEED_INPUT_KEYS)].sort());
  });
});

describe("input schema（冻结后形态复核）", () => {
  it("双键合法样本过（含范围端点 0.10 / 4.00）", () => {
    const valid = { source_asset_id: "88", speed: 1.35 };
    expect(audioSpeedInputSchema.parse(valid)).toEqual(valid);
    expect(audioSpeedInputSchema.safeParse({ source_asset_id: "88", speed: 0.1 }).success).toBe(true);
    expect(audioSpeedInputSchema.safeParse({ source_asset_id: "88", speed: 4.0 }).success).toBe(true);
  });

  it("贴原速省略形态过：省 speed 单键（undefined = 走官方默认 1.0）", () => {
    const neither = { source_asset_id: "88" };
    expect(audioSpeedInputSchema.parse(neither)).toEqual(neither);
  });

  it("strict 多余键拒、source_asset_id 非 id 串拒", () => {
    const valid = { source_asset_id: "88", speed: 1.35 };
    expect(audioSpeedInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(audioSpeedInputSchema.safeParse({ ...valid, source_asset_id: "abc" }).success).toBe(false);
    expect(audioSpeedInputSchema.safeParse({ ...valid, source_asset_id: "0" }).success).toBe(false);
  });

  it("speed 越界一律拒：0.09 / 4.01 / 0 / 负数 / NaN / 非数字类型", () => {
    for (const speed of [0.09, 4.01, 0, -1, Number.NaN, "1.5", null]) {
      expect(
        audioSpeedInputSchema.safeParse({ source_asset_id: "88", speed }).success,
        `speed=${String(speed)}`,
      ).toBe(false);
    }
  });

  it("speed 超两位小数拒（含浮点尾差 0.05×k 形态——强制消费方先经精度收口）", () => {
    for (const speed of [1.355, 0.30000000000000004, 3 * 0.05, 41 * 0.05]) {
      expect(
        audioSpeedInputSchema.safeParse({ source_asset_id: "88", speed }).success,
        `speed=${speed}`,
      ).toBe(false);
    }
    // 量化后的值过（收口函数与 schema 同一口径）。
    expect(
      audioSpeedInputSchema.safeParse({
        source_asset_id: "88",
        speed: roundAudioSpeed(0.30000000000000004),
      }).success,
    ).toBe(true);
  });
});

describe("执行面兜底码（error-codes.ts 注册）", () => {
  it("audio_speed_failed → 1051（1045-1050 已由家族占用取下一空号，落码前全仓 grep 1051 零命中），文案表同步", () => {
    expect(ERROR_AUDIO_SPEED_FAILED).toBe("audio_speed_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_AUDIO_SPEED_FAILED]).toBe(1051);
    expect(ERROR_CODES[1051]).toBeTruthy();
    // 家族相邻码不冲突（号位唯一）。
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_AUDIO_TRIM_FAILED]).toBe(1048);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_VIDEO_MATTING_FAILED]).toBe(1050);
    expect(
      new Set(Object.values(GENERATION_ERROR_NUMERIC_CODES)).size,
    ).toBe(Object.keys(GENERATION_ERROR_NUMERIC_CODES).length);
  });
});

describe("audio_speed 双端一致性（读 worker-java 源码文本，防漂移，IKHW5A 落地后补齐）", () => {
  it("AudioSpeedContract：tag 转发 GenerationMqRouteEnum.AUDIO_SPEED（字面量单处在该枚举，audio_trim 先例）", () => {
    expect(contractJava).toContain(
      "String TAG = GenerationMqRouteEnum.AUDIO_SPEED.tag();",
    );
  });

  it("AudioSpeedContract：两 input 键名与 TS 同值 + 转存格式与 TS 常量同值（官方 format 默认值，本产品不传；审查修复 D 收口单源对账）", () => {
    for (const key of Object.values(AUDIO_SPEED_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
    expect(contractJava).toContain(
      `String TRANSFER_OUTPUT_FORMAT = "${AUDIO_SPEED_OUTPUT_FORMAT}";`,
    );
  });

  it("AudioSpeedContract：网关端点两常量与 TS 同值", () => {
    expect(contractJava).toContain(`String SUBMIT_PATH = "${AUDIO_SPEED_SUBMIT_PATH}";`);
    expect(contractJava).toContain(
      `String POLL_PATH_PREFIX = "${AUDIO_SPEED_POLL_PATH_PREFIX}";`,
    );
  });

  it("AudioSpeedContract 与 AudioSpeedError：兜底错误码与 TS 同值", () => {
    expect(contractJava).toContain(
      'String ERROR_AUDIO_SPEED_FAILED = "audio_speed_failed";',
    );
    expect(audioSpeedErrorJava).toContain(
      'String AUDIO_SPEED_FAILED = "audio_speed_failed";',
    );
  });

  it("已接线：两侧枚举注册 audio_speed（JobTypeEnum 与 GenerationMqRouteEnum，tag = TS 任务类型同值）", () => {
    expect(jobTypeJava).toContain("audio_speed");
    expect(mqRouteJava).toContain(`("${"generation-task"}", "${AUDIO_SPEED_JOB_TYPE}")`);
  });
});
