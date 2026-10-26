import { describe, expect, it } from 'vitest';
import {
  mixQuoteParams,
  muxQuoteParams,
  sourceQuoteParams,
  sourceQuoteParamsWith,
} from './mediaToolQuoteParams';

describe('mediaToolQuoteParams：面板原始参数', () => {
  it('单素材工具只传素材 ID', () => {
    expect(sourceQuoteParams('11')).toEqual({ source_asset_id: '11' });
    expect(sourceQuoteParams(null)).toBeNull();
  });

  it('截取传起止点，调速传倍速', () => {
    expect(sourceQuoteParamsWith('11', { start_time: 1.5, end_time: 10.4 })).toEqual({
      source_asset_id: '11',
      start_time: 1.5,
      end_time: 10.4,
    });
    expect(sourceQuoteParamsWith('11', { speed: 2 })).toEqual({
      source_asset_id: '11',
      speed: 2,
    });
  });

  it('混合把源与附加输入按顺序排成 inputs', () => {
    expect(mixQuoteParams('11', ['12', '13'])).toEqual({
      inputs: [{ asset_id: '11' }, { asset_id: '12' }, { asset_id: '13' }],
    });
    expect(mixQuoteParams(null, ['12'])).toBeNull();
  });

  it('合流传音频、视频素材与同步方式', () => {
    expect(muxQuoteParams('11', '12', 'video')).toEqual({
      audio: { assetId: '11' },
      video: { assetId: '12' },
      sync: 'video',
    });
    expect(muxQuoteParams('11', null, 'none')).toBeNull();
  });
});
