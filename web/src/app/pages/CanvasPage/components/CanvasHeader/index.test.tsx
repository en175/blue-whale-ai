// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasHeader from './index';
import styles from './index.module.css';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/app/components/UserDropdown', () => ({
  default: () => createElement('div', { 'data-testid': 'user-dropdown' }, '个人信息'),
}));

vi.mock('@/app/components/UserDropdown/RechargeModal', () => ({
  default: () => createElement('div', { 'data-testid': 'recharge-modal' }),
}));

vi.mock('@/app/stores/recharge', () => ({
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
});
