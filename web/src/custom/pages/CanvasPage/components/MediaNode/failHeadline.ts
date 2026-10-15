import { type MediaGenStatus } from '@/custom/enums';

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
