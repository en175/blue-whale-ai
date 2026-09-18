// 修正六（IKEL4A）：worker-java 的 MQ 路由表 GenerationMqRoute 与 TS 侧 queue.constants.ts 的
// 跨语言一致性断言。防漂移约定（沿用 image-enhance.test.ts / image-erase.test.ts 读 Java 源码文本的模式）：
// TS 侧常量直接 import 当期望值，插进 Java 源码文本里逐项对账——任一侧改动未同步即红。
// 补这条锚点的原因：image_enhance / image_erase 的 tag 早有各自契约测试钉住，而本次更名的
// video tag（step→video）此前只有 Java 内部三处互钉，跨端没有锚点。
// 契约权威章节：docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md §1 / §16。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AUDIO_GENERATION_TAG,
  GENERATION_TASK_QUEUE,
  IMAGE_CUTOUT_TAG,
  IMAGE_ENHANCE_TAG,
  IMAGE_ERASE_TAG,
  IMAGE_GENERATION_TAG,
  MEDIA_EXTRACT_TAG,
  VIDEO_GENERATION_TAG,
} from "../shared/generation/queue.constants.js";

// 读 worker-java 侧路由表源码（对账基准；3 级 .. = 仓库根）。
const mqRouteJava = readFileSync(
  new URL(
    "../../../worker-java/src/main/java/com/bluewhale/worker/domain/entity/GenerationMqRoute.java",
    import.meta.url,
  ),
  "utf8",
);

/** 七个入口 ↔ TS tag 常量（期望值全取自 TS 侧；Java 侧只提供入口名）。 */
const EXPECTED_ROUTES = [
  { entry: "VIDEO", tag: VIDEO_GENERATION_TAG },
  { entry: "IMAGE", tag: IMAGE_GENERATION_TAG },
  { entry: "AUDIO", tag: AUDIO_GENERATION_TAG },
  { entry: "MEDIA_EXTRACT", tag: MEDIA_EXTRACT_TAG },
  { entry: "IMAGE_ENHANCE", tag: IMAGE_ENHANCE_TAG },
  { entry: "IMAGE_ERASE", tag: IMAGE_ERASE_TAG },
  { entry: "IMAGE_CUTOUT", tag: IMAGE_CUTOUT_TAG },
] as const;

describe("GenerationMqRoute ↔ queue.constants.ts 双端一致性（读 Java 源码文本，防漂移）", () => {
  it("七个入口逐项存在：topic = GENERATION_TASK_QUEUE，tag = TS 同名常量", () => {
    for (const { entry, tag } of EXPECTED_ROUTES) {
      expect(mqRouteJava).toContain(`${entry}("${GENERATION_TASK_QUEUE}", "${tag}")`);
    }
  });

  it("枚举常量表与 TS 六个 tag 一一对应（多一个 / 少一个 / 任一侧换值都红）", () => {
    // 形如 `    VIDEO("generation-task", "video"),`（末项以 `;` 收尾）。
    // 缩进放宽为 `\s*`：纯格式化改动不该红；下面那条 length 断言负责把「正则没匹配上」
      // 变成一句可读的失败，而不是 `expected [] to equal [7 items]` 这种查不出原因的报错。
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
        topic: GENERATION_TASK_QUEUE,
        tag,
      })),
    );
  });
});
