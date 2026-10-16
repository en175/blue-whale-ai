import { describe, expect, it } from 'vitest';
import {
  AUDIO_SPEED_EDGE_ORIGIN,
  AUDIO_SPEED_NODE_PREFIX,
  AUDIO_SPEED_OUTPUT_FORMAT,
  AUDIO_SPEED_UNAVAILABLE_REASON,
  audioSpeedDisplayName,
  audioSpeedErrorText,
  audioSpeedGateReason,
  audioSpeedLabel,
  audioSpeedNodeId,
  audioSpeedTerminalPatch,
  buildAudioSpeedPlaceholderNode,
  isAudioSpeedNodeId,
} from './audioSpeed';

describe('audioSpeedGateReason（音频卡「调速」入口门槛预检，IKHW5C/IKHW5S）', () => {
  it('音频 URL 与资产 ID 均存在时放行', () => {
    expect(audioSpeedGateReason({ src: 'blob:test', assetId: '8' })).toBeNull();
    expect(audioSpeedGateReason({ src: 'http://a/x.mp3', asset_id: 8 })).toBeNull();
  });

  it('有 URL 但没有资产 ID 时置灰', () => {
    expect(audioSpeedGateReason({ src: 'http://a/x.mp3' })).toBe(AUDIO_SPEED_UNAVAILABLE_REASON);
    expect(audioSpeedGateReason({ src: 'http://a/x.mp3', assetId: '' })).toBe(AUDIO_SPEED_UNAVAILABLE_REASON);
  });

  it('音频 URL 缺失置灰并悬停唯一原因（undefined/null/空串）', () => {
    expect(audioSpeedGateReason({})).toBe(AUDIO_SPEED_UNAVAILABLE_REASON);
    expect(audioSpeedGateReason({ src: null })).toBe(AUDIO_SPEED_UNAVAILABLE_REASON);
    expect(audioSpeedGateReason({ src: '' })).toBe(AUDIO_SPEED_UNAVAILABLE_REASON);
  });

  it('assetId 有而 URL 缺失同样置灰', () => {
    expect(audioSpeedGateReason({ src: null, assetId: '8' })).toBe(AUDIO_SPEED_UNAVAILABLE_REASON);
    expect(AUDIO_SPEED_UNAVAILABLE_REASON).toContain('无法调速');
  });

  it('时长缺失不拦调速（用户故事 4：无截取的时长门槛，门槛入参不含时长）', () => {
    expect(audioSpeedGateReason({ src: 'blob:test', assetId: '8' })).toBeNull();
  });
});

describe('audioSpeed 会话身份与占位卡（IKHW5S，audioTrim 同族先例）', () => {
  it('节点 id 前缀 audio-speed-{jobId} 与判定', () => {
    expect(audioSpeedNodeId('j1')).toBe('audio-speed-j1');
    expect(audioSpeedNodeId(1125)).toBe('audio-speed-1125');
    expect(isAudioSpeedNodeId('audio-speed-j1')).toBe(true);
    expect(isAudioSpeedNodeId('audio-trim-j1')).toBe(false);
    expect(isAudioSpeedNodeId('audio-speed-')).toBe(true);
    expect(AUDIO_SPEED_NODE_PREFIX).toBe('audio-speed-');
  });

  it('倍速标签两位小数统一（1.5 → 1.50x、1.35 → 1.35x、4 → 4.00x）', () => {
    expect(audioSpeedLabel(1.5)).toBe('1.50x');
    expect(audioSpeedLabel(1.35)).toBe('1.35x');
    expect(audioSpeedLabel(4)).toBe('4.00x');
  });

  it('展示名：源名去扩展名 + (调速{值}x) + 官方默认输出格式后缀；空名兜底', () => {
    expect(audioSpeedDisplayName('播客片头.mp3', 1.35)).toBe('播客片头(调速1.35x).m4a');
    expect(audioSpeedDisplayName('  播客片头.mp3 ', 1.5)).toBe('播客片头(调速1.50x).m4a');
    expect(audioSpeedDisplayName('无扩展名', 2)).toBe('无扩展名(调速2.00x).m4a');
    expect(audioSpeedDisplayName(undefined, 0.5)).toBe(`音频调速.${AUDIO_SPEED_OUTPUT_FORMAT}`);
    expect(audioSpeedDisplayName('', 1.5)).toBe(`音频调速.${AUDIO_SPEED_OUTPUT_FORMAT}`);
    expect(audioSpeedDisplayName(42, 1.5)).toBe(`音频调速.${AUDIO_SPEED_OUTPUT_FORMAT}`);
    expect(AUDIO_SPEED_OUTPUT_FORMAT).toBe('m4a');
  });

  it('占位卡：源卡右侧 +60px、generating、身份冻结契约构造的 lastInput', () => {
    const source = {
      position: { x: 100.4, y: 20.2 },
      data: { mediaType: 'audio', width: 480, height: 240, fileName: '播客片头.mp3' },
    };
    const node = buildAudioSpeedPlaceholderNode({
      jobId: 'j1',
      speed: 1.35,
      sourceAssetId: '5',
      source,
    });
    expect(node.id).toBe('audio-speed-j1');
    expect(node.type).toBe('mediaNode');
    expect(node.position).toEqual({ x: 640, y: 20 });
    expect(node.data.mediaType).toBe('audio');
    expect(node.data.genStatus).toBe('generating');
    expect(node.data.progress).toBe(0);
    expect(node.data.jobId).toBe('j1');
    expect(node.data.fileName).toBe('播客片头(调速1.35x).m4a');
    expect(node.data.audioSpeed).toEqual({
      sourceAssetId: '5',
      lastInput: { source_asset_id: '5', speed: 1.35 },
    });
  });

  it('占位卡：未知源资产不携带身份；lastInput 经契约贴原速省略构造（防御路径）', () => {
    const noAsset = buildAudioSpeedPlaceholderNode({
      jobId: 9,
      speed: 1.5,
      sourceAssetId: null,
    });
    expect(noAsset.data.audioSpeed).toBeUndefined();
    expect(noAsset.data.fileName).toBe('音频调速.m4a');
    const oneSpeed = buildAudioSpeedPlaceholderNode({
      jobId: 9,
      speed: 1,
      sourceAssetId: '7',
      source: { position: { x: 0, y: 0 }, data: { mediaType: 'audio', fileName: 'a.mp3' } },
    });
    expect(oneSpeed.data.audioSpeed).toEqual({
      sourceAssetId: '7',
      lastInput: { source_asset_id: '7' },
    });
  });

  it('来源边标记是纯视觉来源记录（参考推导跳过口径，同 AUDIO_TRIM_EDGE_ORIGIN 先例）', () => {
    expect(AUDIO_SPEED_EDGE_ORIGIN).toBe('audio-speed');
  });
});

describe('audioSpeed 终态补丁（轮询收敛，IKHW5S）', () => {
  it('succeeded：src/assetId/duration（火山权威时长）回填，展示名保留', () => {
    const patch = audioSpeedTerminalPatch(
      {
        status: 'succeeded',
        asset: { id: 'a88', url: 'http://tos/x.m4a', duration: 47.4 },
      },
      '播客片头(调速1.35x).m4a',
    );
    expect(patch).toEqual({
      genStatus: undefined,
      progress: 100,
      src: 'http://tos/x.m4a',
      mediaType: 'audio',
      fileName: '播客片头(调速1.35x).m4a',
      assetId: 'a88',
      duration: 47.4,
    });
  });

  it('succeeded 命名后缀按产物 URL 真实扩展名校正（审查修复 C：URL .mp3 → 占位名 .m4a 换 .mp3）', () => {
    const patch = audioSpeedTerminalPatch(
      { status: 'succeeded', asset: { id: 'a9', url: 'https://bucket.ep.com/generated/7/audio/uuid.mp3' } },
      '播客片头(调速1.35x).m4a',
    );
    expect(patch?.fileName).toBe('播客片头(调速1.35x).mp3');
  });

  it('succeeded URL 不可解析扩展名：保持占位名默认 m4a 后缀（裸 key / 仅 query / 点开头或结尾）', () => {
    const keep = (url: string) =>
      audioSpeedTerminalPatch(
        { status: 'succeeded', asset: { id: 'a1', url } },
        'a(调速2.00x).m4a',
      )?.fileName;
    expect(keep('https://bucket.ep.com/generated/7/audio/uuid')).toBe('a(调速2.00x).m4a');
    expect(keep('https://bucket.ep.com/generated/7/audio/uuid?x=1.m4a')).toBe('a(调速2.00x).m4a');
    expect(keep('https://bucket.ep.com/.m4a/')).toBe('a(调速2.00x).m4a');
    expect(
      audioSpeedTerminalPatch({ status: 'succeeded', asset: null }, 'a(调速2.00x).m4a')?.fileName,
    ).toBe('a(调速2.00x).m4a');
    expect(
      audioSpeedTerminalPatch({ status: 'succeeded', asset: { id: 'a1', url: '' } }, 'a(调速2.00x).m4a')?.fileName,
    ).toBe('a(调速2.00x).m4a');
  });

  it('succeeded 且资产缺 duration：不写 duration 键（不落本地折算秒数）', () => {
    const patch = audioSpeedTerminalPatch(
      { status: 'succeeded', asset: { id: 'a1', url: 'http://tos/x.m4a', duration: null } },
      'a(调速2.00x).m4a',
    );
    expect(patch).not.toHaveProperty('duration');
  });

  it('failed：1051 兜底码与上游透传文案收敛为可读 errorText', () => {
    expect(
      audioSpeedTerminalPatch({ status: 'failed', error: { code: 'audio_speed_failed', msg: '' } }),
    ).toEqual({ genStatus: 'failed', errorText: '音频调速失败，请重试' });
    expect(
      audioSpeedTerminalPatch({ status: 'failed', error: { code: 'audio_speed_failed', msg: 'speed 超出取值范围' } }),
    ).toEqual({ genStatus: 'failed', errorText: 'speed 超出取值范围' });
  });

  it('cancelled / 进行中：收敛取消态或返回 null 续轮询', () => {
    expect(audioSpeedTerminalPatch({ status: 'cancelled' })).toEqual({ genStatus: 'cancelled' });
    expect(audioSpeedTerminalPatch({ status: 'processing' })).toBeNull();
    expect(audioSpeedTerminalPatch({ status: 'queued' })).toBeNull();
  });

  it('audioSpeedErrorText 兜底：无错误对象时给通用文案', () => {
    expect(audioSpeedErrorText(null)).toBe('音频调速失败');
    expect(audioSpeedErrorText({})).toBe('音频调速失败');
    expect(audioSpeedErrorText({ code: 'enqueue_failed' })).toBe('任务入队失败，请重试');
    expect(audioSpeedErrorText({ code: 'source_asset_unavailable' })).toBe('源音频资产不可用，请刷新画布后重试');
  });
});
