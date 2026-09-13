/**
 * Deterministically compose the provider prompt from ordered text attachments
 * and the target prompt (IKDLQF image / IKDLQG video shared contract). Blank-only
 * attachment texts are skipped; a non-blank target prompt is appended last.
 * No rewriting.
 *
 * attachments 仅需 text 字段（与 @blue-whale/contracts 的 TextAttachmentSnapshot
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

/**
 * IKFA1P：编号清单组合——正文含文本标签（text_ref）时，文本附件按序以
 * 「文本N：<正文>」行进入组合，正文中的「文本N」字样与清单行号建立明确
 * 编号 ↔ 内容关系（不只发送文本N字样）。空白附件保留编号占位（内容为空），
 * 保证行号与附件顺序稳定对应；正文非空时追加在清单之后。
 * 语义权威：docs/specs/2026-09-13-ikfa1p-text-attachment-prompt-ref-contract.md §3.2。
 */
export function composeTextAttachmentPromptIndexed(
  attachments: readonly { text: string }[],
  prompt: string,
): string {
  const parts = attachments.map((a, i) => `文本${i + 1}：${a.text}`);
  if (prompt.trim().length > 0) {
    parts.push(prompt);
  }
  return parts.join("\n\n");
}
