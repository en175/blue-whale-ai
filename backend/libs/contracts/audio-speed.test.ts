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

const contractJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/AudioSpeedContract.java",
    import.meta.url,
  ),
  "utf8",
);
const audioSpeedErrorJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/error/AudioSpeedError.java",
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

describe("audio_speed 契约不变量（官方 CLI 参考文档口径，TS 侧）", () => {
  it("任务类型 audio_speed（generation_jobs.type 与 MQ tag 同值口径），来源 dock", () => {
    expect(AUDIO_SPEED_JOB_TYPE).toBe("audio_speed");
    expect(AUDIO_SPEED_SOURCE).toBe("dock");
  });

  it("input 键名冻结：source_asset_id / speed", () => {
    expect(Object.values(AUDIO_SPEED_INPUT_KEYS)).toEqual(["source_asset_id", "speed"]);
  });

  it("网关端点：提交 /v1/mediakit/adjust-audio-speed、查询 /v1/mediakit/tasks/（IKH67T 实测校准）", () => {
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
    expect(posToSpeed(AUDIO_SPEED_SLIDER_MIN_POS)).toBe(AUDIO_SPEED_MIN_SPEED);
    expect(posToSpeed(AUDIO_SPEED_SLIDER_MAX_POS)).toBe(AUDIO_SPEED_MAX_SPEED);
    expect(posToSpeed(AUDIO_SPEED_SLIDER_MID_POS)).toBe(1.0);
  });

  it("speedToPos 端点与中点：0.10 → 0、4.00 → 1000、1.00 → 500（posToSpeed 逆映射）", () => {
    expect(speedToPos(0.1)).toBe(0);
    expect(speedToPos(4.0)).toBe(1000);
    expect(speedToPos(1.0)).toBe(500);
    expect(speedToPos(0.5)).toBe(222);
    expect(speedToPos(2.0)).toBe(667);
  });

  it("0.05 步进量化：任意整数位置的产物恒为 0.05 网格点且两位小数内、夹在 [0.1, 4.0]", () => {
    for (let pos = AUDIO_SPEED_SLIDER_MIN_POS; pos <= AUDIO_SPEED_SLIDER_MAX_POS; pos += 1) {
      const speed = posToSpeed(pos);
      expect(speed).toBeGreaterThanOrEqual(AUDIO_SPEED_MIN_SPEED);
      expect(speed).toBeLessThanOrEqual(AUDIO_SPEED_MAX_SPEED);
      expect(Number(speed.toFixed(2))).toBe(speed);
      expect(Math.round(speed * 100) % 5).toBe(0);
    }
  });

  it("往返一致：全部 0.05 网格点 speedToPos → posToSpeed 还原原值（79 档全覆盖）", () => {
    for (let i = 2; i <= 80; i += 1) {
      const speed = Number((i * 0.05).toFixed(2));
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
    expect(
      audioSpeedInputSchema.safeParse({
        source_asset_id: "88",
        speed: roundAudioSpeed(0.30000000000000004),
      }).success,
    ).toBe(true);
  });
});

describe("执行面兜底码（error-codes.ts 注册）", () => {
  it("audio_speed_failed → 1052（1051 已由音频混合占用），文案表同步", () => {
    expect(ERROR_AUDIO_SPEED_FAILED).toBe("audio_speed_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_AUDIO_SPEED_FAILED]).toBe(1052);
    expect(ERROR_CODES[1052]).toBe("音频调速失败，请重试");
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
