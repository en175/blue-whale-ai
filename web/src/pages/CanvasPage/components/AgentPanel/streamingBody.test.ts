import { describe, expect, it } from 'vitest';

import { splitStreamingBody } from './streamingBody';

describe('流式正文按工具调用断段', () => {
  it('没有工具调用时原样一段——绝大多数轮次就是这样', () => {
    expect(splitStreamingBody('收到，我这就写。', [])).toEqual([{ type: 'text', text: '收到，我这就写。' }]);
  });

  it('先说一句、再动手、再说一句', () => {
    const text = '收到。我直接落卡。我先把这版需求理解摆给你看。';
    const pieces = splitStreamingBody(text, [
      { tool: 'workflow-prompt-card-authoring', summary: '正在编排分镜与提示词', at: 9 },
    ]);
    expect(pieces).toEqual([
      { type: 'text', text: '收到。我直接落卡。' },
      { type: 'tool_call', tool: 'workflow-prompt-card-authoring', summary: '正在编排分镜与提示词' },
      { type: 'text', text: '我先把这版需求理解摆给你看。' },
    ]);
  });

  it('断点还没被打字动画追上时不提前跳出来', () => {
    // 断点记的是缓冲长度，传进来的是已露出的前缀：`at` 在后面，这一帧就还看不到它。
    const pieces = splitStreamingBody('收到。我直', [
      { tool: 'read_asset', summary: '正在读取视频', at: 30 },
    ]);
    expect(pieces).toEqual([{ type: 'text', text: '收到。我直' }]);
  });

  it('一轮里两次调用，各断各的', () => {
    const pieces = splitStreamingBody('先读素材。再编排。写完了。', [
      { tool: 'read_asset', summary: '正在读取视频', at: 5 },
      { tool: 'workflow-prompt-card-authoring', summary: '正在编排分镜与提示词', at: 9 },
    ]);
    expect(pieces.map(piece => piece.type)).toEqual(['text', 'tool_call', 'text', 'tool_call', 'text']);
    expect(pieces[2]).toEqual({ type: 'text', text: '再编排。' });
  });

  it('调用发生在第一个字之前——不产生一段空正文', () => {
    const pieces = splitStreamingBody('读完了。', [{ tool: 'read_asset', summary: '正在读取视频', at: 0 }]);
    expect(pieces).toEqual([
      { type: 'tool_call', tool: 'read_asset', summary: '正在读取视频' },
      { type: 'text', text: '读完了。' },
    ]);
  });

  it('正文还一个字都没有时，工具行照常显示', () => {
    expect(splitStreamingBody('', [{ tool: 'read_asset', summary: '正在读取视频', at: 0 }])).toEqual([
      { type: 'tool_call', tool: 'read_asset', summary: '正在读取视频' },
    ]);
  });

  it('两次调用挨在同一处时，中间不塞一段空白正文', () => {
    const pieces = splitStreamingBody('好。做完了。', [
      { tool: 'read_asset', summary: '正在读取视频', at: 2 },
      { tool: 'workflow-prompt-card-authoring', summary: '正在编排分镜与提示词', at: 2 },
    ]);
    expect(pieces).toEqual([
      { type: 'text', text: '好。' },
      { type: 'tool_call', tool: 'read_asset', summary: '正在读取视频' },
      { type: 'tool_call', tool: 'workflow-prompt-card-authoring', summary: '正在编排分镜与提示词' },
      { type: 'text', text: '做完了。' },
    ]);
  });
});
