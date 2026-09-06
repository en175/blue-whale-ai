/** 失败卡片主文案：后端具体原因优先，没有才用兜底。 */
import type { MediaGenStatus } from './index';

export function mediaNodeFailHeadline(input: {
  genStatus?: MediaGenStatus;
  errorText?: string;
  isMediaExtraction: boolean;
}): string {
  if (input.genStatus === 'cancelled') return '已取消生成';
  const specific = input.errorText?.trim();
  if (specific) return specific;
  return input.isMediaExtraction ? '音频提取失败' : '生成失败';
}
