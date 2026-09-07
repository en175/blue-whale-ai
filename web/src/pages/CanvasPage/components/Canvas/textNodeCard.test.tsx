// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FlowCanvas from './index';

vi.hoisted(() => {
  // 开发期代码定位插件在导入时探测 Canvas；本测试不绘制位图。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

const TEXT_ID = 'text-1';

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FlowCanvas>;

interface TextCallbacks {
  onDraftError: ReturnType<typeof vi.fn>;
  onChange: ReturnType<typeof vi.fn>;
  onAddToChat: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onDuplicate: ReturnType<typeof vi.fn>;
  onToast: ReturnType<typeof vi.fn>;
}

function node() {
  return container.querySelector<HTMLElement>(`.react-flow__node[data-id="${TEXT_ID}"]`)!;
}

function title() {
  return node().querySelector<HTMLElement>('[data-testid="text-title"]')!;
}

function content() {
  return node().querySelector<HTMLElement>('[data-testid="text-content"]')!;
}

function editor() {
  return content().querySelector<HTMLElement>('[contenteditable]')!;
}

/** 节点内可见操作（按钮文案或 title），用于断言操作条与格式工具栏的并存关系 */
function actions() {
  return [...node().querySelectorAll('button')].map(
    (button) => button.textContent?.trim() || button.getAttribute('title') || '',
  );
}

async function mouse(type: string, target: EventTarget, x = 100, y = 100) {
  await act(async () => {
    const event = new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1,
      clientX: x, clientY: y,
    });
    // Vitest 的 window 代理不通过 jsdom 构造器的 Window 身份检查。
    Object.defineProperty(event, 'view', { value: window });
    target.dispatchEvent(event);
  });
}

async function finishGesture() {
  await mouse('mouseup', window, 160, 140);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}

/**
 * 挂载真实画布与真实文本节点。
 * 每个用例只挂载一次：画布对同 id 文本节点只同步新增与移除，重复渲染不会替换已注入的回调。
 */
async function renderText(
  overrides: { html?: string; toolMode?: 'drag' | 'select'; selected?: boolean; zoom?: number } = {},
): Promise<TextCallbacks> {
  const callbacks: TextCallbacks = {
    onDraftError: vi.fn(),
    onChange: vi.fn(),
    onAddToChat: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onToast: vi.fn(),
  };
  const toolMode = overrides.toolMode ?? 'select';
  const next: ComponentProps<typeof FlowCanvas> = {
    ...props,
    toolMode,
    viewport: { x: 0, y: 0, zoom: overrides.zoom ?? 1 },
    textNodes: [{
      id: TEXT_ID,
      type: 'textNode',
      position: { x: 50, y: 60 },
      selected: overrides.selected ?? false,
      data: { html: overrides.html ?? '', toolMode, ...callbacks },
    }],
  };
  await act(async () => { root.render(createElement(FlowCanvas, next)); });
  return callbacks;
}

/** 双击进入编辑（浏览器随后聚焦编辑器，jsdom 下 React 的委托焦点由 focusin 复现） */
async function startEditing() {
  await act(async () => {
    editor().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(editor().getAttribute('contenteditable')).toBe('true'));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom 不做布局；只补浏览器测量 API，React Flow 与文本卡片均使用真实实现。
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800,
    toJSON: () => ({}),
  });
  // jsdom 未实现富文本命令；替身只放在这一层浏览器能力边界。
  (document as Document & { execCommand: (...args: unknown[]) => boolean }).execCommand = vi.fn(() => true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    toolMode: 'select', showMiniMap: false, showEdges: false, hideZoomControl: true,
    extraNodes: [], textNodes: [], mediaNodes: [], productNodes: [], assetNodes: [],
    edges: [], onEdgesChange: vi.fn(), onConnect: vi.fn(),
    viewport: { x: 0, y: 0, zoom: 1 },
    onDeleteNode: vi.fn(), onNodeDragStop: vi.fn(), onViewportChange: vi.fn(),
    onNodeClick: vi.fn(), onPaneClick: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.innerHTML = '';
  Reflect.deleteProperty(document, 'execCommand');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Canvas 文本节点卡片', () => {
  it('标题常驻内容区上方，名称只呈现一次', async () => {
    await renderText();
    expect(node().textContent).toContain('文本节点');
    expect(node().textContent!.split('文本节点').length - 1).toBe(1);
    // 标题在正文容器之前（上方），空文本时正文为空
    expect(title().compareDocumentPosition(content()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(editor().textContent).toBe('');
  });

  it('短文本完整呈现在正文容器内', async () => {
    await renderText({ html: '<p>一张短便签</p>' });
    expect(content().textContent).toContain('一张短便签');
    expect(content().contains(editor())).toBe(true);
  });

  it('长文本首尾都在正文容器内，可由内部滚动读全', async () => {
    const long = `<p>开篇第一句</p>${'<p>中间段落内容</p>'.repeat(60)}<p>结尾最后一句</p>`;
    await renderText({ html: long });
    expect(content().textContent).toContain('开篇第一句');
    expect(content().textContent).toContain('结尾最后一句');
    // 正文不得撑大外形：内容全在编辑区内，容器不追加正文高度
    expect(content().contains(editor())).toBe(true);
    expect(editor().querySelectorAll('p').length).toBe(62);
  });

  it('选中时“添加到对话”可达并触发原有回调', async () => {
    const callbacks = await renderText({ selected: true });
    expect(actions()).toContain('添加到对话');
    const button = [...node().querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes('添加到对话'))!;
    await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(callbacks.onAddToChat).toHaveBeenCalledWith(TEXT_ID);
  });

  it('双击进入编辑，输入内容经原有通路保存', async () => {
    const callbacks = await renderText({ html: '<p>原内容</p>' });
    await startEditing();
    await act(async () => {
      editor().innerHTML = '<p>原内容</p><p>补充的一段</p>';
      editor().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(callbacks.onChange).toHaveBeenCalledWith(TEXT_ID, expect.stringContaining('补充的一段'));
  });

  it('编辑时格式工具栏与节点操作同处一层，不叠成多行', async () => {
    await renderText({ selected: true });
    expect(actions()).toContain('添加到对话');
    expect(actions()).not.toContain('加粗');

    await startEditing();
    await vi.waitFor(() => expect(actions()).toContain('加粗'));
    // 编辑时节点操作并入同一层操作位置，保持可达
    expect(actions()).toContain('添加到对话');

    // 退出编辑：焦点离开编辑器与工具栏后，格式按钮收起
    await act(async () => {
      editor().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await vi.waitFor(() => expect(actions()).toContain('添加到对话'));
    expect(actions()).not.toContain('加粗');
  });

  // IKDLQE: truncation was retired; complete paste and over-limit drafts are covered by real-browser integration.

  it('滚轮在正文内遵循内部阅读语义，不缩放画布', async () => {
    await renderText({ html: '<p>需要滚动才能读完的正文</p>' });
    const viewportTransform = () =>
      container.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform;
    expect(viewportTransform()).toBe('translate(0px,0px) scale(1)');
    await act(async () => {
      editor().dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    });
    expect(viewportTransform()).toBe('translate(0px,0px) scale(1)');
  });

  it('标题行遵循原有节点拖动语义，拖动后上报新位置', async () => {
    await renderText();
    await mouse('mousedown', title());
    await mouse('mousemove', window, 120, 110);
    await mouse('mousemove', window, 160, 140);
    await finishGesture();
    expect(props.onNodeDragStop).toHaveBeenCalledWith(
      expect.objectContaining({ id: TEXT_ID, position: { x: 90, y: 90 } }),
      expect.any(Array),
    );
  });

  it('拖动模式下双击不进入编辑，正文不接管输入', async () => {
    await renderText({ toolMode: 'drag' });
    expect(editor().style.pointerEvents).toBe('none');
    await act(async () => {
      editor().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    expect(editor().getAttribute('contenteditable')).toBe('false');
  });

  it('右键菜单保留原有节点操作', async () => {
    const callbacks = await renderText();
    await act(async () => {
      content().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 90 }));
    });
    const menuItems = [...document.body.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(menuItems).toEqual(expect.arrayContaining(['添加到聊天', '复制', '删除']));
    const remove = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === '删除')!;
    await act(async () => { remove.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(callbacks.onDelete).toHaveBeenCalledWith(TEXT_ID);
  });
});

describe('Canvas 文本节点标题分段缩放', () => {
  /** 节点根元素（titleRow 的父级）内联样式携带的分段缩放变量（局部值 = 屏幕目标值 ÷ 倍率） */
  function titleVar(name: '--node-title-name' | '--node-title-icon') {
    const wrapper = title().parentElement as HTMLElement;
    return parseFloat(wrapper.style.getPropertyValue(name));
  }

  it.each([
    [0.5, 8, 9.3333], [0.63, 10.08, 11.76], [0.75, 12, 14], [1, 12, 14],
    [1.25, 15, 17.5], [1.5, 16, 18], [8, 16, 18],
  ] as const)('倍率 %s 下名称与图标按父规格补偿为屏幕 %s/%s px', async (zoom, nameScreen, iconScreen) => {
    await renderText({ zoom, html: '<p>一段正文</p>' });
    expect(titleVar('--node-title-name') * zoom).toBeCloseTo(nameScreen, 2);
    expect(titleVar('--node-title-icon') * zoom).toBeCloseTo(iconScreen, 2);
    // 名称与正文大小策略独立：正文编辑区不随标题变量缩放
    expect(title().textContent).toBe('文本节点');
  });

  it('缩放与选中、拖动组合时位置与标题稳定，操作条仍可达', async () => {
    await renderText({ selected: true, zoom: 0.63, html: '<p>组合操作正文</p>' });
    expect(node().style.transform).toBe('translate(50px,60px)');

    await mouse('mousedown', title());
    await mouse('mousemove', window, 120, 110);
    await renderText({ selected: true, zoom: 0.75, html: '<p>组合操作正文</p>' });
    await mouse('mousemove', window, 160, 140);
    await finishGesture();
    expect(props.onNodeDragStop).toHaveBeenCalledWith(expect.objectContaining({ id: TEXT_ID }), expect.any(Array));
    const draggedPosition = node().style.transform;
    expect(draggedPosition).not.toBe('translate(50px,60px)');

    await renderText({ selected: true, zoom: 1.5, html: '<p>组合操作正文</p>' });
    expect(node().style.transform).toBe(draggedPosition);
    expect(title().textContent).toBe('文本节点');
    expect(node().textContent).toContain('组合操作正文');
    expect(actions()).toContain('添加到对话');
  });
});


it('reports invalid text to the canvas and clears the error after correction', async () => {
  const callbacks = await renderText();
  await startEditing();
  await act(async () => {
    Object.defineProperty(editor(), 'innerText', { configurable: true, value: '长'.repeat(100001) });
    editor().dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(callbacks.onChange).not.toHaveBeenCalled();
  expect(callbacks.onDraftError).toHaveBeenLastCalledWith(TEXT_ID, expect.stringContaining('100000'));
  expect(node().textContent).toContain('草稿已保留');
  await act(async () => {
    Object.defineProperty(editor(), 'innerText', { configurable: true, value: '修正正文' });
    editor().innerHTML = '修正正文';
    editor().dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(callbacks.onDraftError).toHaveBeenLastCalledWith(TEXT_ID, '');
  expect(callbacks.onChange).toHaveBeenLastCalledWith(TEXT_ID, '修正正文');
});
