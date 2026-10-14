// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FlowCanvas from './index';

vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

const TEXT_ID = 'text-1';

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FlowCanvas>;

interface TextCallbacks {
  onDraftError: ReturnType<typeof vi.fn>;
  onTextChange: ReturnType<typeof vi.fn>;
  onTitleChange: ReturnType<typeof vi.fn>;
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

function actions() {
  const buttons = [
    ...node().querySelectorAll('button'),
    ...document.querySelectorAll<HTMLElement>('[data-gen-panel-territory] button'),
  ];
  return buttons.map((button) => button.textContent?.trim() || button.getAttribute('title') || '');
}

async function mouse(type: string, target: EventTarget, x = 100, y = 100) {
  await act(async () => {
    const event = new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1,
      clientX: x, clientY: y,
    });
    Object.defineProperty(event, 'view', { value: window });
    target.dispatchEvent(event);
  });
}

async function finishGesture() {
  await mouse('mouseup', window, 160, 140);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}

async function renderText(
  overrides: { text?: string; html?: string; title?: string; toolMode?: 'drag' | 'select'; selected?: boolean; zoom?: number } = {},
): Promise<TextCallbacks> {
  const callbacks: TextCallbacks = {
    onDraftError: vi.fn(),
    onTextChange: vi.fn(),
    onTitleChange: vi.fn(),
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
      data: { ...(overrides.text !== undefined ? { text: overrides.text } : { html: overrides.html ?? '' }), ...(overrides.title !== undefined ? { title: overrides.title } : {}), toolMode, ...callbacks },
    }],
  };
  await act(async () => { root.render(createElement(FlowCanvas, next)); });
  return callbacks;
}

async function startEditing() {
  await act(async () => {
    editor().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(editor().getAttribute('contenteditable')).toBe('true'));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class {
    callback: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.callback = cb; }
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 1000, height: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('DOMMatrixReadOnly', class {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
      this.m22 = scale !== undefined ? +scale : 1;
    }
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.closest('[data-canvas-chrome], .react-flow__minimap')) {
      return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
    }
    return { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON: () => ({}) };
  });
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
    expect(content().contains(editor())).toBe(true);
    expect(editor().querySelectorAll('p').length).toBe(62);
  });

  it('选中时“添加到对话”可达并触发原有回调', async () => {
    const callbacks = await renderText({ selected: true });
    expect(actions()).toContain('添加到对话');
    const button = [...document.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes('添加到对话'))!;
    await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(callbacks.onAddToChat).toHaveBeenCalledWith(TEXT_ID);
  });

  it('双击进入编辑，输入内容经统一通路保存为 Markdown 源', async () => {
    const callbacks = await renderText({ text: '原内容' });
    await startEditing();
    await act(async () => {
      editor().innerHTML = '<p>原内容</p><p>补充的一段</p>';
      editor().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(callbacks.onTextChange).toHaveBeenCalledWith(TEXT_ID, '原内容\n\n补充的一段');
  });

  it('编辑时格式工具栏与节点操作同处一层，不叠成多行', async () => {
    await renderText({ selected: true });
    expect(actions()).toContain('添加到对话');
    expect(actions()).not.toContain('加粗');

    await startEditing();
    await vi.waitFor(() => expect(actions()).toContain('加粗'));
    expect(actions()).toContain('添加到对话');

    await act(async () => {
      editor().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await vi.waitFor(() => expect(actions()).toContain('添加到对话'));
    expect(actions()).not.toContain('加粗');
  });


  it('非编辑态滚轮在正文上平移画布', async () => {
    await renderText({ html: '<p>需要滚动才能读完的正文</p>' });
    const viewportTransform = () =>
      container.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform;
    expect(viewportTransform()).toBe('translate(0px,0px) scale(1)');
    await act(async () => {
      editor().dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    });
    expect(viewportTransform()).toBe('translate(0px,-60px) scale(1)');
  });

  it('编辑态滚轮留在正文内，不平移画布', async () => {
    await renderText({ html: '<p>需要滚动才能读完的正文</p>' });
    await startEditing();
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
    expect(menuItems).toEqual(expect.arrayContaining(['添加到聊天', '创建副本', '粘贴', '删除']));
    const remove = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === '删除')!;
    await act(async () => { remove.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(callbacks.onDelete).toHaveBeenCalledWith(TEXT_ID);
  });
});

describe('Canvas 文本节点标题改名（IKFA8X）', () => {
  function titleInput(): HTMLInputElement | null {
    return title().querySelector('input');
  }

  async function typeTitle(value: string) {
    const input = titleInput()!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function keyOnTitle(key: string, init: KeyboardEventInit = {}) {
    await act(async () => {
      titleInput()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    });
  }

  async function blurTitle() {
    await act(async () => {
      titleInput()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
  }

  async function startRename() {
    await act(async () => {
      title().querySelector('span')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
  }

  it('双击名称原位编辑并带出当前名称', async () => {
    await renderText({ title: '分镜大纲' });
    expect(titleInput()).toBeNull();
    await startRename();
    expect(titleInput()?.value).toBe('分镜大纲');
  });

  it('回车保存去首尾空格后的名称并退出编辑', async () => {
    const callbacks = await renderText({ title: '分镜大纲' });
    await startRename();
    await typeTitle('  终极版大纲  ');
    await keyOnTitle('Enter');
    expect(callbacks.onTitleChange).toHaveBeenCalledWith(TEXT_ID, '终极版大纲');
    expect(titleInput()).toBeNull();
  });

  it('失焦保存名称', async () => {
    const callbacks = await renderText({ title: '分镜大纲' });
    await startRename();
    await typeTitle('新名字');
    await blurTitle();
    expect(callbacks.onTitleChange).toHaveBeenCalledWith(TEXT_ID, '新名字');
    expect(titleInput()).toBeNull();
  });

  it('回车保存后失焦不重复提交', async () => {
    const callbacks = await renderText({ title: '分镜大纲' });
    await startRename();
    await typeTitle('新名字');
    await keyOnTitle('Enter');
    expect(callbacks.onTitleChange).toHaveBeenCalledTimes(1);
  });

  it('Esc 恢复编辑前名称，随后失焦不再保存取消内容', async () => {
    const callbacks = await renderText({ title: '分镜大纲' });
    await startRename();
    await typeTitle('被放弃的名字');
    await keyOnTitle('Escape');
    expect(callbacks.onTitleChange).not.toHaveBeenCalled();
    expect(titleInput()).toBeNull();
    expect(title().textContent).toContain('分镜大纲');
  });

  it('空白或全空格提交保留原名', async () => {
    const callbacks = await renderText({ title: '分镜大纲' });
    await startRename();
    await typeTitle('   ');
    await keyOnTitle('Enter');
    expect(callbacks.onTitleChange).not.toHaveBeenCalled();
    expect(title().textContent).toContain('分镜大纲');
  });

  it('名称未变化时提交不触发回调', async () => {
    const callbacks = await renderText({ title: '分镜大纲' });
    await startRename();
    await keyOnTitle('Enter');
    expect(callbacks.onTitleChange).not.toHaveBeenCalled();
    expect(titleInput()).toBeNull();
  });

  it('100 个字符可保存', async () => {
    const callbacks = await renderText({ title: '分镜大纲' });
    const name = '鲸'.repeat(100);
    await startRename();
    await typeTitle(name);
    await keyOnTitle('Enter');
    expect(callbacks.onTitleChange).toHaveBeenCalledWith(TEXT_ID, name);
  });

  it('101 个字符提示超长：保留编辑内容、不保存、不截断', async () => {
    const callbacks = await renderText({ title: '分镜大纲' });
    const name = '鲸'.repeat(101);
    await startRename();
    await typeTitle(name);
    await keyOnTitle('Enter');
    expect(callbacks.onTitleChange).not.toHaveBeenCalled();
    expect(node().querySelector('[role="alert"]')?.textContent).toContain('100');
    expect(titleInput()?.value).toBe(name);
  });

  it('超长报错后失焦不写入，修正后正常保存', async () => {
    const callbacks = await renderText({ title: '分镜大纲' });
    await startRename();
    await typeTitle('鲸'.repeat(101));
    await blurTitle();
    expect(callbacks.onTitleChange).not.toHaveBeenCalled();
    await typeTitle('修正后的名字');
    await keyOnTitle('Enter');
    expect(callbacks.onTitleChange).toHaveBeenCalledWith(TEXT_ID, '修正后的名字');
    expect(node().querySelector('[role="alert"]')).toBeNull();
  });

  it('中文输入法组合期间的回车不提交', async () => {
    const callbacks = await renderText({ title: '分镜大纲' });
    await startRename();
    await typeTitle('拼音');
    await keyOnTitle('Enter', { isComposing: true });
    expect(callbacks.onTitleChange).not.toHaveBeenCalled();
    expect(titleInput()).not.toBeNull();
    await keyOnTitle('Enter');
    expect(callbacks.onTitleChange).toHaveBeenCalledWith(TEXT_ID, '拼音');
  });

  it('超长标题草稿仅提示，不作为草稿错误阻断画布', async () => {
    const callbacks = await renderText({ title: '分镜大纲' });
    await startRename();
    await typeTitle('鲸'.repeat(101));
    await keyOnTitle('Enter');
    expect(callbacks.onDraftError).not.toHaveBeenCalledWith(TEXT_ID, expect.stringContaining('100'));
  });
});

describe('Canvas 文本节点标题分段缩放', () => {
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
    expect(title().textContent).toContain('文本节点');
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
    expect(title().textContent).toContain('文本节点');
    expect(node().textContent).toContain('组合操作正文');
    expect(actions()).toContain('添加到对话');
  });
});


it('reports invalid text to the canvas and clears the error after correction', async () => {
  const callbacks = await renderText();
  await startEditing();
  await act(async () => {
    editor().textContent = '长'.repeat(100001);
    editor().dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(callbacks.onTextChange).not.toHaveBeenCalled();
  expect(callbacks.onDraftError).toHaveBeenLastCalledWith(TEXT_ID, expect.stringContaining('100000'));
  expect(node().textContent).toContain('草稿已保留');
  await act(async () => {
    editor().textContent = '修正正文';
    editor().dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(callbacks.onDraftError).toHaveBeenLastCalledWith(TEXT_ID, '');
  expect(callbacks.onTextChange).toHaveBeenLastCalledWith(TEXT_ID, '修正正文');
});
