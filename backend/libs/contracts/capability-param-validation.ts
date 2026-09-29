// IKE7JP：生成参数对模型能力目录的结构性校验（纯函数，无 IO）。
// 提交侧（Dock 视频/图片）在接纳当下校验 resolution/size/aspect_ratio/duration 是否
// 落在能力目录支持范围，失败直接 4xx 返回带可用值的可修复文案，不再拖到 worker 执行期。
//
// 与 SceneCard 路径的 checkCapabilityLimit（scene-card-generation-repo.ts）语义一致：
// 那里的入参是 frozenGenerationParametersSchema（size + aspect_ratio + duration 档位 id），
// 这里把 Dock 的扁平字段（resolution + aspect_ratio + duration）归一化后同源校验。
// 后续可把 checkCapabilityLimit 迁到本文件共享（IKE7JP 下一步）。

import { ERROR_CAPABILITY_UNSUPPORTED_RESOLUTION, ERROR_CAPABILITY_UNSUPPORTED_RATIO, ERROR_CAPABILITY_UNSUPPORTED_DURATION } from "./error-codes.js";

/** 提交侧能力目录行（handleCreateGenerationJob 已从 listEnabledByType 取回）。 */
export interface CapabilityLimitInput {
  supported_sizes: Array<{ id?: string; api_value?: string }>;
  supported_aspect_ratios: unknown;
  supported_durations: unknown;
  default_size?: string;
  /** IKFPYX：按任务类型的比例/时长约束（features.task_types）。命中时覆盖基础比例/时长校验。 */
  task_types?: unknown;
}

/** IKFPYX：视频任务类型（官方口径，由输入素材角色 + 提示词意图判定）。
 *  与火山方舟 Seedance 2.5 提示词指南的「任务使用说明」一致：
 *    · 首帧/首尾帧 —— 按 references 的 role（first_frame / last_frame）；
 *    · 编辑 / 延长 —— 参考素材 + 提示词含官方关键词（见下面两个列表）；
 *    · 官方另有一层「是否锁定输出属性」的分类（有锁定：编辑/首尾帧/延长），本枚举只落**有锁定**那三种
 *      加上 default；参考任务/多宫格分镜/关键帧对输出不锁比例时长，约束上没有区别，一并归 default。
 *
 *  ⚠️ 关键词表**逐字对齐官方**，不要凭语感加词：官方原文是「包含其一即可」的**闭集**，
 *     多一个词就等于把「用户没要求编辑」的提示词也当成编辑任务（后果见下面各列表的注释）。 */
export type VideoTaskType = "default" | "first_frame" | "first_last_frame" | "edit" | "prolong";

/** 编辑意图关键词。官方原文：「编辑视频、增加/加上、删除/去掉、修改/替换/改成」——斜杠是**同义项**，
 *  展开即这 8 个词。
 *
 *  ⚠️ 这里**没有**裸「编辑」：官方那条是「**编辑视频**」（两个字连写），不是一个「编辑」子串。
 *     加回裸「编辑」会让「编辑一下这个镜头」（用户只是随口说编辑，没说要改视频）落进 edit，
 *     于是该单被按编辑任务的锁定额处理（ratio 强制 adaptive），与官方的判定错位。
 *
 *  ⚠️ **导出是为了跨语言对账**（`video-task-type-parity.test.ts` 拿它当期望值，
 *     去比 worker-java `VideoJobProcessor` 里的同名字段）——两端各自发明过一次，所以钉死。 */
export const EDIT_INTENT_KEYWORDS = [
  "编辑视频",
  "增加",
  "加上",
  "删除",
  "去掉",
  "修改",
  "替换",
  "改成",
] as const;

/** 延长意图关键词。官方原文：「向前/向后延长、延续、续写」——斜杠是**方向二选一**，
 *  展开即「向前延长」「向后延长」两个完整词组，加「延续」「续写」。
 *
 *  ⚠️ 这里**没有**裸「延长」，也**没有**裸「向前」「向后」：
 *     前者官方未列；后者会命中「镜头向前推进」这种**方向描述**（用户说的是运镜，不是要延长视频），
 *     把参考生视频单误判成 prolong。导出理由同 {@link EDIT_INTENT_KEYWORDS}。 */
export const PROLONG_INTENT_KEYWORDS = ["向前延长", "向后延长", "延续", "续写"] as const;

/** IKJ78C：否定防护词表（六词闭集，扩词走评审）。
 *
 *  背景：裸子串匹配会把「禁止修改」「不要替换」这类**约束句**误判成编辑意图，
 *  纯参考单被按 edit 的锁定比例 4xx 拒单。防护规则见 {@link hasIntentKeyword}。
 *
 *  ⚠️ **导出是为了跨语言对账**（`video-task-type-parity.test.ts` 拿它当期望值），
 *     与 worker-java `VideoJobProcessor` 同名字段逐字对齐。 */
export const NEGATION_KEYWORDS = ["禁止", "不得", "不要", "不能", "勿", "无需"] as const;

/** IKJ78C：子句切分标点（中英闭集，规格口径）。 */
const CLAUSE_SEPARATORS = /[，。；！？、,.;!?]/;

/** IKJ78C：否定防护后的关键词扫描——先按标点切子句，否定词与关键词落在**同一子句**时
 *  剔除该命中（含否定词的子句整体不参与扫描）；跨子句不剔除（混合句「禁止修改人物，
 *  把背景替换成海边」按肯定判 edit）。任一非否定子句命中即算意图存在。 */
function hasIntentKeyword(prompt: string, words: readonly string[]): boolean {
  return prompt.split(CLAUSE_SEPARATORS).some(
    (clause) =>
      !NEGATION_KEYWORDS.some((n) => clause.includes(n)) && words.some((w) => clause.includes(w)),
  );
}

/** IKFPYX：判定视频任务类型（纯函数，无 IO；backend 与 worker-java 同源口径）。
 *  优先级：首尾帧角色 > 单帧角色 > 参考视频 + 提示词意图（延长先于编辑，后者词面更宽）> default。
 *
 *  ⚠️ **「必须至少有一个参考视频」是官方明文**，不是本仓的取舍。出处在**创建视频生成任务 API**
 *     的 `omni_reference_task_type` 参数说明：「设置 edit 时，content 中必须至少包含一个
 *     reference_video」「设置 extend 时……必须至少包含一个 reference_video」。
 *     （提示词指南那页只列了 role 名单、没写这一条，所以要引 API 文档，别引错页。）
 *
 *  ⚠️ **别把 2.5 的约束素推到 2.0**：`ratio 必须为 adaptive` / `duration 必须为 -1` 写在
 *     `omni_reference_task_type` 下，而那个参数的「模型支持」只有 **Seedance 2.5**。
 *     官方「不同模型的取值限制和 adaptive 适配规则」表里，视频编辑/视频延长一行的
 *     Seedance 2.0 系列 = 「支持 adaptive 或指定宽高比」，2.5 = 「默认且仅支持 adaptive」。
 *     本函数是**所有视频模型共用**的判定器（只回答「这单属于哪类」），
 *     按模型分叉的**约束**走能力行配置（`features.task_types`），不要写进这里。 */
export function resolveVideoTaskType(
  references: ReadonlyArray<{ role: string; type: string }>,
  prompt: string,
): VideoTaskType {
  const hasFirst = references.some((r) => r.role === "first_frame");
  const hasLast = references.some((r) => r.role === "last_frame");
  if (hasFirst && hasLast) return "first_last_frame";
  if (hasFirst || hasLast) return "first_frame";
  const hasVideoRef = references.some((r) => r.role === "reference" && r.type === "video");
  if (!hasVideoRef) return "default";
  if (hasIntentKeyword(prompt, PROLONG_INTENT_KEYWORDS)) return "prolong";
  if (hasIntentKeyword(prompt, EDIT_INTENT_KEYWORDS)) return "edit";
  return "default";
}

function readStringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

function readNumberArray(v: unknown): number[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x))
    ? (v as number[])
    : null;
}

/** 该任务类型**声明的**可用比例；未声明 → `null`（= 不覆盖基础能力行）。
 *
 *  <p>导出是给**接纳侧的另一处判定**用的（`validateVideo` 的首帧/首尾帧比例闸）：那里必须按
 *  同一份能力行配置判定，否则两处各写一套就成了 ADR-0110 禁止的「跨层重复的限制」。
 *
 *  <p>⚠️ 这是「配置说了什么」，不是「校验结论」——是否放行由调用方决定（`null` = 不限）。 */
export function taskTypeAllowedRatios(
  taskTypes: unknown,
  taskType: VideoTaskType | undefined,
): string[] | null {
  return readStringArray(taskTypeConstraint(taskTypes, taskType)?.allowed_ratios);
}

/* ── 视频输出像素表 ──────────────────────────────────────────────────────────────
 *
 * 形态：`"resolution=480p|aspect_ratio=16:9" → "864x496"`。
 *
 * **键格式是从定价目录原样搬过来的**（原先叫 `tokenEstimate.dimensions`）。逐字搬而不是
 * 重新设计，是为了让这次搬迁「只换存储位置、不换数据」——搬的过程中没有任何一处需要转换，
 * 也就没有转换错误可言。
 *
 * **为什么这张表在能力行而不是目录**：它只在**预扣**用（按宽高估 token）。预扣是 backend
 * 发起的，可以按规格查表、把宽高冻成两个标量随 Hold 带过去。对照组是单价——单价在**结算**用，
 * 那一刻只有 billing 在场（`JobEventConsumer → settlement.settle`），所以单价必须住 billing 的库。
 * 归属由「谁在用它的那一刻在场」决定，不是按「看起来像不像配置」分。
 */

/** 规格键里允许的轴名。只认这两个——多一个轴就是另一种表，不该悄悄忽略。 */
const SPEC_KEY_AXES = ["resolution", "aspect_ratio"] as const;

/** 宽高值：`864x496`。分隔符是小写 `x`（与目录里既有的值逐字一致）。 */
const PIXELS_RE = /^([1-9][0-9]*)x([1-9][0-9]*)$/;

/** 解析规格键 `resolution=480p|aspect_ratio=16:9` → `{resolution, aspect_ratio}`；
 *  形态不对（缺轴 / 多轴 / 空值 / 重复轴）返回 null。
 *
 *  ⚠️ 轴名与顺序都**不做宽容**：这张表的键是机器生成的（从档位 × 比例派生），
 *  人手敲错时应该当场报错，而不是「勉强认出来」——认错的后果是按错的像素预扣。 */
export function parseSpecKey(key: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const part of key.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    const axis = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (value.length === 0) return null;
    if (!(SPEC_KEY_AXES as readonly string[]).includes(axis)) return null;
    if (out[axis] !== undefined) return null; // 重复轴：后一个会盖掉前一个，宁可拒
    out[axis] = value;
  }
  // 两个轴都必须有：少一个轴的键永远匹配不上，留着只会让人以为配了
  return SPEC_KEY_AXES.every((a) => out[a] !== undefined) ? out : null;
}

/** 拼规格键。与 {@link parseSpecKey} 是一对——全仓只有这一处拼键，避免两处写法漂开。 */
export function specKeyOf(resolution: string, aspectRatio: string): string {
  return `resolution=${resolution}|aspect_ratio=${aspectRatio}`;
}

/** 规格键的**比较用**归一：逐段 trim + 小写，再按轴名排序拼回。
 *
 *  <p>为什么要有这一步：档位的**大小写两处不一致是常态**——能力行的 `api_value` 写 `4K`，
 *  而像素表的键是从定价目录搬过来的 `resolution=4k|...`。这不是脏数据，是同一个值的两种写法。
 *  billing 原先查表走 `PricingKeys.normalizeKey`（同样的 `trim().toLowerCase()`），搬迁时
 *  漏了这一层，实测后果是 **`2.0 + 4K` 从 379 积分变成「算不出价」**（宽高冻不上 → billing 估不出 token）。
 *
 *  <p>⚠️ 归一**只用于比较**，不写回、不改存储。键照原样存，读的时候两边都归一后再比。 */
export function normalizeSpecKey(raw: string): string {
  const parts: Array<[string, string]> = [];
  for (const pair of raw.split("|")) {
    const at = pair.indexOf("=");
    if (at <= 0) return raw.trim().toLowerCase();
    parts.push([pair.slice(0, at).trim().toLowerCase(), pair.slice(at + 1).trim().toLowerCase()]);
  }
  parts.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return parts.map(([k, v]) => `${k}=${v}`).join("|");
}

/** 解析宽高值 `"864x496"` → `{width, height}`；形态不对返回 null。 */
export function parsePixels(value: string): { width: number; height: number } | null {
  const m = PIXELS_RE.exec(value);
  return m === null ? null : { width: Number(m[1]), height: Number(m[2]) };
}

/** 按 (分辨率档, 比例) 查输出像素。
 *
 *  <p>**查不到返回 `null`，不猜**——调用方据此走「预扣算不出上限」的拒绝路径。
 *  尤其**不做「adaptive 取该档位的 16:9 格」这种推断**：`adaptive` 在表里就是一个显式键，
 *  配了就命中、没配就没有，与目录时代的语义逐字相同（搬迁不改行为）。 */
export function resolveOutputPixels(
  dimensions: unknown,
  resolution: string,
  aspectRatio: string,
): { width: number; height: number } | null {
  if (typeof dimensions !== "object" || dimensions === null || Array.isArray(dimensions)) {
    return null;
  }
  // 逐字面命中优先（绝大多数情况，零额外开销），没命中再按归一后比一遍
  // ——档位大小写两处不一致是常态（能力行 api_value 写 `4K`、表键写 `4k`），见 normalizeSpecKey。
  const map = dimensions as Record<string, unknown>;
  const exact = map[specKeyOf(resolution, aspectRatio)];
  if (typeof exact === "string") return parsePixels(exact);

  const target = normalizeSpecKey(specKeyOf(resolution, aspectRatio));
  for (const [key, value] of Object.entries(map)) {
    if (typeof value !== "string") continue;
    if (normalizeSpecKey(key) === target) return parsePixels(value);
  }
  return null;
}

/** 取该任务类型的约束（未传任务类型/无该类型配置/非法形态 → null = 回落基础能力校验）。
 *  注：`default` 也照常取用——配了 default 约束就应按它校验（否则该配置形同虚设）。 */
function taskTypeConstraint(
  taskTypes: unknown,
  taskType: VideoTaskType | undefined,
): Record<string, unknown> | null {
  if (!taskType) return null;
  const map = taskTypes;
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const entry = (map as Record<string, unknown>)[taskType];
  return entry && typeof entry === "object" && !Array.isArray(entry)
    ? (entry as Record<string, unknown>)
    : null;
}

/** 提交侧待校验参数（Dock 视频/图片扁平字段，归一化由调用方完成）。 */
export interface GenerationParamCheckInput {
  /** 视频分辨率档（如 1080p）或图片尺寸档（如 2k）——与能力行 supported_sizes 的 id/api_value 比对。 */
  size: string;
  aspect_ratio: string;
  /** 视频时长（秒）。图片/音频不校验。 */
  duration?: number;
  /** IKFPYX：视频任务类型（命中 features.task_types 时按该类型的比例/时长约束校验）。 */
  task_type?: VideoTaskType;
}

/** 校验失败原因：带可用值提示，前端可直接展示。 */
export interface CapabilityParamFailure {
  reason: string;
  /** 供日志/调试；对外 message 用 reason。 */
  field: "size" | "aspect_ratio" | "duration";
  /** IKE7JP：细分错误码（resolution/ratio/duration 各一，出自码表）。 */
  code: string;
}

/** 尺寸档命中：按 id 或 api_value 比对能力行 supported_sizes 元素。 */
function matchesSize(
  size: string,
  supported: CapabilityLimitInput["supported_sizes"],
): boolean {
  return supported.some((s) => s.id === size || s.api_value === size);
}

/** 时长档：DB 支持两种形态（档位数组 [3,5,10] 或 {min,max,step} 范围对象）。 */
function durationInRange(
  duration: number,
  supported: CapabilityLimitInput["supported_durations"],
): boolean {
  if (Array.isArray(supported)) {
    return supported.includes(duration);
  }
  const range = supported as { min?: number; max?: number } | null;
  if (!range || typeof range.min !== "number" || typeof range.max !== "number") {
    // 无有效范围定义：不阻断（能力行未配置时长约束时放行，worker 兜底）。
    return true;
  }
  return duration >= range.min && duration <= range.max;
}

function ratios(capability: CapabilityLimitInput): string[] {
  return Array.isArray(capability.supported_aspect_ratios)
    ? capability.supported_aspect_ratios
    : [];
}

/** 校验提交参数是否落在能力目录支持范围。
 *  IKFPYX：命中 features.task_types[task_type] 时，该类型的 allowed_ratios / allowed_durations
 *  覆盖基础比例/时长校验（支持 duration=-1 自动时长）；未命中回落基础能力行。
 *  @returns 失败原因（带可用值提示）；全部通过返回 null。 */
export function checkGenerationParamLimit(
  capability: CapabilityLimitInput,
  params: GenerationParamCheckInput,
): CapabilityParamFailure | null {
  const supportedSizes = Array.isArray(capability.supported_sizes)
    ? capability.supported_sizes
    : [];
  // IKE7JP review：size 为空串（只带 duration 的视频任务）时不按分辨率拦截——
  // 分辨率未指定时由能力默认值兜底，仅校验明确携带的 duration。
  if (
    params.size !== "" &&
    supportedSizes.length > 0 &&
    !matchesSize(params.size, supportedSizes)
  ) {
    const available = supportedSizes
      .map((s) => s.api_value || s.id)
      .filter(Boolean)
      .join(" / ");
    return {
      field: "size",
      code: ERROR_CAPABILITY_UNSUPPORTED_RESOLUTION,
      reason: `当前模型不支持 分辨率/尺寸 ${params.size}，可用：${available}`,
    };
  }
  // IKFPYX：任务类型约束优先（首帧/首尾帧/edit/prolong 各自的比例与时长口径）。
  const constraint = taskTypeConstraint(capability.task_types, params.task_type);
  const taskRatios = readStringArray(constraint?.allowed_ratios);
  const taskDurations = readNumberArray(constraint?.allowed_durations);
  const taskLabel = params.task_type ? `当前任务类型（${params.task_type}）` : "当前任务类型";

  const ratioList = taskRatios ?? ratios(capability);
  if (ratioList.length > 0 && !ratioList.includes(params.aspect_ratio)) {
    return {
      field: "aspect_ratio",
      code: ERROR_CAPABILITY_UNSUPPORTED_RATIO,
      reason: `${taskRatios ? taskLabel : "当前模型"}不支持 比例 ${params.aspect_ratio}，可用：${ratioList.join(" / ")}`,
    };
  }
  if (params.duration !== undefined) {
    const d = Number(params.duration);
    if (taskDurations) {
      // 任务类型约束显式给出可用时长（可含 -1 自动时长）——严格按该清单校验。
      if (!taskDurations.includes(d)) {
        return {
          field: "duration",
          code: ERROR_CAPABILITY_UNSUPPORTED_DURATION,
          reason: `${taskLabel}不支持 时长 ${d} 秒，可用：${taskDurations.join(" / ")}`,
        };
      }
    } else {
      // 基础能力行：仅正数，且在 supported_durations 范围内（不含 -1）。
      if (!Number.isFinite(d) || d <= 0) {
        return { field: "duration", code: ERROR_CAPABILITY_UNSUPPORTED_DURATION, reason: "时长必须为正数" };
      }
      const durations = capability.supported_durations;
      if (durations !== undefined && durations !== null && !durationInRange(d, durations)) {
        if (Array.isArray(durations)) {
          return {
            field: "duration",
            code: ERROR_CAPABILITY_UNSUPPORTED_DURATION,
            reason: `当前模型不支持 时长 ${d} 秒，可用档位：${durations.join(" / ")}`,
          };
        }
        const range = durations as { min?: number; max?: number } | null;
        if (range && typeof range.min === "number" && typeof range.max === "number") {
          return {
            field: "duration",
            code: ERROR_CAPABILITY_UNSUPPORTED_DURATION,
            reason: `当前模型不支持 时长 ${d} 秒，可用范围 ${range.min}-${range.max} 秒`,
          };
        }
      }
    }
  }
  return null;
}

/** 把 Dock 视频参数解析成校验输入；resolution 缺省回退 size（plan/scene_card 兼容）。 */
export function toGenerationParamCheckInput(input: {
  resolution?: unknown;
  size?: unknown;
  aspect_ratio?: unknown;
  duration?: unknown;
}): GenerationParamCheckInput | null {
  if (typeof input.aspect_ratio !== "string" || input.aspect_ratio.length === 0) {
    return null;
  }
  const size =
    typeof input.resolution === "string" && input.resolution.length > 0
      ? input.resolution
      : typeof input.size === "string" && input.size.length > 0
        ? input.size
        : "";
  // IKE7JP review：duration 单独存在（视频只带时长、无 resolution/size）也进入校验——
  // 不能让只带时长越界一路漏到 worker。size 为空串时 duration 仍有效。
  const duration =
    input.duration === undefined || input.duration === null
      ? undefined
      : Number(input.duration);
  if (size.length === 0 && duration === undefined) return null;
  return { size, aspect_ratio: input.aspect_ratio, ...(duration !== undefined ? { duration } : {}) };
}
