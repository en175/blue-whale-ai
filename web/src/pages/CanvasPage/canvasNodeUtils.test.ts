import { describe, expect, it } from 'vitest';
import { draftFileNameOf, hasCustomName, planBindingsCoveredBy, readNodeAssetId } from './canvasNodeUtils';

describe('canvasNodeUtils 画布节点纯函数', () => {
  it('draftFileNameOf：按媒体类型给草稿回退名，未知类型落图片草稿', () => {
    expect(draftFileNameOf('video')).toBe('视频草稿');
    expect(draftFileNameOf('audio')).toBe('音频草稿');
    expect(draftFileNameOf('image')).toBe('图片草稿');
    expect(draftFileNameOf(undefined)).toBe('图片草稿');
  });

  it('hasCustomName：仅显式 customName=true 视为已自定义', () => {
    expect(hasCustomName({ data: { customName: true } } as never)).toBe(true);
    expect(hasCustomName({ data: { customName: 'yes' } } as never)).toBe(false);
    expect(hasCustomName({ data: {} } as never)).toBe(false);
    expect(hasCustomName(undefined)).toBe(false);
  });

  it('planBindingsCoveredBy：确认记录覆盖全部当前绑定（按 index+assetId 比对）为真', () => {
    const current = [{ index: 0, assetId: 'a' }, { index: 1, assetId: 'b' }];
    expect(planBindingsCoveredBy(current, [{ index: 0, assetId: 'a' }, { index: 1, assetId: 'b' }])).toBe(true);
    expect(planBindingsCoveredBy(current, [{ index: 0, assetId: 'a' }])).toBe(false);
    expect(planBindingsCoveredBy([], [])).toBe(true);
  });

  it('readNodeAssetId：兼容 assetId/asset_id/assetID，保留原值类型', () => {
    expect(readNodeAssetId({ assetId: 'x' })).toBe('x');
    expect(readNodeAssetId({ asset_id: 'y' })).toBe('y');
    expect(readNodeAssetId({ assetID: 42 })).toBe(42);
    expect(readNodeAssetId({})).toBeUndefined();
  });
});
