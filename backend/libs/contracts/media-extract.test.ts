import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MEDIA_EXTRACT_TAG } from "../shared/generation/queue.constants.js";
import {
  ERROR_CODES,
  ERROR_MEDIA_EXTRACT_FAILED,
  ERROR_MEDIA_EXTRACT_PROVIDER_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./error-codes.js";
import {
  MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT,
  MEDIA_EXTRACT_INPUT_KEYS,
  MEDIA_EXTRACT_JOB_TYPE,
  MEDIA_EXTRACT_OUTPUT_FORMATS,
  MEDIA_EXTRACT_POLL_PATH_PREFIX,
  MEDIA_EXTRACT_SOURCE,
  MEDIA_EXTRACT_SUBMIT_PATH,
  mediaExtractInputSchema,
} from "./media-extract.js";

const contractJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/MediaExtractContract.java",
    import.meta.url,
  ),
  "utf8",
);
const mediaExtractErrorJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/error/MediaExtractError.java",
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

describe("media_extract 契约不变量（官方 PDF 口径，TS 侧）", () => {
  it("任务类型 / MQ tag 同值 media_extract，来源值沿用既有 dock（ADR-0103 不新建任务类型）", () => {
    expect(MEDIA_EXTRACT_JOB_TYPE).toBe("media_extract");
    expect(MEDIA_EXTRACT_TAG).toBe(MEDIA_EXTRACT_JOB_TYPE);
    expect(MEDIA_EXTRACT_SOURCE).toBe("dock");
  });

  it("output_format 枚举五值 m4a/mp3/ogg/flac/wav，默认 m4a（官方描述文字，非示例值列的 mp3）", () => {
    expect([...MEDIA_EXTRACT_OUTPUT_FORMATS]).toEqual(["m4a", "mp3", "ogg", "flac", "wav"]);
    expect(MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT).toBe("m4a");
  });

  it("网关端点：提交 /v1/mediakit/{tool}、查询 /v1/mediakit/tasks/（IKH67T 实测校准）", () => {
    expect(MEDIA_EXTRACT_SUBMIT_PATH).toBe("/v1/mediakit/extract-audio");
    expect(MEDIA_EXTRACT_POLL_PATH_PREFIX).toBe("/v1/mediakit/tasks/");
  });

  it("input 键名冻结：source_asset_id / output_format（结构不变 ADR-0103）", () => {
    expect(Object.values(MEDIA_EXTRACT_INPUT_KEYS)).toEqual(["source_asset_id", "output_format"]);
  });

  it("schema：两键合法样本过、strict 多余键拒、source_asset_id 非 id 串拒", () => {
    const valid = { source_asset_id: "88", output_format: "m4a" };
    expect(mediaExtractInputSchema.parse(valid)).toEqual(valid);
    expect(mediaExtractInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(mediaExtractInputSchema.safeParse({ ...valid, source_asset_id: "abc" }).success).toBe(
      false,
    );
    expect(mediaExtractInputSchema.safeParse({ ...valid, source_asset_id: "0" }).success).toBe(
      false,
    );
  });

  it("schema：五种格式全过、枚举外一律拒（非法值不静默回退——契约口径）", () => {
    for (const format of MEDIA_EXTRACT_OUTPUT_FORMATS) {
      expect(
        mediaExtractInputSchema.safeParse({ source_asset_id: "88", output_format: format })
          .success,
      ).toBe(true);
    }
    for (const format of ["aac", "MP3", "", null, 42]) {
      expect(
        mediaExtractInputSchema.safeParse({ source_asset_id: "88", output_format: format })
          .success,
      ).toBe(false);
    }
  });

  it("火山执行路径兜底码 media_extract_provider_failed → 1044，与既有 media_extract 码不冲突，文案表同步", () => {
    expect(ERROR_MEDIA_EXTRACT_PROVIDER_FAILED).toBe("media_extract_provider_failed");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_MEDIA_EXTRACT_PROVIDER_FAILED]).toBe(1044);
    expect(ERROR_CODES[1044]).toBeTruthy();
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_MEDIA_EXTRACT_FAILED]).toBe(1020);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_MEDIA_EXTRACT_FAILED]).not.toBe(
      GENERATION_ERROR_NUMERIC_CODES[ERROR_MEDIA_EXTRACT_PROVIDER_FAILED],
    );
  });
});

describe("media_extract 双端一致性（读 worker-java 源码文本，防漂移）", () => {
  it("JobType 枚举含 MEDIA_EXTRACT(\"media_extract\")（既有注册，任务类型不变）", () => {
    expect(jobTypeJava).toContain('MEDIA_EXTRACT("media_extract")');
  });

  it("GenerationMqRoute 含 MEDIA_EXTRACT(generation-task, media_extract)", () => {
    expect(mqRouteJava).toContain(
      `MEDIA_EXTRACT("${"generation-task"}", "${MEDIA_EXTRACT_TAG}")`,
    );
  });

  it("MediaExtractContract：tag / source 与 TS 同值", () => {
    expect(contractJava).toContain("String TAG = GenerationMqRouteEnum.MEDIA_EXTRACT.tag();");
    expect(contractJava).toContain('String SOURCE = "dock";');
  });

  it("MediaExtractContract：两 input 键名与 TS 同值", () => {
    for (const key of Object.values(MEDIA_EXTRACT_INPUT_KEYS)) {
      expect(contractJava).toContain(`= "${key}";`);
    }
  });

  it("MediaExtractContract：格式枚举五值与默认 m4a 与 TS 同值", () => {
    expect(contractJava).toContain('List.of("m4a", "mp3", "ogg", "flac", "wav")');
    expect(contractJava).toContain('String DEFAULT_OUTPUT_FORMAT = "m4a";');
  });

  it("MediaExtractContract：火山端点两常量与 TS 同值", () => {
    expect(contractJava).toContain(`String SUBMIT_PATH = "${MEDIA_EXTRACT_SUBMIT_PATH}";`);
    expect(contractJava).toContain(`String POLL_PATH_PREFIX = "${MEDIA_EXTRACT_POLL_PATH_PREFIX}";`);
  });

  it("MediaExtractContract 与 MediaExtractError：兜底错误码与 TS 同值", () => {
    expect(contractJava).toContain(
      'String ERROR_MEDIA_EXTRACT_PROVIDER_FAILED = "media_extract_provider_failed";',
    );
    expect(mediaExtractErrorJava).toContain(
      'String MEDIA_EXTRACT_PROVIDER_FAILED = "media_extract_provider_failed";',
    );
  });
});
