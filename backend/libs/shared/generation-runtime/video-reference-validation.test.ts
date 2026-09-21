import { describe, expect, it } from "vitest";

import { VideoInputError, type MaterialReference } from "./material-reference.js";
import type { VideoWorkerInputAsset } from "./video-job-types.js";
import {
  freezeReferenceLimits,
  validateReferences,
  type ReferenceLimits,
} from "./video-reference-validation.js";

// IKHBDO：本模块**不含任何模型知识**——「哪个模型支持参考视频/音频」「每个模型各自的上限」
// 全部来自能力行 features（运营在后台配）。下面每个用例都通过**改配置**证明行为跟着变，
// 而不是只证明旧默认值仍然通过。

/** 一份能力行 features 投影（字段名与 ModelFeatures 同名，结构对齐）。 */
function limits(overrides: Partial<ReferenceLimits> = {}): ReferenceLimits {
  return {
    image_reference_max: 9,
    video_reference: true,
    video_reference_max: 3,
    audio_reference: true,
    audio_reference_max: 3,
    max_reference_duration_sec: 15,
    ...overrides,
  };
}

function imageAsset(index: number): VideoWorkerInputAsset {
  return { id: `img-${index}`, type: "image", url: `https://cdn.test/${index}.png` };
}

function audioAsset(index = 1): VideoWorkerInputAsset {
  return { id: `aud-${index}`, type: "audio", url: `https://cdn.test/${index}.mp3` };
}

/** 合法参考视频：1280x720 / mp4 / 指定秒数（满足单边/像素/比例物理约束）。 */
function videoAsset(
  index: number,
  seconds: number,
  overrides: Partial<VideoWorkerInputAsset> = {},
): VideoWorkerInputAsset {
  return {
    id: `vid-${index}`,
    type: "video",
    url: `https://cdn.test/${index}.mp4`,
    mime: "video/mp4",
    size: 1024,
    width: 1280,
    height: 720,
    duration: seconds,
    ...overrides,
  };
}

function images(count: number): VideoWorkerInputAsset[] {
  return Array.from({ length: count }, (_, i) => imageAsset(i + 1));
}

function videos(count: number, seconds = 5): VideoWorkerInputAsset[] {
  return Array.from({ length: count }, (_, i) => videoAsset(i + 1, seconds));
}

function expectRejected(
  limitsValue: ReferenceLimits,
  assets: VideoWorkerInputAsset[],
  materials: MaterialReference[] = [],
) {
  try {
    validateReferences(limitsValue, assets, materials);
  } catch (error) {
    if (error instanceof VideoInputError) return error;
    throw error;
  }
  throw new Error("期望校验失败，但通过了");
}

describe("validateReferences 参考上限读能力行（IKHBDO）", () => {
  it("参考图上限随 image_reference_max 变化：14 张放行、15 张拒绝", () => {
    const config = limits({ image_reference_max: 14 });
    expect(validateReferences(config, images(14), [])).toHaveLength(14);

    const error = expectRejected(config, images(15));
    expect(error.code).toBe("reference_limit_exceeded");
    expect(error.message).toBe("参考图最多 14 张");

    // 同一份输入在旧默认 9 下被拒：行为差异只来自配置
    expect(expectRejected(limits({ image_reference_max: 9 }), images(14)).message)
      .toBe("参考图最多 9 张");
  });

  it("参考视频上限随 video_reference_max 变化：5 个放行、6 个拒绝；配 0 = 禁用", () => {
    const config = limits({ video_reference_max: 5, max_reference_duration_sec: null });
    expect(validateReferences(config, videos(5), [])).toHaveLength(5);
    expect(expectRejected(config, videos(6)).message).toBe("参考视频最多 5 个");

    expect(expectRejected(limits({ video_reference_max: 0 }), videos(1)).message)
      .toBe("参考视频最多 0 个");
  });

  it("参考音频上限随 audio_reference_max 变化：2 个放行、3 个拒绝；配 0 = 禁用", () => {
    const config = limits({ audio_reference_max: 2 });
    expect(validateReferences(config, [audioAsset(1), audioAsset(2)], [])).toHaveLength(2);
    expect(expectRejected(config, [audioAsset(1), audioAsset(2), audioAsset(3)]).message)
      .toBe("参考音频最多 2 个");

    expect(expectRejected(limits({ audio_reference_max: 0 }), [audioAsset()]).message)
      .toBe("参考音频最多 0 个");
  });

  it("能力位 video_reference 决定视频素材是否被接受（文案不再点名任何模型）", () => {
    expect(validateReferences(limits({ video_reference: true }), videos(1), [])).toHaveLength(1);

    const error = expectRejected(limits({ video_reference: false }), videos(1));
    expect(error.code).toBe("unsupported_input");
    expect(error.message).toBe("当前模型不支持视频素材参考");
  });

  it("能力位 audio_reference 决定音频素材是否被接受", () => {
    expect(validateReferences(limits({ audio_reference: true }), [audioAsset()], [])).toHaveLength(1);

    const error = expectRejected(limits({ audio_reference: false }), [audioAsset()]);
    expect(error.code).toBe("unsupported_input");
    expect(error.message).toBe("当前模型不支持音频素材参考");
  });

  it("参考总时长上限随 max_reference_duration_sec 变化：30 → 2×15s 放行、31s 拒绝", () => {
    const config = limits({ max_reference_duration_sec: 30 });
    expect(validateReferences(config, [videoAsset(1, 15), videoAsset(2, 15)], [])).toHaveLength(2);

    const error = expectRejected(config, [videoAsset(1, 16), videoAsset(2, 15)]);
    expect(error.code).toBe("invalid_reference_media");
    expect(error.message).toBe("参考视频已知总时长不能超过 30 秒");

    // 旧 15s 口径下同样两条就超限：差异只来自配置
    expect(expectRejected(limits({ max_reference_duration_sec: 15 }), [
      videoAsset(1, 15),
      videoAsset(2, 15),
    ]).message).toBe("参考视频已知总时长不能超过 15 秒");
  });

  it("单条参考视频时长上限也读同一配置；未配（null）= 不设上限", () => {
    // 30s 配置下，单条 20s 视频合法（旧硬编码 15 会拒）
    expect(validateReferences(limits({ max_reference_duration_sec: 30 }), [videoAsset(1, 20)], []))
      .toHaveLength(1);
    expect(expectRejected(limits({ max_reference_duration_sec: 15 }), [videoAsset(1, 20)]).message)
      .toBe("单个参考视频时长必须为 2 至 15 秒");

    // null = 能力行未配上限 → 只保留平台下限 2s
    expect(validateReferences(limits({ max_reference_duration_sec: null }), [videoAsset(1, 120)], []))
      .toHaveLength(1);
    expect(expectRejected(limits({ max_reference_duration_sec: null }), [videoAsset(1, 1)]).message)
      .toBe("单个参考视频时长不能少于 2 秒");
  });

  it("素材库引用并入同一套能力行上限（视频素材库引用 + 本地参考一起数）", () => {
    const config = limits({ video_reference_max: 2, max_reference_duration_sec: null });
    // 1 条本地 + 1 条素材库 = 2，恰好到上限
    expect(validateReferences(config, videos(1), [{ id: "asset-1", type: "video" }])).toHaveLength(2);
    expect(expectRejected(config, videos(1), [
      { id: "asset-1", type: "video" },
      { id: "asset-2", type: "video" },
    ]).message).toBe("参考视频最多 2 个");
  });

  it("物理约束仍是常量（不随能力行变化）：单视频 200MB / 单边 300–6000", () => {
    const oversized = videoAsset(1, 5, { size: 200 * 1024 * 1024 + 1 });
    expect(expectRejected(limits(), [oversized]).message).toBe("单个参考视频不能超过 200 MB");

    const thin = videoAsset(1, 5, { width: 299, height: 800 });
    expect(expectRejected(limits(), [thin]).message).toBe("参考视频单边像素必须为 300 至 6000");
  });
});

describe("freezeReferenceLimits（接纳侧冻结口径）", () => {
  it("只冻结 worker 判定要用的上限字段（支持位由接纳侧单独把关，不进快照）", () => {
    expect(
      freezeReferenceLimits({
        image_reference_max: 14,
        video_reference: true,
        video_reference_max: 5,
        audio_reference: false,
        audio_reference_max: 2,
        max_reference_duration_sec: 30,
      }),
    ).toEqual({
      image_reference_max: 14,
      video_reference_max: 5,
      audio_reference_max: 2,
      max_reference_duration_sec: 30,
    });
  });

  it("max_reference_duration_sec 未配 → 冻结为 null（worker 侧 = 不限）", () => {
    expect(freezeReferenceLimits(limits({ max_reference_duration_sec: null })))
      .toMatchObject({ max_reference_duration_sec: null });
  });
});
