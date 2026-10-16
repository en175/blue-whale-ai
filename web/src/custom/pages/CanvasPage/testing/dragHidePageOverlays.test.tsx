// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const PAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tsxFilesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesUnder(full);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [full] : [];
  });
}

function componentNameOf(file: string): string | null {
  const base = path.basename(file, '.tsx');
  if (base === 'index') return path.basename(path.dirname(file));
  return base;
}

function anchoredOverlayComponents(): string[] {
  return [
    ...new Set(
      tsxFilesUnder(path.join(PAGE_DIR, 'components'))
        .filter((file) => fs.readFileSync(file, 'utf8').includes('anchoredOverlayStyle'))
        .map((file) => componentNameOf(file))
        .filter((name): name is string => name != null),
    ),
  ].sort();
}

function defaultImportLocalsByComponentDir(file: string, wanted: ReadonlySet<string>): Map<string, string> {
  const sourceFile = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const map = new Map<string, string>();
  sourceFile.forEachChild((stmt) => {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) return;
    const match = stmt.moduleSpecifier.text.match(/^(?:\.\/|\.\.\/(?:\.\.\/)*)components\/([A-Za-z0-9_]+?)(?:\/index)?$/);
    if (!match || !wanted.has(match[1])) return;
    const local = stmt.importClause?.name?.text;
    if (local) map.set(match[1], local);
  });
  return map;
}

function jsxElementsNamed(
  sourceFile: ts.SourceFile,
  localName: string,
): Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> {
  const found: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === localName
    ) {
      found.push(node);
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return found;
}

function resourcesDragHiddenWired(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean {
  const attr = node.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === 'resources',
  );
  const expr = attr?.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined;
  if (expr == null || !ts.isObjectLiteralExpression(expr)) return false;
  return expr.properties.some((property) => {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || property.name.text !== 'dragHidden') {
      return false;
    }
    const initializer = property.initializer;
    return (
      ts.isCallExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      initializer.expression.text === 'isAnchoredOverlayDragHidden'
    );
  });
}

function spreadsResources(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean {
  return node.attributes.properties.some(
    (p) => ts.isJsxSpreadAttribute(p) && ts.isIdentifier(p.expression) && p.expression.text === 'resources',
  );
}

function productionTsxFiles(): string[] {
  const componentRoot = path.join(PAGE_DIR, 'components') + path.sep;
  return tsxFilesUnder(PAGE_DIR).filter((file) => !file.startsWith(componentRoot));
}

function overlayWrapperModule(overlayName: string): string {
  const matches = productionTsxFiles().filter((file) =>
    defaultImportLocalsByComponentDir(file, new Set([overlayName])).has(overlayName),
  );
  expect(matches.length, `未找到 CanvasPage 下默认导入 components/${overlayName} 的包装模块`).toBe(1);
  return matches[0];
}

function defaultImportLocalOfModuleBase(file: string, wrapperBase: string): string | null {
  const sourceFile = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  let local: string | null = null;
  sourceFile.forEachChild((stmt) => {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) return;
    const spec = stmt.moduleSpecifier.text;
    if (spec !== `./${wrapperBase}` && !spec.endsWith(`/${wrapperBase}`)) return;
    const name = stmt.importClause?.name?.text;
    if (name) local = name;
  });
  return local;
}

describe('IKJU9T 页面级锚定浮层出口机械护栏', () => {
  const anchored = anchoredOverlayComponents();
  const sessions = defaultImportLocalsByComponentDir(
    path.join(PAGE_DIR, 'tool-runtime/canvasToolEntries.tsx'),
    new Set(anchored),
  );
  const pageLevel = anchored.filter((name) => !sessions.has(name));

  it('页面级锚定浮层清单（anchoredOverlayStyle 组件 − 会话注册组件）与四类生成面板一致', () => {
    expect(pageLevel).toEqual(['AudioDialog', 'BottomDialog', 'ImageDialog', 'TextGenDialog']);
  });

  it('每个页面级锚定浮层经 CanvasPage 的 Dock 包装出口接线 dragHidden={isAnchoredOverlayDragHidden(…)}', () => {
    const indexFile = path.join(PAGE_DIR, 'index.tsx');
    const indexSource = ts.createSourceFile(
      indexFile,
      fs.readFileSync(indexFile, 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TSX,
    );
    const directLocals = defaultImportLocalsByComponentDir(indexFile, new Set(pageLevel));
    for (const name of pageLevel) {
      const directLocal = directLocals.get(name);
      if (directLocal) {
        expect(
          jsxElementsNamed(indexSource, directLocal).length,
          `${name} 绕过 Dock 包装在 CanvasPage 直接渲染（页面级锚定浮层只能经包装出口接线）`,
        ).toBe(0);
      }

      const wrapperFile = overlayWrapperModule(name);
      const wrapperBase = path.basename(wrapperFile, '.tsx');
      const exitFile = productionTsxFiles().find(
        (file) => file !== wrapperFile && defaultImportLocalOfModuleBase(file, wrapperBase) != null,
      );
      expect(exitFile, `${name} 的包装模块 ${wrapperBase} 未在画布页出口模块中默认导入`).toBeTruthy();
      const wrapperLocal = defaultImportLocalOfModuleBase(exitFile!, wrapperBase);
      const exitSource = ts.createSourceFile(
        exitFile!,
        fs.readFileSync(exitFile!, 'utf8'),
        ts.ScriptTarget.ESNext,
        true,
        ts.ScriptKind.TSX,
      );

      const pageSites = jsxElementsNamed(exitSource, wrapperLocal!);
      expect(pageSites.length, `${name} 的包装 ${wrapperLocal} 未在 CanvasPage 出口渲染`).toBeGreaterThan(0);
      pageSites.forEach((site, i) => {
        expect(
          resourcesDragHiddenWired(site),
          `${name} 第 ${i + 1} 处包装渲染的 resources 未含 dragHidden: isAnchoredOverlayDragHidden(锚定卡 id)`,
        ).toBe(true);
      });

      const wrapperSource = ts.createSourceFile(
        wrapperFile,
        fs.readFileSync(wrapperFile, 'utf8'),
        ts.ScriptTarget.ESNext,
        true,
        ts.ScriptKind.TSX,
      );
      const overlayLocal = defaultImportLocalsByComponentDir(wrapperFile, new Set([name])).get(name);
      expect(overlayLocal, `${wrapperBase} 未默认导入 components/${name}`).toBeTruthy();
      const wrapperSites = jsxElementsNamed(wrapperSource, overlayLocal!);
      expect(wrapperSites.length, `${wrapperBase} 未渲染 ${name}`).toBeGreaterThan(0);
      wrapperSites.forEach((site, i) => {
        expect(
          spreadsResources(site),
          `${wrapperBase} 第 ${i + 1} 处 ${name} 渲染未透传 {...resources}（dragHidden 会被静默丢弃）`,
        ).toBe(true);
      });
    }
  });
});

vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

vi.mock('../components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
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

vi.mock('../components/BottomDialog', () => ({
  default: ({ dragHidden }: { dragHidden?: boolean }) =>
    createElement('div', { 'data-testid': 'panel-video', 'data-drag-hidden': String(dragHidden ?? false) }),
}));

vi.mock('../components/ImageDialog', () => ({
  default: ({ dragHidden }: { dragHidden?: boolean }) =>
    createElement('div', { 'data-testid': 'panel-image', 'data-drag-hidden': String(dragHidden ?? false) }),
}));

vi.mock('../components/TextGenDialog', () => ({
  default: ({ dragHidden }: { dragHidden?: boolean }) =>
    createElement('div', { 'data-testid': 'panel-text', 'data-drag-hidden': String(dragHidden ?? false) }),
}));

vi.mock('../components/AudioDialog', () => ({
  default: ({ dragHidden }: { dragHidden?: boolean }) =>
    createElement('div', { 'data-testid': 'panel-audio', 'data-drag-hidden': String(dragHidden ?? false) }),
}));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({ credits: 0 })),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  referencePromptPlan: vi.fn(),
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async () => ({ generation_job_id: 'j1', cursor: 1 })),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async () => []),
}));

vi.mock('@/custom/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));

vi.mock('@/custom/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
  toSessionUser: apiMocks.toSessionUser,
}));

vi.mock('@/custom/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
  assetPageQueryOptions: vi.fn((type: string, size: number) => ({
    queryKey: ['asset-pages', type, size],
    initialPageParam: 1,
    queryFn: () => Promise.resolve({ records: [], total: 0, current: 1 }),
    getNextPageParam: () => undefined,
  })),
  assetDetailQueryOptions: vi.fn((id: unknown) => ({
    queryKey: ['asset-detail', id],
    queryFn: () => Promise.resolve(null),
    enabled: id != null,
  })),
  deleteAsset: vi.fn(),
  fetchAssetReferences: vi.fn(),
}));

vi.mock('@/custom/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  referencePromptPlan: apiMocks.referencePromptPlan,
  listLegacyCardHistory: apiMocks.listLegacyCardHistory,
  createConversationQuote: apiMocks.createConversationQuote,
  legacyCardHistoryOptions: apiMocks.legacyCardHistoryOptions,
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn(
    (edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
      JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data }))),
  ),
}));

vi.mock('@/custom/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createAudioTrim: apiMocks.createAudioTrim,
  readJobFailText: apiMocks.readJobFailText,
}));

vi.mock('@/custom/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));

vi.mock('@/custom/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));

vi.mock('@/custom/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/canvasRecovery')>()),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    queryFn: async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null }),
  })),
}));

vi.mock('@/custom/api/generation', () => ({
  fetchGenerationModels: apiMocks.fetchGenerationModels,
}));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));

vi.mock('../hooks/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'd1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '图片草稿提示词' },
        },
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 700, y: 0 },
          data: { src: '', mediaType: 'video', fileName: '视频草稿', genStatus: 'draft', draft: true, prompt: '视频草稿提示词' },
        },
        {
          id: 't1',
          type: 'textNode',
          position: { x: 1000, y: 0 },
          data: { text: '文本草稿', title: '文本生成', textGen: true },
        },
        {
          id: 'au1',
          type: 'mediaNode',
          position: { x: 1500, y: 0 },
          data: { src: '', mediaType: 'audio', fileName: '音频草稿', genStatus: 'draft', draft: true, prompt: '音频草稿提示词' },
        },
        { id: 'group-a', type: 'groupFrame', position: { x: 350, y: -50 }, data: { box: { x: 350, y: -50, w: 900, h: 600 }, excludedIds: [] } },
        { id: 'group-b', type: 'groupFrame', position: { x: 1450, y: -50 }, data: { box: { x: 1450, y: -50, w: 450, h: 600 }, excludedIds: [] } },
      ],
      edges: [],
    },
    assets: {},
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

let root: Root;
let container: HTMLDivElement;

async function renderPage() {
  const { default: Page } = await import('../index');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MemoryRouter, { initialEntries: ['/canvas?project=p1'] }, createElement(Page) as ReactElement),
      ),
    );
  });
}

function node(id: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
}

function pane(): HTMLElement {
  return container.querySelector<HTMLElement>('.react-flow__pane')!;
}

function fireMouse(type: 'mousedown' | 'mousemove' | 'mouseup' | 'click', target: EventTarget, cx: number, cy: number) {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' || type === 'click' ? 0 : 1,
    clientX: cx, clientY: cy,
  });
  Object.defineProperty(event, 'view', { value: window });
  target.dispatchEvent(event);
}

function firePointer(type: 'pointerdown' | 'pointermove' | 'pointerup', target: EventTarget, cx: number, cy: number) {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: cx, clientY: cy,
  });
  Object.defineProperty(event, 'view', { value: window });
  Object.defineProperty(event, 'isPrimary', { value: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

async function clickCard(id: string, x: number, y: number) {
  const el = node(id);
  await act(async () => {
    fireMouse('mousedown', el, x, y);
    fireMouse('mousemove', window, x + 4, y + 3);
    fireMouse('mousemove', window, x, y);
    fireMouse('mouseup', window, x, y);
    fireMouse('click', node(id), x, y);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

async function clickCardStill(id: string, x: number, y: number) {
  const el = node(id);
  await act(async () => {
    fireMouse('mousedown', el, x, y);
    fireMouse('mouseup', window, x, y);
    fireMouse('click', node(id), x, y);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('页面测试禁止真实出网'); }));
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  document.elementsFromPoint = () => [];
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(2000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rectOf(this: HTMLElement) {
    if (this.closest('[data-canvas-chrome], .react-flow__minimap')) {
      return { x: 980, y: 760, left: 980, top: 760, right: 1000, bottom: 800, width: 20, height: 20, toJSON: () => ({}) };
    }
    return { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON: () => ({}) };
  });
  Element.prototype.scrollTo = () => {};
  seedDoc();
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  Reflect.deleteProperty(document, 'elementsFromPoint');
  expect(fetch).not.toHaveBeenCalled();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PANEL_CASES = [
  { name: '图片', anchor: 'd1', x: 520, y: 90, testid: 'panel-image' },
  { name: '视频', anchor: 'v1', x: 820, y: 90, testid: 'panel-video' },
  { name: '文本', anchor: 't1', x: 1110, y: 50, testid: 'panel-text' },
  { name: '音频', anchor: 'au1', x: 1620, y: 90, testid: 'panel-audio' },
] as const;

describe('IKJU9T 页面级生成面板 dragHidden 传递（真实手势 + 面板桩）', () => {
  it.each(PANEL_CASES)('$name 面板：拖锚定卡 dragHidden=true，拖别的卡 false', async ({ anchor, x, y, testid }) => {
    await renderPage();
    await vi.waitFor(() => expect(node(anchor)).toBeTruthy());

    if (anchor === 't1') {
      await clickCardStill(anchor, x, y);
    } else {
      await clickCard(anchor, x, y);
    }
    const panel = () => container.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!;
    await vi.waitFor(() => expect(panel()).toBeTruthy());
    expect(panel().getAttribute('data-drag-hidden')).toBe('false');

    await act(async () => { fireMouse('mousedown', node(anchor), x, y); });
    await act(async () => { fireMouse('mousemove', window, x + 4, y + 3); });
    await act(async () => { fireMouse('mousemove', window, x + 104, y + 73); });
    expect(panel().getAttribute('data-drag-hidden')).toBe('true');

    await act(async () => { fireMouse('mouseup', window, x + 104, y + 73); });
    await vi.waitFor(() => expect(panel().getAttribute('data-drag-hidden')).toBe('false'));

    const [gx, gy] = anchor === 'au1' ? [400, 500] : [1850, 500];
    await act(async () => { firePointer('pointerdown', pane(), gx, gy); });
    await act(async () => { firePointer('pointermove', window, gx + 50, gy + 60); });
    expect(panel().getAttribute('data-drag-hidden')).toBe('false');
    await act(async () => { firePointer('pointerup', window, gx + 50, gy + 60); });
  }, 20000);
});
