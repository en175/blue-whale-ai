import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { toFeatures } from "./model-capability-repo.js";


const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

interface Ruling {
  consumer: string;
  fallback: string;
  configWinsTest: string | null;
  gapReason?: string;
  inert?: string;
}

const RULINGS: Record<string, Ruling> = {
  reference_image: {
    consumer:
      "backend/libs/shared/canvas/prompt-target.ts（方案引用校验：参考数 > 0 且位为 false → 拒绝）；" +
      "web/src/pages/CanvasPage/modelCaps.ts → videoRefConflict / canAddRefRole（面板参考入口）",
    fallback: "false（语义缺省，能力行未配即为不支持）",
    configWinsTest:
      "backend/libs/shared/generation/prompt-plan-snapshot.test.ts",
  },
  watermark: {
    consumer: "当前无读取点（仅 handle-list-models 透出消费端；后台表单位已删，水印行为改读 system_settings.watermark）",
    fallback: "false",
    configWinsTest: null,
    inert: "目录透出键：仓库内无任何消费方，不驱动行为，故无「配置赢」可言",
  },
  quantity_max: {
    consumer: "当前无读取点（唯一消费方分镜预览随场景卡退役删除，IKRDNK）",
    fallback: "1（语义缺省，单张）",
    configWinsTest: null,
    inert: "目录透出键：仓库内无任何消费方，不驱动行为",
  },
  sequential_image_generation: {
    consumer: "当前无读取点（出站由 input.sequential_image_generation 驱动，见 new-api-generation-ops）",
    fallback: "false",
    configWinsTest: null,
    inert: "目录透出键：仓库内无任何消费方，不驱动行为",
  },
  stream: {
    consumer: "当前无读取点（text-completions 的 stream 来自请求记录，不是能力位）",
    fallback: "false",
    configWinsTest: null,
    inert: "目录透出键：仓库内无任何消费方，不驱动行为",
  },
  tools: {
    consumer: "当前无读取点（出站 tools/web_search 由 input 驱动，见 new-api-generation-ops）",
    fallback: "false",
    configWinsTest: null,
    inert: "目录透出键：仓库内无任何消费方，不驱动行为",
  },
  first_frame: {
    consumer: "web/src/pages/CanvasPage/modelCaps.ts → canAddRefRole 首帧槽",
    fallback: "false",
    configWinsTest: null,
    gapReason: "无测试把该位配成 false 证明会拒",
  },
  last_frame: {
    consumer: "web modelCaps → canAddRefRole 尾帧槽",
    fallback: "false",
    configWinsTest: null,
    gapReason: "无测试把该位配成 false 证明会拒",
  },
  first_last_frame: {
    consumer: "web modelCaps → canAddRefRole",
    fallback: "false",
    configWinsTest: null,
    gapReason: "无测试把该位配成 false 证明会拒",
  },
  audio: {
    consumer:
      "backend/libs/shared/generation/handle-create-generation-job.ts（composeInput：true 才把用户选择冻结进 input.generate_audio）；" +
      "worker-java VideoJobProcessor 读 input.generate_audio；" +
      "web/src/pages/Home/components/ChatBox（是否出「带音频」开关）",
    fallback: "false（未配则不出开关、出站不下发 generate_audio）",
    configWinsTest:
      "backend/libs/shared/generation/handle-create-generation-job.test.ts",
  },
  i2i_model_name: {
    consumer:
      "worker-java ImageChannelParser / ImageJobProcessor（有参考图时出站改用该上游模型名，直接从能力行 features 读）；" +
      "handle-list-models 把它从消费端剥除（出站调用值不下发浏览器）",
    fallback: "null（不分流，出站用目录 id 本身）",
    configWinsTest:
      "server/blue-whale-worker/src/test/java/com/bluewhale/worker/application/processor/ImageJobProcessorI2iAliasTest.java",
  },
  max_prompt_length: {
    consumer:
      "backend/libs/shared/generation/handle-create-generation-job.ts（正文长度闸，resolvePromptMaxLength）；" +
      "handle-list-models 下发的**已算好生效值**；web 输入框上限",
    fallback: "null → 按生成类型回落缺省（图片/视频 4000、音频 3000，ADR-0085）",
    configWinsTest:
      "backend/libs/shared/generation/handle-create-generation-job.test.ts",
  },
  video_reference: {
    consumer:
      "backend/libs/shared/generation-runtime/reference-limits.ts（checkReferenceLimits：视频素材需此位）；" +
      "backend/libs/shared/generation-runtime/video-reference-validation.ts（validateReferences 同一口径；" +
      "由 canvas.service.ts 与 prompt-plan-snapshot.ts 调用）；web/src/lib/model-reference-limits.ts",
    fallback: "false",
    configWinsTest:
      "backend/libs/shared/generation-runtime/video-reference-validation.test.ts",
  },
  video_reference_max: {
    consumer:
      "backend/libs/shared/generation-runtime/reference-limits.ts；video-reference-validation.ts；" +
      "freezeReferenceLimits → job.input.reference_limits；worker-java VideoJobProcessor.referenceLimitsOf 读冻结值",
    fallback: "DEFAULT_VIDEO_REFERENCE_MAX = 3",
    configWinsTest:
      "backend/libs/shared/generation-runtime/video-reference-validation.test.ts",
  },
  audio_reference: {
    consumer:
      "backend/libs/shared/generation-runtime/reference-limits.ts（音频素材需此位）；" +
      "video-reference-validation.ts；web/src/lib/model-reference-limits.ts",
    fallback: "false",
    configWinsTest:
      "backend/libs/shared/generation-runtime/video-reference-validation.test.ts",
  },
  audio_reference_max: {
    consumer:
      "backend/libs/shared/generation-runtime/reference-limits.ts（音频生成的音频参考上限）；" +
      "video-reference-validation.ts；冻结进 job.input.reference_limits",
    fallback: "DEFAULT_AUDIO_REFERENCE_MAX = 3",
    configWinsTest:
      "backend/libs/shared/generation-runtime/video-reference-validation.test.ts",
  },
  image_reference_max: {
    consumer:
      "backend/libs/shared/generation-runtime/reference-limits.ts（checkReferenceLimits 的 image / video / audio 三分支共用的**图**参考上限）；" +
      "backend/libs/shared/generation/handle-create-generation-job.ts（resolveReferenceAssets 图片上限）；" +
      "backend/libs/shared/canvas/prompt-target.ts；" +
      "web/src/lib/model-reference-limits.ts（imageReferenceMaxOf / imageReferenceMaxOfForAudio）；" +
      "worker-java ImageChannelParser.parseMaxReferenceImages（图片链路镜像缺省）；冻结进 job.input.reference_limits",
    fallback:
      "按行类型分（IKHEXG）：图片/视频行 DEFAULT_IMAGE_REFERENCE_MAX = 10" +
      "（与网关 maxImageEditImages / ARK 复合编辑上限对齐，IKA72G）；" +
      "音频行 DEFAULT_IMAGE_REFERENCE_MAX_FOR_AUDIO = 1（官方音频接口只收 1 张）。" +
      "由 toFeatures(json, capabilityType) 选",
    configWinsTest: "backend/libs/shared/persistence/model-capability-repo.test.ts",
  },
  max_reference_image_pixels: {
    consumer:
      "backend/libs/shared/generation-runtime/image-reference-validation.ts（validateReferenceImages：图片生成的单张参考图总像素上限；" +
      "validateConfiguredReferenceImages：视频参考图只在能力行显式配置时校验）；" +
      "经 handle-create-generation-job 在提交前拒绝，不建任务、不扣费。写侧形态闸门在 " +
      "backend/libs/shared/model-capability/constants.ts（featuresFieldErr）",
    fallback:
      "null（IKSLLC：能力行未配 = 视频不校验）；图片生成路径仍回退 DEFAULT_MAX_REFERENCE_IMAGE_PIXELS = 36,000,000（IKQYEH）",
    configWinsTest:
      "backend/libs/shared/generation-runtime/image-reference-validation.test.ts",
  },
  max_reference_image_ratio: {
    consumer:
      "backend/libs/shared/generation-runtime/image-reference-validation.ts（validateReferenceImages：图片生成的单张参考图宽高比 [1/N, N]；" +
      "validateConfiguredReferenceImages：视频参考图只在能力行显式配置时校验）；" +
      "经 handle-create-generation-job 在提交前拒绝。写侧形态闸门在 " +
      "backend/libs/shared/model-capability/constants.ts（featuresFieldErr）",
    fallback:
      "null（IKSLLC：能力行未配 = 视频不校验）；图片生成路径仍回退 DEFAULT_MAX_REFERENCE_IMAGE_RATIO = 16（IKQYEH）",
    configWinsTest:
      "backend/libs/shared/generation-runtime/image-reference-validation.test.ts",
  },
  max_reference_image_bytes: {
    consumer:
      "backend/libs/shared/generation-runtime/image-reference-validation.ts（validateReferenceImageMedia：音频生成参考图的格式与单张大小）；" +
      "经 handle-create-generation-job 在提交前拒绝。写侧形态闸门在 " +
      "backend/libs/shared/model-capability/constants.ts（featuresFieldErr）",
    fallback: "null（IKSLLC：能力行未配 = 音频不校验格式与大小）",
    configWinsTest:
      "backend/libs/shared/generation-runtime/image-reference-validation.test.ts",
  },
  min_reference_image_side: {
    consumer:
      "backend/libs/shared/generation-runtime/image-reference-validation.ts（validateReferenceImages / validateConfiguredReferenceImages：参考图单边下限）；" +
      "经 handle-create-generation-job 在提交前拒绝。写侧形态闸门在 " +
      "backend/libs/shared/model-capability/constants.ts（featuresFieldErr）",
    fallback: "null（IKSUVD：能力行未配 = 不校验单边下限）",
    configWinsTest:
      "backend/libs/shared/generation-runtime/image-reference-validation.test.ts",
  },
  max_reference_duration_sec: {
    consumer:
      "backend/libs/shared/generation-runtime/reference-limits.ts（参考素材已知总时长）；" +
      "video-reference-validation.ts（单条参考视频时长上限）；冻结进 job.input.reference_limits",
    fallback: "null（未配 = 不限，只保留平台下限 2 秒）",
    configWinsTest:
      "backend/libs/shared/generation-runtime/video-reference-validation.test.ts",
  },
  task_types: {
    consumer:
      "backend/libs/contracts/capability-param-validation.ts（checkGenerationParamLimit：按任务类型的 allowed_ratios；" +
      "allowed_durations 已退役，见 ADR-0086 修订段）经 handle-create-generation-job 消费",
    fallback: "null（未配 = 只看基础行的 supported_aspect_ratios / supported_durations）",
    configWinsTest:
      "backend/libs/contracts/capability-param-validation.test.ts",
  },
  video_dimensions: {
    consumer:
      "backend/libs/contracts/capability-param-validation.ts（resolveOutputPixels：按 resolution+aspect_ratio 查宽高）" +
      "经 handle-create-generation-job 的 composeInput 冻成 job.input.output_width / output_height，" +
      "随 Hold 到 billing 的 specs 后被 TokenEstimator（server/blue-whale-billing/.../pricing/TokenEstimator.java）消费。" +
      "写侧形态闸门在 backend/libs/shared/model-capability/constants.ts（featuresFieldErr）",
    fallback:
      "null（未配 = 不冻结宽高）；此时 billing 回落目录里那份 tokenEstimate.dimensions（过渡期双向兼容）",
    configWinsTest:
      "backend/libs/shared/generation/handle-create-generation-job.test.ts",
  },
  sample_mode: {
    consumer:
      "backend/libs/shared/generation/handle-create-generation-job.ts（ruleSampleMode：创建侧样片门控，" +
      "位不为 true → 400 capability_unsupported_param）与 handle-quote-generation-job.ts（报价侧同一判定，" +
      "未放行 → 空报价双 null）。契约 backend/libs/contracts/video-sample-mode.ts（IKIZQ7）。" +
      "写侧形态闸门在 backend/libs/shared/model-capability/constants.ts（featuresFieldErr 布尔裁定）",
    fallback: "false（样片默认关闭：能力行未声明即拒绝样片提交/不给样片报价；放行 = 运营显式配置）",
    configWinsTest:
      "backend/libs/shared/generation/handle-create-generation-job.test.ts",
  },
  omni_reference_task_type: {
    consumer:
      "backend/libs/shared/generation/handle-create-generation-job.ts（按该位把 input.omni_reference_task_type_allowed 冻结进快照）；" +
      "server/blue-whale-worker 的 NewApiVideoClient（按冻结位决定是否下发上游 metadata.omni_reference_task_type）。" +
      "写侧形态闸门在 backend/libs/shared/model-capability/constants.ts（featuresFieldErr 布尔裁定）",
    fallback: "false（能力行未声明即不下发该参数）",
    configWinsTest:
      "backend/libs/shared/generation/handle-create-generation-job.test.ts",
  },
};

const FIELDS_OUTSIDE_NORMALISER = ["image_protocol"] as const;

const NORMALISED_FIELDS: string[] = Object.keys(toFeatures({})).sort();

describe("模型能力字段裁决表（ADR-0110）", () => {
  it("新增能力字段必须先在 RULINGS 里留下裁决——否则本用例红", () => {
    expect(NORMALISED_FIELDS.filter((field) => !(field in RULINGS))).toEqual([]);
  });

  it("表里不留已消失的字段（删字段时表要同删）", () => {
    expect(
      Object.keys(RULINGS).filter((field) => !NORMALISED_FIELDS.includes(field)),
    ).toEqual([]);
  });

  it("声称有「配置赢」证明的字段，其测试文件必须存在（指向腐烂即红）", () => {
    const dangling = Object.entries(RULINGS)
      .filter(([, ruling]) => ruling.configWinsTest !== null)
      .filter(
        ([, ruling]) => !existsSync(`${REPO_ROOT}${ruling.configWinsTest}`),
      )
      .map(([field, ruling]) => `${field} → ${ruling.configWinsTest}`);
    expect(dangling).toEqual([]);
  });

  it("没有「配置赢」证明的字段必须登记为缺口（gapReason）或不驱动行为（inert），不许两者皆无", () => {
    const undeclared = Object.entries(RULINGS)
      .filter(
        ([, ruling]) =>
          ruling.configWinsTest === null && !ruling.inert && !ruling.gapReason,
      )
      .map(([field]) => field);
    expect(undeclared).toEqual([]);
  });

  it("归一器之外的字段仍留在清单里（接进 toFeatures 时逼其搬进 RULINGS）", () => {
    expect(
      FIELDS_OUTSIDE_NORMALISER.filter((field) =>
        NORMALISED_FIELDS.includes(field),
      ),
    ).toEqual([]);
  });
});
