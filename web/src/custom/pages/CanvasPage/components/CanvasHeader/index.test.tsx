// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/shared/stores/auth';
import CanvasHeader from './index';
import styles from './index.module.css';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/custom/components/UserDropdown', () => ({
  default: () => createElement('div', { 'data-testid': 'user-dropdown' }, '个人信息'),
}));

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({
  default: () => createElement('div', { 'data-testid': 'recharge-modal' }),
}));

vi.mock('@/custom/stores/recharge', () => ({
  useRechargeUiStore: (selector: (state: { open: boolean; closeRecharge: () => void }) => unknown) =>
    selector({ open: false, closeRecharge: () => {} }),
}));

let root: Root;
let mountNode: HTMLDivElement;

const headerProps = {
  projects: [{ id: 'p1', name: '项目一' }],
  currentProjectId: 'p1',
  onSelectProject: vi.fn(),
  onRenameProject: vi.fn(),
  onDeleteProject: vi.fn(),
  onNewProject: vi.fn(),
  onToggleAgent: vi.fn(),
};

async function renderHeader(overrides: Partial<ComponentProps<typeof CanvasHeader>> = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(CanvasHeader, { ...headerProps, ...overrides }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useAuthStore.setState({ credits: null });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('CanvasHeader', () => {
  it('右侧只保留 Agent，不渲染个人信息下拉', async () => {
    await renderHeader();

    expect(mountNode.querySelector('[data-testid="user-dropdown"]')).toBeNull();
    expect(mountNode.textContent).not.toContain('个人信息');
    expect(mountNode.textContent).not.toContain('登录');
    expect(mountNode.textContent).not.toContain('账号信息');

    const right = mountNode.querySelector(`.${styles.right}`);
    expect(right?.textContent).toContain('Agent');
    expect(right?.querySelectorAll('button')).toHaveLength(1);

    await act(async () => {
      right?.querySelector('button')?.click();
    });
    expect(headerProps.onToggleAgent).toHaveBeenCalledTimes(1);
  });

  it('面板展开时隐藏 Agent 入口（hideAgentEntry），避免与面板内关闭按钮冗余（IKDLD4）', async () => {
    await renderHeader({ hideAgentEntry: true });

    const agentBtn = mountNode.querySelector(`.${styles.agentBtn}`);
    expect(agentBtn?.classList.contains(styles.agentBtnHidden)).toBe(true);
  });

  it('默认显示 Agent 入口', async () => {
    await renderHeader();

    const agentBtn = mountNode.querySelector(`.${styles.agentBtn}`);
    expect(agentBtn?.classList.contains(styles.agentBtnHidden)).toBe(false);
  });

  it('右上角展示与首页一致的积分余额，未登录/未加载时不渲染', async () => {
    await renderHeader();
    expect(mountNode.textContent).not.toContain('12,345');

    useAuthStore.setState({ credits: 12345 });
    await renderHeader();

    const right = mountNode.querySelector(`.${styles.right}`);
    expect(right?.textContent).toContain('12,345');
    expect(right?.querySelector('svg')?.getAttribute('fill')).toBe('#FBBF24');
  });

  it('Agent 抽屉展开时右上角内容按抽屉宽度左移，关闭/浮动/收起回原位', async () => {
    useAuthStore.setState({ credits: 300 });

    await renderHeader({ agentDrawer: { open: true, closing: false, floating: false, resizing: false, width: 468 } });
    let right = mountNode.querySelector<HTMLElement>(`.${styles.right}`)!;
    expect(right.classList.contains(styles.rightPushed)).toBe(true);
    expect(right.style.getPropertyValue('--agent-drawer-push')).toBe('468px');

    await renderHeader({ agentDrawer: { open: true, closing: true, floating: false, resizing: false, width: 468 } });
    right = mountNode.querySelector<HTMLElement>(`.${styles.right}`)!;
    expect(right.classList.contains(styles.rightPushed)).toBe(false);

    await renderHeader({ agentDrawer: { open: true, closing: false, floating: true, resizing: false, width: 360 } });
    right = mountNode.querySelector<HTMLElement>(`.${styles.right}`)!;
    expect(right.classList.contains(styles.rightPushed)).toBe(false);

    await renderHeader({ agentDrawer: { open: false, closing: false, floating: false, resizing: false, width: 0 } });
    right = mountNode.querySelector<HTMLElement>(`.${styles.right}`)!;
    expect(right.classList.contains(styles.rightPushed)).toBe(false);
  });

  it('拖拽调宽时关闭位移过渡，跟手移动', async () => {
    await renderHeader({ agentDrawer: { open: true, closing: false, floating: false, resizing: true, width: 520 } });

    const right = mountNode.querySelector<HTMLElement>(`.${styles.right}`)!;
    expect(right.classList.contains(styles.rightFollowingResize)).toBe(true);
    expect(right.style.getPropertyValue('--agent-drawer-push')).toBe('520px');
  });
});
