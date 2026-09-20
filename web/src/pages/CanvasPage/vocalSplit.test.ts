import { describe, expect, it } from 'vitest';
import {
  VOCAL_SPLIT_NODE_PREFIX,
  VOCAL_SPLIT_SCENE_OPTIONS,
  buildVocalSplitPlaceholderNode,
  isVocalSplitNodeId,
  vocalSplitDisplayName,
  vocalSplitErrorText,
  vocalSplitNodeId,
  vocalSplitSceneHint,
  vocalSplitSceneLabel,
  vocalSplitTerminalPatch,
} from './vocalSplit';

describe('场景四档：标签与产出轨数 hint', () => {
  it('场景清单与契约同序四档；标签=通用/音乐/短剧/口播', () => {
    expect(VOCAL_SPLIT_SCENE_OPTIONS).toEqual(['audio', 'music', 'drama', 'narrate']);
    expect(vocalSplitSceneLabel('audio')).toBe('通用');
    expect(vocalSplitSceneLabel('music')).toBe('音乐');
    expect(vocalSplitSceneLabel('drama')).toBe('短剧');
    expect(vocalSplitSceneLabel('narrate')).toBe('口播');
  });

  it('轨数 hint 按契约轨映射派生：audio/music 两轨、drama/narrate 三轨', () => {
    expect(vocalSplitSceneHint('audio')).toBe('人声+背景音两轨');
    expect(vocalSplitSceneHint('music')).toBe('人声+背景音两轨');
    expect(vocalSplitSceneHint('drama')).toBe('人声/音乐/音效三轨');
    expect(vocalSplitSceneHint('narrate')).toBe('人声/音乐/音效三轨');
  });
});

describe('占位卡命名与 node id', () => {
  it('展示名 = 源名去扩展名 + (人声背景分离)；空名回落', () => {
    expect(vocalSplitDisplayName('测试视频.mp4')).toBe('测试视频(人声背景分离)');
    expect(vocalSplitDisplayName('  无后缀名  ')).toBe('无后缀名(人声背景分离)');
    expect(vocalSplitDisplayName('')).toBe('人声背景分离');
    expect(vocalSplitDisplayName(undefined)).toBe('人声背景分离');
  });

  it('占位节点 id = vocal-split-{jobId}，前缀判定与轮询/终态共用同一约定', () => {
    expect(vocalSplitNodeId('701')).toBe('vocal-split-701');
    expect(VOCAL_SPLIT_NODE_PREFIX).toBe('vocal-split-');
    expect(isVocalSplitNodeId('vocal-split-701')).toBe(true);
    expect(isVocalSplitNodeId('media-extract-701')).toBe(false);
  });
});

describe('buildVocalSplitPlaceholderNode', () => {
  it('生成中占位卡：mediaType audio、源卡右侧按内容宽让开一格、带 vocalSplit 身份（lastInput 三键）', () => {
    const node = buildVocalSplitPlaceholderNode({
      jobId: '701',
      scene: 'drama',
      outputFormat: 'flac',
      sourceAssetId: '5',
      source: {
        position: { x: 100, y: 220 },
        data: { fileName: '测试视频.mp4', mediaType: 'video', width: 1920, height: 1080 },
      },
    });
    expect(node.id).toBe('vocal-split-701');
    expect(node.position.y).toBe(220);
    expect(node.data.genStatus).toBe('generating');
    expect(node.data.mediaType).toBe('audio');
    expect(node.data.fileName).toBe('测试视频(人声背景分离)');
    expect(node.data.vocalSplit).toEqual({
      sourceAssetId: '5',
      lastInput: { source_asset_id: '5', scene: 'drama', output_format: 'flac' },
    });
  });

  it('源 assetId 未知时不带身份（无身份失败卡不渲染重试，口径同家族）', () => {
    const node = buildVocalSplitPlaceholderNode({
      jobId: '702',
      scene: 'audio',
      outputFormat: 'aac',
      source: { position: { x: 0, y: 0 }, data: { mediaType: 'video' } },
    });
    expect(node.data.vocalSplit).toBeUndefined();
  });
});

describe('vocalSplitErrorText', () => {
  it('优先 msg；1046 兜底码映射「人声背景分离失败，请重试」；入队失败映射专用文案', () => {
    expect(vocalSplitErrorText({ msg: '任务入队失败，请重试' })).toBe('任务入队失败，请重试');
    expect(vocalSplitErrorText({ code: 'vocal_split_failed' })).toBe('人声背景分离失败，请重试');
    expect(vocalSplitErrorText({ code: 'enqueue_failed' })).toBe('任务入队失败，请重试');
    expect(vocalSplitErrorText(null)).toBe('人声背景分离失败');
  });
});

describe('vocalSplitTerminalPatch', () => {
  it('succeeded 最小处理 = 停生成中（不回填成品，多轨扇出归 IKHA30）', () => {
    expect(vocalSplitTerminalPatch({ status: 'succeeded' })).toEqual({
      genStatus: undefined,
      progress: 100,
    });
  });

  it('failed 落失败态与可读文案；cancelled 落已取消；进行中返回 null 续轮询', () => {
    expect(vocalSplitTerminalPatch({ status: 'failed', error: { code: 'vocal_split_failed' } })).toEqual({
      genStatus: 'failed',
      errorText: '人声背景分离失败，请重试',
    });
    expect(vocalSplitTerminalPatch({ status: 'cancelled' })).toEqual({ genStatus: 'cancelled' });
    expect(vocalSplitTerminalPatch({ status: 'processing' })).toBeNull();
    expect(vocalSplitTerminalPatch({ status: 'queued' })).toBeNull();
  });
});
