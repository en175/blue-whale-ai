/**
 * **已退役（IKE5G8 / ADR-0088 / IKH8AU）：无生产调用者，不要再接回接纳或出站链路。**
 * ADR-0088 起正文由提交方给全（附件正文已在 `prompt` 里），服务端不再组合；接纳侧曾用它
 * 当长度探针，那正是「附件被算两遍」的来源，已随组合闸一并删除。现仅测试引用。
 * 是否连同 `composeImagePrompt` 一起删除，另开清理单处理。
 *
 * Deterministically compose the provider prompt from ordered text attachments
 * and the target prompt (IKDLQF image / IKDLQG video shared contract). Blank-only
 * attachment texts are skipped; a non-blank target prompt is appended last.
 * No rewriting.
 *
 * attachments 仅需 text 字段（与 @lib/contracts 的 TextAttachmentSnapshot
 * 结构化同构）：core 不反向依赖 contracts，同 ark-image-client.ts 头注释先例。
 */
export function composeTextAttachmentPrompt(
  attachments: readonly { text: string }[],
  prompt: string,
): string {
  const parts = attachments.map((a) => a.text).filter((t) => t.trim().length > 0);
  if (prompt.trim().length > 0) {
    parts.push(prompt);
  }
  return parts.join("\n\n");
}
