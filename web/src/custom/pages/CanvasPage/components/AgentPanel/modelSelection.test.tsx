// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentPanel from './index';


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

vi.mock('@/custom/api/generation', () => ({
  fetchGenerationModels: vi.fn(async () => catalog.rows),
}));

vi.mock('@/custom/api/skills', () => ({ fetchMySkills: vi.fn(async () => []) }));
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

describe('Agent 面板不让选文本模型（IKHCK4）', () => {
  it('没有选模型的按钮，也不去拉文本模型目录', async () => {
    await renderPanel();

    expect(container.querySelector('[aria-label*="Agent 模型"]')).toBeNull();
    expect(container.textContent).not.toContain('Agent 模型');
    const { fetchGenerationModels } = await import('@/custom/api/generation');
    expect(vi.mocked(fetchGenerationModels)).not.toHaveBeenCalledWith('text');
  });

  it('不往会话状态机传模型——发消息时就不会带 model', async () => {
    sessionState.sessionId = 's-doubao';
    sessionState.sessions = [{ session_id: 's-doubao', model: 'doubao-seed-evolving' }];

    await renderPanel();

    expect(handedToSession.values.length).toBeGreaterThan(0);
    expect(handedToSession.values.every((value) => value === undefined)).toBe(true);
  });
});
