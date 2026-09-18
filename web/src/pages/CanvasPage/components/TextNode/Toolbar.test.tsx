// @vitest-environment jsdom
/* IKGYYE 文本卡两条工具栏（格式工具栏 / 操作条）钉屏幕迁移测试：渲染模式沿用
   floatPosition.test.tsx（mock @xyflow/react + createRoot/act 渲染 TextNode）。
   断言口径：两条工具条渲染在钉屏幕层（React Flow domNode = .react-flow 根之下、
   不在节点卡 DOM 内），层根带 data-gen-panel-territory、锚点 = computeFollowAnchorAbove
   换算值；出现时机与迁移前一致（格式栏=编辑聚焦、操作条=唯一选中或悬停卡片、非编辑）；
   按钮构成/顺序/回调不变；编辑态点工具条（焦点移入层内）不触发 blur 退出编辑。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TextNode from './index';
import { computeFollowAnchorAbove } from '../../followDialog';

beforeAll(() => {
  // jsdom 未实现 Range 几何 API 与 execCommand（格式化命令点击路径用）
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = function () { return zeroRect(); };
  }
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = function () { return [] as unknown as DOMRectList; };
  }
  Object.defineProperty(document, 'execCommand', {
    value: vi.fn(() => true),
    configurable: true,
    writable: true,
  });
});

function zeroRect(): DOMRect {
  return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => '' } as DOMRect;
}

/** store 状态（可变：锚定跟随用例直接改写后受控重渲染） */
const storeState = vi.hoisted(() => {
  const nodes = [
    { id: 't1', type: 'textNode', position: { x: 100, y: 200 }, data: {}, selected: false },
    { id: 'm1', type: 'mediaNode', position: { x: 600, y: 0 }, data: { assetId: 'a1', mediaType: 'image', src: 'http://img/m1.png', fileName: '素材图一' }, selected: false },
  ];
  return {
    nodes,
    edges: [] as Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>,
    transform: [0, 0, 1] as [number, number, number],
    width: 1200,
    height: 800,
    /** 钉屏幕层的 portal 目标（.react-flow 根；渲染前由 renderTextNode 注入） */
    domNode: null as HTMLElement | null,
    nodeLookup: new Map(
      nodes.map((n) => [
        n.id,
        {
          ...n,
          selected: false,
          internals: { positionAbsolute: { ...n.position } },
          measured: { width: 360, height: 292 },
        },
      ]),
    ),
  };
});

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  useReactFlow: () => ({ setCenter: vi.fn() }),
}));

let root: Root;
let container: HTMLDivElement;
/** 钉屏幕层宿主（.react-flow 根）：两条工具条应 portal 到这里而不是留在节点卡内 */
let flowRoot: HTMLDivElement;

interface RenderOptions {
  selected?: boolean;
  data?: Record<string, unknown>;
}

async function renderTextNode({ selected = false, data = {} }: RenderOptions = {}) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  flowRoot = document.createElement('div');
  flowRoot.className = 'react-flow';
  document.body.append(flowRoot);
  storeState.domNode = flowRoot;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(TextNode, {
    id: 't1',
    type: 'textNode',
    selected,
    dragging: false,
    zIndex: 1,
    selectable: true,
    deletable: true,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      toolMode: 'select' as const,
      title: '文本节点',
      text: '正文',
      onTextChange: vi.fn(),
      onToast: vi.fn(),
      ...data,
    },
  } as never)));
  return container.querySelector<HTMLElement>('[data-placeholder="输入内容..."]')!;
}

/** 受控重渲染（同 prop 再渲染一次：锚定跟随用例改 storeState 后驱动 selector 重读） */
async function rerenderTextNode({ selected = false, data = {} }: RenderOptions = {}) {
  await act(async () => root.render(createElement(TextNode, {
    id: 't1',
    type: 'textNode',
    selected,
    dragging: false,
    zIndex: 1,
    selectable: true,
    deletable: true,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      toolMode: 'select' as const,
      title: '文本节点',
      text: '正文',
      onTextChange: vi.fn(),
      onToast: vi.fn(),
      ...data,
    },
  } as never)));
}

/** 双击编辑器进入编辑（editing=true → effect 聚焦 → isFocused=true） */
async function enterEditing(editor: HTMLElement) {
  await act(async () => editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
}

/** 悬停卡片（React onMouseEnter 由 mouseover 派生） */
async function hoverCard() {
  const wrapper = container.firstElementChild as HTMLElement;
  await act(async () => wrapper.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
}

async function leaveCard() {
  const wrapper = container.firstElementChild as HTMLElement;
  await act(async () => wrapper.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
}

/** 钉屏幕层根（data-gen-panel-territory 打在层根上） */
function layer(): HTMLElement | null {
  return flowRoot.querySelector<HTMLElement>('[data-gen-panel-territory]');
}

/** 层内按钮 title 序列（divider 为 div 不计入） */
function layerButtonTitles(): string[] {
  return [...(layer()?.querySelectorAll('button[title]') ?? [])].map(b => b.getAttribute('title')!);
}

beforeEach(() => {
  storeState.transform = [0, 0, 1];
  storeState.width = 1200;
  // 多选用例会改写 nodes 的 selected 标记，逐用例恢复原始态
  storeState.nodes.forEach((n) => { n.selected = false; });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  flowRoot?.remove();
  storeState.domNode = null;
});

describe('IKGYYE 钉屏幕层渲染与出现时机', () => {
  it('编辑聚焦：格式工具栏渲染在钉屏幕层（.react-flow 根下、节点卡 DOM 外），锚点=上方锚定换算', async () => {
    const editor = await renderTextNode();
    await enterEditing(editor);
    const bar = layer();
    expect(bar).toBeTruthy();
    expect(bar!.textContent).toContain('添加到对话');
    // 不在节点卡 DOM 内（迁移前渲染在 wrapper 里）
    expect(container.querySelector('[data-gen-panel-territory]')).toBeNull();
    const anchor = computeFollowAnchorAbove({
      nodeX: 100, nodeY: 200, nodeWidth: 360,
      viewport: { x: 0, y: 0, zoom: 1 }, containerWidth: 1200,
    });
    expect(bar!.style.left).toBe(`${anchor.left}px`);
    expect(bar!.style.top).toBe(`${anchor.top}px`);
  });

  it('唯一选中非编辑：操作条渲染在钉屏幕层', async () => {
    await renderTextNode({ selected: true });
    const bar = layer();
    expect(bar).toBeTruthy();
    expect(bar!.textContent).toContain('添加到对话');
    expect(container.querySelector('[data-gen-panel-territory]')).toBeNull();
  });

  it('未选中、非编辑、未悬停：不渲染任何工具条', async () => {
    await renderTextNode();
    expect(layer()).toBeNull();
  });

  it('画布多选（useSoloNodeSelected 抑制）：唯一选中的文本卡也不出操作条', async () => {
    await renderTextNode({ selected: true });
    storeState.nodes = [
      { ...storeState.nodes[0], selected: true },
      { ...storeState.nodes[1], selected: true },
    ];
    await rerenderTextNode({ selected: true });
    expect(layer()).toBeNull();
  });

  it('悬停未选中卡也显示操作条（.wrapper:hover 的 JS 等价），移出后消失', async () => {
    await renderTextNode();
    expect(layer()).toBeNull();
    await hoverCard();
    expect(layer()).toBeTruthy();
    expect(layer()!.textContent).toContain('添加到对话');
    await leaveCard();
    expect(layer()).toBeNull();
  });

  it('互斥（isFocused 优先）：选中且编辑时只出格式工具栏，不出操作条的素材标签控件', async () => {
    const editor = await renderTextNode({ selected: true });
    await enterEditing(editor);
    expect(layer()!.querySelector('button[title="标题1"]')).toBeTruthy();
    expect(layer()!.querySelector('select')).toBeNull();
    expect(layer()!.querySelector('button[title="新增素材标签"]')).toBeNull();
  });
});

describe('格式工具栏（编辑聚焦）', () => {
  it('按钮构成与顺序不变（标题1/2/3、加粗、斜体、有序列表、无序列表、分割线、添加到对话）', async () => {
    const editor = await renderTextNode();
    await enterEditing(editor);
    expect(layerButtonTitles()).toEqual([
      '标题1', '标题2', '标题3', '加粗', '斜体', '有序列表', '无序列表', '分割线', '添加到对话',
    ]);
  });

  it('点击加粗经 execCmd 执行 document.execCommand，编辑态保持（工具栏不消失）', async () => {
    const editor = await renderTextNode();
    await enterEditing(editor);
    await act(async () => layer()!.querySelector<HTMLButtonElement>('button[title="加粗"]')!.click());
    expect(document.execCommand).toHaveBeenCalledWith('bold', false, undefined);
    expect(layer()).toBeTruthy();
    expect(editor.getAttribute('contenteditable')).toBe('true');
  });

  it('点击设置标题执行 formatBlock，编辑态保持', async () => {
    const editor = await renderTextNode();
    await enterEditing(editor);
    await act(async () => layer()!.querySelector<HTMLButtonElement>('button[title="标题2"]')!.click());
    expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, 'h2');
    expect(layer()).toBeTruthy();
  });

  it('「添加到对话」携带节点 id 回调', async () => {
    const onAddToChat = vi.fn();
    const editor = await renderTextNode({ data: { onAddToChat } });
    await enterEditing(editor);
    await act(async () => layer()!.querySelector<HTMLButtonElement>('button[title="添加到对话"]')!.click());
    expect(onAddToChat).toHaveBeenCalledWith('t1');
  });

  it('编辑器 blur 且焦点移入钉屏幕层（relatedTarget 在层内）不退出编辑；blur 到层外才退出', async () => {
    const editor = await renderTextNode();
    await enterEditing(editor);
    // 焦点移到层内按钮（closest 白名单含层根 data-gen-panel-territory）：保持编辑
    const toolbarBtn = layer()!.querySelector<HTMLButtonElement>('button[title="加粗"]')!;
    await act(async () => editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: toolbarBtn })));
    expect(layer()).toBeTruthy();
    expect(editor.getAttribute('contenteditable')).toBe('true');
    // 对照：焦点移到层外：退出编辑，格式工具栏消失
    await act(async () => editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body })));
    expect(layer()).toBeNull();
  });
});

describe('操作条（唯一选中、非编辑）', () => {
  it('普通文本卡：仅「添加到对话」一个按钮', async () => {
    await renderTextNode({ selected: true });
    const buttons = [...(layer()!.querySelectorAll('button, select') ?? [])];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain('添加到对话');
  });

  it('素材标签卡（promptMentions 绑定、非 promptSource）：新增素材标签 select 列画布素材 + 添加到对话', async () => {
    await renderTextNode({
      selected: true,
      data: {
        promptMentions: [],
        promptMaterials: [],
      },
    });
    const select = layer()!.querySelector<HTMLSelectElement>('select[aria-label="新增素材标签"]');
    expect(select).toBeTruthy();
    const options = [...select!.querySelectorAll('option')].map(o => o.textContent);
    expect(options[0]).toBe('新增素材标签');
    expect(options).toContain('素材图一');
    expect(layer()!.textContent).toContain('添加到对话');
  });

  it('点击卡内素材标签后出现「删除标签 #n」（selectedMention 联动）', async () => {
    await renderTextNode({
      selected: true,
      data: {
        text: '素材#1',
        promptMentions: [{ start: 0, end: 4, assetId: 'a1', index: 1 }],
        promptMaterials: [{ assetId: 'a1', mediaType: 'image', url: 'http://img/m1.png', name: '素材图一' }],
      },
    });
    const chip = container.querySelector<HTMLElement>('[data-prompt-index="1"]');
    expect(chip).toBeTruthy();
    await act(async () => chip!.click());
    const delBtn = [...(layer()!.querySelectorAll('button') ?? [])].find(b => b.textContent?.includes('删除标签 #1'));
    expect(delBtn).toBeTruthy();
  });

  it('「添加到对话」携带节点 id 回调', async () => {
    const onAddToChat = vi.fn();
    await renderTextNode({ selected: true, data: { onAddToChat } });
    const btn = [...(layer()!.querySelectorAll('button') ?? [])].find(b => b.textContent?.includes('添加到对话'))!;
    await act(async () => btn.click());
    expect(onAddToChat).toHaveBeenCalledWith('t1');
  });
});

describe('钉屏幕层锚定跟随（IKGYYD 基建 computeFollowAnchorAbove）', () => {
  it('视口平移缩放后层锚点实时重算（zoom 只换算位置，不参与尺寸）', async () => {
    const editor = await renderTextNode({ selected: true });
    await enterEditing(editor);
    storeState.transform = [40, -20, 2];
    await rerenderTextNode({ selected: true });
    void editor;
    const anchor = computeFollowAnchorAbove({
      nodeX: 100, nodeY: 200, nodeWidth: 360,
      viewport: { x: 40, y: -20, zoom: 2 }, containerWidth: 1200,
    });
    expect(layer()!.style.left).toBe(`${anchor.left}px`);
    expect(layer()!.style.top).toBe(`${anchor.top}px`);
  });

  it('操作条抬升量按其条高收紧（非格式栏默认 52）', async () => {
    await renderTextNode({ selected: true });
    const anchor = computeFollowAnchorAbove({
      nodeX: 100, nodeY: 200, nodeWidth: 360,
      viewport: { x: 0, y: 0, zoom: 1 }, containerWidth: 1200,
      toolbarLift: 42,
    });
    expect(layer()!.style.top).toBe(`${anchor.top}px`);
  });
});
