import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { toFeatures } from "./model-capability-repo.js";

/* ============================================
 * 能力行字段裁决表（ADR-0110）
 *
 * 这条规则以前只活在会话与注释里，四个独立副本照样长了出来——因为违反它不会让任何东西变红。
 * 本文件把它变成机械检查：`toFeatures` 恒返回**全字段**对象（缺省补齐），
 * 所以 `Object.keys(toFeatures({}))` 就是「当前已知的全部能力字段」。断言这个集合与下面的
 * RULINGS 精确相等，于是：
 *   - 新增字段而没留裁决 → 红；
 *   - 删字段而表没同删 → 红；
 *   - 裁决指向的测试文件没了（指向腐烂）→ 红；
 *   - 一个字段既没有「配置赢」的证明、又没登记为已知缺口 → 红。
 *
 * 每行回答四件事：谁读它、缺省是多少、哪条测试证明「配置在场时配置赢」、是否根本不驱动行为。
 * `configWinsTest: null` 是**显式登记的缺口**（配 `gapReason`），不是省略——
 * 一行「消费方是 X，暂无配置驱动行为的测试」比留个洞有用。
 * ============================================ */

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

interface Ruling {
  /** 消费方：读这个字段的代码 + 它门控什么。无消费方就写明「当前无读取点」。 */
  consumer: string;
  /** 未配置时生效的值（`DEFAULT_*` 常量或语义缺省）。 */
  fallback: string;
  /** 证明「配置在场时配置赢」的测试（仓库相对路径）；null = 已知缺口，必须同时给 gapReason。 */
  configWinsTest: string | null;
  /** `configWinsTest` 为 null 且非 inert 时必填：缺口登记（缺在哪、为什么还没补）。 */
  gapReason?: string;
  /** 非空 = 该字段当前不驱动任何行为，此处写明原因（纯目录透出 / 无读取点）。 */
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
    consumer: "当前无读取点（仅 handle-list-models 透出消费端 + 后台表单位）",
    fallback: "false",
    configWinsTest: null,
    inert: "目录透出键：仓库内无任何消费方，不驱动行为，故无「配置赢」可言",
  },
  quantity_max: {
    consumer:
      "backend/libs/shared/persistence/storyboard-preview-repo.ts（checkImageCapabilityLimit：分镜预览 count 上限）；" +
      "注意它读的是**库中原始 JSON**，自带一份 `?? 1` 归一，未走 toFeatures",
    fallback: "1（语义缺省，单张）",
    configWinsTest: null,
    gapReason: "消费方存在但无测试改变该配置证明胜负（现有用例都只走缺省值）",
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
    consumer:
      "backend/libs/shared/persistence/scene-card-generation-repo.ts（checkCapabilityLimit → referenceModeToRequiredFeature，" +
      "不支持时报「当前模型不支持首帧参考模式」）；web/src/pages/CanvasPage/modelCaps.ts → canAddRefRole 首帧槽",
    fallback: "false",
    configWinsTest: null,
    gapReason:
      "无测试把该位配成 false 证明会拒（scene-card 现有用例只把它配成 true）",
  },
  last_frame: {
    consumer:
      "同 first_frame（referenceModeToRequiredFeature 的 last_frame 分支）；web modelCaps → canAddRefRole 尾帧槽",
    fallback: "false",
    configWinsTest: null,
    gapReason: "无测试把该位配成 false 证明会拒",
  },
  first_last_frame: {
    consumer:
      "同 first_frame（referenceModeToRequiredFeature 的 first_last_frame 分支）；web modelCaps → canAddRefRole",
    fallback: "false",
    configWinsTest: null,
    gapReason:
      "无测试把该位配成 false 证明会拒（scene-card 用例只配 true 走通）",
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
      "worker-java ImageChannelMapper / ImageJobProcessor（有参考图时出站改用该上游模型名，直接从能力行 features 读）；" +
      "handle-list-models 把它从消费端剥除（出站调用值不下发浏览器）",
    fallback: "null（不分流，出站用目录 id 本身）",
    configWinsTest:
      "worker-java/src/test/java/com/bluewhale/worker/application/processor/ImageJobProcessorI2iAliasTest.java",
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
      "worker-java ImageChannelMapper.parseMaxReferenceImages（图片链路镜像缺省）；冻结进 job.input.reference_limits",
    fallback:
      "按行类型分（IKHEXG）：图片/视频行 DEFAULT_IMAGE_REFERENCE_MAX = 10" +
      "（与网关 maxImageEditImages / ARK 复合编辑上限对齐，IKA72G）；" +
      "音频行 DEFAULT_IMAGE_REFERENCE_MAX_FOR_AUDIO = 1（官方音频接口只收 1 张）。" +
      "由 toFeatures(json, capabilityType) 选",
    configWinsTest: "backend/libs/shared/persistence/model-capability-repo.test.ts",
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
      "allowed_durations 已退役，见 ADR-0086 修订段）经 handle-create-generation-job 与 scene-card-generation-repo 消费",
    fallback: "null（未配 = 只看基础行的 supported_aspect_ratios / supported_durations）",
    configWinsTest:
      "backend/libs/shared/persistence/scene-card-generation-repo.test.ts",
  },
};

/** 能力行里存在、但 `toFeatures` 不产出的字段：上面的枚举机制**看不见**它们，改动不会被拦。
 *  逐个列出，避免留下「以为覆盖了」的错觉：
 *  - `image_protocol`（出站图片协议，ADR-0085 / 023 迁移）：由 worker-java `ImageChannelMapper`
 *    直接从库中 features JSON 读，TS 侧不归一、也不下发消费端。
 *  断言方向是双向的——这些字段一旦被接进 `toFeatures`，用例即红，逼它搬进 RULINGS 走同一条裁决。 */
const FIELDS_OUTSIDE_NORMALISER = ["image_protocol"] as const;

/** `toFeatures` 的产出键集 = 当前已知的全部能力字段。 */
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
