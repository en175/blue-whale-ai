/**
 * 生成卡挂回对话（IKEV0V）。
 *
 * 改过卡之后，上一版要留在写它的那一轮下面——PRD 要求旧卡保留在对话历史中、刷新后仍可查看。
 * 之前只挂当前生效的那一版，刷新一次，上一版就从对话里消失了。
 */
import { describe, expect, it } from 'vitest';

import type { PromptCardRecord, PromptCardRevision } from '@/api/agentSessions';
import { attachCards, type ChatMessage } from './useAgentSession';

function assistant(id: string, runId: string, sequence: number): ChatMessage {
  return { id, role: 'assistant', content: '好的', blocks: [], sequence_no: sequence, sourceRunId: runId };
}

function revision(id: string, runId: string, number: number, title: string): PromptCardRevision {
  return {
    revision_id: id,
    card_id: 'card_s',
    authoring_run_id: runId,
    revision_number: number,
    schema_version: 4,
    payload: {
      schema_version: 4,
      target_media: 'video',
      overview: '总览',
      shots: [{ shot_no: 1, title, prompt_text: `${title}的提示词`, asset_bindings: [] }],
      assets: [],
    },
  };
}

const rev1 = revision('rev_run_a', 'run_a', 1, '第一版');
const rev2 = revision('rev_run_b', 'run_b', 2, '第二版');

function record(active: PromptCardRevision, history: PromptCardRevision[]): PromptCardRecord {
  return {
    card_id: 'card_s',
    session_id: 's',
    active_revision_id: active.revision_id,
    revision_count: history.length,
    active_revision: active,
    revisions: history.map((r) => ({
      revision_id: r.revision_id,
      revision_number: r.revision_number,
      authoring_run_id: r.authoring_run_id!,
      created_at: '2026-09-11T00:00:00.000Z',
    })),
  };
}

/** 每条消息下挂着的卡标题。 */
function titlesByMessage(messages: ChatMessage[]): Record<string, string[]> {
  return Object.fromEntries(
    messages.map((m) => [m.id, (m.blocks ?? []).filter((b) => b.type === 'card').map((b) => b.card!.shotTitle)]),
  );
}

describe('attachCards', () => {
  const messages = [assistant('m_a', 'run_a', 2), assistant('m_b', 'run_b', 4)];

  it('改过卡：上一版挂回写它的那一轮，当前那一版挂在改卡那一轮', () => {
    const cache = new Map([[rev1.revision_id, rev1]]);
    const out = attachCards(messages, [record(rev2, [rev1, rev2])], cache);
    expect(titlesByMessage(out)).toEqual({ m_a: ['第一版'], m_b: ['第二版'] });
  });

  it('上一版的正文还没取回来时先不挂，当前那一版照常挂', () => {
    const out = attachCards(messages, [record(rev2, [rev1, rev2])], new Map());
    expect(titlesByMessage(out)).toEqual({ m_a: [], m_b: ['第二版'] });
  });

  it('上一版对不上任何一轮就不挂——兜底挂到最后一条，正是「旧卡被当成这次的结果」', () => {
    const orphan = revision('rev_run_x', 'run_x', 1, '孤儿版');
    const cache = new Map([[orphan.revision_id, orphan]]);
    const out = attachCards(messages, [record(rev2, [orphan, rev2])], cache);
    expect(titlesByMessage(out)).toEqual({ m_a: [], m_b: ['第二版'] });
  });

  it('当前那一版对不上时照旧挂到最后一条助手消息，别让用户看到「已出卡」却什么都没有', () => {
    const lost = revision('rev_run_y', 'run_y', 1, '当前版');
    const out = attachCards(messages, [record(lost, [lost])], new Map());
    expect(titlesByMessage(out)).toEqual({ m_a: [], m_b: ['当前版'] });
  });

  it('重连时再挂一遍不重复', () => {
    const cache = new Map([[rev1.revision_id, rev1]]);
    const once = attachCards(messages, [record(rev2, [rev1, rev2])], cache);
    const twice = attachCards(once, [record(rev2, [rev1, rev2])], cache);
    expect(titlesByMessage(twice)).toEqual({ m_a: ['第一版'], m_b: ['第二版'] });
  });

  it('挂当前那一版时顺手缓存：它下次改卡后成了历史版本，不必再取一遍', () => {
    const cache = new Map<string, PromptCardRevision>();
    attachCards(messages, [record(rev1, [rev1])], cache);
    expect(cache.get(rev1.revision_id)).toBe(rev1);
  });

  /** 一个会话多件事（IKG793）：第二件事另开一个批次，两张卡各挂到写它的那一轮，互不覆盖。 */
  it('两个批次：各自挂到写它的那一轮，派生的那张带承接标', () => {
    const first = record(rev1, [rev1]);
    const second: PromptCardRecord = {
      ...record({ ...rev2, card_id: 'card_s_2' }, [{ ...rev2, card_id: 'card_s_2' }]),
      card_id: 'card_s_2',
      task_id: 'und_s_2',
    };
    const labels = new Map([['und_s_2', '视频版 · 承接上一张〈第一版〉']]);
    const out = attachCards(messages, [first, second], new Map(), labels);
    expect(titlesByMessage(out)).toEqual({ m_a: ['第一版'], m_b: ['第二版'] });
    const cardsOf = (id: string) => (out.find((m) => m.id === id)!.blocks ?? []).filter((b) => b.type === 'card').map((b) => b.card!);
    expect(cardsOf('m_a')[0]!.taskLabel).toBeUndefined();
    expect(cardsOf('m_b')[0]!.taskLabel).toBe('视频版 · 承接上一张〈第一版〉');
  });

  it('不带 revisions 的老 agent：只挂当前那一版，行为与以前一样', () => {
    const legacy: PromptCardRecord = { ...record(rev2, []), revisions: undefined };
    const out = attachCards(messages, [legacy], new Map([[rev1.revision_id, rev1]]));
    expect(titlesByMessage(out)).toEqual({ m_a: [], m_b: ['第二版'] });
  });
});
