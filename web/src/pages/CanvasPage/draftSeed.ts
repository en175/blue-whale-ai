/** 草稿面板 seed 内容等值比较（IKIJ61）：排除 ts 时间戳的深度等值——图片/视频/音频三面板
 *  的 seed 均为可 JSON 化纯数据（text/doc/promptDoc/params/targetNodeId/attachments/refs/files），
 *  数组按元素、对象按键递归比较。打开链路重复通报同一草稿时据此跳过 setSeed 写入，
 *  保留旧引用（面板 key 不变、不重挂载）；内容真实变化仍写入新对象。 */
export function draftSeedEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => draftSeedEquals(item, b[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).filter((k) => k !== 'ts');
  const bKeys = Object.keys(bObj).filter((k) => k !== 'ts');
  return aKeys.length === bKeys.length
    && aKeys.every((k) => Object.prototype.hasOwnProperty.call(bObj, k) && draftSeedEquals(aObj[k], bObj[k]));
}
