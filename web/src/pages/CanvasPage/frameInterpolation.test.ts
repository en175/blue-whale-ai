/* IKHLKR 视频插帧纯逻辑测试：入口门槛（未关联资产唯一前置，不做时长/源帧率前置）、
   帧率恢复（缺键/非法值回落契约默认档 60）、草稿卡出生位（源卡实际内容宽 + 60）、
   卡名纯函数与切档跟随（hasCustomName 保护口径）、契约三键组装（zod strict 校验）与
   失败文案家族映射（1049 兜底，IKHLKX 消费）。 */
import { describe, expect, it } from 'vitest';
import {
  FRAME_INTERPOLATION_DEFAULT_FPS,
  FRAME_INTERPOLATION_DRAFT_HINT,
  FRAME_INTERPOLATION_EDGE_ORIGIN,
  FRAME_INTERPOLATION_ENTRY_HINT,
  FRAME_INTERPOLATION_FPS_VALUES,
  FRAME_INTERPOLATION_SEND_HINT,
  buildFrameInterpolationInput,
  frameInterpolationDisplayName,
  frameInterpolationDraftPosition,
  frameInterpolationErrorText,
  frameInterpolationGateReason,
  restoreFrameInterpolationFps,
} from './frameInterpolation';
import { VIDEO_ENHANCE_MISSING_ASSET_REASON } from './videoEnhance';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';

describe('frameInterpolationGateReason（插帧入口门槛预检）', () => {
  it('唯一置灰情形 = 未关联资产（与整钮 trigger gate 同源同句）', () => {
    expect(frameInterpolationGateReason({})).toBe(VIDEO_ENHANCE_MISSING_ASSET_REASON);
    expect(frameInterpolationGateReason({ assetId: null })).toBe(VIDEO_ENHANCE_MISSING_ASSET_REASON);
  });

  it('关联资产后恒放行：宽高缺失、超 HD 上限、超 2 小时都不拦（无时长/分辨率/源帧率前置）', () => {
    expect(frameInterpolationGateReason({ assetId: '7' })).toBeNull();
    // 超 HD 输入上限（长边 3840）——HD 项置灰而插帧可用（ADR-0113 触发钮直启被拦口径）
    const overHdLimit = { assetId: '7', width: 3840, height: 2160 };
    expect(frameInterpolationGateReason(overHdLimit)).toBeNull();
    const belowHdFloor = { assetId: '7', width: 640, height: 359 };
    expect(frameInterpolationGateReason(belowHdFloor)).toBeNull();
  });
});

describe('帧率三档与默认档（契约同源）', () => {
  it('三档 [30, 60, 120] 与默认 60 直接来自契约，不另造常量', () => {
    expect([...FRAME_INTERPOLATION_FPS_VALUES]).toEqual([30, 60, 120]);
    expect(FRAME_INTERPOLATION_DEFAULT_FPS).toBe(60);
  });
});

describe('frameInterpolationDisplayName（草稿卡名）', () => {
  it('卡名随档位拼装为「插帧 · {fps}fps」（父单指定文案）', () => {
    expect(frameInterpolationDisplayName(30)).toBe('插帧 · 30fps');
    expect(frameInterpolationDisplayName(60)).toBe('插帧 · 60fps');
    expect(frameInterpolationDisplayName(120)).toBe('插帧 · 120fps');
  });
});

describe('restoreFrameInterpolationFps（lastParams 恢复）', () => {
  it('合法枚举原样恢复；缺键/非法值（字符串、档外整数）回落默认档 60', () => {
    expect(restoreFrameInterpolationFps({ fps: 120 })).toBe(120);
    expect(restoreFrameInterpolationFps({ fps: 30 })).toBe(30);
    expect(restoreFrameInterpolationFps(undefined)).toBe(60);
    expect(restoreFrameInterpolationFps({})).toBe(60);
    expect(restoreFrameInterpolationFps({ fps: '60' })).toBe(60);
    expect(restoreFrameInterpolationFps({ fps: 45 })).toBe(60);
    expect(restoreFrameInterpolationFps({ fps: 240 })).toBe(60);
  });
});

describe('frameInterpolationDraftPosition（插帧草稿卡出生位）', () => {
  it('源卡右侧让开一格（源卡实际内容盒宽 + 60），y 跟随源卡', () => {
    const pos = frameInterpolationDraftPosition({
      position: { x: 400, y: 120 },
      data: { mediaType: 'video', width: 1920, height: 1080 },
    });
    const box = mediaContentBox({ mediaType: 'video', width: 1920, height: 1080 });
    expect(pos).toEqual({ x: Math.round(400 + box.width + 60), y: 120 });
  });

  it('坐标缺失兜底 0（口径同 videoEnhanceDraftPosition）', () => {
    const pos = frameInterpolationDraftPosition({ data: {} });
    expect(pos.y).toBe(0);
    expect(Number.isFinite(pos.x)).toBe(true);
  });
});

describe('buildFrameInterpolationInput（契约三键组装，IKHLKX 发送消费）', () => {
  it('三键键名与值恒等契约形态（source_asset_id / target_node_id / fps 整型直传）', () => {
    expect(buildFrameInterpolationInput('5', 'media-draft-1', 60)).toEqual({
      source_asset_id: '5',
      target_node_id: 'media-draft-1',
      fps: 60,
    });
    expect(buildFrameInterpolationInput('7', 'media-draft-9', 30)).toBeTruthy();
    expect(buildFrameInterpolationInput('7', 'media-draft-9', 120)).toBeTruthy();
  });

  it('非法输入返回 null（资产 id 非数字串 / 目标节点空 / fps 越三档含字符串）', () => {
    expect(buildFrameInterpolationInput('a5', 'media-draft-1', 60)).toBeNull();
    expect(buildFrameInterpolationInput('5', '', 60)).toBeNull();
    expect(buildFrameInterpolationInput('5', 'media-draft-1', 45 as never)).toBeNull();
    expect(buildFrameInterpolationInput('5', 'media-draft-1', '60' as never)).toBeNull();
  });
});

describe('frameInterpolationErrorText（失败文案家族映射，IKHLKX 消费）', () => {
  it('后端 msg 优先透传（上游可读原因随 message 投影）', () => {
    expect(frameInterpolationErrorText({ code: 1049, msg: '输入视频时长超出限制' })).toBe('输入视频时长超出限制');
  });

  it('msg 为空按错误码兜底：video_frame_interpolation_failed / 1049 →「视频插帧失败，请重试」', () => {
    expect(frameInterpolationErrorText({ code: 'video_frame_interpolation_failed', msg: '' })).toBe('视频插帧失败，请重试');
    expect(frameInterpolationErrorText({ code: 1049, msg: '' })).toBe('视频插帧失败，请重试');
    expect(frameInterpolationErrorText({ code: 'enqueue_failed' })).toBe('任务入队失败，请重试');
  });

  it('无错误对象/未知码兜底同句，失败态不空白', () => {
    expect(frameInterpolationErrorText(null)).toBe('视频插帧失败，请重试');
    expect(frameInterpolationErrorText(undefined)).toBe('视频插帧失败，请重试');
    expect(frameInterpolationErrorText({ code: 'unknown_code', msg: '' })).toBe('视频插帧失败，请重试');
  });
});

describe('对客文案常量（父单指定，原型同源）', () => {
  it('入口 hint / 草稿占位 / 发送 hint 逐字一致', () => {
    expect(FRAME_INTERPOLATION_ENTRY_HINT).toBe('提升视频帧率，画面更流畅');
    expect(FRAME_INTERPOLATION_DRAFT_HINT).toBe('配置参数生成插帧视频');
    expect(FRAME_INTERPOLATION_SEND_HINT).toBe('智能补帧，最高可至 120fps');
  });

  it('来源边 origin 标记为 frame-interpolation（不参与参考推导与 @ 编号）', () => {
    expect(FRAME_INTERPOLATION_EDGE_ORIGIN).toBe('frame-interpolation');
  });
});
