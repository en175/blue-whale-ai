import { promptCoveredByAttachmentParts, type PromptDoc } from '@/app/utils/prompt-doc';
import type { ImageTextAttachment } from './index';

export function composeImageSendPrompt(
  attachments: ImageTextAttachment[] | undefined,
  input: string,
  promptDoc?: PromptDoc | null,
): string {
  const indexed = promptDoc?.segments.some((segment) => segment.kind === 'text_ref');
  const parts = indexed
    ? (attachments ?? []).map((item, i) => `文本${i + 1}：${item.text}`)
    : (attachments ?? []).map((item) => item.text).filter((text) => text.trim().length > 0);
  if (input.trim().length > 0 && !promptCoveredByAttachmentParts(input, parts)) parts.push(input);
  return parts.join('');
}
