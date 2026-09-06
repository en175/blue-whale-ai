// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasPage from './index';
import headerStyles from './components/CanvasHeader/index.module.css';

/* 本测试只验证 CanvasPage 的接线：showAgent 同时驱动面板挂载与 CanvasHeader 入口显隐。
   被测协作方是真实 CanvasHeader；面板本身的抽屉行为由 AgentPanel 自己的测试覆盖，这里打桩。 */
vi.mock('./components/AgentPanel', () => ({
  default: ({ onClose }: { onClose: () => void }) =>
    createElement(
      'button',
      { 'data-testid': 'agent-panel-stub', onClick: onClose },
      'AgentPanel',
    ),
}));

/* FlowCanvas（reactflow 画布）与接线无关，打桩掉以隔离画布渲染栈。 */
vi.mock('./components/Canvas', () => ({
  default: () => createElement('div', { 'data-testid': 'flow-canvas' }),
}));

/* ProjectSelector 打桩但透出 props：测试要直接触发 onSelect 模拟用户切换项目。 */
const selectorProps: { current?: { onSelect: (id: string) => void } } = {};

vi.mock('./components/ProjectSelector', () => ({
  default: (props: { onSelect: (id: string) => void }) => {
    selectorProps.current = props;
    return createElement('div', { 'data-testid': 'project-selector' });
  },
}));

vi.mock('@/components/UserDropdown/RechargeModal', () => ({
  default: () => null,
}));

vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({
  default: () => null,
}));

const apiMocks = vi.hoisted(() => ({
  // 列表给一项：currentId 经水合落到 'p1'，后续 onSelect('p2') 才是真实的项目迁移
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
}));

vi.mock('@/api/projects', () => ({
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));

vi.mock('@/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchQuota: apiMocks.fetchQuota,
  toSessionUser: apiMocks.toSessionUser,
}));

vi.mock('@/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/api/canvas', () => ({
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(),
  serializeNodes: vi.fn(() => '[]'),
}));

vi.mock('@/api/jobs', () => ({
  createGenerationJob: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  createMediaExtraction: vi.fn(),
  readJobFailText: vi.fn(() => ''),
}));

vi.mock('@/api/sharedAssets', () => ({
  saveSharedAsset: vi.fn(),
}));

/* useCanvasDoc 的真实实现返回稳定的 state 引用（仅在快照变化时换 identity）。
   打桩也必须保持引用稳定：每次渲染都新建对象会让 [doc, snapshotAssets] 水合 effect
   setState → 重渲染 → 再触发，异步死循环直到 OOM。 */
const canvasDocMock = vi.hoisted(() => ({
  doc: { id: null, version: null, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
  assets: {},
  refetch: vi.fn(),
}));

vi.mock('./hooks/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock,
}));

let root: Root;
let container: HTMLDivElement;

function agentEntry() {
  return container.querySelector<HTMLElement>(`.${headerStyles.agentBtn}`);
}

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, createElement(CanvasPage))));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe('CanvasPage Agent 面板接线（IKDLD4）', () => {
  it('进入画布时面板默认收起、Agent 入口可见（展开状态不持久化）', async () => {
    await renderPage();

    expect(container.querySelector('[data-testid="agent-panel-stub"]')).toBeNull();
    expect(agentEntry()).not.toBeNull();
    expect(agentEntry()!.classList.contains(headerStyles.agentBtnHidden)).toBe(false);
  });

  it('打开面板后右上角 Agent 入口隐藏，关闭后面板卸载、入口恢复', async () => {
    await renderPage();

    await act(async () => {
      agentEntry()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="agent-panel-stub"]')).not.toBeNull();
    expect(agentEntry()!.classList.contains(headerStyles.agentBtnHidden)).toBe(true);

    await act(async () => {
      container
        .querySelector('[data-testid="agent-panel-stub"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="agent-panel-stub"]')).toBeNull();
    expect(agentEntry()!.classList.contains(headerStyles.agentBtnHidden)).toBe(false);
  });

  it('切换 Project 后面板收起、入口恢复（展开状态不跨项目携带）', async () => {
    await renderPage();

    await act(async () => {
      agentEntry()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="agent-panel-stub"]')).not.toBeNull();

    await act(async () => {
      selectorProps.current!.onSelect('p2');
    });
    expect(container.querySelector('[data-testid="agent-panel-stub"]')).toBeNull();
    expect(agentEntry()!.classList.contains(headerStyles.agentBtnHidden)).toBe(false);
  });
});
