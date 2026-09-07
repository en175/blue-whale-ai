// IKDMQU 成功卡原卡编辑与重新生成：纯函数单测
import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { cancelledTerminalAction, hasGenerationRecord, isInPlaceRegenTarget } from './mediaReEdit';

/** 构造媒体节点（data 局部覆盖） */
function mediaNode(data: Record<string, unknown>): Node {
  return { id: 'm1', type: 'mediaNode', position: { x: 0, y: 0 }, data };
}

describe('hasGenerationRecord 成品卡生成记录判定', () => {
  it('携带 jobId 的成品卡（字符串/数字）视为有生成记录', () => {
    expect(hasGenerationRecord(mediaNode({ src: 'http://a/1.png', jobId: 'j9' }))).toBe(true);
    expect(hasGenerationRecord(mediaNode({ src: 'http://a/1.png', jobId: 9 }))).toBe(true);
  });

  it('重新生成中的成品卡（generating + jobId）仍有生成记录', () => {
    expect(
      hasGenerationRecord(mediaNode({ src: 'http://a/1.png', genStatus: 'generating', jobId: 'j9' })),
    ).toBe(true);
  });

  it('上传素材卡（无 jobId）无生成记录——选中不自动打开面板（Q4）', () => {
    expect(hasGenerationRecord(mediaNode({ src: 'http://a/1.png', fileName: '上传图.png' }))).toBe(false);
  });

  it('待生成草稿不属于成品卡生成记录（走草稿绑定路径）', () => {
    expect(hasGenerationRecord(mediaNode({ draft: true, genStatus: 'draft', mediaType: 'image' }))).toBe(
      false,
    );
  });

  it('无 jobId 的 failed 卡无生成记录（历史占位卡失败未成作品）', () => {
    expect(hasGenerationRecord(mediaNode({ genStatus: 'failed', errorText: 'x' }))).toBe(false);
  });

  it('非媒体节点一律无生成记录', () => {
    expect(hasGenerationRecord({ id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: {} })).toBe(false);
    expect(hasGenerationRecord(undefined)).toBe(false);
  });
});

describe('isInPlaceRegenTarget 原位承接判定（Q1 原卡重新生成）', () => {
  it('草稿身份节点原位承接（IKDMQQ 既有行为）', () => {
    expect(isInPlaceRegenTarget(mediaNode({ draft: true, genStatus: 'draft' }))).toBe(true);
  });

  it('有生成记录的成品卡原位承接（IKDMQU 新行为）', () => {
    expect(isInPlaceRegenTarget(mediaNode({ src: 'http://a/1.png', jobId: 'j1' }))).toBe(true);
  });

  it('上传素材卡不原位承接（避免普通生成误挂到素材卡）', () => {
    expect(isInPlaceRegenTarget(mediaNode({ src: 'http://a/1.png' }))).toBe(false);
  });
});

describe('cancelledTerminalAction 取消终态处置（Q5 保留旧素材）', () => {
  it('成品卡取消 → 恢复成品态（不删卡，保留旧素材与最新编辑）', () => {
    expect(cancelledTerminalAction(mediaNode({ src: 'http://a/1.png', jobId: 'j2' }))).toBe('restore');
  });

  it('草稿取消 → 维持既有删除路径（取消竞态属后续切片）', () => {
    expect(cancelledTerminalAction(mediaNode({ draft: true, genStatus: 'generating' }))).toBe('remove');
  });

  it('无生成记录的非草稿节点取消 → 维持删除（历史占位卡语义）', () => {
    expect(cancelledTerminalAction(mediaNode({ genStatus: 'generating' }))).toBe('remove');
  });
});
