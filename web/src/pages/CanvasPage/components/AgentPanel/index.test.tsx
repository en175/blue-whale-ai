// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentPanel from './index';
import styles from './index.module.css';
import { DEFAULT_PANEL_WIDTH, PANEL_WIDTH_STORAGE_KEY } from './drawerWidth';

/* useAgentSession 是会话状态机（快照水合 + 流式事件流），与抽屉形态无关，整体打桩。 */
const sessionMock = vi.hoisted(() => ({
  turns: [],
  sessionId: null,
  sessions: [],
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
  useAgentSession: () => sessionMock,
}));

vi.mock('@/api/generation', () => ({
  fetchGenerationModels: vi.fn(async () => []),
}));

vi.mock('@/api/skills', () => ({
  fetchMySkills: vi.fn(async () => []),
}));

vi.mock('@/api/agentSessions', () => ({
  fetchSessionCredits: vi.fn(async () => null),
}));

/* 富文本输入框与抽屉形态无关，打桩掉以隔离 contentEditable 等 jsdom 盲区。 */
vi.mock('../ChipTextEditor', () => ({
  default: () => createElement('div', { 'data-testid': 'chip-editor' }),
}));

let root: Root;
let container: HTMLDivElement;
let onClose: ReturnType<typeof vi.fn>;

function panel() {
  return container.querySelector<HTMLElement>(`.${styles.panel}`)!;
}

function resizeHandle() {
  return container.querySelector<HTMLElement>(`.${styles.resizeHandle}`);
}

async function pointer(type: string, target: EventTarget, x: number) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x }));
  });
}

async function renderPanel() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onClose = vi.fn();
  await act(async () => {
    root.render(
      createElement(AgentPanel, {
        onClose,
        projectId: 'p1',
        onPlaceFileOnCanvas: vi.fn(async () => ({ asset_id: 'a1', url: 'blob:x' })),
      }),
    );
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe('AgentPanel 停靠抽屉（IKDLD4）', () => {
  it('默认宽度 468px，左缘渲染隐形拖拽热区', async () => {
    await renderPanel();

    expect(panel().style.width).toBe(`${DEFAULT_PANEL_WIDTH}px`);
    expect(resizeHandle()).not.toBeNull();
  });

  it('持久化宽度在下次打开时回显', async () => {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, '560');
    vi.stubGlobal('innerWidth', 1600);
    await renderPanel();

    expect(panel().style.width).toBe('560px');
  });

  it('拖拽左缘实时调宽（向左拖加宽），松开时才持久化', async () => {
    vi.stubGlobal('innerWidth', 1600);
    await renderPanel();
    const handle = resizeHandle()!;

    await pointer('pointerdown', handle, 500);
    await pointer('pointermove', handle, 400);
    expect(panel().style.width).toBe('568px');
    expect(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY)).toBeNull();

    await pointer('pointerup', handle, 400);
    expect(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY)).toBe('568');
  });

  it('拖拽超限时按视口钳制', async () => {
    vi.stubGlobal('innerWidth', 1600);
    await renderPanel();
    const handle = resizeHandle()!;

    // 向左猛拖 1000px：468 + 1000 远超上限 min(720, 50vw)=720，收在 720
    await pointer('pointerdown', handle, 1200);
    await pointer('pointermove', handle, 200);
    expect(panel().style.width).toBe('720px');
    await pointer('pointerup', handle, 200);
  });

  it('双击手柄复位默认宽度并持久化', async () => {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, '560');
    vi.stubGlobal('innerWidth', 1600);
    await renderPanel();
    expect(panel().style.width).toBe('560px');

    await act(async () => {
      resizeHandle()!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    expect(panel().style.width).toBe(`${DEFAULT_PANEL_WIDTH}px`);
    expect(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY)).toBe(String(DEFAULT_PANEL_WIDTH));
  });

  it('窗口变窄时对当前宽度重新钳制', async () => {
    await renderPanel();
    expect(panel().style.width).toBe('468px');

    // jsdom 默认 innerWidth 1024；缩到 900 后上限 50vw=450 < 468，宽度被收回
    vi.stubGlobal('innerWidth', 900);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(panel().style.width).toBe('450px');
  });

  it('浮动模式不渲染调宽手柄，宽度由浮动样式接管', async () => {
    await renderPanel();

    const floatToggle = container.querySelector('button[title="浮动窗口（可拖动）"]')!;
    await act(async () => {
      floatToggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(resizeHandle()).toBeNull();
    expect(panel().classList.contains(styles.panelFloating)).toBe(true);
  });

  it('关闭按钮先让抽屉滑出，动画结束（240ms）后才回调 onClose', async () => {
    vi.useFakeTimers();
    try {
      await renderPanel();

      const closeBtn = container.querySelector('button[title="关闭"]')!;
      await act(async () => {
        closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(panel().classList.contains(styles.panelDrawerClosing)).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(240);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AgentPanel 消息列表跟随到底', () => {
  type MockSession = { turns: unknown[]; sessionId: string | null; streamingText: string; runningRunId: string | null };
  const session = sessionMock as unknown as MockSession;

  function userTurn(n: number) {
    return {
      key: `t${n}`,
      batchId: null,
      user: [{ id: `u${n}`, role: 'user', content: `第 ${n} 句`, sequence_no: n }],
      assistant: null,
      live: null,
      runId: null,
      account: null,
      solutionCards: [],
    };
  }

  /** jsdom 不做布局：给消息列表装上可控的滚动几何，内容高度随测试改。 */
  function list(contentHeight = { value: 2000 }) {
    const el = container.querySelector<HTMLElement>(`.${styles.messageList}`)!;
    let top = 0;
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 500 });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => contentHeight.value });
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = Math.max(0, Math.min(v, contentHeight.value - 500));
      },
    });
    return { el, contentHeight };
  }

  async function userScrollsTo(el: HTMLElement, top: number, deltaY: number) {
    await act(async () => {
      el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }));
      el.scrollTop = top;
      el.dispatchEvent(new Event('scroll'));
    });
  }

  async function rerender(patch: Partial<MockSession>) {
    Object.assign(session, patch);
    await act(async () => {
      root.render(
        createElement(AgentPanel, {
          onClose,
          projectId: 'p1',
          onPlaceFileOnCanvas: vi.fn(async () => ({ asset_id: 'a1', url: 'blob:x' })),
        }),
      );
    });
  }

  beforeEach(() => {
    Object.assign(session, { turns: [userTurn(1)], sessionId: 's1', streamingText: '', runningRunId: 'r1' });
  });

  afterEach(() => {
    Object.assign(session, { turns: [], sessionId: null, streamingText: '', runningRunId: null });
  });

  it('贴着底时，流式内容变长会跟到底', async () => {
    await renderPanel();
    const { el, contentHeight } = list();
    await rerender({ streamingText: '一' });
    expect(el.scrollTop).toBe(1500);

    contentHeight.value = 2600;
    await rerender({ streamingText: '一二', turns: [userTurn(1)] });
    expect(el.scrollTop).toBe(2100);
  });

  it('运行中用户往上滑，哪怕只滑一小格，流式内容也不再把列表拉回底部', async () => {
    await renderPanel();
    const { el, contentHeight } = list();
    await rerender({ streamingText: '一' });
    await userScrollsTo(el, 1490, -10);

    contentHeight.value = 2600;
    await rerender({ streamingText: '一二', turns: [userTurn(1)] });
    expect(el.scrollTop).toBe(1490);
  });

  it('用户自己滑回底部后恢复跟随', async () => {
    await renderPanel();
    const { el, contentHeight } = list();
    await rerender({ streamingText: '一' });
    await userScrollsTo(el, 800, -700);
    await userScrollsTo(el, 1500, 700);

    contentHeight.value = 2600;
    await rerender({ streamingText: '一二', turns: [userTurn(1)] });
    expect(el.scrollTop).toBe(2100);
  });

  it('用户发出新消息时回到底部并恢复跟随', async () => {
    await renderPanel();
    const { el, contentHeight } = list();
    await rerender({ streamingText: '一' });
    await userScrollsTo(el, 300, -1200);

    contentHeight.value = 2600;
    await rerender({ turns: [userTurn(1), userTurn(2)] });
    expect(el.scrollTop).toBe(2100);
  });

  it('切换会话时回到底部并恢复跟随', async () => {
    await renderPanel();
    const { el, contentHeight } = list();
    await rerender({ streamingText: '一' });
    await userScrollsTo(el, 300, -1200);

    contentHeight.value = 2600;
    await rerender({ sessionId: 's2', turns: [userTurn(1)] });
    expect(el.scrollTop).toBe(2100);
  });
});
