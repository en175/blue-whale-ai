// IKGM8U：image_enhance（高清放大）跨进程契约双端一致性断言。
// 防漂移约定（沿用 ikg4ur 读种子文本的同源断言模式）：TS 侧常量直接 import 断言值；
// worker-java 无法 import TS 常量，本测试直接读 Java 源码文本逐值对账——任一侧改动未同步即红。
// 契约权威章节：docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md §14。
// 后续票（IKGM99 创建入口 / IKGM9D worker 执行 / 前端）照抄 §14 与 image-enhance.ts，不得发明字段名。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { IMAGE_ENHANCE_TAG } from "../shared/generation/queue.constants.js";
import {
  ERROR_CODES,
  ERROR_IMAGE_ENHANCE_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  IMAGE_ENHANCE_DEFAULTS,
  IMAGE_ENHANCE_INPUT_KEYS,
  IMAGE_ENHANCE_JOB_TYPE,
  IMAGE_ENHANCE_MODES,
  IMAGE_ENHANCE_MULTIPLES,
  IMAGE_ENHANCE_SOURCE,
  IMAGE_ENHANCE_TIER_CAPABILITY,
  IMAGE_ENHANCE_TOOL_VERSION,
  IMAGE_ENHANCE_VERSION_TIERS,
  imageEnhanceInputSchema,
} from "./image-enhance.js";

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
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/entity/ImageEnhanceContract.java",
    import.meta.url,
  ),
  "utf8",
);

describe("image_enhance 契约不变量（§14.1–14.4，TS 侧）", () => {
  it("任务类型 / MQ tag / 来源值三处同值 image_enhance", () => {
    expect(IMAGE_ENHANCE_JOB_TYPE).toBe("image_enhance");
    expect(IMAGE_ENHANCE_TAG).toBe(IMAGE_ENHANCE_JOB_TYPE);
    expect(IMAGE_ENHANCE_SOURCE).toBe(IMAGE_ENHANCE_JOB_TYPE);
  });

  it("版本档映射 Lite→standard、Pro→professional、Max→max，键集与档位枚举一致", () => {
    expect(IMAGE_ENHANCE_TOOL_VERSION).toEqual({
      lite: "standard",
      pro: "professional",
      max: "max",
    });
    expect([...IMAGE_ENHANCE_VERSION_TIERS].sort()).toEqual(["lite", "max", "pro"]);
  });

  it("倍数 2/4/6；策略 fidelity_first / generative_first", () => {
    expect([...IMAGE_ENHANCE_MULTIPLES]).toEqual([2, 4, 6]);
    expect([...IMAGE_ENHANCE_MODES]).toEqual(["fidelity_first", "generative_first"]);
  });

  it("能力矩阵：策略仅 pro/max，色彩校正仅 max", () => {
    expect(IMAGE_ENHANCE_TIER_CAPABILITY).toEqual({
      lite: { enhanceMode: false, correctColor: false },
      pro: { enhanceMode: true, correctColor: false },
      max: { enhanceMode: true, correctColor: true },
    });
  });

  it("默认值：pro / 2 / generative_first / 色彩校正开", () => {
    expect(IMAGE_ENHANCE_DEFAULTS).toEqual({
      versionTier: "pro",
      multiple: 2,
      generativeEnhanceMode: "generative_first",
      enableCorrectColor: true,
    });
  });

  it("input 六键冻结：合法样本过、缺键/多键/非法枚举拒", () => {
    const valid = {
      source_asset_id: "123",
      target_node_id: "node-abc",
      version_tier: "pro",
      multiple: 4,
      generative_enhance_mode: "fidelity_first",
      enable_correct_color: false,
    };
    expect(imageEnhanceInputSchema.parse(valid)).toEqual(valid);
    expect(
      imageEnhanceInputSchema.safeParse({ ...valid, version_tier: "standard" }).success,
    ).toBe(false);
    expect(imageEnhanceInputSchema.safeParse({ ...valid, multiple: 3 }).success).toBe(false);
    expect(imageEnhanceInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(
      imageEnhanceInputSchema.safeParse({ ...valid, multiple: undefined }).success,
    ).toBe(false);
  });

  it("兜底错误码 image_enhance_failed → 1039，文案表同步", () => {
    expect(ERROR_IMAGE_ENHANCE_FAILED).toBe("image_enhance_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_IMAGE_ENHANCE_FAILED]).toBe(1039);
    expect(ERROR_CODES[1039]).toBeTruthy();
  });
});

describe("image_enhance 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("JobType 枚举含 IMAGE_ENHANCE(\"image_enhance\")", () => {
    expect(jobTypeJava).toContain('IMAGE_ENHANCE("image_enhance")');
  });

  it("ImageEnhanceContract：tag / source 与 TS 同值", () => {
    expect(contractJava).toContain('String TAG = "image_enhance";');
    expect(contractJava).toContain('String SOURCE = "image_enhance";');
  });

  it("ImageEnhanceContract：六 input 键名与 TS 同值", () => {
    for (const key of Object.values(IMAGE_ENHANCE_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("ImageEnhanceContract：版本档三值与 tool_version 三对映射与 TS 同值", () => {
    expect(contractJava).toContain('String TIER_LITE = "lite";');
    expect(contractJava).toContain('String TIER_PRO = "pro";');
    expect(contractJava).toContain('String TIER_MAX = "max";');
    expect(contractJava).toContain('TIER_LITE, "standard",');
    expect(contractJava).toContain('TIER_PRO, "professional",');
    expect(contractJava).toContain('TIER_MAX, "max"');
  });

  it("ImageEnhanceContract：倍数 / 策略枚举与 TS 同值", () => {
    expect(contractJava).toContain("List.of(2, 4, 6)");
    expect(contractJava).toContain('String MODE_FIDELITY_FIRST = "fidelity_first";');
    expect(contractJava).toContain('String MODE_GENERATIVE_FIRST = "generative_first";');
  });

  it("ImageEnhanceContract：能力矩阵与默认值与 TS 同值", () => {
    expect(contractJava).toContain("Set.of(TIER_PRO, TIER_MAX)");
    expect(contractJava).toContain("Set.of(TIER_MAX)");
    expect(contractJava).toContain("String DEFAULT_VERSION_TIER = TIER_PRO;");
    expect(contractJava).toContain("int DEFAULT_MULTIPLE = 2;");
    expect(contractJava).toContain("String DEFAULT_MODE = MODE_GENERATIVE_FIRST;");
    expect(contractJava).toContain("boolean DEFAULT_ENABLE_CORRECT_COLOR = true;");
  });
});
