// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentPanel from './index';
import styles from './index.module.css';


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

const catalog = vi.hoisted(() => ({
  rows: [] as { model_id: string; model_label: string; is_default?: boolean }[],
}));

const DEFAULT_CATALOG = [
  { model_id: 'MiniMax-M3', model_label: 'MiniMax-M3' },
  { model_id: 'doubao-seed-evolving', model_label: 'doubao-seed-evolving' },
];

vi.mock('@/api/generation', () => ({
  fetchGenerationModels: vi.fn(async () => catalog.rows),
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
  catalog.rows = DEFAULT_CATALOG.map((row) => ({ ...row }));
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe('Agent 模型选择器交给会话状态机的值（IKE0II）', () => {
  it('默认是模型目录里的第一项', async () => {
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
    sessionState.sessionId = 's-doubao';
    sessionState.sessions = [{ session_id: 's-doubao', model: 'doubao-seed-evolving' }];

    await renderPanel();

    expect(currentModel()).toBe('doubao-seed-evolving');
  });

  it('会话没选过模型时保留用户此刻的选择，不重置回第一项', async () => {
    sessionState.sessionId = 's-new';
    sessionState.sessions = [{ session_id: 's-new', model: null }];

    await renderPanel();
    await openDropdown();
    const doubao = modelOptions().find((option) => option.textContent === 'doubao-seed-evolving')!;
    await act(async () => doubao.click());

    expect(currentModel()).toBe('doubao-seed-evolving');
  });
});

describe('默认模型来自目录的显式标记（IKE0VX）', () => {
  it('选中标了 is_default 的那条，哪怕它不排第一', async () => {
    catalog.rows = [
      { model_id: 'MiniMax-M3', model_label: 'MiniMax-M3' },
      { model_id: 'doubao-seed-evolving', model_label: 'doubao-seed-evolving', is_default: true },
    ];

    await renderPanel();

    expect(currentModel()).toBe('doubao-seed-evolving');
  });

  it('一条都没标时退回列表第一条，不是空、不报错', async () => {
    catalog.rows = [
      { model_id: 'MiniMax-M3', model_label: 'MiniMax-M3' },
      { model_id: 'doubao-seed-evolving', model_label: 'doubao-seed-evolving' },
    ];

    await renderPanel();

    expect(currentModel()).toBe('MiniMax-M3');
  });

  it('用户点过之后，目录标记不再回头改写他的选择', async () => {
    catalog.rows = [
      { model_id: 'MiniMax-M3', model_label: 'MiniMax-M3', is_default: true },
      { model_id: 'doubao-seed-evolving', model_label: 'doubao-seed-evolving' },
    ];

    await renderPanel();
    expect(currentModel()).toBe('MiniMax-M3');

    await openDropdown();
    const doubao = modelOptions().find((option) => option.textContent === 'doubao-seed-evolving')!;
    await act(async () => doubao.click());

    expect(currentModel()).toBe('doubao-seed-evolving');
  });
});
