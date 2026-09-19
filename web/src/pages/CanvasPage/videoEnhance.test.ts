/* IKH3VG 视频 HD 高清纯逻辑测试：门槛预检四情形与边界（契约常量同源数值）、
   lastParams 恢复（缺键/非法值回落默认档）、草稿卡出生位（口径同 imageEnhance）。 */
import { describe, expect, it } from 'vitest';
import {
  VIDEO_ENHANCE_ENTRY_HINT,
  VIDEO_ENHANCE_MISSING_ASSET_REASON,
  restoreVideoEnhanceResolution,
  videoEnhanceDraftPosition,
  videoEnhanceGateReason,
} from './videoEnhance';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';

describe('videoEnhanceGateReason（HD 入口门槛预检）', () => {
  it('未关联资产置灰（最优先，宽高缺失不叠加拦截）', () => {
    expect(videoEnhanceGateReason({})).toBe(VIDEO_ENHANCE_MISSING_ASSET_REASON);
    expect(videoEnhanceGateReason({ assetId: null })).toBe(VIDEO_ENHANCE_MISSING_ASSET_REASON);
    expect(videoEnhanceGateReason({ width: 3840, height: 2160 })).toBe(VIDEO_ENHANCE_MISSING_ASSET_REASON);
  });

  it('宽高缺失放行不拦（存量视频交服务端按权威数据复核）', () => {
    expect(videoEnhanceGateReason({ assetId: '7' })).toBeNull();
  });

  it('超上限：短边>1080 或长边>1920 拦截（短长边判定竖屏合法）', () => {
    // 横屏长边超限
    expect(videoEnhanceGateReason({ assetId: '7', width: 2561, height: 1440 })).toContain('1920');
    // 竖屏短边超限（1080×1920 合法、1081×1920 短边超）
    expect(videoEnhanceGateReason({ assetId: '7', width: 1080, height: 1920 })).toBeNull();
    expect(videoEnhanceGateReason({ assetId: '7', width: 1081, height: 1920 })).toContain('1080');
    expect(videoEnhanceGateReason({ assetId: '7', width: 3840, height: 2160 })).toContain('超出输入上限');
  });

  it('短边不足 360 拦截；恰 360 放行（长边≥短边故无需单判下限）', () => {
    expect(videoEnhanceGateReason({ assetId: '7', width: 640, height: 359 })).toContain('360');
    expect(videoEnhanceGateReason({ assetId: '7', width: 640, height: 360 })).toBeNull();
  });

  it('可用态与置灰态文案互斥（同一 title 通道）', () => {
    expect(videoEnhanceGateReason({ assetId: '7', width: 1280, height: 720 })).toBeNull();
    expect(VIDEO_ENHANCE_ENTRY_HINT).toContain('4K');
    expect(VIDEO_ENHANCE_ENTRY_HINT).not.toBe(VIDEO_ENHANCE_MISSING_ASSET_REASON);
  });
});

describe('restoreVideoEnhanceResolution（lastParams 恢复）', () => {
  it('合法枚举原样恢复；缺键/非法值（含被裁撤的 720p）回落默认档 1080p', () => {
    expect(restoreVideoEnhanceResolution({ resolution: '4k' })).toBe('4k');
    expect(restoreVideoEnhanceResolution({ resolution: '2k' })).toBe('2k');
    expect(restoreVideoEnhanceResolution({ resolution: '1080p' })).toBe('1080p');
    expect(restoreVideoEnhanceResolution(undefined)).toBe('1080p');
    expect(restoreVideoEnhanceResolution({})).toBe('1080p');
    expect(restoreVideoEnhanceResolution({ resolution: '720p' })).toBe('1080p');
    expect(restoreVideoEnhanceResolution({ resolution: 42 })).toBe('1080p');
  });
});

describe('videoEnhanceDraftPosition（HD 草稿卡出生位）', () => {
  it('源卡右侧让开一格（内容盒宽 + 60），y 跟随源卡', () => {
    const pos = videoEnhanceDraftPosition({
      position: { x: 400, y: 120 },
      data: { mediaType: 'video', width: 1920, height: 1080 },
    });
    const box = mediaContentBox({ mediaType: 'video', width: 1920, height: 1080 });
    expect(pos).toEqual({ x: Math.round(400 + box.width + 60), y: 120 });
  });

  it('坐标缺失兜底 0（口径同 imageEnhanceDraftPosition）', () => {
    const pos = videoEnhanceDraftPosition({ data: {} });
    expect(pos.y).toBe(0);
    expect(Number.isFinite(pos.x)).toBe(true);
  });
});
