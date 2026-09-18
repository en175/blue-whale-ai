// IKGOT3：image_erase（图片擦除）跨进程契约双端一致性断言。
// 防漂移约定（沿用 image-enhance.test.ts 读种子文本的同源断言模式）：TS 侧常量直接 import 断言值；
// worker-java 无法 import TS 常量，本测试直接读 Java 源码文本逐值对账——任一侧改动未同步即红。
// 契约权威章节：docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md §15。
// 后续票（IKGOT4 创建入口 / IKGOT6 worker 执行 / 前端）照抄 §15 与 image-erase.ts，不得发明字段名。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { IMAGE_ERASE_TAG } from "../shared/generation/queue.constants.js";
import {
  ERROR_CODES,
  ERROR_IMAGE_ERASE_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  IMAGE_ERASE_INPUT_FORMATS,
  IMAGE_ERASE_INPUT_KEYS,
  IMAGE_ERASE_JOB_TYPE,
  IMAGE_ERASE_MAX_FILE_BYTES,
  IMAGE_ERASE_MAX_SHORT_SIDE_PX,
  IMAGE_ERASE_MAX_LONG_SIDE_PX,
  IMAGE_ERASE_MIN_SIDE_PX,
  IMAGE_ERASE_OUTPUT_FORMAT,
  IMAGE_ERASE_SCENES,
  IMAGE_ERASE_SOURCE,
  IMAGE_ERASE_TOOL_VERSION,
  imageEraseInputSchema,
} from "./image-erase.js";

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
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/entity/ImageEraseContract.java",
    import.meta.url,
  ),
  "utf8",
);

describe("image_erase 契约不变量（§15.1–15.4，TS 侧）", () => {
  it("任务类型 / MQ tag / 来源值三处同值 image_erase", () => {
    expect(IMAGE_ERASE_JOB_TYPE).toBe("image_erase");
    expect(IMAGE_ERASE_TAG).toBe(IMAGE_ERASE_JOB_TYPE);
    expect(IMAGE_ERASE_SOURCE).toBe(IMAGE_ERASE_JOB_TYPE);
  });

  it("场景枚举仅本期两值：full_screen_text_erase / selected_area_erase", () => {
    expect([...IMAGE_ERASE_SCENES]).toEqual([
      "full_screen_text_erase",
      "selected_area_erase",
    ]);
  });

  it("出站固定参数：tool_version=standard、output_format=png（不取接口默认 webp）", () => {
    expect(IMAGE_ERASE_TOOL_VERSION).toBe("standard");
    expect(IMAGE_ERASE_OUTPUT_FORMAT).toBe("png");
  });

  it("输入限制常量与火山官方文档一致：≤2560×1440、≥10×10、≤10MB、png/jpg/jpeg/heic", () => {
    expect(IMAGE_ERASE_MAX_LONG_SIDE_PX).toBe(2560);
    expect(IMAGE_ERASE_MAX_SHORT_SIDE_PX).toBe(1440);
    expect(IMAGE_ERASE_MIN_SIDE_PX).toBe(10);
    expect(IMAGE_ERASE_MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect([...IMAGE_ERASE_INPUT_FORMATS]).toEqual(["png", "jpg", "jpeg", "heic"]);
  });

  it("input 键名冻结：source_asset_id / target_node_id / erase_scene / mask_asset_id", () => {
    expect(Object.values(IMAGE_ERASE_INPUT_KEYS)).toEqual([
      "source_asset_id",
      "target_node_id",
      "erase_scene",
      "mask_asset_id",
    ]);
  });

  it("schema：full_screen_text_erase 三键合法样本过、多键/非法 id 拒、mask_asset_id 禁填", () => {
    const valid = {
      source_asset_id: "123",
      target_node_id: "node-abc",
      erase_scene: "full_screen_text_erase",
    };
    expect(imageEraseInputSchema.parse(valid)).toEqual(valid);
    // strict：未知键（含禁填的 mask_asset_id）拒。
    expect(imageEraseInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(
      imageEraseInputSchema.safeParse({ ...valid, mask_asset_id: "456" }).success,
    ).toBe(false);
    // 源素材 id 沿用 Asset id 口径（非 0 开头数字串）。
    expect(imageEraseInputSchema.safeParse({ ...valid, source_asset_id: "0" }).success).toBe(
      false,
    );
    expect(
      imageEraseInputSchema.safeParse({ ...valid, source_asset_id: "abc" }).success,
    ).toBe(false);
    expect(
      imageEraseInputSchema.safeParse({ ...valid, target_node_id: "" }).success,
    ).toBe(false);
  });

  it("schema：selected_area_erase 四键（mask_asset_id 必填）合法样本过、缺键/多键拒", () => {
    const valid = {
      source_asset_id: "123",
      target_node_id: "node-abc",
      erase_scene: "selected_area_erase",
      mask_asset_id: "456",
    };
    expect(imageEraseInputSchema.parse(valid)).toEqual(valid);
    // mask_asset_id 必填（缺键拒）。
    const { mask_asset_id: _omitted, ...withoutMask } = valid;
    expect(imageEraseInputSchema.safeParse(withoutMask).success).toBe(false);
    expect(imageEraseInputSchema.safeParse({ ...valid, mask_asset_id: "0" }).success).toBe(
      false,
    );
    expect(imageEraseInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });

  it("schema：范围外场景值拒（full_screen_icon_erase / standard_erase_text / 乱值）", () => {
    const base = { source_asset_id: "123", target_node_id: "node-abc" };
    for (const scene of ["full_screen_icon_erase", "standard_erase_text", "bogus", ""]) {
      expect(
        imageEraseInputSchema.safeParse({ ...base, erase_scene: scene }).success,
      ).toBe(false);
    }
  });

  it("兜底错误码 image_erase_failed → 1040，文案表同步", () => {
    expect(ERROR_IMAGE_ERASE_FAILED).toBe("image_erase_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_IMAGE_ERASE_FAILED]).toBe(1040);
    expect(ERROR_CODES[1040]).toBeTruthy();
  });
});

describe("image_erase 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("JobType 枚举含 IMAGE_ERASE(\"image_erase\")", () => {
    expect(jobTypeJava).toContain('IMAGE_ERASE("image_erase")');
  });

  it("ImageEraseContract：tag / source 与 TS 同值", () => {
    expect(contractJava).toContain('String TAG = "image_erase";');
    expect(contractJava).toContain('String SOURCE = "image_erase";');
  });

  it("ImageEraseContract：四 input 键名与 TS 同值", () => {
    for (const key of Object.values(IMAGE_ERASE_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("ImageEraseContract：场景两值与 TS 同值", () => {
    expect(contractJava).toContain(
      'String SCENE_FULL_SCREEN_TEXT_ERASE = "full_screen_text_erase";',
    );
    expect(contractJava).toContain(
      'String SCENE_SELECTED_AREA_ERASE = "selected_area_erase";',
    );
  });

  it("ImageEraseContract：tool_version / output_format 与 TS 同值", () => {
    expect(contractJava).toContain('String TOOL_VERSION = "standard";');
    expect(contractJava).toContain('String OUTPUT_FORMAT = "png";');
  });

  it("ImageEraseContract：输入限制镜像与 TS 同值", () => {
    expect(contractJava).toContain("int MAX_INPUT_LONG_SIDE_PX = 2560;");
    expect(contractJava).toContain("int MAX_INPUT_SHORT_SIDE_PX = 1440;");
    expect(contractJava).toContain("int MIN_INPUT_SIDE_PX = 10;");
    expect(contractJava).toContain("long MAX_INPUT_FILE_BYTES = 10L * 1024 * 1024;");
    expect(contractJava).toContain('List.of("png", "jpg", "jpeg", "heic")');
  });

  it("ImageEraseContract：兜底错误码与 TS 同值", () => {
    expect(contractJava).toContain(
      'String ERROR_IMAGE_ERASE_FAILED = "image_erase_failed";',
    );
  });
});
