import { describe, expect, it } from 'vitest';

import type { PromptCardRevision } from './agentSessions';
import { cardsOfRevision } from './promptCardMapping';

function revision(schemaVersion: number, shot: Record<string, unknown>): PromptCardRevision {
  return {
    revision_id: 'rev_1',
    card_id: 'card_s',
    authoring_run_id: 'run_1',
    revision_number: 1,
    schema_version: schemaVersion,
    payload: {
      schema_version: schemaVersion,
      target_media: 'video',
      overview: '总览',
      shots: [{ shot_no: 1, title: '开场', prompt_text: '时长3秒。开场。', asset_bindings: [], ...shot }],
      assets: [],
    },
  } as PromptCardRevision;
}

describe('cardsOfRevision', () => {
  it('V4 卡没有画面字段：不给 visual，画布卡上那一行自己不画（IKEV0K）', () => {
    const [card] = cardsOfRevision('s', revision(4, {}));
    expect(card).not.toHaveProperty('visual');
    expect(card!.prompt).toBe('时长3秒。开场。');
  });

  it('V3 旧卡照旧带着画面', () => {
    const [card] = cardsOfRevision('s', revision(3, { frame_description: '黄昏海边' }));
    expect(card!.visual).toBe('黄昏海边');
  });

  /**
   * F32：每张生成卡标注它是按哪套写法编的。批次级的一项，每张卡都带——用户手动应用的是单张卡，
   * 他在那张卡上就该看得见它。只做展示与核对：按 F34 这个标注不下传生成面板。
   */
  it('目标模型标注：批次级的一项，每张卡都带', () => {
    const withModel = revision(4, {});
    withModel.payload.target_model = { family: 'Seedance', version: '2.5' };
    expect(cardsOfRevision('s', withModel)[0]!.targetModel).toBe('Seedance 2.5');
  });

  it('图像没有版本：只写家族——细分版本归目标技能', () => {
    const withModel = revision(4, {});
    withModel.payload.target_model = { family: 'Seedream' };
    expect(cardsOfRevision('s', withModel)[0]!.targetModel).toBe('Seedream');
  });

  it('老卡没有这一项：整项不带，卡上那一行自己不画', () => {
    expect(cardsOfRevision('s', revision(4, {}))[0]).not.toHaveProperty('targetModel');
  });

  it('卡片 id 以版本号开头：同一组卡的不同版本互不覆盖（IKEV0V）', () => {
    const [card] = cardsOfRevision('s', revision(4, {}));
    expect(card!.cardId).toBe('rev_1#1');
    expect(card!.source).toEqual({ sessionId: 's', revisionId: 'rev_1', shotNo: 1 });
  });

  it('正文里的素材记号：按服务端算好的位置取号和原文，卡上显示「图1」（IKFLB9）', () => {
    const withAsset = revision(4, {
      prompt_text: '参考 @图1 的油画笔触。',
      asset_bindings: [{ asset_ref_id: 'ref_a' }],
      prompt_mentions: [{ start: 3, end: 6, index: 1, asset_ref_id: 'ref_a' }],
    });
    withAsset.payload.assets = [{ asset_ref_id: 'ref_a', asset_id: '6412', media_type: 'image', display_label: '参考.png' }] as never;
    expect(cardsOfRevision('s', withAsset)[0]!.assetRefItems).toEqual([
      { assetId: '6412', label: '参考.png', mediaType: 'image', marker: '图1', markerTexts: ['@图1'] },
    ]);
  });

  it('老卡没有记号位置：不带号，照旧显示名字', () => {
    const old = revision(4, { asset_bindings: [{ asset_ref_id: 'ref_a' }] });
    old.payload.assets = [{ asset_ref_id: 'ref_a', asset_id: '6412', media_type: 'image', display_label: '参考.png' }] as never;
    expect(cardsOfRevision('s', old)[0]!.assetRefItems).toEqual([{ assetId: '6412', label: '参考.png', mediaType: 'image' }]);
  });
});
