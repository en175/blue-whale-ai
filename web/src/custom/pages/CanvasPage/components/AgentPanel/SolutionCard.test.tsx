// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentPanel from './index';
import styles from './index.module.css';
import type { RequirementUnderstanding } from '@/custom/api/agentSessions';

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
vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels: vi.fn(async () => []) }));
vi.mock('@/custom/api/skills', () => ({ fetchMySkills: vi.fn(async () => []) }));
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
    expect(text).not.toContain('创意方向');
    expect(text).not.toContain('你给的素材各起什么作用');
  });

  it('出片参数一行显示，没聊到的项不占位', () => {
    sessionMock.turns = turnWith(
      understanding({ solution_card: { ...card!, delivery_spec: { aspect_ratio: '9:16', duration_seconds: 25 } } }),
    );
    mount();

    const text = solutionCard()!.textContent ?? '';
    expect(text).toContain('出片参数');
    expect(text).toContain('9:16 · 25 秒');
  });

  it('按段拆的卡逐段列出每段拍什么、几秒', () => {
    sessionMock.turns = turnWith(
      understanding({
        solution_card: {
          ...card!,
          segments: [
            { content: '清晨街道，红裙女孩走入画面', seconds: 5, segment_id: 'seg_1' },
            { content: '正午咖啡馆窗边侧脸', seconds: 5, segment_id: 'seg_2' },
          ],
        },
      }),
    );
    mount();
    const text = solutionCard()!.textContent ?? '';
    expect(text).toContain('分几段拍');
    expect(text).toContain('第 1 段：清晨街道，红裙女孩走入画面（5 秒）');
    expect(text).toContain('第 2 段：正午咖啡馆窗边侧脸（5 秒）');
    expect(solutionCard()!.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('变更卡显示「这次改什么」：改之前 → 改之后，逐项列出', () => {
    sessionMock.turns = turnWith(
      understanding({
        solution_card: {
          ...card!,
          scope: { kind: 'change', label: '加 1 段', effect: '在第 2 段「正午咖啡馆」和第 3 段「黄昏天桥」之间加 1 段——改完共 5 段、25 秒' },
          segments: [{ content: '在第 2 段「正午咖啡馆」和第 3 段「黄昏天桥」之间加一段：她推门走出咖啡馆', seconds: 5 }],
        },
      }),
    );
    mount();
    const text = solutionCard()!.textContent ?? '';
    expect(text).toContain('这次改什么');
    expect(text).toContain('在第 2 段「正午咖啡馆」和第 3 段「黄昏天桥」之间加 1 段——改完共 5 段、25 秒');
    expect(text).toContain('之间加一段：她推门走出咖啡馆（5 秒）');
    expect(text).not.toContain('分几段拍');
    expect(text).not.toContain('这张卡管的范围');
  });

  it('只有一段、或者老卡没有分段：和原来一样，不多出一栏', () => {
    sessionMock.turns = turnWith(understanding({ solution_card: { ...card!, segments: [{ content: '一段拉花', seconds: 8 }] } }));
    mount();
    const text = solutionCard()!.textContent ?? '';
    expect(text).not.toContain('分几段拍');
    expect(text).not.toContain('这次改什么');
  });

  it('续写的卡显示「这张卡管的范围：第 2 段」，整条的卡不显示这一行', () => {
    sessionMock.turns = turnWith(
      understanding({ solution_card: { ...card!, scope: { kind: 'continuation', label: '第 2 段' } } }),
    );
    mount();
    const text = solutionCard()!.textContent ?? '';
    expect(text).toContain('这张卡管的范围');
    expect(text).toContain('第 2 段');
  });

  it('另开一件事的卡显示范围与承接', () => {
    sessionMock.turns = turnWith(
      understanding({
        target_media: 'video',
        solution_card: { ...card!, scope: { kind: 'new_task', label: '视频版', derived_from: '咖啡产地信息图' } },
      }),
    );
    mount();
    const text = solutionCard()!.textContent ?? '';
    expect(text).toContain('这张卡管的范围');
    expect(text).toContain('视频版');
    expect(text).toContain('承接上一张');
    expect(text).toContain('〈咖啡产地信息图〉');
  });

  it('「接下来怎么做」在卡外面，按正文显示，卡里没有这一项', () => {
    sessionMock.turns = turnWith(understanding({ solution_card: { ...card!, next_steps: '确认后我写卡。' } }));
    mount();
    expect(solutionCard()!.textContent).not.toContain('确认后我写卡。');
    expect(solutionCard()!.textContent).not.toContain('接下来怎么做');
    const bodies = [...container.querySelectorAll(`.${styles.md}`)].map((el) => el.textContent);
    expect(bodies).toContain('确认后我写卡。');
  });

  it('没写范围（整条）时不显示那一行', () => {
    sessionMock.turns = turnWith(understanding());
    mount();
    expect(solutionCard()!.textContent ?? '').not.toContain('这张卡管的范围');
  });

  it('没有出片参数时整项不显示', () => {
    sessionMock.turns = turnWith(understanding());
    mount();
    expect(solutionCard()!.textContent ?? '').not.toContain('出片参数');
  });

  it('出片路线只显示家族与版本，不显示推荐理由', () => {
    sessionMock.turns = turnWith(
      understanding({
        solution_card: { ...card!, execution_route: { model_family: 'Seedance', model_version: '2.5', reason: '因为它更快' } },
      }),
    );
    mount();

    const text = solutionCard()!.textContent ?? '';
    expect(text).toContain('Seedance 2.5');
    expect(text).not.toContain('因为它更快');
  });

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
