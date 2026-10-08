import { describe, expect, it } from 'vitest';
import { draftFileNameOf, hasCustomName, planBindingsCoveredBy, readNodeAssetId, resolveAssetRef, readRefLookupId, resolveRefType, mapBackendNode, characterLibraryVerifiedPatch } from './canvasNodeUtils';

type Snap = Record<string, { asset_id: number; type: 'image' | 'video' | 'audio'; access_url: string; width: number | null; height: number | null; material_id?: string | null; material_status?: 'Active' | 'Processing' | 'Failed' | null }>;
const snap = (o: Snap): Snap => o;

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

  it('resolveAssetRef：字典命中取 access_url，兼容多种 assetId 形态，查不到返回 null', () => {
    const assets = snap({ '7': { asset_id: 7, type: 'video', access_url: 'https://x/7.mp4', width: null, height: null } });
    expect(resolveAssetRef({ data: { asset_id: 7 } } as never, assets)).toEqual({ url: 'https://x/7.mp4', type: 'video', assetId: '7' });
    expect(resolveAssetRef({ data: { assetId: '7' } } as never, assets)?.url).toBe('https://x/7.mp4');
    expect(resolveAssetRef({ data: { assetID: '7' } } as never, assets)?.url).toBe('https://x/7.mp4');
    expect(resolveAssetRef({ data: { asset_id: '7' }, asset_id: 7 } as never, assets)?.assetId).toBe('7');
    expect(resolveAssetRef({ data: { asset_id: 999 } } as never, assets)).toBeNull();
    expect(resolveAssetRef({ data: {} } as never, assets)).toBeNull();
    expect(resolveAssetRef({ data: { sourceAssetId: '7' } } as never, assets)?.assetId).toBe('7');
    expect(resolveAssetRef({ data: { reference_asset_ids: ['7'] } } as never, assets)?.assetId).toBe('7');
  });

  it('readRefLookupId：数字/字符串取原值，对象取 asset_id/assetId/id，空值返回 undefined', () => {
    expect(readRefLookupId(3)).toBe('3');
    expect(readRefLookupId('a')).toBe('a');
    expect(readRefLookupId('')).toBeUndefined();
    expect(readRefLookupId({ asset_id: 9 })).toBe('9');
    expect(readRefLookupId({ assetId: 'b' })).toBe('b');
    expect(readRefLookupId({ id: 4 })).toBe('4');
    expect(readRefLookupId({})).toBeUndefined();
    expect(readRefLookupId(null)).toBeUndefined();
  });

  it('resolveRefType：type/media_type 为 video 或 MIME 以 video/ 开头才算视频，否则图片', () => {
    expect(resolveRefType({ type: 'video' })).toBe('video');
    expect(resolveRefType({ media_type: 'video' })).toBe('video');
    expect(resolveRefType({ mime: 'video/mp4' })).toBe('video');
    expect(resolveRefType({ type: 'image' })).toBe('image');
    expect(resolveRefType({ mime: 'image/png' })).toBe('image');
    expect(resolveRefType(null)).toBe('image');
  });

  it('mapBackendNode：reference 参考卡还原资产卡，引用查不到时保留条目并标 missing', () => {
    const assets = snap({ '1': { asset_id: 1, type: 'image', access_url: 'https://x/1.png', width: null, height: null } });
    const ref = mapBackendNode({ id: 'n1', type: 'reference', position: { x: 1, y: 2 }, cardType: 'style', references: [{ asset_id: 1 }, { asset_id: 2 }], data: { desc: '说明' } } as never, assets);
    expect(ref).toMatchObject({ id: 'n1', type: 'assetNode', position: { x: 1, y: 2 }, data: { kind: 'style', initialDesc: '说明' } });
    const refs = (ref!.data as { initialRefs: Array<Record<string, unknown>> }).initialRefs;
    expect(refs[0]).toMatchObject({ src: 'https://x/1.png', assetId: '1' });
    expect(refs[1]).toMatchObject({ src: '', missing: true });
    expect(mapBackendNode({ id: 'n2', type: 'reference', data: {} } as never, assets)).toMatchObject({ data: { kind: 'custom' } });
  });

  it('mapBackendNode：text 节点取 html/content/text，未知类型按资产引用还原为媒体节点', () => {
    expect(mapBackendNode({ id: 't1', type: 'text', data: { html: '<b>x</b>' } } as never, snap({}))).toMatchObject({ type: 'textNode', data: { html: '<b>x</b>' } });
    expect(mapBackendNode({ id: 't2', type: 'text', data: {} } as never, snap({}))).toMatchObject({ type: 'textNode', data: { html: '' } });
    const miss = mapBackendNode({ id: 'm1', data: { prompt: 'p' } } as never, snap({}));
    expect(miss).toMatchObject({ type: 'mediaNode', data: { src: '', mediaType: 'image', assetMissing: true, prompt: 'p' } });
    const hit = mapBackendNode({ id: 'm2', data: { asset_id: 1 } } as never, snap({ '1': { asset_id: 1, type: 'video', access_url: 'https://x/1.mp4', width: null, height: null } }));
    expect(hit).toMatchObject({ type: 'mediaNode', data: { src: 'https://x/1.mp4', mediaType: 'video', assetId: '1' } });
  });

  it('characterLibraryVerifiedPatch：音频不参与；非历史只对齐 Active，历史按 material_status 派生', () => {
    expect(characterLibraryVerifiedPatch({ mediaType: 'audio' }, 'm1', 'Active')).toEqual({});
    expect(characterLibraryVerifiedPatch({ mediaType: 'image', materialId: 'm1' }, undefined, null)).toEqual({ materialId: undefined });
    expect(characterLibraryVerifiedPatch({ mediaType: 'image', complianceBusy: true }, 'm2', 'Active')).toEqual({ materialId: 'm2', complianceBusy: undefined, compliancePassed: true });
    expect(characterLibraryVerifiedPatch({ mediaType: 'video' }, null, 'Processing', true)).toEqual({ compliancePassed: false });
    expect(characterLibraryVerifiedPatch({ mediaType: 'video' }, 'm3', 'Active', true)).toEqual({ materialId: 'm3', compliancePassed: true });
    expect(characterLibraryVerifiedPatch({ mediaType: 'image', compliancePassed: false }, null, null, true)).toEqual({});
  });
});
