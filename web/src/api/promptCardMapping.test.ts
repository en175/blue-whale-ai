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

  it('卡片 id 以版本号开头：同一组卡的不同版本互不覆盖（IKEV0V）', () => {
    const [card] = cardsOfRevision('s', revision(4, {}));
    expect(card!.cardId).toBe('rev_1#1');
    expect(card!.source).toEqual({ sessionId: 's', revisionId: 'rev_1', shotNo: 1 });
  });
});
