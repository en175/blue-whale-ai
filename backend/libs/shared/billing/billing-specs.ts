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

/**
 * <h2>二、凭证（provider_credential）—— 这是**密钥泄漏**，不是分层问题</h2>
 *
 * 建任务时把上游 key 明文写进 `job.input.provider_credential`
 * （`handle-create-generation-job.ts`，修正四「凭证去密」）。它是字符串，
 * 于是被「取所有标量」的规则一并收进 specs，**跟着 Hold/Quote 的请求离开这个进程**、
 * 落进 billing 的 MQ 日志与计费记录里。
 *
 * <p>实测撞到：billing 的 MQ 日志里能读到明文 key。
 *
 * <p>⚠️ 它与上面那类字段**理由不同**（那个是分层，这个是安全），但处理方式一样 ——
 * 都在离开本进程之前挡掉。加进来的时候别再分两个集合：**「不该进规格的字段」
 * 只有一个清单，分开维护就一定有一边漏。**
 */
const NON_SPEC_FIELDS = new Set(["prompt", "title", "provider_credential"]);

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
 */
export function extractSpecs(input: Record<string, unknown>): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (NON_SPEC_FIELDS.has(key.toLowerCase())) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      specs[key.toLowerCase()] = String(value).toLowerCase();
    }
  }
  // ⚠️ 参考素材数：`references` 是**数组**，数组进不了规格，但定价要的正是它的**长度**
  //    （catalog 用 `usage.referenceCount` 做加价倍率）。所以在这里折算成一个标量键，
  //    键名与 UsageDim.REFERENCE_COUNT 的 contractSpecKey 一致。
  //    放在这份共用的归一里而不是各调用点：Hold 与 Quote 必须取到同一个数 —— 少取一处，
  //    预览价就比实冻价少了加价那部分（也就是「预览一个价、实扣另一个价」）。
  //    只取长度：**数组本身不进规格**（有测试钉住这条，混进去会让 catalog 查不到规格）。
  specs.reference_count = String(Array.isArray(input.references) ? input.references.length : 0);
  // ⚠️ 是否含视频输入：视频按 token 计价的**单价**分两档（火山官方：无视频输入 / 含视频输入），
  //    而「有没有视频参考」是 `references` 数组里的**元素类型**，同样进不了规格。
  //    与 reference_count 同一处、同一套理由折算成标量键，两个调用点取到同一个值。
  //    口径与 reference_count **逐条相同**：只认 `input.references` 里 type === 'video' 的条目，
  //    旧分字段路径（`reference_asset_ids` / `reference_materials`）不计入——两边口径必须一致，
  //    否则会出现「预扣按含视频输入计价、结算按不含视频输入收」这种对不上的账。
  specs.has_video_input = String(
    Array.isArray(input.references) &&
      input.references.some(
        (ref) =>
          typeof ref === 'object' &&
          ref !== null &&
          (ref as { type?: unknown }).type === 'video',
      ),
  );
  return specs;
}
