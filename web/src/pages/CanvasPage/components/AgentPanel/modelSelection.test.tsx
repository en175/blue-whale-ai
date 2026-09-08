// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentPanel from './index';
import styles from './index.module.css';

/**
 * Agent 模型选择器真的把选中值交出去（IKE0II）。
 *
 * 这个选择器上线时是假的：`selectedModel` 只用来算 tooltip 和高亮，从不参与发送。用户点了
 * 豆包，界面高亮换了，实际跑的还是服务端默认的 MiniMax。所以这组用例钉的是**面板交给
 * 会话状态机的那个值**——它是模型抵达 agent 的唯一通道，断言渲染出来的高亮只会重现原来
 * 那个 bug：高亮一直是对的，错的是没人把它发出去。
 */

/** 每次渲染时面板传给 useAgentSession 的第二个参数（当前选中的模型）。 */
const handedToSession = vi.hoisted(() => ({ values: [] as (string | undefined)[] }));

const sessionState = vi.hoisted(() => ({
  turns: [],
  sessionId: null as string | null,
  sessions: [] as { session_id: string; model?: string | null }[],
  activeSkillIds: [],
  changeActiveSkills: vi.fn(),
  streamingText: '',
  streaming: false,
  runningRunId: null,
  failedRunId: null,
  liveActivity: null,
  turnOutcome: null,
  chatError: null,
  retryUnavailable: false,
  sendError: null,
  paymentRequiredMessage: null,
  sendMessage: vi.fn(async () => true),
  stopRun: vi.fn(),
  retryRun: vi.fn(),
  resetChat: vi.fn(),
  switchSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteError: null,
  dismissDeleteError: vi.fn(),
  refreshSessions: vi.fn(),
}));

vi.mock('../../hooks/useAgentSession', () => ({
  useAgentSession: (_projectId: string, agentModel?: string) => {
    handedToSession.values.push(agentModel);
    return sessionState;
  },
}));

/** 下拉的数据源：蓝鲸模型目录里 text 能力、已启用的两条，顺序即默认。 */
vi.mock('@/api/generation', () => ({
  fetchGenerationModels: vi.fn(async () => [
    { model_id: 'MiniMax-M3', model_label: 'MiniMax-M3' },
    { model_id: 'doubao-seed-evolving', model_label: 'doubao-seed-evolving' },
  ]),
}));

vi.mock('@/api/skills', () => ({ fetchMySkills: vi.fn(async () => []) }));
vi.mock('@/api/agentSessions', () => ({ fetchSessionCredits: vi.fn(async () => null) }));
vi.mock('../ChipTextEditor', () => ({
  default: () => createElement('div', { 'data-testid': 'chip-editor' }),
}));

let root: Root;
let container: HTMLDivElement;

async function renderPanel() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(AgentPanel, {
        onClose: vi.fn(),
        projectId: 'p1',
        onPlaceFileOnCanvas: vi.fn(async () => ({ asset_id: 'a1', url: 'blob:x' })),
      }),
    );
  });
}

/** 面板最后一次交给会话状态机的模型。 */
function currentModel() {
  return handedToSession.values.at(-1);
}

function modelOptions() {
  return [...container.querySelectorAll<HTMLButtonElement>(`.${styles.modelOption}`)];
}

async function openDropdown() {
  const button = container.querySelector<HTMLButtonElement>(`.${styles.modelBtn}`)!;
  await act(async () => button.click());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  handedToSession.values = [];
  sessionState.sessionId = null;
  sessionState.sessions = [];
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe('Agent 模型选择器交给会话状态机的值（IKE0II）', () => {
  it('默认是模型目录里的第一项', async () => {
    // 默认由蓝鲸的模型目录决定（enabled + sort_order），不由 agent 容器里的环境变量决定。
    await renderPanel();

    expect(currentModel()).toBe('MiniMax-M3');
  });

  it('点了豆包就换成豆包', async () => {
    await renderPanel();
    await openDropdown();

    const doubao = modelOptions().find((option) => option.textContent === 'doubao-seed-evolving')!;
    await act(async () => doubao.click());

    expect(currentModel()).toBe('doubao-seed-evolving');
  });

  it('切到一条用豆包跑过的会话，选择器跟着那条会话走', async () => {
    // 不回填的话，选择器就变成另一种假：界面显示 MiniMax，这条会话在服务端仍然是豆包。
    sessionState.sessionId = 's-doubao';
    sessionState.sessions = [{ session_id: 's-doubao', model: 'doubao-seed-evolving' }];

    await renderPanel();

    expect(currentModel()).toBe('doubao-seed-evolving');
  });

  it('会话没选过模型时保留用户此刻的选择，不重置回第一项', async () => {
    // `model` 为 null 的有两种：老会话，以及刚新建的会话。刚点完豆包又新建一条会话，
    // 选择器跳回 MiniMax 是错的。
    sessionState.sessionId = 's-new';
    sessionState.sessions = [{ session_id: 's-new', model: null }];

    await renderPanel();
    await openDropdown();
    const doubao = modelOptions().find((option) => option.textContent === 'doubao-seed-evolving')!;
    await act(async () => doubao.click());

    expect(currentModel()).toBe('doubao-seed-evolving');
  });
});
