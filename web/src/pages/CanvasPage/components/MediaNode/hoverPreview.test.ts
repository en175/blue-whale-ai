import { describe, expect, it } from 'vitest';
import { HOVER_PREVIEW_DELAY_MS, videoHoverPreviewBlocked, videoHoverPreviewEligible } from './hoverPreview';

/** 未选中成品视频卡基准样本：满足起播门的全部条件 */
const eligibleBase = {
  mediaType: 'video' as const,
  src: 'https://x/main.mp4',
  toolMode: 'select' as const,
  selected: false,
};

describe('videoHoverPreviewEligible / videoHoverPreviewBlocked（IKJ7RS）', () => {
  it('布防延时为 100ms', () => {
    expect(HOVER_PREVIEW_DELAY_MS).toBe(100);
  });

  it('成品视频卡 + 选择工具 + 未选中：可起播、无排除态', () => {
    expect(videoHoverPreviewEligible(eligibleBase)).toBe(true);
    expect(videoHoverPreviewBlocked(eligibleBase)).toBe(false);
  });

  it('选中卡不起播（选中卡规则归 IKJ7S1），但不算会话排除态（点选过渡续播不被停）', () => {
    const input = { ...eligibleBase, selected: true };
    expect(videoHoverPreviewEligible(input)).toBe(false);
    expect(videoHoverPreviewBlocked(input)).toBe(false);
  });

  it.each([
    ['图片卡', { ...eligibleBase, mediaType: 'image' as const }],
    ['音频卡', { ...eligibleBase, mediaType: 'audio' as const }],
    ['抓手（拖动）工具模式', { ...eligibleBase, toolMode: 'drag' as const }],
    ['加载失败兜底', { ...eligibleBase, hasVideoError: true }],
    ['生成中（含重生成成品卡）', { ...eligibleBase, genStatus: 'generating' as const }],
    ['待生成草稿', { ...eligibleBase, genStatus: 'draft' as const }],
    ['生成失败', { ...eligibleBase, genStatus: 'failed' as const }],
    ['已取消', { ...eligibleBase, genStatus: 'cancelled' as const }],
    ['草稿身份卡', { ...eligibleBase, draft: true }],
    ['素材缺失', { ...eligibleBase, assetMissing: true }],
    ['空壳占位', { ...eligibleBase, emptyShell: true }],
    ['去字幕会话锁定', { ...eligibleBase, subtitleEraseLocked: true }],
    ['分离/场景切分/抠像会话锁定', { ...eligibleBase, splitEditing: true }],
    ['blob 上传预览 src', { ...eligibleBase, src: 'blob:preview' }],
    ['空 src', { ...eligibleBase, src: '' }],
    ['src 缺失', { ...eligibleBase, src: undefined }],
  ])('排除态：%s 不起播且命中会话排除', (_name, input) => {
    expect(videoHoverPreviewEligible(input)).toBe(false);
    expect(videoHoverPreviewBlocked(input)).toBe(true);
  });
});
