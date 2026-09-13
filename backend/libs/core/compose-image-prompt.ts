import { composeTextAttachmentPrompt } from "./compose-text-attachment-prompt.js";

/**
 * Deterministically compose the provider prompt from ordered text attachments
 * and the target prompt (IKDLQF contract). Blank-only attachment texts are
 * skipped; a non-blank target prompt is appended last. No rewriting.
 *
 * 通用实现见 compose-text-attachment-prompt.ts（IKDLQG 起图片与视频共用同一条
 * 组合规则）；本函数保留图片侧入口名称，语义不变。
 */
export function composeImagePrompt(
  attachments: readonly { text: string }[],
  prompt: string,
): string {
  return composeTextAttachmentPrompt(attachments, prompt);
}
