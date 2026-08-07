// IK74V6：场景卡生成编辑器的纯逻辑（类型/常量/纯函数），从组件文件下沉。

import {
  referenceModeToRequiredFeature,
  type CapabilitySnapshotVersion,
  type ProviderPromptAsset,
  type VideoReferenceMode,
} from "@blue-whale/contracts";
import type { ImageModelCapability } from "@/app/canvas/_canvas/api/generation";
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATION_MAX,
  VIDEO_DURATION_MIN,
  VIDEO_DURATION_STEP,
  VIDEO_RESOLUTIONS,
} from "@/app/canvas/_canvas/constants";

/** 可调参数 overrides（IK67HB/T13）：媒体类型/权威正文/ProviderPromptProjection 只读；
 *  模型仅可切到与首次冻结能力版本和摘要一致的候选；
 *  比例/分辨率/时长/数量/参考模式在当前能力支持范围内可调。 */
export type Overrides = {
  model_id: string;
  aspect_ratio: string;
  size: string;
  duration: number;
  count: number;
  reference_mode: VideoReferenceMode;
  reference_assets: ProviderPromptAsset[];
};

export const REFERENCE_MODE_OPTIONS = [
  { id: "text_to_video", label: "文生视频" },
  { id: "first_frame", label: "首帧" },
  { id: "last_frame", label: "尾帧" },
  { id: "first_and_last_frame", label: "首尾帧" },
];

export const REFERENCE_ROLE_OPTIONS = [
  { id: "reference", label: "普通参考" },
  { id: "first_frame", label: "首帧" },
  { id: "last_frame", label: "尾帧" },
] as const;

export const CAPABILITY_DRIFT_MESSAGE =
  "模型能力与首次冻结快照不一致，未切换；请重新确认生成参数。";

export function getReferenceCapabilityError(
  model: ImageModelCapability | null,
  referenceMode: VideoReferenceMode,
): string | null {
  if (!model || referenceMode === "text_to_video") return null;
  const required = referenceModeToRequiredFeature(referenceMode);
  if (required && model.features[required] !== true) {
    const label =
      REFERENCE_MODE_OPTIONS.find((option) => option.id === referenceMode)
        ?.label ?? referenceMode;
    return `当前模型不支持${label}参考模式`;
  }
  return null;
}

export function matchesFrozenCapability(
  model: ImageModelCapability | undefined,
  snapshot: CapabilitySnapshotVersion,
): model is ImageModelCapability {
  return Boolean(
    model &&
      model.version === snapshot.row_version &&
      model.digest === snapshot.digest,
  );
}

export function deriveOptions(model: ImageModelCapability | null) {
  const sizes =
    model?.supported_sizes.map((s) => ({ id: s.id, label: s.label })) ??
    VIDEO_RESOLUTIONS;
  const ratios =
    model?.supported_aspect_ratios.map((r) => ({ id: r, label: r })) ??
    VIDEO_ASPECT_RATIOS.map((r) => ({ id: r.id, label: r.label }));
  const duration = model?.supported_durations ?? {
    min: VIDEO_DURATION_MIN,
    max: VIDEO_DURATION_MAX,
    step: VIDEO_DURATION_STEP,
  };
  const quantityMax = model?.features.quantity_max ?? 1;
  return { sizes, ratios, duration, quantityMax };
}
