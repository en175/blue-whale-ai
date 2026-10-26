import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { IMAGE_CUTOUT_TAG } from "../shared/generation/queue.constants.js";
import {
  ERROR_CODES,
  ERROR_IMAGE_CUTOUT_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  IMAGE_CUTOUT_CONTOUR_COLOR,
  IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT,
  IMAGE_CUTOUT_CONTOUR_SIZE_MAX,
  IMAGE_CUTOUT_CONTOUR_SIZE_MIN,
  IMAGE_CUTOUT_EDGE_ORIGIN,
  IMAGE_CUTOUT_INPUT_FORMATS,
  IMAGE_CUTOUT_INPUT_KEYS,
  IMAGE_CUTOUT_JOB_TYPE,
  IMAGE_CUTOUT_MAX_FILE_BYTES,
  IMAGE_CUTOUT_OUTPUT_FORMAT,
  IMAGE_CUTOUT_SCENES,
  IMAGE_CUTOUT_SCENE_SIZE_LIMITS,
  IMAGE_CUTOUT_SOURCE,
  imageCutoutInputSchema,
} from "./image-cutout.js";

const jobTypeJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/JobTypeEnum.java",
    import.meta.url,
  ),
  "utf8",
);
const contractJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/ImageCutoutContract.java",
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

describe("image_cutout 契约不变量（官方 PDF 口径，TS 侧）", () => {
  it("任务类型 / MQ tag / 来源值三处同值 image_cutout", () => {
    expect(IMAGE_CUTOUT_JOB_TYPE).toBe("image_cutout");
    expect(IMAGE_CUTOUT_TAG).toBe(IMAGE_CUTOUT_JOB_TYPE);
    expect(IMAGE_CUTOUT_SOURCE).toBe(IMAGE_CUTOUT_JOB_TYPE);
  });

  it("场景枚举仅本期三值：general / human / product", () => {
    expect([...IMAGE_CUTOUT_SCENES]).toEqual(["general", "human", "product"]);
  });

  it("出站固定参数：output_format=png（无 tool_version 参数，区别于擦除）", () => {
    expect(IMAGE_CUTOUT_OUTPUT_FORMAT).toBe("png");
  });

  it("描边常量：颜色固定 #FFFFFF，宽度 [1,100] 默认 10", () => {
    expect(IMAGE_CUTOUT_CONTOUR_COLOR).toBe("#FFFFFF");
    expect(IMAGE_CUTOUT_CONTOUR_SIZE_MIN).toBe(1);
    expect(IMAGE_CUTOUT_CONTOUR_SIZE_MAX).toBe(100);
    expect(IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT).toBe(10);
  });

  it("输入限制与火山官方文档一致：≤30MB、png/jpg/jpeg/heic、分辨率两档", () => {
    expect(IMAGE_CUTOUT_MAX_FILE_BYTES).toBe(30 * 1024 * 1024);
    expect([...IMAGE_CUTOUT_INPUT_FORMATS]).toEqual(["png", "jpg", "jpeg", "heic"]);
    expect(IMAGE_CUTOUT_SCENE_SIZE_LIMITS.general).toEqual({
      maxLongSide: 10240,
      maxShortSide: 6000,
      maxTotalPixels: 40 * 1000 * 1000,
    });
    expect(IMAGE_CUTOUT_SCENE_SIZE_LIMITS.human).toEqual({
      maxLongSide: 7680,
      maxShortSide: 4320,
    });
    expect(IMAGE_CUTOUT_SCENE_SIZE_LIMITS.product).toEqual({
      maxLongSide: 7680,
      maxShortSide: 4320,
    });
  });

  it("input 键名冻结：source_asset_id / target_node_id / cutout_scene + 增强四键", () => {
    expect(Object.values(IMAGE_CUTOUT_INPUT_KEYS)).toEqual([
      "source_asset_id",
      "target_node_id",
      "cutout_scene",
      "need_contour",
      "contour_color",
      "contour_size",
      "need_crop_background",
    ]);
  });

  it("edge origin：纯视觉来源边标记 image-cutout（参考推导跳过）", () => {
    expect(IMAGE_CUTOUT_EDGE_ORIGIN).toBe("image-cutout");
  });

  it("schema：general 三键合法样本过、多键 / 描边裁剪四键禁填拒", () => {
    const valid = {
      source_asset_id: "123",
      target_node_id: "node-abc",
      cutout_scene: "general",
    };
    expect(imageCutoutInputSchema.parse(valid)).toEqual(valid);
    expect(imageCutoutInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(imageCutoutInputSchema.safeParse({ ...valid, need_contour: true }).success).toBe(false);
    expect(
      imageCutoutInputSchema.safeParse({ ...valid, need_crop_background: false }).success,
    ).toBe(false);
    expect(imageCutoutInputSchema.safeParse({ ...valid, source_asset_id: "0" }).success).toBe(
      false,
    );
    expect(
      imageCutoutInputSchema.safeParse({ ...valid, source_asset_id: "abc" }).success,
    ).toBe(false);
    expect(
      imageCutoutInputSchema.safeParse({ ...valid, target_node_id: "" }).success,
    ).toBe(false);
  });

  it("schema：human / product 七键合法样本过、缺键拒、contour 值域约束拒", () => {
    const valid = {
      source_asset_id: "123",
      target_node_id: "node-abc",
      cutout_scene: "human",
      need_contour: true,
      contour_color: "#FFFFFF",
      contour_size: 10,
      need_crop_background: false,
    };
    expect(imageCutoutInputSchema.parse(valid)).toEqual(valid);
    expect(imageCutoutInputSchema.parse({ ...valid, cutout_scene: "product" })).toEqual({
      ...valid,
      cutout_scene: "product",
    });
    const { need_contour: _omitted, ...withoutContour } = valid;
    expect(imageCutoutInputSchema.safeParse(withoutContour).success).toBe(false);
    expect(
      imageCutoutInputSchema.safeParse({ ...valid, contour_color: "#000000" }).success,
    ).toBe(false);
    expect(imageCutoutInputSchema.safeParse({ ...valid, contour_size: 0 }).success).toBe(false);
    expect(imageCutoutInputSchema.safeParse({ ...valid, contour_size: 101 }).success).toBe(false);
    expect(imageCutoutInputSchema.safeParse({ ...valid, contour_size: 1.5 }).success).toBe(false);
    expect(imageCutoutInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });

  it("schema：范围外场景值拒（乱值 / 空串）", () => {
    const base = { source_asset_id: "123", target_node_id: "node-abc" };
    for (const scene of ["bogus", "", "general ", "GENERAL"]) {
      expect(
        imageCutoutInputSchema.safeParse({ ...base, cutout_scene: scene }).success,
      ).toBe(false);
    }
  });

  it("兜底错误码 image_cutout_failed → 1042（1041 已由扩图占用），文案表同步", () => {
    expect(ERROR_IMAGE_CUTOUT_FAILED).toBe("image_cutout_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_IMAGE_CUTOUT_FAILED]).toBe(1042);
    expect(ERROR_CODES[1042]).toBeTruthy();
  });
});

describe("image_cutout 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("JobType 枚举含 IMAGE_CUTOUT(\"image_cutout\")", () => {
    expect(jobTypeJava).toContain('IMAGE_CUTOUT("image_cutout")');
  });

  it("ImageCutoutContract：tag / source 与 TS 同值", () => {
    expect(mqRouteJava).toContain(`IMAGE_CUTOUT("generation-task", "${IMAGE_CUTOUT_TAG}")`);
    expect(contractJava).toContain("String TAG = GenerationMqRouteEnum.IMAGE_CUTOUT.tag();");
    expect(contractJava).toContain('String SOURCE = "image_cutout";');
  });

  it("ImageCutoutContract：七 input 键名与 TS 同值", () => {
    for (const key of Object.values(IMAGE_CUTOUT_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("ImageCutoutContract：场景三值与 TS 同值", () => {
    expect(contractJava).toContain('String SCENE_GENERAL = "general";');
    expect(contractJava).toContain('String SCENE_HUMAN = "human";');
    expect(contractJava).toContain('String SCENE_PRODUCT = "product";');
  });

  it("ImageCutoutContract：output_format / 描边常量与 TS 同值", () => {
    expect(contractJava).toContain('String OUTPUT_FORMAT = "png";');
    expect(contractJava).toContain('String CONTOUR_COLOR = "#FFFFFF";');
    expect(contractJava).toContain("int CONTOUR_SIZE_MIN = 1;");
    expect(contractJava).toContain("int CONTOUR_SIZE_MAX = 100;");
    expect(contractJava).toContain("int CONTOUR_SIZE_DEFAULT = 10;");
  });

  it("ImageCutoutContract：输入限制镜像与 TS 同值（30MB / 格式白名单 / 两档分辨率）", () => {
    expect(contractJava).toContain("long MAX_INPUT_FILE_BYTES = 30L * 1024 * 1024;");
    expect(contractJava).toContain('List.of("png", "jpg", "jpeg", "heic")');
    expect(contractJava).toContain("int MAX_GENERAL_INPUT_LONG_SIDE_PX = 10240;");
    expect(contractJava).toContain("int MAX_GENERAL_INPUT_SHORT_SIDE_PX = 6000;");
    expect(contractJava).toContain("long MAX_GENERAL_INPUT_TOTAL_PIXELS = 40_000_000L;");
    expect(contractJava).toContain("int MAX_SUBJECT_INPUT_LONG_SIDE_PX = 7680;");
    expect(contractJava).toContain("int MAX_SUBJECT_INPUT_SHORT_SIDE_PX = 4320;");
  });

  it("ImageCutoutContract：兜底错误码与 TS 同值", () => {
    expect(contractJava).toContain(
      'String ERROR_IMAGE_CUTOUT_FAILED = "image_cutout_failed";',
    );
  });
});
