import { describe, expect, it } from 'vitest';
import { cardsFromRevision } from './promptCardMapping';
import type { PromptCardRecord, PromptCardShot, PromptCardAssetProvenance } from './agentSessions';

function shot(overrides: Partial<PromptCardShot> = {}): PromptCardShot {
  return {
    shot_no: 1,
    title: '海妖破浪而出',
    frame_description: '巨蛇自漩涡中升起',
    prompt_text: 'a giant serpent rising from a storm vortex',
    asset_bindings: [],
    ...overrides,
  };
}

function provenance(overrides: Partial<PromptCardAssetProvenance> = {}): PromptCardAssetProvenance {
  return {
    asset_ref_id: 'ref-1',
    asset_id: 'asset-100',
    media_type: 'image',
    display_label: '宙斯',
    ...overrides,
  };
}

interface RevisionFixture {
  shots: PromptCardShot[];
  assets?: PromptCardAssetProvenance[];
  target_media?: 'image' | 'video';
}

function record(payload: RevisionFixture): PromptCardRecord {
  return {
    card_id: 'card-1',
    active_revision: {
      revision_id: 'rev-9',
      card_id: 'card-1',
      revision_number: 1,
      schema_version: 3,
      payload: {
        schema_version: 3,
        target_media: payload.target_media ?? 'video',
        overview: '整体节奏',
        shots: payload.shots,
        assets: payload.assets ?? [],
      },
    },
  };
}

describe('cardsFromRevision', () => {
  /** 本函数曾经把 agent 的整块结构压成六个扁字符串，卡头徽标、#N、素材身份全被扔掉。 */
  it('把卡头要用的每个字段都带出来，一个不丢', () => {
    const [card] = cardsFromRevision(
      record({
        target_media: 'video',
        shots: [
          shot({
            shot_no: 3,
            generation_suggestions: { target_media: 'video', aspect_ratio: '16:9', duration_seconds: 15 },
          }),
        ],
      }),
    );

    expect(card).toMatchObject({
      cardId: 'rev-9#3',
      shotNo: 3,
      shotTitle: '海妖破浪而出',
      targetMedia: 'video',
      aspectRatio: '16:9',
      durationSeconds: 15,
    });
  });

  it('素材引用带上 asset_id 与 media_type——没有身份就渲染不出缩略图', () => {
    const [card] = cardsFromRevision(
      record({
        shots: [shot({ asset_bindings: [{ asset_ref_id: 'ref-1' }, { asset_ref_id: 'ref-2' }] })],
        assets: [
          provenance({ asset_ref_id: 'ref-1', asset_id: 'asset-100', display_label: '宙斯', media_type: 'image' }),
          provenance({ asset_ref_id: 'ref-2', asset_id: 'asset-200', display_label: '海妖登场', media_type: 'video' }),
        ],
      }),
    );

    expect(card!.assetRefItems).toEqual([
      { assetId: 'asset-100', label: '宙斯', mediaType: 'image' },
      { assetId: 'asset-200', label: '海妖登场', mediaType: 'video' },
    ]);
    // 纯文本形式与胶囊并存：复制、给 Agent 的引用文案仍要 @名称。
    expect(card!.assetRefs).toEqual(['@宙斯', '@海妖登场']);
  });

  it('展示名里已有的 @ 不会被叠成 @@', () => {
    const [card] = cardsFromRevision(
      record({
        shots: [shot({ asset_bindings: [{ asset_ref_id: 'ref-1' }] })],
        assets: [provenance({ display_label: '@宙斯' })],
      }),
    );
    expect(card!.assetRefItems).toEqual([{ assetId: 'asset-100', label: '宙斯', mediaType: 'image' }]);
    expect(card!.assetRefs).toEqual(['@宙斯']);
  });

  it('出处表里查不到的绑定直接丢掉，不把内部 ref id 甩给用户', () => {
    const [card] = cardsFromRevision(
      record({
        shots: [shot({ asset_bindings: [{ asset_ref_id: 'ref-unknown' }] })],
        assets: [provenance({ asset_ref_id: 'ref-1' })],
      }),
    );
    expect(card!.assetRefItems).toBeUndefined();
    expect(card!.assetRefs).toBeUndefined();
  });

  it('时间段按时长竖着累加，本镜自己的秒数另外原样带出', () => {
    const cards = cardsFromRevision(
      record({
        target_media: 'video',
        shots: [
          shot({ shot_no: 1, generation_suggestions: { target_media: 'video', duration_seconds: 6 } }),
          shot({ shot_no: 2, generation_suggestions: { target_media: 'video', duration_seconds: 7 } }),
        ],
      }),
    );
    expect(cards.map((c) => c.timeRange)).toEqual(['0-6s', '6-13s']);
    // 卡头徽标要的是「这一镜多长」，不是「它排在整片哪一段」——两者都要有。
    expect(cards.map((c) => c.durationSeconds)).toEqual([6, 7]);
  });

  it('图片批次没有时长，就不给时间段也不给时长徽标', () => {
    const [card] = cardsFromRevision(
      record({
        target_media: 'image',
        shots: [shot({ generation_suggestions: { target_media: 'image', aspect_ratio: '1:1' } })],
      }),
    );
    expect(card!.timeRange).toBeUndefined();
    expect(card!.durationSeconds).toBeUndefined();
    expect(card!.targetMedia).toBe('image');
    expect(card!.aspectRatio).toBe('1:1');
  });

  it('没有 generation_suggestions 时不渲染任何参数徽标，也不崩', () => {
    const [card] = cardsFromRevision(record({ shots: [shot()] }));
    expect(card!.aspectRatio).toBeUndefined();
    expect(card!.durationSeconds).toBeUndefined();
    expect(card!.shotNo).toBe(1);
  });

  it('标题为空时退回「镜头 N」兜底', () => {
    const [card] = cardsFromRevision(record({ shots: [shot({ shot_no: 4, title: '' })] }));
    expect(card!.shotTitle).toBe('镜头 4');
  });

  it('没有修订版或没有镜头时返回空数组', () => {
    expect(cardsFromRevision({ card_id: 'c', active_revision: null })).toEqual([]);
    expect(cardsFromRevision(record({ shots: [] }))).toEqual([]);
  });
});
