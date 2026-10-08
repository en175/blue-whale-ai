/* ============================================
 * 规格归一 —— **Hold 与 Quote 共用的这一份**
 *
 * ⚠️ 为什么必须共用而不是各写一份：报价（Quote）与预扣（Hold）都是拿
 *    「模型 + 任务类型 + 规格 + 等级」去同一份定价目录里查价。两份归一逻辑只要漂移一点
 *    （少取一个键、大小写不一致），用户看到的预览价就与实际被冻的钱对不上 ——
 *    而这类不一致会被当成「扣错了」，是本仓最不能接受的一类不一致。
 *
 *    所以：**改这里等于同时改 Hold 与 Quote**，两边行为一起变，不会分叉。
 * ============================================ */

/**
 * 不进规格的字段 —— 两类，**理由不同但后果一样：它们不该出现在定价那侧**。
 *
 * <h2>一、内容字段（prompt / title）</h2>
 *
 * 光靠「取所有标量」会把 `prompt` 也收进来（它是字符串）。于是：
 *
 * · **报价与预扣会分叉**。价格预览不必带创作内容（它是要发给用户看的一个数，
 *   没必要把用户刚写的整段提示词再传一遍），于是预览的规格集合比预扣少一个键。
 *   今天没有规则按提示词定价，所以看不出来；哪天有人配了，**预览价与实扣价就对不上**——
 *   而「预览价 = 实扣价」正是共用这个文件要保证的全部意义。
 * · **预览的查询键会随打字变化**。带上 prompt，用户每敲一个字都要重新报一次价。
 *
 * <p>规则本身：**规格是定价目录定义的封闭维度集合（尺寸、时长、档位……），
 * 创作内容不是。** 将来若要按内容计价（例如按提示词长度），那应当由上游把
 * 「长度」算成一个数字规格传进来，而不是把正文塞进规格表。
 */

export const DURATION_BASIS_KEY = "duration_basis_seconds";

export const OMNI_TASK_TYPE_ALLOWED_KEY = "omni_reference_task_type_allowed";

const NON_SPEC_FIELDS = new Set([
  "prompt",
  "title",
  "provider_credential",
  DURATION_BASIS_KEY,
  OMNI_TASK_TYPE_ALLOWED_KEY,
]);

/**
 * 规格键：视频输入档（轴名沿用火山的 `video`）。
 *
 * <p>⚠️ 键名与取值是**跨进程的规格契约**：预扣侧（本文件）、结算侧
 * （worker 的 {@code SettlementUsageLines}）与定价引擎（billing 的 {@code TokenEstimator}）
 * 三处必须逐字一致。任何一处改名，价格表就查不到 → 任务提交被拒（UNPRICEABLE），
 * 所以它落成常量而不是散在三处的字符串字面量。
 */
export const VIDEO_TIER_KEY = 'video';

/**
 * 视频输入档的两个取值 —— 火山把「输入不含视频 / 输入包含视频」这两档写作
 * **`video0` / `video1`**（同一模型的同一任务类型下的两个计费档）。
 *
 * <p>本仓的规格键语法是「轴=值」（{@code PricingKeys.normalizeKey} 要求键里有 `=`），
 * 所以它在规格与价格表里落成 `video=0` / `video=1`：**轴名沿用火山的 `video`、
 * 取值沿用火山的 `0` / `1`**，不另起名字。管理端展示时补中文解释
 * （「不含视频输入（video0）」/「含视频输入（video1）」），但存储与键名只用这一对。
 */
export const VIDEO_TIER_VALUES = { without: '0', with: '1' } as const;

/** 本次参考素材里有没有视频——只看 `references` 这一个数组，口径与 reference_count 相同。 */
function hasVideoInput(input: Record<string, unknown>): boolean {
  return (
    Array.isArray(input.references) &&
    input.references.some(
      (ref) =>
        typeof ref === 'object' && ref !== null && (ref as { type?: unknown }).type === 'video',
    )
  );
}

/**
 * 规格提取。
 *
 * ⚠️ 只取**标量**字段、排除 {@link NON_SPEC_FIELDS}、统一小写键名 —— 定价目录里的规格表
 * 按规范化后的键查找（《计费逻辑详细设计》§4.5.1）。这里不做值层面的归一
 * （例如 "1080P" → "1080p" 由 catalog 编译期负责），因为「哪些值等价」是定价配置的知识，
 * 不是生成流程的。
 *
 * <p>约定：catalog 里配了 table 的规格键，必须出现在 job 的冻结 input 上。
 * 漏键的后果是 `UNPRICEABLE`（拒绝提交）而不是按 0 计价 —— 这是刻意的。
 *
 * @param taskType ★ 必须传：参考素材数（{@code reference_count}）的**来源键按媒介不同**
 *                 —— 图片是 {@code input_asset_ids}，视频/音频是 {@code references}。
 *                 这里做成**必填**而不是可选，正是为了让「忘记传」变成编译错误：
 *                 漏传会让图片单的参考数静默退回 0（而它今天正在被按张收费）。
 */
export function extractSpecs(
  input: Record<string, unknown>,
  taskType: string,
): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (NON_SPEC_FIELDS.has(key.toLowerCase())) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      specs[key.toLowerCase()] = String(value).toLowerCase();
    }
  }
  // ⚠️ 参考素材数：参考素材是**数组**，数组进不了规格，但定价要的正是它的**长度**
  //    （catalog 用 `usage.referenceCount` 做加价：整单倍率，或 Seedream 5.0 Pro 那种
  //    「首张免费、第 2 张起每张 0.02 元」的按张绝对加价）。
  //    放在这份共用的归一里而不是各调用点：Hold 与 Quote 必须取到同一个数 —— 少取一处，
  //    预览价就比实冻价少了加价那部分（也就是「预览一个价、实扣另一个价」）。
  //    只取长度：**数组本身不进规格**（有测试钉住这条，混进去会让 catalog 查不到规格）。
  specs.reference_count = String(referenceList(input, taskType).length);
  const basisSeconds = input[DURATION_BASIS_KEY];
  if (typeof basisSeconds === "number" && Number.isFinite(basisSeconds)) {
    specs.duration = String(basisSeconds);
  }
  // ⚠️ 视频输入档：视频按 token 计价的**单价**分两档（火山官方：输入不含视频 / 输入包含视频），
  //    而「有没有视频参考」是 `references` 数组里的**元素类型**，同样进不了规格。
  //    与 reference_count 同一处、同一套理由折算成标量键，两个调用点取到同一个值。
  //    口径与 reference_count **逐条相同**：只认 `input.references` 里 type === 'video' 的条目，
  //    旧分字段路径（`reference_asset_ids` / `reference_materials`）不计入——两边口径必须一致，
  //    否则会出现「预扣按含视频输入计价、结算按不含视频输入收」这种对不上的账。
  specs[VIDEO_TIER_KEY] = hasVideoInput(input) ? VIDEO_TIER_VALUES.with : VIDEO_TIER_VALUES.without;
  // ⚠️ 输入视频时长（秒）：官方公式在含视频输入时要把输入时长加进 token 估算
  //    （(输入时长 + 输出时长) × 宽 × 高 × 帧率 ÷ 1024），而时长是 references **元素上**的标量、
  //    数组本身进不了规格，所以与上面两个键同一处折算成标量键。
  //    时长由接纳侧在建任务时冻结进 references（本地素材取 assets.duration，画布提交时前端也会带），
  //    worker 侧的 SettlementUsageLines 按同一口径折算——预扣与结算取到同一个数。
  //    ⚠️ **量不到就整个键不写**（而不是写 0）：键缺失 + `video=1` 时，
  //    billing 的 TokenEstimator 判为「含视频输入却量不到输入时长」→ 取不到 → 拒绝提交，
  //    而不是按 0 估。按 0 估就是明知故犯地少冻（差额平台垫付、账面无信号）。
  const videoInputSeconds = sumVideoInputSeconds(input.references);
  if (videoInputSeconds !== null) specs.video_input_seconds = String(videoInputSeconds);
  return specs;
}

/**
 * 本次生成的**参考素材列表** —— 取哪个键**按媒介**，这就是「参考数」的唯一口径。
 *
 * <h2>为什么图片与视频取的不是同一个键</h2>
 *
 * 建任务时两条路各写各的（`handle-create-generation-job.ts`）：
 * <ul>
 *   <li><b>图片</b>：合并去重后的参考图落 {@code input.input_asset_ids}
 *       （{@code imageStrategy.composeInput}，「image 参考图统一落 input_asset_ids」）。
 *       图片**从不写** {@code input.references}。</li>
 *   <li><b>视频 / 音频</b>：落 {@code input.references}（单数组契约，保序）。</li>
 * </ul>
 * 所以在改造前，图片单的 {@code reference_count} 恒为 **0** —— 不是「没有参考」，
 * 是**取错了键**。而 Seedream 5.0 Pro 的参考图是要按张收费的，那个 0 会让加价永远不生效。
 *
 * <p>⚠️ **视频/音频刻意保持只认 `references`**：它们的旧分字段路径
 * （{@code reference_asset_ids} / {@code reference_materials} / 首尾帧字段）从来不计入，
 * 现在放开会把老客户端的单子突然算上参考费。改图片是因为图片**只有**这一个键 —— 不存在
 * 「新老两条路」的问题。
 *
 * <p>取值口径与 worker 侧 {@code SettlementUsageLines.referenceList} **逐条相同**：
 * 同一个媒介分支、同一个键。两边漂一点就是「预扣按 2 张冻、结算按 5 张收」。
 */
export function referenceList(input: Record<string, unknown>, taskType: string): unknown[] {
  if (taskType === 'image' && Array.isArray(input.input_asset_ids)) {
    return input.input_asset_ids;
  }
  return Array.isArray(input.references) ? input.references : [];
}

/**
 * 输入视频总时长（秒，各视频参考 duration 之和）——**量不到返回 null**。
 *
 * 口径与 worker 侧 `SettlementUsageLines.videoInputSeconds` 逐条相同：只认 type === 'video'
 * 的条目、只累加它们各自带的 duration。只要有一条视频参考没带时长，这次就是量不到
 * （返回 null），**不把其余几条加起来凑一个偏小的数**——凑出来的数会让预扣偏低而看不出来。
 * 没有视频参考也返回 null（这一档本来就不加输入时长）。
 */
export function sumVideoInputSeconds(references: unknown): number | null {
  if (!Array.isArray(references)) return null;
  let total = 0;
  let any = false;
  for (const ref of references) {
    if (typeof ref !== 'object' || ref === null) continue;
    const entry = ref as { type?: unknown; duration?: unknown };
    if (entry.type !== 'video') continue;
    any = true;
    const seconds = entry.duration;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
    total += Math.floor(seconds);
  }
  return any ? total : null;
}
