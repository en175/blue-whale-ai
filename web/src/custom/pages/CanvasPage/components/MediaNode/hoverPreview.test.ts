import { type MediaGenStatus } from '@/custom/enums';
import { describe, expect, it } from 'vitest';
import { HOVER_PREVIEW_DELAY_MS, videoHoverPreviewBlocked, videoHoverPreviewEligible } from './hoverPreview';
import type { VideoHoverPreviewInput } from './hoverPreview';

import { isMultiNodeSelection } from '../../hooks/chrome/useSoloNodeSelected';

const _genStatusCoversMediaGenStatus: VideoHoverPreviewInput['genStatus'] = undefined as MediaGenStatus | undefined;
const _mediaGenStatusCoveredByGenStatus: MediaGenStatus | undefined = undefined as VideoHoverPreviewInput['genStatus'];
void _genStatusCoversMediaGenStatus;
void _mediaGenStatusCoveredByGenStatus;

const eligibleBase = {
  mediaType: 'video' as const,
  src: 'https://x/main.mp4',
  toolMode: 'select' as const,
};

describe('videoHoverPreviewEligible / videoHoverPreviewBlocked（IKJ7RS 建，IKJ7S1 翻转）', () => {
  it('布防延时为 100ms', () => {
    expect(HOVER_PREVIEW_DELAY_MS).toBe(100);
  });

  it('成品视频卡 + 选择工具：可起播、无排除态', () => {
    expect(videoHoverPreviewEligible(eligibleBase)).toBe(true);
    expect(videoHoverPreviewBlocked(eligibleBase)).toBe(false);
  });

  it.each([
    ['图片卡', { ...eligibleBase, mediaType: 'image' as const }],
    ['音频卡', { ...eligibleBase, mediaType: 'audio' as const }],
    ['抓手（拖动）工具模式', { ...eligibleBase, toolMode: 'drag' as const }],
    ['加载失败兜底', { ...eligibleBase, hasVideoError: true }],
    ['生成中（含重生成成品卡）', { ...eligibleBase, genStatus: 'generating' as const }],
    ['质检核对锁定 checking', { ...eligibleBase, genStatus: 'checking' as const }],
    ['待生成草稿', { ...eligibleBase, genStatus: 'draft' as const }],
    ['生成失败', { ...eligibleBase, genStatus: 'failed' as const }],
    ['已取消', { ...eligibleBase, genStatus: 'cancelled' as const }],
    ['草稿身份卡', { ...eligibleBase, draft: true }],
    ['素材缺失', { ...eligibleBase, assetMissing: true }],
    ['空壳占位', { ...eligibleBase, emptyShell: true }],
    ['去字幕会话锁定', { ...eligibleBase, subtitleEraseLocked: true }],
    ['分离/场景切分/抠像会话锁定', { ...eligibleBase, splitEditing: true }],
    ['画布多选（框选 / Ctrl 加选 / Ctrl+A）', { ...eligibleBase, multiSelected: true }],
    ['blob 上传预览 src', { ...eligibleBase, src: 'blob:preview' }],
    ['空 src', { ...eligibleBase, src: '' }],
    ['src 缺失', { ...eligibleBase, src: undefined }],
  ])('排除态：%s 不起播且命中会话排除', (_name, input) => {
    expect(videoHoverPreviewEligible(input)).toBe(false);
    expect(videoHoverPreviewBlocked(input)).toBe(true);
  });
});

describe('isMultiNodeSelection（useSoloNodeSelected 导出计数，MediaNode useStore 选择器复用）', () => {
  it('无选中 / 单选中：非多选', () => {
    expect(isMultiNodeSelection([])).toBe(false);
    expect(isMultiNodeSelection([{ selected: false }, { selected: false }])).toBe(false);
    expect(isMultiNodeSelection([{ selected: true }, { selected: false }])).toBe(false);
  });

  it('两个及以上选中即多选；selected 字段缺失视为未选中', () => {
    expect(isMultiNodeSelection([{ selected: true }, { selected: true }])).toBe(true);
    expect(isMultiNodeSelection([{ selected: true }, {}, { selected: true }])).toBe(true);
    expect(isMultiNodeSelection([{}, {}])).toBe(false);
  });
});
