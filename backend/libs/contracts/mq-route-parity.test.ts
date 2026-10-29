import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AUDIO_GENERATION_TAG,
  AUDIO_MIX_TAG,
  AUDIO_VIDEO_MUX_TAG,
  AUDIO_SPEED_TAG,
  AUDIO_TRIM_TAG,
  GENERATION_TASK_TOPIC,
  IMAGE_CUTOUT_TAG,
  IMAGE_ENHANCE_TAG,
  IMAGE_ERASE_TAG,
  IMAGE_GENERATION_TAG,
  IMAGE_OUTPAINT_TAG,
  MEDIA_EXTRACT_TAG,
  VIDEO_FRAME_INTERPOLATION_TAG,
  VIDEO_GENERATION_TAG,
  VIDEO_SCENE_SPLIT_TAG,
  VIDEO_SUBTITLE_ERASE_TAG,
  VIDEO_ENHANCE_TAG,
  VIDEO_MATTING_TAG,
  VOCAL_SPLIT_TAG,
} from "../shared/generation/queue.constants.js";

const mqRouteJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/GenerationMqRouteEnum.java",
    import.meta.url,
  ),
  "utf8",
);

const EXPECTED_ROUTE_COUNT = 18;

const EXPECTED_ROUTES = [
  { entry: "VIDEO", tag: VIDEO_GENERATION_TAG },
  { entry: "IMAGE", tag: IMAGE_GENERATION_TAG },
  { entry: "AUDIO", tag: AUDIO_GENERATION_TAG },
  { entry: "MEDIA_EXTRACT", tag: MEDIA_EXTRACT_TAG },
  { entry: "AUDIO_MIX", tag: AUDIO_MIX_TAG },
  { entry: "AUDIO_VIDEO_MUX", tag: AUDIO_VIDEO_MUX_TAG },
  { entry: "AUDIO_TRIM", tag: AUDIO_TRIM_TAG },
  { entry: "AUDIO_SPEED", tag: AUDIO_SPEED_TAG },
  { entry: "IMAGE_ENHANCE", tag: IMAGE_ENHANCE_TAG },
  { entry: "IMAGE_ERASE", tag: IMAGE_ERASE_TAG },
  { entry: "IMAGE_CUTOUT", tag: IMAGE_CUTOUT_TAG },
  { entry: "IMAGE_OUTPAINT", tag: IMAGE_OUTPAINT_TAG },
  { entry: "VIDEO_SUBTITLE_ERASE", tag: VIDEO_SUBTITLE_ERASE_TAG },
  { entry: "VIDEO_ENHANCE", tag: VIDEO_ENHANCE_TAG },
  { entry: "VOCAL_SPLIT", tag: VOCAL_SPLIT_TAG },
  { entry: "VIDEO_SCENE_SPLIT", tag: VIDEO_SCENE_SPLIT_TAG },
  { entry: "VIDEO_MATTING", tag: VIDEO_MATTING_TAG },
  { entry: "VIDEO_FRAME_INTERPOLATION", tag: VIDEO_FRAME_INTERPOLATION_TAG },
] as const;

describe("GenerationMqRoute ↔ queue.constants.ts 双端一致性（读 Java 源码文本，防漂移）", () => {
  it("EXPECTED_ROUTES 长度与显式计数互锁：只改清单不改计数（或反之）即红", () => {
    expect(
      EXPECTED_ROUTES.length,
      `EXPECTED_ROUTES 有 ${EXPECTED_ROUTES.length} 项，但 EXPECTED_ROUTE_COUNT 声明为 ${EXPECTED_ROUTE_COUNT}——清单与计数必须同步改`,
    ).toBe(EXPECTED_ROUTE_COUNT);
  });

  it(`${EXPECTED_ROUTE_COUNT} 个入口逐项存在：topic = GENERATION_TASK_TOPIC，tag = TS 同名常量`, () => {
    for (const { entry, tag } of EXPECTED_ROUTES) {
      expect(mqRouteJava).toContain(`${entry}("${GENERATION_TASK_TOPIC}", "${tag}")`);
    }
  });

  it(`枚举常量表与 TS ${EXPECTED_ROUTE_COUNT} 个 tag 一一对应（多一个 / 少一个 / 任一侧换值都红）`, () => {
    const declared = [
      ...mqRouteJava.matchAll(/^\s*([A-Z_]+)\("([^"]+)",\s*"([^"]+)"\)[,;]\s*$/gm),
    ].map((match) => ({ entry: match[1], topic: match[2], tag: match[3] }));

    expect(
      declared.length,
      "未从 GenerationMqRoute.java 解析出任何枚举常量——源码形状已偏离 `X(\"topic\", \"tag\")[,;]`，请同步本测试的正则",
    ).toBeGreaterThan(0);

    expect(declared).toEqual(
      EXPECTED_ROUTES.map(({ entry, tag }) => ({
        entry,
        topic: GENERATION_TASK_TOPIC,
        tag,
      })),
    );
  });
});
