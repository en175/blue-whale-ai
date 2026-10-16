import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import CanvasPageNavProbe from './CanvasPageNavProbe';
import { beforeAll, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { GenerationModel } from '@/custom/api/generation';
import type { FetchJobsParams, FrameInterpolationCurrentData, JobListData } from '@/custom/api/jobs';

vi.mock('../components/AgentPanel', () => ({
  default: ({ initialCardLabel }: { initialCardLabel?: string }) =>
    createElement('div', { 'data-testid': 'agent-panel-stub' }, initialCardLabel),
}));

export const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('../components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('../components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));
vi.mock('../components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));
vi.mock('../components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));
vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

export const apiMocks = {
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(async (_projectId: string, _payload: { viewport: unknown; nodes: unknown[]; edges: unknown[]; confirmEmpty?: boolean }, _version: number | null) => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(async () => null),
  retryGenerationJob: vi.fn(),
  retryAudioMix: vi.fn(),
  createAudioVideoMux: vi.fn(),
  retryAudioVideoMux: vi.fn(),
  newIdempotencyKey: vi.fn((() => { let seq = 0; return () => `test-retry-key-${++seq}`; })()),
  createFrameInterpolation: vi.fn(),
  fetchFrameInterpolationCurrent: vi.fn(async (): Promise<FrameInterpolationCurrentData | null> => null),
  fetchJobs: vi.fn(async (_params?: FetchJobsParams): Promise<JobListData> => ({ records: [], total: 0, size: 20, current: 1 })),
  createAudioSpeed: vi.fn(),
  createAudioTrim: vi.fn(),
};

vi.mock('@/custom/api/projects', () => ({
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
  touchProjectLastOpened: apiMocks.touchProjectLastOpened,
}));
vi.mock('@/custom/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
  toSessionUser: apiMocks.toSessionUser,
}));
export const assetLibraryRecords: { current: Array<Record<string, unknown>> } = { current: [] };

vi.mock('@/custom/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
  assetPageQueryOptions: (type: string, size = 30) => ({
    queryKey: ['assets', 'pages', type, size],
    initialPageParam: 1,
    queryFn: async () => ({
      records: assetLibraryRecords.current,
      total: assetLibraryRecords.current.length,
      size,
      current: 1,
    }),
    getNextPageParam: () => undefined,
  }),
}));
vi.mock('@/custom/api/canvas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/custom/api/canvas')>()),
  applyPromptPreview: apiMocks.applyPromptPreview,
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data }))),
  ),
}));
vi.mock('@/shared/api/idempotencyKey', () => ({
  newIdempotencyKey: apiMocks.newIdempotencyKey,
}));
vi.mock('@/custom/api/jobs', () => ({
  createGenerationJob: vi.fn(),
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  retryAudioMix: apiMocks.retryAudioMix,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: vi.fn(),
  createFrameInterpolation: apiMocks.createFrameInterpolation,
  fetchFrameInterpolationCurrent: apiMocks.fetchFrameInterpolationCurrent,
  fetchJobs: apiMocks.fetchJobs,
  createMediaExtraction: vi.fn(),
  createAudioTrim: apiMocks.createAudioTrim,
  createAudioSpeed: apiMocks.createAudioSpeed,
  createAudioVideoMux: apiMocks.createAudioVideoMux,
  retryAudioVideoMux: apiMocks.retryAudioVideoMux,
  createVocalSplit: vi.fn(),
  readJobFailText: vi.fn(() => ''),
}));
vi.mock('@/custom/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/custom/api/generation', () => ({
  fetchGenerationModels: apiMocks.fetchGenerationModels,
}));

export const canvasDocMock: {
  current: {
    doc: unknown;
    assets: Record<string, unknown>;
    refetch: () => Promise<unknown>;
    acceptDoc: (doc: unknown) => void;
    loadFailed?: boolean;
  };
} = {
  current: {
    doc: null,
    assets: {},
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
};

vi.mock('../hooks/document/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

export function enableReactActEnvironment() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
export let navigateRef: ((to: string) => void) | null = null;
export let locationRef: { search: string } | null = null;


let CanvasPage: typeof import('../index').default;

beforeAll(async () => {
  enableReactActEnvironment();
  CanvasPage = (await import('../index')).default;
});

export async function renderPage() {
  enableReactActEnvironment();
  container = document.createElement('div');
  document.body.appendChild(container);
  const createdRoot = createRoot(container);
  root = createdRoot;
  await act(async () => {
    createdRoot.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }) },
        createElement(MemoryRouter, { initialEntries: ['/canvas?project=p1'] }, createElement(CanvasPageNavProbe, { onChange: (navigate, search) => { navigateRef = navigate; locationRef = { search }; } }), createElement(CanvasPage)),
        createElement(Toaster, { duration: Infinity }),
      ),
    );
  });
}

export async function unmountPage() {
  const current = root;
  if (current) await act(async () => { current.unmount(); });
  toast.dismiss();
  container?.remove();
  root = null;
  container = null;
  navigateRef = null;
  locationRef = null;
}

export function textNodes(): Node[] {
  return flowProps.current.textNodes as Node[];
}

export function mediaNodes(): Node[] {
  return flowProps.current.mediaNodes as Node[];
}

export function textCopies(): Node[] {
  return textNodes().filter((n) => n.id.startsWith('text-'));
}

export function mediaCopies(): Node[] {
  return mediaNodes().filter((n) => n.id.startsWith('media-'));
}

export async function copySelected(ids: string[]) {
  await act(async () => {
    flowProps.current.onCopySelected(ids);
  });
}

export async function pasteClipboard() {
  await act(async () => {
    flowProps.current.onPasteClipboard();
  });
  await act(async () => {});
}

export async function pressUndo(modifier: 'ctrl' | 'meta' = 'ctrl') {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', bubbles: true, cancelable: true,
      ctrlKey: modifier === 'ctrl', metaKey: modifier === 'meta',
    }));
  });
}
