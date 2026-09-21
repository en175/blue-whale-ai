import { describe, expect, it } from 'vitest';
import {
  VOCAL_SPLIT_NODE_PREFIX,
  VOCAL_SPLIT_SCENE_OPTIONS,
  VOCAL_SPLIT_TRACK_LABELS,
  VOCAL_SPLIT_TRACK_NODE_PREFIX,
  buildVocalSplitPlaceholderNode,
  buildVocalSplitTrackNodes,
  isVocalSplitNodeId,
  vocalSplitDisplayName,
  vocalSplitErrorText,
  vocalSplitNodeId,
  vocalSplitSceneHint,
  vocalSplitSceneLabel,
  vocalSplitSourceName,
  vocalSplitTerminalPatch,
  vocalSplitTrackDisplayName,
  vocalSplitTrackNodeId,
} from './vocalSplit';
import { VOCAL_SPLIT_SCENE_TRACKS, type VocalSplitTrackType } from '@lib/contracts/vocal-split';

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
  it('优先 msg；1047 兜底码映射「人声背景分离失败，请重试」；入队失败映射专用文案', () => {
    expect(vocalSplitErrorText({ msg: '任务入队失败，请重试' })).toBe('任务入队失败，请重试');
    expect(vocalSplitErrorText({ code: 'vocal_split_failed' })).toBe('人声背景分离失败，请重试');
    expect(vocalSplitErrorText({ code: 'enqueue_failed' })).toBe('任务入队失败，请重试');
    expect(vocalSplitErrorText(null)).toBe('人声背景分离失败');
  });
});

describe('vocalSplitTerminalPatch', () => {
  it('succeeded 返回 null：成功不落本卡补丁，由页面层扇出接管（IKHA30）', () => {
    expect(vocalSplitTerminalPatch({ status: 'succeeded' })).toBeNull();
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

describe('轨卡命名与轨词映射（IKHA30）', () => {
  it('轨类型四值中文词：voice 人声 / background 背景音 / music 音乐 / sfx 音效', () => {
    expect(VOCAL_SPLIT_TRACK_LABELS).toEqual({
      voice: '人声',
      background: '背景音',
      music: '音乐',
      sfx: '音效',
    });
  });

  it('轨卡名 = 源名(轨词).格式：括号词随轨类型、后缀随所选格式', () => {
    expect(vocalSplitTrackDisplayName('测试视频', 'voice', 'aac')).toBe('测试视频(人声).aac');
    expect(vocalSplitTrackDisplayName('测试视频', 'background', 'aac')).toBe('测试视频(背景音).aac');
    expect(vocalSplitTrackDisplayName('测试视频', 'music', 'flac')).toBe('测试视频(音乐).flac');
    expect(vocalSplitTrackDisplayName('测试视频', 'sfx', 'mp3')).toBe('测试视频(音效).mp3');
  });

  it('源名缺失回落「人声背景分离(轨词).格式」', () => {
    expect(vocalSplitTrackDisplayName('', 'voice', 'wav')).toBe('人声背景分离(人声).wav');
    expect(vocalSplitTrackDisplayName(undefined, 'music', 'm4a')).toBe('人声背景分离(音乐).m4a');
  });

  it('vocalSplitSourceName 从占位卡名还原源名；非家族名（用户改过名）返回空串', () => {
    expect(vocalSplitSourceName('测试视频(人声背景分离)')).toBe('测试视频');
    expect(vocalSplitSourceName('  无后缀名(人声背景分离)  ')).toBe('无后缀名');
    expect(vocalSplitSourceName('生成-701')).toBe('');
    expect(vocalSplitSourceName(undefined)).toBe('');
  });
});

describe('轨卡 node id 与扇出计划（IKHA30）', () => {
  it('轨卡 id = vocal-track-{jobId}-{track_type}，确定性且不带 vocal-split- 前缀（防 isVocalSplitNodeId 误判）', () => {
    expect(vocalSplitTrackNodeId('701', 'voice')).toBe('vocal-track-701-voice');
    expect(vocalSplitTrackNodeId('701', 'voice')).toBe(vocalSplitTrackNodeId('701', 'voice'));
    expect(VOCAL_SPLIT_TRACK_NODE_PREFIX).toBe('vocal-track-');
    expect(isVocalSplitNodeId('vocal-track-701-voice')).toBe(false);
    expect(isVocalSplitNodeId('vocal-split-701')).toBe(true);
  });

  it('两轨场景（audio）：按 tracks 顺序扇出两张，纵向排布锚点右列、步长 = 内容区高 240 + 间距 60', () => {
    const tracks = VOCAL_SPLIT_SCENE_TRACKS.audio.map((track_type) => ({
      track_type,
      asset_id: `${track_type}-asset`,
      url: `http://tos/${track_type}.aac`,
      duration: 15.5,
    }));
    const plan = buildVocalSplitTrackNodes({
      jobId: '701',
      outputFormat: 'aac',
      tracks,
      sourceName: '测试视频',
      anchor: { x: 958, y: 40 },
    });
    expect(plan.map((item) => item.trackType)).toEqual(['voice', 'background']);
    expect(plan.map((item) => item.node.id)).toEqual(['vocal-track-701-voice', 'vocal-track-701-background']);
    expect(plan.map((item) => item.node.position)).toEqual([
      { x: 958, y: 40 },
      { x: 958, y: 340 },
    ]);
  });

  it('三轨场景（drama）：三张卡轨序随契约（voice 首轨），data 为普通音频成品卡形态', () => {
    const tracks = VOCAL_SPLIT_SCENE_TRACKS.drama.map((track_type: VocalSplitTrackType) => ({
      track_type,
      asset_id: `${track_type}-asset`,
      url: `http://tos/${track_type}.flac`,
      duration: 8,
    }));
    const plan = buildVocalSplitTrackNodes({
      jobId: '702',
      outputFormat: 'flac',
      tracks,
      sourceName: '短剧素材',
      anchor: { x: 0, y: 0 },
    });
    expect(plan.map((item) => item.trackType)).toEqual(['voice', 'music', 'sfx']);
    expect(plan.map((item) => item.node.position.y)).toEqual([0, 300, 600]);
    const voice = plan[0]!.node;
    expect(voice.data).toEqual({
      src: 'http://tos/voice.flac',
      fileName: '短剧素材(人声).flac',
      mediaType: 'audio',
      progress: 100,
      assetId: 'voice-asset',
      duration: 8,
      toolMode: 'select',
    });
  });

  it('duration 为 null 时不写时长字段（浏览器实测兜底由播放层承担）', () => {
    const plan = buildVocalSplitTrackNodes({
      jobId: '703',
      outputFormat: 'mp3',
      tracks: [{ track_type: 'voice', asset_id: 'a1', url: 'http://tos/v.mp3', duration: null }],
      sourceName: '',
      anchor: { x: 0, y: 0 },
    });
    expect(plan[0]!.node.data.fileName).toBe('人声背景分离(人声).mp3');
    expect('duration' in plan[0]!.node.data).toBe(false);
  });
});
