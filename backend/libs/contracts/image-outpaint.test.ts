// IKGOQR：image_outpaint（智能扩图）跨进程契约双端一致性断言。
// 防漂移约定（沿用 IKGM8U 读种子文本的同源断言模式）：TS 侧常量直接 import 断言值；
// worker-java 无法 import TS 常量，本测试直接读 Java 源码文本逐值对账——任一侧改动未同步即红。
// 契约权威：docs/specs/2026-09-18-image-outpaint-mediakit.md（Implementation Decisions）+ ADR-0093。
// 后续票（创建入口 / worker 执行 / 前端）照抄本文件与 image-outpaint.ts，不得发明字段名。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { IMAGE_OUTPAINT_TAG } from "../shared/generation/queue.constants.js";
import {
  ERROR_CODES,
  ERROR_IMAGE_OUTPAINT_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS,
  IMAGE_OUTPAINT_INPUT_KEYS,
  IMAGE_OUTPAINT_JOB_TYPE,
  IMAGE_OUTPAINT_PROVIDER_CREDENTIAL_KEY,
  IMAGE_OUTPAINT_SOURCE,
  IMAGE_OUTPAINT_SOURCE_LIMITS,
  imageOutpaintInputSchema,
  imageOutpaintSourceGate,
} from "./image-outpaint.js";

// 读 worker-java 侧常量源码（对账基准；3 级 .. = 仓库根）。
const jobTypeJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/JobTypeEnum.java",
    import.meta.url,
  ),
  "utf8",
);
const contractJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/ImageOutpaintContract.java",
    import.meta.url,
  ),
  "utf8",
);

describe("image_outpaint 契约不变量（TS 侧）", () => {
  it("任务类型 / MQ tag / 来源值三处同值 image_outpaint", () => {
    expect(IMAGE_OUTPAINT_JOB_TYPE).toBe("image_outpaint");
    expect(IMAGE_OUTPAINT_TAG).toBe(IMAGE_OUTPAINT_JOB_TYPE);
    expect(IMAGE_OUTPAINT_SOURCE).toBe(IMAGE_OUTPAINT_JOB_TYPE);
  });

  it("扩展比例四键键名固定，值域 [0, 0.4]（相对原图短边）", () => {
    expect(IMAGE_OUTPAINT_INPUT_KEYS).toEqual({
      sourceAssetId: "source_asset_id",
      targetNodeId: "target_node_id",
      expandTop: "expand_top",
      expandBottom: "expand_bottom",
      expandLeft: "expand_left",
      expandRight: "expand_right",
    });
    expect(IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS).toEqual({ min: 0, max: 0.4 });
  });

  it("基础设施键 provider_credential 单处定义（非客户端 payload，不进 schema）", () => {
    expect(IMAGE_OUTPAINT_PROVIDER_CREDENTIAL_KEY).toBe("provider_credential");
  });

  it("源图门槛单处定义：长边 ≤4160px、文件 ≤10MB、宽高缺失即拒，判定与文案同源", () => {
    // 门槛数值（火山官方 PDF 溯源）与判定函数 imageOutpaintSourceGate 只此一份：
    // backend 创建入口复核与 web 菜单项预检两端 import 引用（防漂移锚点）。
    expect(IMAGE_OUTPAINT_SOURCE_LIMITS).toMatchObject({
      maxLongSide: 4160,
      maxFileSizeBytes: 10 * 1024 * 1024,
    });
    // 边界判定（等值放行、越界拒绝）：长边恰 4160 / 文件恰 10MB 放行。
    expect(imageOutpaintSourceGate(4160, 1000, 10 * 1024 * 1024)).toBeNull();
    expect(imageOutpaintSourceGate(1000, 4160, 10 * 1024 * 1024)).toBeNull();
    expect(imageOutpaintSourceGate(4161, 1000, 1024)).toBe(
      IMAGE_OUTPAINT_SOURCE_LIMITS.longSideRejectionText,
    );
    expect(imageOutpaintSourceGate(1000, 1000, 10 * 1024 * 1024 + 1)).toBe(
      IMAGE_OUTPAINT_SOURCE_LIMITS.fileSizeRejectionText,
    );
    // 真实宽高缺失/非正数即拒（扩展比例换算依赖短边，与高清放大「缺尺寸放行」相反）。
    expect(imageOutpaintSourceGate(null, 1000, 1024)).toBe(
      IMAGE_OUTPAINT_SOURCE_LIMITS.missingDimensionsText,
    );
    expect(imageOutpaintSourceGate(1000, undefined, 1024)).toBe(
      IMAGE_OUTPAINT_SOURCE_LIMITS.missingDimensionsText,
    );
    expect(imageOutpaintSourceGate(0, 1000, 1024)).toBe(
      IMAGE_OUTPAINT_SOURCE_LIMITS.missingDimensionsText,
    );
    // 文件大小缺失不臆造、跳过大小判定（源 Asset 的 size 恒在，防御调用方缺参）。
    expect(imageOutpaintSourceGate(1000, 1000, null)).toBeNull();
    // 拒绝文案含门槛数值供两端展示定位。
    expect(IMAGE_OUTPAINT_SOURCE_LIMITS.longSideRejectionText).toContain("4160");
    expect(IMAGE_OUTPAINT_SOURCE_LIMITS.fileSizeRejectionText).toContain("10MB");
  });

  it("input 六键冻结：合法样本过、缺键/多键/越界/全零/非法 ID 拒", () => {
    const valid = {
      source_asset_id: "123",
      target_node_id: "node-abc",
      expand_top: 0.1,
      expand_bottom: 0,
      expand_left: 0.25,
      expand_right: 0.4, // 上限等值放行
    };
    expect(imageOutpaintInputSchema.parse(valid)).toEqual(valid);
    // 值域：下限等值 0 放行（不扩的方向传 0），越界拒。
    expect(imageOutpaintInputSchema.safeParse({ ...valid, expand_top: 0.41 }).success).toBe(false);
    expect(imageOutpaintInputSchema.safeParse({ ...valid, expand_top: -0.01 }).success).toBe(false);
    expect(imageOutpaintInputSchema.safeParse({ ...valid, expand_top: "0.1" }).success).toBe(false);
    // 四键全 0 = 零扩展，无任务意义，refine 拒（前端发送钮同口径置灰）。
    expect(
      imageOutpaintInputSchema.safeParse({
        ...valid,
        expand_top: 0,
        expand_left: 0,
        expand_right: 0,
      }).success,
    ).toBe(false);
    // strict 六键：多键拒、缺键拒。
    expect(imageOutpaintInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(imageOutpaintInputSchema.safeParse({ ...valid, expand_bottom: undefined }).success).toBe(false);
    // 源素材 ID 为正整数字符串（BigInt Asset id 口径，同高清放大）。
    expect(imageOutpaintInputSchema.safeParse({ ...valid, source_asset_id: "0" }).success).toBe(false);
    expect(imageOutpaintInputSchema.safeParse({ ...valid, source_asset_id: "abc" }).success).toBe(false);
    // 凭证是服务端注入的基础设施键，不进客户端 payload 校验。
    expect(imageOutpaintInputSchema.safeParse({ ...valid, provider_credential: "sk-x" }).success).toBe(false);
  });

  it("兜底错误码 image_outpaint_failed → 1041，文案表同步", () => {
    expect(ERROR_IMAGE_OUTPAINT_FAILED).toBe("image_outpaint_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_IMAGE_OUTPAINT_FAILED]).toBe(1041);
    expect(ERROR_CODES[1041]).toContain("扩图");
  });
});

describe("image_outpaint 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("JobType 枚举含 IMAGE_OUTPAINT(\"image_outpaint\")", () => {
    expect(jobTypeJava).toContain('IMAGE_OUTPAINT("image_outpaint")');
  });

  it("ImageOutpaintContract：tag / source 与 TS 同值", () => {
    expect(contractJava).toContain('String TAG = "image_outpaint";');
    expect(contractJava).toContain('String SOURCE = "image_outpaint";');
  });

  it("ImageOutpaintContract：六 input 键名 + provider_credential 基础设施键与 TS 同值", () => {
    for (const key of Object.values(IMAGE_OUTPAINT_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
    expect(contractJava).toContain(
      `String INPUT_KEY_PROVIDER_CREDENTIAL = "${IMAGE_OUTPAINT_PROVIDER_CREDENTIAL_KEY}";`,
    );
  });

  it("ImageOutpaintContract：扩展比例值域上下限与 TS 同值", () => {
    expect(contractJava).toContain(
      `double EXPAND_RATIO_MIN = ${IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS.min}.0d;`,
    );
    expect(contractJava).toContain(
      `double EXPAND_RATIO_MAX = ${IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS.max}d;`,
    );
  });

  it("ImageOutpaintContract：错误码与 TS 同值", () => {
    expect(contractJava).toContain(
      `String ERROR_IMAGE_OUTPAINT_FAILED = "${ERROR_IMAGE_OUTPAINT_FAILED}";`,
    );
  });
});
