import { describe, expect, it } from 'vitest';
import {
  AUDIO_TRIM_EDGE_ORIGIN,
  AUDIO_TRIM_MISSING_DURATION_REASON,
  AUDIO_TRIM_NODE_PREFIX,
  audioTrimDisplayName,
  audioTrimErrorText,
  audioTrimGateReason,
  audioTrimNodeId,
  audioTrimTerminalPatch,
  buildAudioTrimPlaceholderNode,
  isAudioTrimNodeId,
} from './audioTrim';

describe('audioTrimGateReason（音频卡「截取」入口门槛预检，IKHB6Y）', () => {
  it('有音频 URL 且时长 > 0 放行（分数时长亦放行）', () => {
    expect(audioTrimGateReason({ src: 'blob:test', duration: 12 })).toBeNull();
    expect(audioTrimGateReason({ src: 'http://a/x.mp3', duration: 0.5 })).toBeNull();
  });

  it('音频 URL 缺失置灰并悬停唯一原因（undefined/null/空串）', () => {
    expect(audioTrimGateReason({ duration: 12 })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
    expect(audioTrimGateReason({ src: null, duration: 12 })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
    expect(audioTrimGateReason({ src: '', duration: 12 })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
  });

  it('时长缺失或非正置灰并悬停唯一原因（undefined/null/0/负数，IKHB6Y 双条件之二）', () => {
    expect(audioTrimGateReason({ src: 'blob:test' })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
    expect(audioTrimGateReason({ src: 'blob:test', duration: null })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
    expect(audioTrimGateReason({ src: 'blob:test', duration: 0 })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
    expect(audioTrimGateReason({ src: 'blob:test', duration: -3 })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
  });

  it('不照搬家族「数据缺失不拦」口径：URL 与时长双缺失同样置灰（截取手柄换算硬性依赖时长）', () => {
    expect(audioTrimGateReason({})).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
    expect(AUDIO_TRIM_MISSING_DURATION_REASON).toContain('时长缺失');
    expect(AUDIO_TRIM_MISSING_DURATION_REASON).toContain('无法截取');
  });
});

describe('audioTrim 会话身份与占位卡（IKHB7A，mediaExtract 同族先例）', () => {
  it('节点 id 前缀 audio-trim-{jobId} 与判定', () => {
    expect(audioTrimNodeId('j1')).toBe('audio-trim-j1');
    expect(audioTrimNodeId(1125)).toBe('audio-trim-1125');
    expect(isAudioTrimNodeId('audio-trim-j1')).toBe(true);
    expect(isAudioTrimNodeId('media-extract-j1')).toBe(false);
    expect(isAudioTrimNodeId('audio-trim-')).toBe(true);
    expect(AUDIO_TRIM_NODE_PREFIX).toBe('audio-trim-');
  });

  it('展示名：源名去扩展名 + (截取) + 所选格式；空名兜底', () => {
    expect(audioTrimDisplayName('播客片头.mp3', 'wav')).toBe('播客片头(截取).wav');
    expect(audioTrimDisplayName('  播客片头.mp3 ', 'm4a')).toBe('播客片头(截取).m4a');
    expect(audioTrimDisplayName('无扩展名', 'mp3')).toBe('无扩展名(截取).mp3');
    expect(audioTrimDisplayName(undefined, 'mp3')).toBe('音频截取(截取).mp3');
    expect(audioTrimDisplayName('', 'ogg')).toBe('音频截取(截取).ogg');
    expect(audioTrimDisplayName(42, 'flac')).toBe('音频截取(截取).flac');
  });

  it('占位卡：源卡右侧 +60px、generating、身份冻结贴边省略形态的 lastInput', () => {
    const source = {
      position: { x: 100.4, y: 20.2 },
      data: { mediaType: 'audio', width: 480, height: 240, fileName: '播客片头.mp3' },
    };
    const node = buildAudioTrimPlaceholderNode({
      jobId: 'j1',
      outputFormat: 'wav',
      timeParams: { start_time: 2.4 },
      sourceAssetId: '5',
      source,
    });
    expect(node.id).toBe('audio-trim-j1');
    expect(node.type).toBe('mediaNode');
    // 音频卡内容宽恒 480：x = 100 + 480 + 60 = 640，y 与源同排
    expect(node.position).toEqual({ x: 640, y: 20 });
    expect(node.data.mediaType).toBe('audio');
    expect(node.data.genStatus).toBe('generating');
    expect(node.data.progress).toBe(0);
    expect(node.data.jobId).toBe('j1');
    expect(node.data.fileName).toBe('播客片头(截取).wav');
    // lastInput 冻结：贴边省略的 start_time 保留、end_time 键不出现（strict 冻结形态）
    expect(node.data.audioTrim).toEqual({
      sourceAssetId: '5',
      lastInput: { source_asset_id: '5', start_time: 2.4, output_format: 'wav' },
    });
  });

  it('占位卡：双贴边（全选）时 lastInput 无起止键；未知源资产不携带身份', () => {
    const fullSelect = buildAudioTrimPlaceholderNode({
      jobId: 9,
      outputFormat: 'mp3',
      timeParams: {},
      sourceAssetId: null,
    });
    expect(fullSelect.data.audioTrim).toBeUndefined();
    expect(fullSelect.data.fileName).toBe('音频截取(截取).mp3');
    const withEnd = buildAudioTrimPlaceholderNode({
      jobId: 9,
      outputFormat: 'mp3',
      timeParams: { end_time: 12.5 },
      sourceAssetId: '7',
      source: { position: { x: 0, y: 0 }, data: { mediaType: 'audio', fileName: 'a.mp3' } },
    });
    expect(withEnd.data.audioTrim).toEqual({
      sourceAssetId: '7',
      lastInput: { source_asset_id: '7', end_time: 12.5, output_format: 'mp3' },
    });
  });

  it('来源边标记是纯视觉来源记录（参考推导跳过口径）', () => {
    expect(AUDIO_TRIM_EDGE_ORIGIN).toBe('audio-trim');
  });
});

describe('audioTrim 终态补丁（轮询收敛，IKHB7A）', () => {
  it('succeeded：src/assetId/duration（火山权威时长）回填，展示名保留', () => {
    const patch = audioTrimTerminalPatch(
      {
        status: 'succeeded',
        asset: { id: 'a88', url: 'http://tos/x.wav', duration: 10.62 },
      },
      '播客片头(截取).wav',
    );
    expect(patch).toEqual({
      genStatus: undefined,
      progress: 100,
      src: 'http://tos/x.wav',
      mediaType: 'audio',
      fileName: '播客片头(截取).wav',
      assetId: 'a88',
      duration: 10.62,
    });
  });

  it('succeeded 且资产缺 duration：不写 duration 键（不落本地选区秒数）', () => {
    const patch = audioTrimTerminalPatch(
      { status: 'succeeded', asset: { id: 'a1', url: 'http://tos/x.mp3', duration: null } },
      'a(截取).mp3',
    );
    expect(patch).not.toHaveProperty('duration');
  });

  it('failed：1047 兜底码与上游透传文案收敛为可读 errorText', () => {
    expect(
      audioTrimTerminalPatch({ status: 'failed', error: { code: 'audio_trim_failed', msg: '' } }),
    ).toEqual({ genStatus: 'failed', errorText: '音频截取失败，请重试' });
    expect(
      audioTrimTerminalPatch({ status: 'failed', error: { code: 'audio_trim_failed', msg: 'end_time 超出片尾' } }),
    ).toEqual({ genStatus: 'failed', errorText: 'end_time 超出片尾' });
  });

  it('cancelled / 进行中：收敛取消态或返回 null 续轮询', () => {
    expect(audioTrimTerminalPatch({ status: 'cancelled' })).toEqual({ genStatus: 'cancelled' });
    expect(audioTrimTerminalPatch({ status: 'processing' })).toBeNull();
    expect(audioTrimTerminalPatch({ status: 'queued' })).toBeNull();
  });

  it('audioTrimErrorText 兜底：无错误对象时给通用文案', () => {
    expect(audioTrimErrorText(null)).toBe('音频截取失败');
    expect(audioTrimErrorText({})).toBe('音频截取失败');
    expect(audioTrimErrorText({ code: 'enqueue_failed' })).toBe('任务入队失败，请重试');
  });
});
