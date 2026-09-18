// IKGXLS：image_cutout（图片抠图）跨进程契约双端一致性断言。
// 防漂移约定（沿用 image-erase.test.ts 读种子文本的同源断言模式）：TS 侧常量直接 import 断言值；
// worker-java 无法 import TS 常量，本测试直接读 Java 源码文本逐值对账——任一侧改动未同步即红。
// 契约权威章节：docs/specs/2026-09-18-image-cutout-mediakit.md（官方 API 要点节）。
// 后续票（IKGXM1 创建入口 / IKGXM2 worker 执行 / 前端）照抄本契约与 image-cutout.ts，不得发明字段名。
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
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/entity/ImageCutoutContract.java",
    import.meta.url,
  ),
  "utf8",
);
// tag 字面量已上移到 GenerationMqRoute（ImageCutoutContract.TAG 只做转发），故 tag 的对账基准改读该枚举。
const mqRouteJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/entity/GenerationMqRoute.java",
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
    // general 档：长边 10240 / 短边 6000 / 总像素 40MP（菜单预检同档）。
    expect(IMAGE_CUTOUT_SCENE_SIZE_LIMITS.general).toEqual({
      maxLongSide: 10240,
      maxShortSide: 6000,
      maxTotalPixels: 40 * 1000 * 1000,
    });
    // human / product 档：长边 7680 / 短边 4320（官方未给该档总像素上限）。
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
    // strict：未知键拒；通用场景不携带描边与裁剪参数（规格故事 29），四键传入即拒。
    expect(imageCutoutInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(imageCutoutInputSchema.safeParse({ ...valid, need_contour: true }).success).toBe(false);
    expect(
      imageCutoutInputSchema.safeParse({ ...valid, need_crop_background: false }).success,
    ).toBe(false);
    // 源素材 id 沿用 Asset id 口径（非 0 开头数字串）。
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
    // 四增强键必填（缺键拒）。
    const { need_contour: _omitted, ...withoutContour } = valid;
    expect(imageCutoutInputSchema.safeParse(withoutContour).success).toBe(false);
    // 描边颜色固定白色（非 #FFFFFF 拒）；宽度越界 / 非整数拒（官方 [1,100]）。
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

  it("兜底错误码 image_cutout_failed → 1041，文案表同步", () => {
    expect(ERROR_IMAGE_CUTOUT_FAILED).toBe("image_cutout_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_IMAGE_CUTOUT_FAILED]).toBe(1041);
    expect(ERROR_CODES[1041]).toBeTruthy();
  });
});

describe("image_cutout 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("JobType 枚举含 IMAGE_CUTOUT(\"image_cutout\")", () => {
    expect(jobTypeJava).toContain('IMAGE_CUTOUT("image_cutout")');
  });

  it("ImageCutoutContract：tag / source 与 TS 同值", () => {
    expect(mqRouteJava).toContain(`IMAGE_CUTOUT("generation-task", "${IMAGE_CUTOUT_TAG}")`);
    expect(contractJava).toContain("String TAG = GenerationMqRoute.IMAGE_CUTOUT.tag();");
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
