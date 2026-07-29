/**
 * 将新文本追加到已有文本末尾：已有文本为空（trim 后）直接返回新文本，否则换行拼接。
 * 纯函数，无副作用。
 */
export function appendPrompt(existing: string, incoming: string): string {
  return existing.trim() === "" ? incoming : `${existing}\n${incoming}`;
}
