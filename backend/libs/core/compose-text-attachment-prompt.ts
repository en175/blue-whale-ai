/**
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
