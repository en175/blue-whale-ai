// @vitest-environment jsdom
/* IKGZ5P「高清 ▾」触发钮最近工具语义（画布链路）：触发钮显示全局记忆的最近工具（默认「高清」）、
   悬浮展开选「抠图」进入会话并隐藏触发钮（IKGZ5O soloToolbarHidden 渲染门联动验证）、
   会话内显式发送链路完整（直启非一键直发）、退出会话后触发钮重现并显示刚用过的工具名、
   点击触发钮直启所显示工具、所显示工具对当前卡不可用（webp 抠图）时整钮置灰点击无效
   而 hover 仍展开菜单可改选。渲染模式沿用 cutoutCanvas.test.tsx（FlowCanvas 打桩透出 props），
   差异：stub 内以 ReactFlowProvider + selected=true 渲染真实 MediaNode，触发钮工具条进入 DOM。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import type { GenerationModel } from '@/api/generation';
import { persistRecentQualityTool, RECENT_QUALITY_TOOL_STORAGE_KEY } from './recentQualityTool';

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点与触发画布回调；
 *  与 cutoutCanvas 的差异——渲染真实 MediaNode（ReactFlowProvider 空态无多选，
 *  selected=true 模拟唯一选中，悬浮工具条/触发钮进入 DOM）。 */
const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', async () => {
  const { createElement } = await import('react');
  const { ReactFlowProvider } = await import('@xyflow/react');
  const { default: MediaNode } = await import('./components/MediaNode');
  return {
    default: (props: Record<string, any>) => {
      flowProps.current = props;
      return createElement(
        ReactFlowProvider,
        null,
        createElement(
          'div',
          { 'data-testid': 'flow-canvas' },
          (props.mediaNodes as Array<Record<string, any>>).map((n) =>
            createElement(MediaNode, {
              key: n.id,
              ...n,
              selected: true,
              dragging: false,
              isConnectable: true,
            } as never)),
        ),
      );
    },
  };
});

vi.mock('./components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('./components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('./components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

/** PromptRefEditor 打桩（TextGenDialog 打开所需，genPanelDismiss 同款） */
vi.mock('./components/PromptRefEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(function StubPromptRefEditor(_props: unknown, ref: React.Ref<unknown>) {
      useImperativeHandle(ref, () => ({
        insertRefAtMention: () => {},
        consumeMentionForPendingInsert: () => {},
        insertRefAtPending: () => {},
        dismissMention: () => {},
        replaceRefAt: () => {},
        clear: () => {},
      }));
      return createElement('textarea', { 'data-testid': 'chip-editor' });
    }),
  };
});

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(
    async (): Promise<{ id: number; project_id: number; version: number; viewport: string; nodes: string }> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createMediaExtraction: vi.fn(),
  createImageErase: vi.fn(),
  createImageCutout: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
  uploadAssetFile: vi.fn(),
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
  applyPromptPreview: apiMocks.applyPromptPreview,
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({
    queryKey: ['canvas', projectId, 'legacy-history'],
    queryFn: () => Promise.resolve({ items: [] }),
    retry: false,
  }),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string }>) =>
    JSON.stringify(edges.map((e) => JSON.parse(JSON.stringify(e)))),
  ),
}));
vi.mock('@/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createImageErase: apiMocks.createImageErase,
  createImageCutout: apiMocks.createImageCutout,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));
vi.mock('@/utils/upload', () => ({ uploadAssetFile: apiMocks.uploadAssetFile }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

/** 画布：就绪图片节点 i1（1600×900，assetId 数字串满足抠图契约）。webp=true 时格式在
 *  抠图/擦除白名单外（触发钮显示「抠图」时整钮置灰的门槛场景）。 */
function seedDoc(webp = false) {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'i1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: {
            src: webp ? 'http://img/i1.webp' : 'http://img/i1.png',
            mediaType: 'image',
            fileName: '素材图',
            assetId: '5',
            width: 1600,
            height: 900,
            mime: webp ? 'image/webp' : 'image/png',
          },
        },
      ],
      edges: [],
    },
    assets: {
      5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 1600, height: 900 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

let root: Root;
let container: HTMLDivElement;

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MemoryRouter, null, createElement(CanvasPage)),
      ),
    );
  });
}

function bodyBtn(testId: string): HTMLButtonElement {
  return document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
}

async function click(testId: string) {
  await act(async () => {
    bodyBtn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 悬浮触发钮展开「高清 ▾」菜单（mouseover 合成 onMouseEnter） */
async function hoverTrigger() {
  await act(async () => {
    bodyBtn('image-quality-trigger').dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }),
    );
  });
}

function triggerText(): string {
  return bodyBtn('image-quality-trigger').textContent ?? '';
}

function cutoutToolbar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="cutout-toolbar"]');
}

/** 裁切编辑态标记（渲染期注入）：目标源图卡 data.cropEditing === true */
function cropEditing(): boolean {
  const node = (flowProps.current.mediaNodes as Node[] | undefined)?.find((n) => n.id === 'i1');
  return (node?.data as Record<string, unknown> | undefined)?.cropEditing === true;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createImageCutout.mockReset();
  apiMocks.createImageCutout.mockResolvedValue({ job_id: 'j88', status: 'queued' });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKGZ5P 触发钮最近工具语义（画布链路）', () => {
  it('初始（无记忆）触发钮显示「高清」', async () => {
    await renderPage();
    expect(triggerText()).toContain('高清');
  });

  it('悬浮展开选「抠图」：进入会话 + 写入记忆 + 触发钮随悬浮工具条隐藏（IKGZ5O 渲染门联动）', async () => {
    await renderPage();
    await hoverTrigger();
    expect(document.body.querySelector('[data-testid="image-quality-menu"]')).not.toBeNull();
    await click('image-quality-item-cutout');
    // 进入抠图会话（横条出现）
    expect(cutoutToolbar()).toBeTruthy();
    // 记忆写入：全局单值落 localStorage
    expect(localStorage.getItem(RECENT_QUALITY_TOOL_STORAGE_KEY)).toBe('cutout');
    // 会话中源卡工具条整条隐藏，触发钮随之消失
    expect(document.body.querySelector('[data-testid="image-quality-trigger"]')).toBeNull();
  });

  it('会话内显式发送链路完整（直启只进会话，发送需会话内触发，非一键直发）', async () => {
    await renderPage();
    await hoverTrigger();
    await click('image-quality-item-cutout');
    expect(apiMocks.createImageCutout).not.toHaveBeenCalled(); // 直启/进入不发送
    await click('cutout-send-btn');
    expect(apiMocks.createImageCutout).toHaveBeenCalledTimes(1);
    // 发送即退出会话
    expect(cutoutToolbar()).toBeNull();
  });

  it('退出会话后触发钮重现并显示刚用过的工具名「抠图」', async () => {
    await renderPage();
    await hoverTrigger();
    await click('image-quality-item-cutout');
    await click('cutout-close');
    expect(cutoutToolbar()).toBeNull();
    const trigger = document.body.querySelector<HTMLButtonElement>('[data-testid="image-quality-trigger"]');
    expect(trigger).not.toBeNull();
    expect(trigger!.textContent).toContain('抠图');
  });

  it('点击触发钮直启所显示工具：记忆「抠图」时直接进入抠图会话', async () => {
    await renderPage();
    await act(async () => {
      persistRecentQualityTool('cutout');
    });
    expect(triggerText()).toContain('抠图');
    await act(async () => {
      bodyBtn('image-quality-trigger').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(cutoutToolbar()).toBeTruthy();
    // 直启同样写入记忆（同一写入点）
    expect(localStorage.getItem(RECENT_QUALITY_TOOL_STORAGE_KEY)).toBe('cutout');
  });

  it('所显示工具对当前卡不可用（webp 卡显示「抠图」）：整钮置灰点击无效，hover 仍展开菜单可改选', async () => {
    seedDoc(true);
    await renderPage();
    await act(async () => {
      persistRecentQualityTool('cutout');
    });
    const trigger = bodyBtn('image-quality-trigger');
    expect(trigger.textContent).toContain('抠图');
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    // 点击无效：不进入会话、不派发
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(cutoutToolbar()).toBeNull();
    expect(apiMocks.createImageCutout).not.toHaveBeenCalled();
    // hover 仍可展开菜单：可见「抠图」置灰原因
    await hoverTrigger();
    const menu = document.body.querySelector('[data-testid="image-quality-menu"]');
    expect(menu).not.toBeNull();
    const cutout = bodyBtn('image-quality-item-cutout');
    expect(cutout.getAttribute('aria-disabled')).toBe('true');
    expect(cutout.getAttribute('title')).toContain('webp');
    // 改选「裁切」进入裁切会话，记忆改写
    await click('image-quality-item-crop');
    expect(cropEditing()).toBe(true);
    expect(localStorage.getItem(RECENT_QUALITY_TOOL_STORAGE_KEY)).toBe('crop');
  });
});
