/** 参考素材分类上限判定（ADR-0086：读能力行 features，程序里不写死任何上限）。
 *
 *  服务端与前端同源（后端透出 features 全键给前端，前端有一份独立实现）。本模块是**服务端唯一
 *  一份**参考上限判定——接纳侧（handle-create-generation-job）与 SceneCard 再生成
 *  （scene-card-generation-repo）共用，避免第三份副本漂移。
 *
 *  与 worker 执行期的关系：worker-java `VideoJobProcessor.validateReferences` 按同一套文案与
 *  判定顺序复核，读的是接纳侧冻结进 `input.reference_limits` 的快照；接纳侧这里判的是**当前**
 *  能力行，两道口径同源。 */

/** 判定所需的 features 子集（结构类型：`ModelFeatures` 可直接传入）。
 *  字段名 snake_case，读侧传入前须经 toFeatures 归一（兼容 DB 里 camelCase 的历史行）。
 *
 *  IKHEXG：参考上限键按**素材媒介**命名，作用域由 `kind` 决定——
 *  `image_reference_max` 同时服务图片/视频/音频三种生成的图参考（合并了旧的
 *  `max_reference_images`）；`audio_reference_max` 同时服务视频与音频生成；`video_reference_max`
 *  只服务视频生成。见 ADR-0086 修订段。 */
export interface ReferenceLimitFeatures {
  video_reference: boolean;
  video_reference_max: number;
  audio_reference: boolean;
  audio_reference_max: number;
  image_reference_max: number;
  max_reference_duration_sec: number | null;
}

/** 参考素材分类上限校验（读能力行 features）。返回 null 表示通过，否则为用户可读失败原因
 *  （含真实上限）。 */
export function checkReferenceLimits(
  features: ReferenceLimitFeatures,
  references: Array<{ type: "image" | "video" | "audio"; duration?: number | undefined }>,
  kind: "image" | "video" | "audio",
): string | null {
  // 图生成：只收图片参考，上限 image_reference_max。
  if (kind === "image") {
    const imageCount = references.filter((r) => r.type === "image").length;
    if (imageCount > features.image_reference_max)
      return `参考图最多 ${features.image_reference_max} 张`;
    return null;
  }
  // 音频生成：只收 audio/image，不可混用，音频≤audio_reference_max、图≤image_reference_max，
  // 总时长≤max_reference_duration_sec（IKHEXG：此前本分支漏读该键——运营在音频行配了上限
  // 却不生效，与「写进键里但代码不读」是同一类失效）。
  if (kind === "audio") {
    const audioCount = references.filter((r) => r.type === "audio").length;
    const imageCount = references.filter((r) => r.type === "image").length;
    if (audioCount > features.audio_reference_max)
      return `参考音频最多 ${features.audio_reference_max} 个`;
    if (imageCount > features.image_reference_max)
      return `参考图最多 ${features.image_reference_max} 个`;
    if (audioCount > 0 && imageCount > 0)
      return "音频与图片参考不可混用";
    if (features.max_reference_duration_sec != null) {
      const total = references.reduce((sum, r) => sum + (r.duration ?? 0), 0);
      if (total > features.max_reference_duration_sec)
        return `参考素材总时长超过 ${features.max_reference_duration_sec} 秒，请减少素材`;
    }
    return null;
  }
  // 视频生成：普通参考按类型分类上限（图/视频/音频各自上限）；视频素材需 video_reference 位、
  // 音频素材需 audio_reference 位；总时长（所有参考素材之和）≤ max_reference_duration_sec。
  const imageRefs = references.filter((r) => r.type === "image");
  const videoRefs = references.filter((r) => r.type === "video");
  const audioRefs = references.filter((r) => r.type === "audio");
  if (imageRefs.length > features.image_reference_max)
    return `参考图最多 ${features.image_reference_max} 张`;
  if (videoRefs.length > 0 && !features.video_reference)
    return "当前模型不支持视频素材参考";
  if (audioRefs.length > 0 && !features.audio_reference)
    return "当前模型不支持音频素材参考";
  if (videoRefs.length > features.video_reference_max)
    return `参考视频最多 ${features.video_reference_max} 个`;
  if (audioRefs.length > features.audio_reference_max)
    return `参考音频最多 ${features.audio_reference_max} 个`;
  if (features.max_reference_duration_sec != null) {
    const total = references.reduce((sum, r) => sum + (r.duration ?? 0), 0);
    if (total > features.max_reference_duration_sec)
      return `参考素材总时长超过 ${features.max_reference_duration_sec} 秒，请减少素材`;
  }
  return null;
}
