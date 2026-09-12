// @vitest-environment jsdom
/**
 * 方案卡在对话里的形态（IKF3KE）。
 *
 * 这几条钉的是「用户点得到、也看得懂」：卡在对话流里、三个按钮各有去向、没聊到的项不占位、
 * 已表态的版本留在原处置灰。门只认用户在这张卡上的动作——所以这张卡渲染不出来，首卡就永远
 * 出不来，这不是样式问题。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentPanel from './index';
import styles from './index.module.css';
import type { RequirementUnderstanding } from '@/api/agentSessions';

const card: RequirementUnderstanding['solution_card'] = {
  goal: '给新品耳机做一条 15 秒短视频',
  target_media: 'video',
  assumptions: ['你没说时长，我按 15 秒', '你没说分几镜，我按三镜'],
  execution_route: { model_family: 'Seedance', model_version: '2.0', reason: '平台已接入' },
  constraints: ['竖屏 9:16'],
};

function understanding(overrides: Partial<RequirementUnderstanding> = {}): RequirementUnderstanding {
  return {
    understanding_id: 'und_1',
    version: 1,
    session_id: 's1',
    proposed_by_run_id: 'run-1',
    target_media: 'video',
    proposed_summary: '摘要',
    solution_card: card,
    status: 'awaiting_confirmation',
    ...overrides,
  };
}

const sessionMock = vi.hoisted(() => ({
  turns: [] as unknown[],
  sessionId: 's1',
  sessions: [],
  activeSkillIds: [],
  changeActiveSkills: vi.fn(),
  streamingText: '',
  streaming: false,
  runningRunId: null as string | null,
  failedRunId: null,
  liveActivity: null,
  turnOutcome: null,
  chatError: null,
  retryUnavailable: false,
  sendError: null,
  paymentRequiredMessage: null,
  sendMessage: vi.fn(async () => true),
  confirmSolution: vi.fn(async () => true),
  voidSolution: vi.fn(async () => true),
  stopRun: vi.fn(),
  retryRun: vi.fn(),
  resetChat: vi.fn(),
  switchSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteError: null,
  dismissDeleteError: vi.fn(),
  refreshSessions: vi.fn(),
}));

vi.mock('../../hooks/useAgentSession', () => ({ useAgentSession: () => sessionMock }));
vi.mock('@/api/generation', () => ({ fetchGenerationModels: vi.fn(async () => []) }));
vi.mock('@/api/skills', () => ({ fetchMySkills: vi.fn(async () => []) }));
vi.mock('@/api/agentSessions', () => ({ fetchSessionCredits: vi.fn(async () => null) }));
vi.mock('../ChipTextEditor', () => ({ default: () => createElement('div', { 'data-testid': 'chip-editor' }) }));

let root: Root;
let container: HTMLDivElement;

function turnWith(one: RequirementUnderstanding) {
  return [
    {
      key: 't1',
      batchId: 'b1',
      user: [{ id: 'm1', role: 'user', content: '做条耳机短视频', sequence_no: 1, blocks: [] }],
      assistant: { id: 'm2', role: 'assistant', content: '你看一下这个方案。', sequence_no: 2, blocks: [] },
      live: null,
      runId: 'run-1',
      account: null,
      solutionCards: [one],
    },
  ];
}

function mount() {
  act(() => {
    root.render(
      createElement(AgentPanel, {
        onClose: vi.fn(),
        projectId: 'p1',
        onPlaceFileOnCanvas: vi.fn(async () => ({ asset_id: 'a1', url: 'blob:x' })),
      }),
    );
  });
}

function solutionCard() {
  return container.querySelector<HTMLElement>(`.${styles.solutionCard}`);
}

function buttons() {
  return [...container.querySelectorAll<HTMLButtonElement>(`.${styles.solutionCard} button`)].map(
    (b) => b.textContent?.trim() ?? '',
  );
}

function clickButton(label: string) {
  const target = [...container.querySelectorAll<HTMLButtonElement>(`.${styles.solutionCard} button`)].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!target) throw new Error(`找不到按钮：${label}`);
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  sessionMock.runningRunId = null;
  sessionMock.confirmSolution.mockClear();
  sessionMock.voidSolution.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('方案卡在对话里', () => {
  it('卡跟着那一轮出现，八项里没聊到的不占位', () => {
    sessionMock.turns = turnWith(understanding());
    mount();

    const text = solutionCard()!.textContent ?? '';
    expect(text).toContain('这次要做什么');
    expect(text).toContain('给新品耳机做一条 15 秒短视频');
    expect(text).toContain('我替你定的几项');
    expect(text).toContain('你没说时长，我按 15 秒');
    expect(text).toContain('Seedance 2.0');
    // 没写的项连小标题都不出现——空壳标题比没有更糟。
    expect(text).not.toContain('创意方向');
    expect(text).not.toContain('你给的素材各起什么作用');
  });

  /**
   * 出片路线 2026-09-12 起是可选项：模型不再凭记忆写它，改由服务端按平台模型目录填。
   * 在绑目录做完之前，卡上很可能就是没有这一项——那时整项不显示，不能留一个空的小标题，
   * 更不能因为读不到 `execution_route.model_family` 整张卡白屏（门只认这张卡上的按钮，
   * 卡渲染不出来首卡就永远出不来）。
   */
  it('没有出片路线时整项不显示，卡照常渲染', () => {
    const { execution_route: _route, ...withoutRoute } = card!;
    sessionMock.turns = turnWith(understanding({ solution_card: withoutRoute }));
    mount();

    const text = solutionCard()!.textContent ?? '';
    expect(text).toContain('给新品耳机做一条 15 秒短视频');
    expect(text).not.toContain('用哪个模型出片');
    expect(text).not.toContain('Seedance');
  });

  it('待确认时三个按钮都在', () => {
    sessionMock.turns = turnWith(understanding());
    mount();
    expect(buttons()).toEqual(['确认', '取消', '补充']);
  });

  it('点「确认」就是这次改动的全部意义：开门的从此是用户的这一下', () => {
    sessionMock.turns = turnWith(understanding());
    mount();
    clickButton('确认');
    expect(sessionMock.confirmSolution).toHaveBeenCalledWith('und_1', 1);
  });

  it('点「取消」作废这一版，不带话', () => {
    sessionMock.turns = turnWith(understanding());
    mount();
    clickButton('取消');
    expect(sessionMock.voidSolution).toHaveBeenCalledWith('und_1', 1, undefined);
  });

  it('点「补充」先写话再发：那段话当下一轮的输入', () => {
    sessionMock.turns = turnWith(understanding());
    mount();
    clickButton('补充');

    const box = container.querySelector<HTMLTextAreaElement>(`.${styles.solutionNote}`)!;
    expect(box).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(box, '结尾要露产品正面');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    clickButton('发给它');

    expect(sessionMock.voidSolution).toHaveBeenCalledWith('und_1', 1, '结尾要露产品正面');
  });

  it('已确认的那一版留在原处、置灰、按钮消失——历史要读得懂', () => {
    sessionMock.turns = turnWith(understanding({ status: 'accepted' }));
    mount();

    expect(solutionCard()!.className).toContain(styles.solutionCardSettled);
    expect(buttons()).toEqual([]);
    expect(solutionCard()!.textContent).toContain('已确认');
  });

  it('已作废的那一版同样留着，说清它作废了', () => {
    sessionMock.turns = turnWith(understanding({ status: 'superseded' }));
    mount();
    expect(solutionCard()!.textContent).toContain('已作废');
  });

  it('有别的轮在跑时按钮点不动：那一轮结束前点了也只会撞在相位上', () => {
    sessionMock.turns = turnWith(understanding());
    sessionMock.runningRunId = 'run-9';
    mount();
    const confirm = [...container.querySelectorAll<HTMLButtonElement>(`.${styles.solutionCard} button`)][0]!;
    expect(confirm.disabled).toBe(true);
  });
});
