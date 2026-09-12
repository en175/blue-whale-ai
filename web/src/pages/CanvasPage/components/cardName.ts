/* ============================================
 * 卡片名称（IKFA8X）：图片/视频/音频/文本卡片双击改名共用规则。
 * 名称是节点级显示信息（媒体节点 data.fileName / 文本节点 data.title），
 * 用户自定义状态由显式 data.customName 标记，不靠名称内容推断。
 * ============================================ */

/** 卡片名称最大字符数（按 JS 字符串长度计；父规格 A08：100 可保存，101 拒绝） */
export const CARD_NAME_MAX_LENGTH = 100;

export type CardNameCommit =
  /** 有效新名称：保存去首尾空格后的值 */
  | { kind: 'save'; value: string }
  /** 空白或全空格提交：恢复编辑前名称，不保存 */
  | { kind: 'restore' }
  /** 内容与当前名称一致：直接退出编辑，不触发保存、不置自定义标记 */
  | { kind: 'noop' }
  /** 超长：保留编辑内容继续修改，不保存、不截断 */
  | { kind: 'invalid'; message: string };

/** 提交归一化：去首尾空格 → 空回退 → 超长拒绝 → 未变更跳过 → 保存 */
export function commitCardName(raw: string, current: string): CardNameCommit {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'restore' };
  if (trimmed.length > CARD_NAME_MAX_LENGTH) {
    return { kind: 'invalid', message: `名称最多 ${CARD_NAME_MAX_LENGTH} 个字符，当前内容未保存` };
  }
  if (trimmed === current) return { kind: 'noop' };
  return { kind: 'save', value: trimmed };
}
