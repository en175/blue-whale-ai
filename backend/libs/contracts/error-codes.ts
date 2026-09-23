// 全库统一错误码文件（IKDZGM / ADR-0083）。
//
// 这就是要的「一份错误码」：全局唯一，高内聚。生成任务域、账号域、全局业务码
// 的错误码常量/数值表/文案表全部收在这一处。散落各处报错、要中文文案，都查这里。
//
// 段位约定（对齐 result.ts ADR-0078）：
//   4xx/5xx   —— HTTP 语义错误（参数/未授权/资源不存在等基础设施错误）
//   1xxx      —— 领域错误码，每错一码（生成域 1001-1030；账号域 1100+）
//   1xxxx     —— 全局业务码（Java SystemCode 系，如 100301 资源不存在）
//
// 对外契约：错误响应统一 { code: 数值码, message: 中文 }（见 result.ts ResultEnvelope）。
// 前端按数值 code 分支（如 web/src/api/jobs.ts isGenerationDomainError 用 1000-1099）。
//
// 职责边界：本文件是错误码 & 文案的唯一来源 + provider 错误信号识别；
// 信封函数 ok()/fail()/ResultEnvelope 在 result.ts（非错误码，不并入）。

// ═══════════════════════════════════════════════════════════════
// 一、生成任务域错误码（字符串契约，worker/provider/投影三层共用）
// ═══════════════════════════════════════════════════════════════
export const ERROR_INVALID_INPUT = "invalid_input";
export const ERROR_UNSUPPORTED_TYPE = "unsupported_type";
export const ERROR_UNSUPPORTED_INPUT = "unsupported_input";
export const ERROR_MODEL_UNAVAILABLE = "model_unavailable";
export const ERROR_REFERENCE_ASSET_UNAVAILABLE = "reference_asset_unavailable";
export const ERROR_REFERENCE_LIMIT_EXCEEDED = "reference_limit_exceeded";
export const ERROR_SOURCE_ASSET_UNAVAILABLE = "source_asset_unavailable";
/** IKE7JP：提交时参数超出当前模型能力目录支持范围（分辨率/宽高比/时长/尺寸档位越界）——统一兜底码。 */
export const ERROR_CAPABILITY_UNSUPPORTED_PARAM = "capability_unsupported_param";
/** IKE7JP：分辨率/尺寸档位越界（细分码，码表文案兜底，一码一文案）。 */
export const ERROR_CAPABILITY_UNSUPPORTED_RESOLUTION = "capability_unsupported_resolution";
/** IKE7JP：宽高比越界（细分码）。 */
export const ERROR_CAPABILITY_UNSUPPORTED_RATIO = "capability_unsupported_ratio";
/** IKE7JP：时长越界（细分码）。 */
export const ERROR_CAPABILITY_UNSUPPORTED_DURATION = "capability_unsupported_duration";
/** IKE7JP：参考素材结构/关系非法（引用无效、为空、混用、帧位约束）。 */
export const ERROR_INVALID_REFERENCE = "invalid_reference";
/** IKE7JP：参考素材类型不匹配（首尾帧必须图片、参考图必须图片、素材库类型非法）。 */
export const ERROR_INVALID_REFERENCE_TYPE = "invalid_reference_type";
/** IKE7JP：参考视频物理约束不满足（MIME/大小/时长/像素/总时长）。 */
export const ERROR_INVALID_REFERENCE_MEDIA = "invalid_reference_media";
/** IKE7JP：生成输出数量与预期不符。仅 52 库历史存量（退役 blue_whale_web worker 写入），
 *  现行 generation-worker 对数量不符按「部分成功」处理（partial_output），不再产生该码；登记仅为投影兜底。 */
export const ERROR_OUTPUT_COUNT_MISMATCH = "output_count_mismatch";

export const ERROR_QUOTA_EXHAUSTED = "quota_exhausted";
export const ERROR_PROVIDER_CREDENTIAL_MISSING = "provider_credential_missing";
export const ERROR_PROVIDER_CONFIG = "provider_config";
export const ERROR_PROVIDER_FAILED = "provider_failed";
export const ERROR_PROVIDER_TIMEOUT = "provider_timeout";
export const ERROR_NO_RESULT = "no_result";

export const ERROR_SUBMISSION_UNKNOWN = "submission_unknown";
export const ERROR_TIMED_OUT = "timed_out";
export const ERROR_STORAGE_FAILED = "storage_failed";
export const ERROR_ALL_OUTPUTS_FAILED = "all_outputs_failed";

export const ERROR_CONTENT_REJECTED = "content_rejected";
/** IKFL53：参考内容版权拒绝（与输出内容审核 1018 分开，用户可见「参考内容可能涉及版权限制」）。 */
export const ERROR_CONTENT_REJECTED_REFERENCE = "content_rejected_reference";
export const ERROR_CONTENT_REVIEW_UNAVAILABLE = "content_review_unavailable";

export const ERROR_MEDIA_EXTRACT_FAILED = "media_extract_failed";
export const ERROR_VIDEO_GENERATION_FAILED = "video_generation_failed";
export const ERROR_IMAGE_GENERATION_FAILED = "image_generation_failed";
export const ERROR_AUDIO_GENERATION_FAILED = "audio_generation_failed";
/** IKGM8U：高清放大（image_enhance）执行兜底失败码（契约 §14，无 worker 级重试）。 */
export const ERROR_IMAGE_ENHANCE_FAILED = "image_enhance_failed";
/** IKGOT3：图片擦除（image_erase）执行兜底失败码（契约 §15，无 worker 级重试）。 */
export const ERROR_IMAGE_ERASE_FAILED = "image_erase_failed";
/** IKGOQR：智能扩图（image_outpaint）执行兜底失败码（规格 docs/specs/2026-09-18-image-outpaint-mediakit.md，无 worker 级重试）。 */
export const ERROR_IMAGE_OUTPAINT_FAILED = "image_outpaint_failed";
/** IKGXLS：图片抠图（image_cutout）执行兜底失败码（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md，无 worker 级重试）。 */
export const ERROR_IMAGE_CUTOUT_FAILED = "image_cutout_failed";
/** IKGZ7Z：视频去字幕（video_subtitle_erase）执行兜底失败码（迁移契约 §17，异步任务轮询失败终态，无 worker 级重试）。 */
export const ERROR_VIDEO_SUBTITLE_ERASE_FAILED = "video_subtitle_erase_failed";
/** IKH28T：音视频分离（media_extract）火山执行路径兜底失败码（迁移契约 §18——网关分类链外
 *  的火山任务失败与转存失败归并；与本地 ffmpeg 链路兜底 1020 区分，双执行路径并存 ADR-0103）。 */
export const ERROR_MEDIA_EXTRACT_PROVIDER_FAILED = "media_extract_provider_failed";
/** IKH3VF：视频 HD 高清（video_enhance，火山 MediaKit 画质增强大模型版）执行兜底失败码
 *  （父规格 IKH3VB——网关分类链外的火山任务失败〔含 SDR 限制、输入短边/长边超限等供应商侧
 *  拒绝〕与转存失败统一归并，异步任务轮询失败终态，无 worker 级重试）。 */
export const ERROR_VIDEO_ENHANCE_FAILED = "video_enhance_failed";
/** IKHA2C：人声背景分离（vocal_split，火山 MediaKit 人声背景音分离）执行兜底失败码
 *  （契约 = backend/libs/contracts/vocal-split.ts——网关分类链外的火山任务失败〔轮询
 *  status=failed〕与转存失败〔result 各轨 URL 24h 临时链接 → 自家 TOS〕统一归并，
 *  异步任务轮询失败终态，无 worker 级重试）。 */
export const ERROR_VOCAL_SPLIT_FAILED = "vocal_split_failed";
/** IKHB6F：音频截取（audio_trim，火山 MediaKit trim-audio）执行兜底失败码（父单 IKHB08
 *  ——网关分类链外的火山任务失败与转存失败统一归并，异步任务轮询失败终态，无 worker 级重试）。 */
export const ERROR_AUDIO_TRIM_FAILED = "audio_trim_failed";
/** IKI68N：音频混合上游失败或临时结果转存失败。 */
export const ERROR_AUDIO_MIX_FAILED = "audio_mix_failed";
/** IKH8BH：视频场景切分（video_scene_split，火山 MediaKit segment-scenes）执行兜底失败码
 *  （父规格 IKH86V——网关分类链外的火山任务 failed 与逐段转存失败〔任一段失败即整体失败〕
 *  统一归并，异步任务轮询失败终态，无 worker 级重试）。 */
export const ERROR_VIDEO_SCENE_SPLIT_FAILED = "video_scene_split_failed";
/** IKHK7F：智能抠像（video_matting，火山 MediaKit matte-portrait-video /
 *  matte-greenscreen-video 双端点）执行兜底失败码（父规格 IKHJRC——网关分类链外的火山
 *  任务 failed 与转存失败〔result.video_url 24h 临时链接 → 自家 TOS〕统一归并，双模式
 *  共享一码，异步任务轮询失败终态，无 worker 级重试）。 */
export const ERROR_VIDEO_MATTING_FAILED = "video_matting_failed";
/** IKHLK3：视频插帧（video_frame_interpolation，火山 MediaKit video-frame-interpolation）执行兜底
 *  失败码（父需求 IKHLES——网关分类链外的火山任务失败〔轮询 status=failed，含入口未前置判定的
 *  官方门槛拒绝：目标帧率越界、输入规格不符、文件大小/时长超上游限制〕与转存失败统一归并，
 *  异步任务轮询失败终态，无 worker 级重试；契约 = backend/libs/contracts/video-frame-interpolation.ts）。
 *  入队失败不走本码，落 ERROR_ENQUEUE_FAILED（同家族口径）。 */
export const ERROR_VIDEO_FRAME_INTERPOLATION_FAILED = "video_frame_interpolation_failed";

export const ERROR_VIDEO_HAS_NO_AUDIO_TRACK = "video_has_no_audio_track";
export const ERROR_VIDEO_DOWNLOAD_FAILED = "video_download_failed";
export const ERROR_VIDEO_TOO_LARGE = "video_too_large";
export const ERROR_EXTRACT_FAILED = "extract_failed";
export const ERROR_UPLOAD_FAILED = "upload_failed";
export const ERROR_ENQUEUE_FAILED = "enqueue_failed";

/** HTTP 限流（IKDPHS）：NewApiError 第三参；过滤器按 status=429 透传。 */
export const RATE_LIMITED = "rate_limited";

/** 登录失败锁定（IKDR4J）：连续失败达阈值后锁定期内 429 的 NewApiError 第三参。 */
export const ACCOUNT_LOCKED = "account_locked";

// ═══════════════════════════════════════════════════════════════
// 二、账号域错误码（字符串契约）
// ═══════════════════════════════════════════════════════════════
export const ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE = 1100;
export const ACCOUNT_ERROR_PASSWORD_INCORRECT = "password_incorrect";
export const ACCOUNT_ERROR_PASSWORD_INVALID = "password_invalid";
export const ACCOUNT_ERROR_PASSWORD_NOT_SET = "password_not_set";

// ═══════════════════════════════════════════════════════════════
// 三、对外数值错误码（字符串码 → 每错一码的独立数值码）
// ═══════════════════════════════════════════════════════════════
export const GENERATION_ERROR_UNKNOWN_NUMERIC_CODE = 1000;

export const GENERATION_ERROR_NUMERIC_CODES: Record<string, number> = {
  [ERROR_QUOTA_EXHAUSTED]: 1001,
  [ERROR_INVALID_INPUT]: 1002,
  [ERROR_UNSUPPORTED_TYPE]: 1003,
  [ERROR_UNSUPPORTED_INPUT]: 1004,
  [ERROR_MODEL_UNAVAILABLE]: 1005,
  [ERROR_REFERENCE_ASSET_UNAVAILABLE]: 1006,
  [ERROR_REFERENCE_LIMIT_EXCEEDED]: 1007,
  [ERROR_SOURCE_ASSET_UNAVAILABLE]: 1008,
  [ERROR_PROVIDER_CREDENTIAL_MISSING]: 1009,
  [ERROR_PROVIDER_CONFIG]: 1010,
  [ERROR_PROVIDER_FAILED]: 1011,
  [ERROR_PROVIDER_TIMEOUT]: 1012,
  [ERROR_NO_RESULT]: 1013,
  [ERROR_SUBMISSION_UNKNOWN]: 1014,
  [ERROR_TIMED_OUT]: 1015,
  [ERROR_STORAGE_FAILED]: 1016,
  [ERROR_ALL_OUTPUTS_FAILED]: 1017,
  [ERROR_CONTENT_REJECTED]: 1018,
  [ERROR_CONTENT_REJECTED_REFERENCE]: 1038,
  [ERROR_CONTENT_REVIEW_UNAVAILABLE]: 1019,
  [ERROR_MEDIA_EXTRACT_FAILED]: 1020,
  [ERROR_VIDEO_GENERATION_FAILED]: 1021,
  [ERROR_IMAGE_GENERATION_FAILED]: 1022,
  [ERROR_VIDEO_HAS_NO_AUDIO_TRACK]: 1023,
  [ERROR_VIDEO_DOWNLOAD_FAILED]: 1024,
  [ERROR_VIDEO_TOO_LARGE]: 1025,
  [ERROR_EXTRACT_FAILED]: 1026,
  [ERROR_UPLOAD_FAILED]: 1027,
  [ERROR_ENQUEUE_FAILED]: 1028,
  [ERROR_AUDIO_GENERATION_FAILED]: 1029,
  [ERROR_CAPABILITY_UNSUPPORTED_PARAM]: 1030,
  [ERROR_CAPABILITY_UNSUPPORTED_RESOLUTION]: 1031,
  [ERROR_CAPABILITY_UNSUPPORTED_RATIO]: 1032,
  [ERROR_CAPABILITY_UNSUPPORTED_DURATION]: 1033,
  [ERROR_INVALID_REFERENCE]: 1034,
  [ERROR_INVALID_REFERENCE_TYPE]: 1035,
  [ERROR_INVALID_REFERENCE_MEDIA]: 1036,
  [ERROR_OUTPUT_COUNT_MISMATCH]: 1037,
  [ERROR_IMAGE_ENHANCE_FAILED]: 1039,
  [ERROR_IMAGE_ERASE_FAILED]: 1040,
  // IKGOQR 注：1040 已由 IKGOT3 擦除占用（!730 先入 release），扩图兜底码取下一空号 1041。
  [ERROR_IMAGE_OUTPAINT_FAILED]: 1041,
  // IKGXLS 注：1041 已由 IKGOQR 扩图占用（!737 先入 release），抠图兜底码取下一空号 1042。
  [ERROR_IMAGE_CUTOUT_FAILED]: 1042,
  // IKGZ7Z 注：1039-1042 已由高清放大/擦除/扩图/抠图占用，去字幕兜底码取下一空号 1043。
  [ERROR_VIDEO_SUBTITLE_ERASE_FAILED]: 1043,
  // IKH28T 注：1043 已由去字幕占用，音视频分离火山路径兜底码取下一空号 1044（映射口径 = 迁移契约 §18）。
  [ERROR_MEDIA_EXTRACT_PROVIDER_FAILED]: 1044,
  // IKH3VF 注：1044 已由音视频分离占用，视频 HD 高清兜底码取下一空号 1045（父规格 IKH3VB）。
  [ERROR_VIDEO_ENHANCE_FAILED]: 1045,
  // IKHB6F 注：1047 已由人声背景分离占用（IKHA2C，!787 先入 release；1046 此前已由场景切分占用），
  // 音频截取兜底码让位取下一空号 1048（父单 IKHB08）。
  [ERROR_AUDIO_TRIM_FAILED]: 1048,
  [ERROR_VIDEO_SCENE_SPLIT_FAILED]: 1046,
  // IKHA2C 注：1046 已由场景切分占用（与 !789 并行开发撞号），人声背景分离兜底码让号取 1047（契约 = vocal-split.ts）。
  [ERROR_VOCAL_SPLIT_FAILED]: 1047,
  // IKHLK3 注：1045-1048 已由 HD 高清 / 场景切分 / 人声背景分离 / 音频截取占用
  // （落码前全仓 grep 1049 零命中，无并行分支撞号），插帧兜底码取下一空号 1049（父需求 IKHLES）。
  [ERROR_VIDEO_FRAME_INTERPOLATION_FAILED]: 1049,
  // IKHK7F 注：1049 已由 !820 插帧先行合入占用，智能抠像兜底码让号取下一空号 1050。
  [ERROR_VIDEO_MATTING_FAILED]: 1050,
  [ERROR_AUDIO_MIX_FAILED]: 1051,
};

/** 字符串码 → 数值码；白名单外/未知码兜底 1000。 */
export function errorCodeToNumeric(code: string): number {
  return GENERATION_ERROR_NUMERIC_CODES[code] ?? GENERATION_ERROR_UNKNOWN_NUMERIC_CODE;
}

export const ACCOUNT_ERROR_NUMERIC_CODES: Record<string, number> = {
  [ACCOUNT_ERROR_PASSWORD_INCORRECT]: 1101,
  [ACCOUNT_ERROR_PASSWORD_INVALID]: 1102,
  [ACCOUNT_ERROR_PASSWORD_NOT_SET]: 1103,
};

/** 字符串码 → 数值码；白名单外/未知码兜底 1100。 */
export function accountErrorToNumeric(code: string): number {
  return ACCOUNT_ERROR_NUMERIC_CODES[code] ?? ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE;
}

/** 账号域中文文案（对外 message 唯一生成，杜绝网关英文透传）。
 *  单一来源：经 accountErrorToNumeric 转数字后查 ERROR_CODES 表；未登记给账号域兜底。
 *  不再 switch 硬编码——避免与 ERROR_CODES 表双份维护（ADR-0083 一码一文案）。 */
export function accountMessageFor(code: string): string {
  const fromTable = ERROR_CODES[accountErrorToNumeric(code)];
  return fromTable ?? "账号操作失败，请稍后重试";
}

// ═══════════════════════════════════════════════════════════════
// 三之二、素材域错误码（2xxx；Agent 素材上传与引用）
//    放在文案表**之前**：下面的 ERROR_CODES 要从这里派生素材域的文案。
// ═══════════════════════════════════════════════════════════════

/**
 * **一条错误一行，码、HTTP 状态、文案都在这一行里。**
 *
 * 为什么要把 HTTP 状态并进码表——这正是 ADR-0083 点名的那处「两套投影机制」漏掉的一格：
 *
 * - `throw` 出去的错误经 `AllExceptionsFilter`，那里 `response.status(...)` 写了状态码；
 * - `return fail(code, msg)` 直接被 `TransformInterceptor` 透传，**状态码由 Nest 按方法默认给**。
 *   于是一次 POST 的拒绝回的是 `HTTP 201` + 信封 `code: 400`：信封说失败，传输层说创建成功。
 *
 * 实测（2026-09-08 测试站）：上传一份 SVG，`presign` 回 `HTTP 201` 且 body 是
 * `{"code":400,"msg":"这个图片格式读不了…"}`。只看状态码的非浏览器客户端会把拒绝当成成功。
 * 本仓前端两条都判（`web/src/api/http.ts` 的 `!res.ok || !ok`）所以没出事，但那是前端替我们兜的。
 *
 * 状态码写在码表里而不是各调用点，是为了让「新增一个错误码」仍然只改一处（ADR-0083 §3）。
 */
export interface ErrorCodeSpec {
  /** 对外数值码。素材域占 2xxx 段。 */
  code: number;
  /** 这条错误该用哪个 HTTP 状态回。 */
  status: number;
  /** 对外中文文案的唯一来源。调用点不再自己写中文。 */
  message: string;
}

/**
 * 素材上传与引用的错误码。
 *
 * 取代此前 `fail(400, "中文")` 那批**裸中文**——它们没有码，前端拿到的一律是 400，
 * 既没法分支也没法定位，只能靠 msg 去猜（ADR-0083 §核心问题 1）。
 *
 * 分工上照 HTTP 语义摆：**客户端把话说错了是 400；说的是真话但东西不在是 404；
 * 我们自己没配好是 503。** 「文件与声明不符」归 422：请求本身合法，是内容不符合语义。
 */
export const ASSET_ERROR_SPECS = {
  /** 声明的 type 不是 image/video/audio。 */
  ASSET_TYPE_UNSUPPORTED: {
    code: 2001,
    status: 400,
    message: "不支持的素材类型",
  },
  /** mime 与声明的 type 对不上，例如 type=image 而 mime=video/mp4。 */
  ASSET_TYPE_MIME_MISMATCH: {
    code: 2002,
    status: 400,
    message: "文件类型与声明类型不匹配",
  },
  /** 我们读不了的图片编码（今天只有 SVG，见 upload.ts 里那段为什么挡在上传口）。 */
  ASSET_FORMAT_UNSUPPORTED: {
    code: 2003,
    status: 400,
    message: "这个图片格式读不了。请用 JPG、PNG、WebP 或 GIF。",
  },
  /** size 非正整数或超过该类型的上限。 */
  ASSET_SIZE_INVALID: {
    code: 2004,
    status: 400,
    message: "文件大小无效或超过限制",
  },
  /** complete 时没带 storage_key。 */
  ASSET_STORAGE_KEY_MISSING: {
    code: 2005,
    status: 400,
    message: "缺少存储键",
  },
  /** storage_key 的前缀不属于当前用户——越权，不是「找不到」。 */
  ASSET_STORAGE_KEY_FOREIGN: {
    code: 2006,
    status: 403,
    message: "存储键与当前用户不匹配",
  },
  /** 预签名发了，但那个对象没被真正 PUT 上来。 */
  ASSET_OBJECT_MISSING: {
    code: 2007,
    status: 404,
    message: "上传对象不存在",
  },
  /** 对象存储上的字节数与声明的 size 不符。 */
  ASSET_SIZE_MISMATCH: {
    code: 2008,
    status: 422,
    message: "文件大小与实际上传不符",
  },
  /** 对象存储上的 Content-Type 与声明的 mime 不符。 */
  ASSET_MIME_MISMATCH: {
    code: 2009,
    status: 422,
    message: "文件类型与实际上传不符",
  },
  /**
   * 读到了字节，但认不出任何已知容器——文件是坏的。
   *
   * 与 {@link ASSET_ERROR_SPECS.ASSET_FORMAT_UNSUPPORTED} 是两回事，措辞也必须不一样：
   * 那条是「格式我们不支持」（换个格式就行），这条是「这份文件本身打不开」（换个文件）。
   * 混成一句话会让人白白重传三次。
   */
  ASSET_BYTES_UNRECOGNIZED: {
    code: 2010,
    status: 400,
    message:
      "这个文件打不开，可能已损坏。请换一份 JPG、PNG、WebP 或 MP4 重新上传。",
  },
  /**
   * 字节认得出，但不是它声明的那一类（选了图片，传的是视频）。
   *
   * 文案里要报出**实测的那一类**，所以这条是少数允许调用点覆写 message 的——覆写的是同一
   * 句话里的一个词，不是另起一句。
   */
  ASSET_KIND_MISMATCH: {
    code: 2012,
    status: 422,
    message: "这个文件的实际类型和你选择的类型不一致。请重新上传。",
  },
  /** 对象存储没配置——是我们的部署问题，不是用户的请求问题。 */
  ASSET_STORAGE_UNCONFIGURED: {
    code: 2011,
    status: 503,
    message: "对象存储未配置",
  },
  /**
   * IKGQWR：上传时引用的素材库素材此刻不能关联（ADR-0093 决策 3）。
   *
   * **一个码 + 两条 msg**，与生成门（ADR-0087 决策 6）同款口径：
   *   - 终局（素材未通过 / 上游已不存在）→ `MATERIAL_NOT_APPROVED_MESSAGE`（本 spec 的默认 message）
   *   - 暂时故障（上游不可达、鉴权、限流、5xx）→ `MATERIAL_STATUS_UNAVAILABLE_MESSAGE`，调用点覆写
   * 前端按 `msg` 分流：前者引导重走合规校验，后者给重试入口。
   *
   * 为什么不拆成两个码：拆了前端就要维护两套分流规则，而生成门那边已经按同一形状定了
   * （三种情况同一个 `data.code`，按 msg 区分）。两条闸门的形状必须一致，否则同一个用户
   * 在上传口和生成口拿到的是两套话术。
   */
  ASSET_MATERIAL_UNAVAILABLE: {
    code: 2013,
    status: 400,
    message: "该素材未审核通过，不能用于视频生成",
  },
} as const satisfies Record<string, ErrorCodeSpec>;

export type AssetErrorName = keyof typeof ASSET_ERROR_SPECS;

/**
 * 技能域（`/api/agent/skills`）错误码。
 *
 * **这几个码此前散在 `backend/libs/shared/skills/*.ts` 里各自 `const` 定义**，同一个 100100
 * 在两个文件里各写一遍——正是 ADR-0083 §1 要终结的那件事（「所有领域从这里取码，不再各自定义」）。
 * 搬进来的同时补上此前完全缺失的那一格：HTTP 状态码。
 *
 * 段位沿用 Java SystemCode 系的 1001xx，不另起 2xxx——这些码前端已经在用，换段位是白白制造
 * 一次兼容问题，而本次要修的是状态码，不是码本身。
 */
export const SKILL_ERROR_SPECS = {
  /** 技能不存在。文案要带上是哪个技能，所以调用点会覆写 message。 */
  SKILL_NOT_FOUND: {
    code: 100100,
    status: 404,
    message: "技能不存在",
  },
  /** 个人技能重名。 */
  SKILL_NAME_CONFLICT: {
    code: 100101,
    status: 409,
    message: "同名技能已存在",
  },
  /** 名称占用了官方技能的名字。 */
  SKILL_NAME_RESERVED: {
    code: 100102,
    status: 409,
    message: "名称与官方技能冲突",
  },
  /** 要添加的官方技能与用户已有的个人技能同名。 */
  SKILL_ADD_CONFLICT: {
    code: 100103,
    status: 409,
    message: "官方技能与你的个人技能同名，无法添加；你仍可直接使用",
  },
  /** AI 格式化这一步失败或没配置。 */
  SKILL_FORMAT_FAILED: {
    code: 100104,
    status: 503,
    message: "AI 格式化失败，请稍后重试",
  },
  /** 技能正被引用，不能删。 */
  SKILL_IN_USE: {
    code: 100105,
    status: 409,
    message: "技能正在使用中，无法删除",
  },
  /** SKILL.md 的 frontmatter 缺失或字段为空。 */
  SKILL_FORMAT_INVALID: {
    code: 100106,
    status: 400,
    message: "SKILL.md 格式不合法",
  },
  /** creative_skill_id / category / sort / lang 这类查询参数不合法。 */
  SKILL_PARAM_INVALID: {
    code: 100107,
    status: 400,
    message: "参数不合法",
  },
} as const satisfies Record<string, ErrorCodeSpec>;

export type SkillErrorName = keyof typeof SKILL_ERROR_SPECS;

// ═══════════════════════════════════════════════════════════════
// 四、一码一中文文案表（对外 message 唯一来源）
// ═══════════════════════════════════════════════════════════════
export const ERROR_CODES: Record<number, string> = {
  // ── 生成任务领域（1xxx）──
  1001: "账户余额不足，请充值后重试",
  1002: "输入参数无效",
  1003: "不支持的生成类型",
  1004: "输入内容不支持",
  1005: "模型未开通或不可用",
  1006: "参考素材不可用",
  1007: "参考素材数量超过限制",
  1008: "源视频资产不可用",
  1009: "生成服务凭证未配置",
  1010: "生成服务配置不完整",
  1011: "生成服务响应异常",
  1012: "生成服务响应超时",
  1013: "生成服务未返回结果",
  1014: "无法确认视频任务是否已提交",
  1015: "视频生成超时",
  1016: "生成结果存储失败",
  1017: "所有输出均生成失败",
  1018: "生成内容未通过安全审核",
  1038: "参考内容可能涉及版权限制", // content_rejected_reference
  1019: "内容审核不可用",
  1020: "音频提取失败",
  1021: "视频生成失败",
  1022: "图像生成失败",
  1023: "视频没有音轨",
  1024: "视频下载失败",
  1025: "视频超过大小上限",
  1026: "音频提取失败",
  1027: "音频上传失败",
  1028: "任务入队失败",
  1029: "音频生成失败", // audio_generation_failed
  1030: "当前模型不支持所选参数，请按提示调整", // capability_unsupported_param
  1031: "当前模型不支持所选分辨率", // capability_unsupported_resolution
  1032: "当前模型不支持所选比例", // capability_unsupported_ratio
  1033: "当前模型不支持所选时长", // capability_unsupported_duration
  1034: "参考素材无效，请重新选择", // invalid_reference
  1035: "参考素材类型不符合要求，请更换后重试", // invalid_reference_type
  1036: "参考视频不符合要求（格式/大小/时长/像素），请更换后重试", // invalid_reference_media
  1037: "生成数量与预期不符，请重新生成", // output_count_mismatch
  1039: "高清放大失败，请重试", // image_enhance_failed
  1040: "图片擦除失败，请重试", // image_erase_failed
  1041: "扩图失败，请重试", // image_outpaint_failed
  1042: "抠图失败，请重试", // image_cutout_failed
  1043: "去字幕失败，请重试", // video_subtitle_erase_failed
  1044: "音频提取失败，请重试", // media_extract_provider_failed（火山执行路径）
  1045: "视频画质增强失败，请重试", // video_enhance_failed（火山 MediaKit 画质增强大模型版）
  1046: "场景切分失败，请重试", // video_scene_split_failed（火山 MediaKit segment-scenes）
  1047: "人声背景分离失败，请重试", // vocal_split_failed（火山 MediaKit 人声背景音分离）
  1048: "音频截取失败，请重试", // audio_trim_failed（火山 MediaKit trim-audio；1046 场景切分/1047 人声分离已占，让位取 1048）
  1049: "视频插帧失败，请重试", // video_frame_interpolation_failed（火山 MediaKit video-frame-interpolation）
  1050: "智能抠像失败，请重试", // video_matting_failed（火山 MediaKit matte-portrait/greenscreen-video 双端点；1049 已由 !820 插帧占用，让位取 1050）
  1051: "音频混合失败，请重试", // audio_mix_failed
  // ── 账号域（1xxx，1100+）──
  1101: "原密码错误，请重试",
  1102: "新密码需为 8-20 位",
  1103: "当前账号未设置密码",
  // ── 全局业务码（1xxxx，Java SystemCode 系；常量见下方三节）──
  100000: "缺少幂等键",
  100100: "资源不存在",
  100202: "资源不可用",
  100301: "资源不存在",
  100302: "幂等键已使用",
  100303: "任务状态冲突",
  100307: "任务已处于终态，无法执行该操作",
  100308: "任务当前状态不可重试",
  100401: "计划消息不存在或不属于该项目",
  100402: "该计划的应用类型暂不支持",
  100403: "计划能力快照已过期，需生成新计划",
  100404: "该计划已应用成功，不可重复应用",
  100405: "余额不足，请充值后重试",
  100406: "版本冲突，请刷新后重试",
  100407: "覆盖目标已变化，请生成新计划",
  100408: "空参数卡片不可保存，请补全参考图或描述",
  100410: "共享资产类型不支持",
};

/**
 * 素材域（2xxx）的文案不在上面手抄一遍，直接从码表派生进来——**一条错误只写一次**。
 *
 * 手抄的第二份迟早和第一份分叉，而分叉出来的症状是「同一个码在两个地方说两句不同的话」，
 * 排查时最难认。声明提前到这里是因为 `ERROR_CODES` 是本文件对外的那张总表，素材域必须在表里。
 */
for (const spec of Object.values(ASSET_ERROR_SPECS)) {
  ERROR_CODES[spec.code] = spec.message;
}
for (const spec of Object.values(SKILL_ERROR_SPECS)) {
  ERROR_CODES[spec.code] = spec.message;
}

/** 按数字码取中文文案；未登记返回 undefined（调用方决定兜底/缺省文案）。 */
export function errorMessage(code: number): string | undefined {
  return ERROR_CODES[code];
}

/** 数字码 → 中文文案，未登记给缺省「未知错误」。（对外响应建议用之，避免 undefined 泄漏。） */
export function messageOf(code: number): string {
  return ERROR_CODES[code] ?? "未知错误";
}

// ═══════════════════════════════════════════════════════════════
// 五、provider 错误信号（上游错误正文识别，跨 provider 共享）
// ═══════════════════════════════════════════════════════════════
export const CONTENT_POLICY_SIGNAL =
  /(copyright|sensitive|版权|敏感|policy violation|policyviolation|content policy)/i;

export function isContentPolicySignal(text: string): boolean {
  return CONTENT_POLICY_SIGNAL.test(text);
}

export const NEW_API_QUOTA_SIGNAL =
  /(预扣费额度失败|剩余额度|余额不足|额度不足|balance|payment_required)/i;

export function isQuotaSignal(text: string, status?: number): boolean {
  return status === 402 || NEW_API_QUOTA_SIGNAL.test(text);
}

// ═══════════════════════════════════════════════════════════════
// 六、对外错误对象类型
// ═══════════════════════════════════════════════════════════════
export interface PublicGenerationError {
  code: number;
  message: string;
}

export interface PublicAccountError {
  code: number;
  message: string;
}

// ═══════════════════════════════════════════════════════════════
// 七、全局业务码常量（数字码；Java SystemCode 系，来源 result.ts）
//    信封函数 ok()/fail()/ResultEnvelope 留在 result.ts，不并入。
// ═══════════════════════════════════════════════════════════════
export const SUCCESS_CODE = 200;
export const FAILURE_CODE = 400;
export const DATA_NOT_EXIST_CODE = 100100;
export const ASSET_UNAVAILABLE_CODE = 100202;
export const RESOURCE_NOT_FOUND_CODE = 100301;
export const IDEMPOTENCY_KEY_REUSED_CODE = 100302;
export const AGENT_RUN_CONFLICT_CODE = 100303;
export const AGENT_RUN_ALREADY_TERMINAL_CODE = 100307;
export const AGENT_RUN_NOT_RETRYABLE_CODE = 100308;
export const PARAM_MISSING_CODE = 100000;
export const PLAN_APPLICATION_PLAN_NOT_FOUND_CODE = 100401;
export const PLAN_APPLICATION_KIND_UNSUPPORTED_CODE = 100402;
export const PLAN_APPLICATION_CAPABILITY_DRIFT_CODE = 100403;
export const PLAN_APPLICATION_ALREADY_APPLIED_CODE = 100404;
export const PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE = 100405;
export const SCENE_CARD_VERSION_CONFLICT_CODE = 100406;
export const PLAN_APPLICATION_TARGET_STALE_CODE = 100407;
export const SHARED_ASSET_EMPTY_CARD_CODE = 100408;
export const SHARED_ASSET_TYPE_UNSUPPORTED_CODE = 100410;

// ═══════════════════════════════════════════════════════════════
// 八、数值码 → HTTP 状态码（ADR-0083 阶段 5/6 的投影换算，唯一一处）
// ═══════════════════════════════════════════════════════════════



/**
 * Java SystemCode 系那几个码该用哪个 HTTP 状态。
 *
 * **只列本仓真的会经过统一投影的那些**，不做一张假装完备的大表——没走投影的调用点写在
 * 这里也不会生效，那种表只会让人以为已经对齐了。
 */
const GLOBAL_CODE_HTTP_STATUS: Record<number, number> = {
  [PARAM_MISSING_CODE]: 400,
  [RESOURCE_NOT_FOUND_CODE]: 404,
  [ASSET_UNAVAILABLE_CODE]: 503,
};

const SPEC_CODE_HTTP_STATUS: Record<number, number> = Object.fromEntries(
  [...Object.values(ASSET_ERROR_SPECS), ...Object.values(SKILL_ERROR_SPECS)].map(
    (spec) => [spec.code, spec.status],
  ),
);

/**
 * 数值码 → HTTP 状态码。**投影层唯一的换算处。**
 *
 * 段位按 `result.ts` 的约定读：`4xx`/`5xx` 本身就是 HTTP 语义，原样用；领域码与全局业务码
 * 查表；查不到的一律 400——**宁可回一个笼统的 400，也不要把一次失败回成 2xx**，后者会让
 * 只看状态码的客户端把拒绝当成成功，而这正是本次要修的那个 bug。
 */
export function httpStatusForCode(code: number): number {
  if (code >= 400 && code <= 599) return code;
  return SPEC_CODE_HTTP_STATUS[code] ?? GLOBAL_CODE_HTTP_STATUS[code] ?? 400;
}
