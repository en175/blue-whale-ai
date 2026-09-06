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
