/**
 * IKG6EK / ADR-0088：素材引用标记转移。
 *
 * 提交方（前端）给出的正文里，素材引用写作 `&<asset_id>&`——只承载**稳定身份**，
 * 不承载编号。服务端按本次请求的素材顺序把标记换成可读标签 `@<标签>`，
 * 编号（第几份）由本批素材现算，与标记在正文中的先后无关。
 *
 * 规则（ADR-0088 决策 3）：
 * - `labels` 由调用方按本次请求的素材顺序构造，键为本地 asset 纯数字 id，
 *   值为**不带 `@`** 的标签（如 `图片1` / `首帧`）。函数只负责补 `@`。
 * - **找不到身份就不转，标记原样保留**。不猜测、不删除、不报错——这是本版
 *   有意接受的代价（用户手打「价格 &21212& 元」这类文本会保持原样送达）。
 * - 不做转义；不做去重；同一素材多次提及得到同一标签（由 labels 保证）。
 *
 * core 不反向依赖 contracts，入参只取纯数据（同 compose-text-attachment-prompt.ts
 * 头注释先例）。
 */
/** 引用标记语法：`&<正整数 asset_id>&`——扫描与替换共用的唯一定义。 */
const MARKER_SOURCE = "&([1-9][0-9]*)&";
/** 每次现造正则：带 g 的正则是有状态的（lastIndex），共用实例会串味。 */
const markerPattern = () => new RegExp(MARKER_SOURCE, "g");

export function transferReferenceMarkers(
  prompt: string,
  labels: ReadonlyMap<string, string>,
): string {
  if (labels.size === 0) return prompt;
  // asset_id 为正整数（契约 IKFA1M §1 的稳定身份形态），`&0&` / `&01&` 这类
  // 非法形态不匹配，天然落回「原样保留」。
  return prompt.replace(markerPattern(), (whole, assetId: string) => {
    const label = labels.get(assetId);
    return label === undefined ? whole : `@${label}`;
  });
}

/** 与 transferReferenceMarkers 同一套语法：正文中被引用的 asset id（去重、保首见）。 */
export function markerAssetIdsOf(prompt: string): string[] {
  return [...new Set([...prompt.matchAll(markerPattern())].map((m) => m[1]!))];
}
