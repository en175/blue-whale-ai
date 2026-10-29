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
  IMAGE_OUTPAINT_SOURCE,
  IMAGE_OUTPAINT_SOURCE_LIMITS,
  imageOutpaintInputSchema,
  imageOutpaintSourceGate,
} from "./image-outpaint.js";

const jobTypeJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/JobTypeEnum.java",
    import.meta.url,
  ),
  "utf8",
);
const contractJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/ImageOutpaintContract.java",
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
  it("源图门槛单处定义：长边 ≤4160px、文件 ≤10MB、宽高缺失即拒，判定与文案同源", () => {
    expect(IMAGE_OUTPAINT_SOURCE_LIMITS).toMatchObject({
      maxLongSide: 4160,
      maxFileSizeBytes: 10 * 1024 * 1024,
    });
    expect(imageOutpaintSourceGate(4160, 1000, 10 * 1024 * 1024)).toBeNull();
    expect(imageOutpaintSourceGate(1000, 4160, 10 * 1024 * 1024)).toBeNull();
    expect(imageOutpaintSourceGate(4161, 1000, 1024)).toBe(
      IMAGE_OUTPAINT_SOURCE_LIMITS.longSideRejectionText,
    );
    expect(imageOutpaintSourceGate(1000, 1000, 10 * 1024 * 1024 + 1)).toBe(
      IMAGE_OUTPAINT_SOURCE_LIMITS.fileSizeRejectionText,
    );
    expect(imageOutpaintSourceGate(null, 1000, 1024)).toBe(
      IMAGE_OUTPAINT_SOURCE_LIMITS.missingDimensionsText,
    );
    expect(imageOutpaintSourceGate(1000, undefined, 1024)).toBe(
      IMAGE_OUTPAINT_SOURCE_LIMITS.missingDimensionsText,
    );
    expect(imageOutpaintSourceGate(0, 1000, 1024)).toBe(
      IMAGE_OUTPAINT_SOURCE_LIMITS.missingDimensionsText,
    );
    expect(imageOutpaintSourceGate(1000, 1000, null)).toBeNull();
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
      expand_right: 0.4,
    };
    expect(imageOutpaintInputSchema.parse(valid)).toEqual(valid);
    expect(imageOutpaintInputSchema.safeParse({ ...valid, expand_top: 0.41 }).success).toBe(false);
    expect(imageOutpaintInputSchema.safeParse({ ...valid, expand_top: -0.01 }).success).toBe(false);
    expect(imageOutpaintInputSchema.safeParse({ ...valid, expand_top: "0.1" }).success).toBe(false);
    expect(
      imageOutpaintInputSchema.safeParse({
        ...valid,
        expand_top: 0,
        expand_left: 0,
        expand_right: 0,
      }).success,
    ).toBe(false);
    expect(imageOutpaintInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(imageOutpaintInputSchema.safeParse({ ...valid, expand_bottom: undefined }).success).toBe(false);
    expect(imageOutpaintInputSchema.safeParse({ ...valid, source_asset_id: "0" }).success).toBe(false);
    expect(imageOutpaintInputSchema.safeParse({ ...valid, source_asset_id: "abc" }).success).toBe(false);
  });

  it("兜底错误码 image_outpaint_failed → 1041，文案表同步", () => {
    expect(ERROR_IMAGE_OUTPAINT_FAILED).toBe("image_outpaint_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_IMAGE_OUTPAINT_FAILED]).toBe(1041);
    expect(ERROR_CODES[1041]).toBe("操作未完成，请稍后查看。");
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

  it("ImageOutpaintContract：六 input 键名与 TS 同值", () => {
    for (const key of Object.values(IMAGE_OUTPAINT_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
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
