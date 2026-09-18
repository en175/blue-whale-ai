/**
 * IKG6EK / ADR-0088：素材引用标记转移。
 *
 * 提交方（前端）给出的正文里，素材引用写作 `&<稳定身份>&`——只承载身份，不承载编号。
 * 服务端按本次请求的素材顺序把标记换成可读标签 `@<标签>`，编号（第几份）由本批素材现算，
 * 与标记在正文中的先后无关。
 *
 * 规则（ADR-0088 决策 3）：
 * - `labels` 由调用方按本次请求的素材顺序构造（键为**本次提交里该素材的身份原样**，
 *   值为不带 `@` 的标签如 `图片1` / `首帧`）。函数只负责补 `@`，不解释身份。
 * - **找不到身份就不转，标记原样保留**。不猜测、不删除、不报错——本版有意接受的代价
 *   （用户手打「价格 &21212& 元」这类文本会保持原样送达）。
 * - 不做转义；不做去重；同一素材多次提及得到同一标签（由 labels 保证）。
 *
 * 身份形态由提交方决定、本层不解释：本地 Asset 是纯数字 id，素材库/虚拟角色库是
 * `asset-` 前缀 id（与 `materialId()` 同口径，见契约 IKFA1M §1）。**标记里写什么，
 * 取决于本次 references 里该素材是以什么身份提交的**——转成 material_id 再调上游是
 * worker 的事，不在接纳层。
 *
 * core 不反向依赖 contracts，入参只取纯数据（同 compose-text-attachment-prompt.ts 先例）。
 */

/** 引用标记语法：`&<正整数 asset_id>&` 或 `&<asset- 前缀素材库 id>&`——扫描与替换共用的唯一定义。
 *  两处收口：`[^&]` 防吃掉后续标记、`[^&\s]` 再排除空白——素材库 id 不含空白，排除后
 *  「未闭合的 `&asset-x`」不会一路吞到下一个标记的 `&`（否则同一段里后续所有合法标记连带失效）。
 *  `i` 让语法层与校验层同宽：`MATERIAL_ID_PATTERN` 是 `/i`，`&ASSET-x&` 完全同名就该命中。
 *  `&0&` / `&01&` 这类非法形态不匹配，天然落回「原样保留」。 */
const MARKER_SOURCE = "&([1-9][0-9]*|asset-[^&\\s]{1,128})&";
/** 每次现造正则：带 g 的正则是有状态的（lastIndex），共用实例会串味。 */
const markerPattern = () => new RegExp(MARKER_SOURCE, "gi");

export function transferReferenceMarkers(
  prompt: string,
  labels: ReadonlyMap<string, string>,
): string {
  if (labels.size === 0) return prompt;
  // 素材库 id 在本仓按**大小写不敏感**处理（materialId() /^[Aa]sset-/、MATERIAL_ID_PATTERN /i、
  // 方案快照比对用 toLowerCase）；本地 asset 数字 id 无大小写问题。
  // 故 asset- 前缀的身份走小写回退，避免「references 写 Asset-X、正文写 &asset-x&」这类
  // 同义不同形被判成「找不到身份」而静默不转。
  const lower = new Map<string, string>();
  for (const [key, value] of labels) {
    if (!lower.has(key.toLowerCase())) lower.set(key.toLowerCase(), value);
  }
  return prompt.replace(markerPattern(), (whole, identity: string) => {
    const label = labels.get(identity)
      ?? (identity.toLowerCase().startsWith("asset-") ? lower.get(identity.toLowerCase()) : undefined);
    return label === undefined ? whole : `@${label}`;
  });
}
