// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  apiMocks,
  canvasDocMock,
  enableReactActEnvironment,
  flowProps,
  renderPage,
  unmountPage,
} from './testing/canvasPageTestHarness';

/* IKGBPC 撤销快捷键页面级链路：Ctrl/Cmd+Z 回退删除（卡与悬空连线一并恢复）、
   栈走空静默、Shift+Z 走既有重做而非撤销、编辑器/@ 菜单内让位、右键菜单
   撤销/重做项保留且灰态正确。共享夹具见 canvasPageTestHarness（FlowCanvas 等
   协作方打桩透出 props），键盘事件为派发到真实 DOM 的 KeyboardEvent。
   本文件特有：生图模型列表（生成链路初始化用）。 */

/** 默认画布：文本卡 t1/t1b + 成品媒体卡 m1 + 连线 t1→m1、t1b→m1（全部非生成中，不触发轮询）。 */
function seedCanvasDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '雨夜', text: '霓虹' } },
        { id: 't1b', type: 'textNode', position: { x: 0, y: 200 }, data: { title: '雾都', text: '路灯' } },
        {
          id: 'm1',
          type: 'mediaNode',
          position: { x: 300, y: 0 },
          data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '成品图' },
        },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 'm1' },
        { id: 'e2', source: 't1b', target: 'm1' },
      ],
    },
    assets: {},
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

function allNodes(): Node[] {
  return [
    ...flowProps.current.textNodes,
    ...flowProps.current.mediaNodes,
    ...flowProps.current.productNodes,
    ...flowProps.current.assetNodes,
  ];
}

function nodeExists(id: string): boolean {
  return allNodes().some((n) => n.id === id);
}

function edgeExists(id: string): boolean {
  return flowProps.current.edges.some((e: { id: string }) => e.id === id);
}

/** 派发真实 keydown（冒泡 + 可取消），返回事件以断言 defaultPrevented。 */
function pressKey(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const evt = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(evt);
  return evt;
}

async function deleteNodes(ids: string[]) {
  await act(async () => {
    flowProps.current.onDeleteNode(ids);
  });
}

beforeEach(() => {
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
  seedCanvasDoc();
  // 生成链路初始化需要一个可用模型（harness 默认空列表）
  apiMocks.fetchGenerationModels.mockResolvedValue([
    {
      model_id: 'm-test',
      provider_id: 'prov',
      model_label: '测试生图模型',
      icon: null,
      supported_sizes: [{ id: '2k', label: '2K' }],
      supported_aspect_ratios: [{ id: '1:1', label: '1:1' }],
      supported_formats: [],
      supported_durations: null,
      default_size: '2k',
      default_format: null,
      default_aspect_ratio: '1:1',
      default_duration: null,
      features: {
        reference_image: true,
        image_reference_max: 3,
        watermark: false,
        quantity_max: 1,
        sequential_image_generation: false,
        stream: false,
        tools: false,
        first_frame: false,
        last_frame: false,
        first_last_frame: false,
        audio: false,
      },
      is_default: false,
      version: 1,
      digest: '',
    },
  ]);
});

afterEach(async () => {
  await unmountPage();
  document.querySelectorAll('[data-canvas-keyboard-scope="mention"]').forEach((el) => el.remove());
  vi.clearAllMocks();
});

describe('IKGBPC Ctrl/Cmd+Z 回退画布结构操作', () => {
  it('单删媒体卡后按 Cmd+Z：卡与悬空连线一并恢复', async () => {
    await renderPage();
    expect(nodeExists('m1')).toBe(true);

    await deleteNodes(['m1']);
    expect(nodeExists('m1')).toBe(false);
    expect(edgeExists('e1')).toBe(false);
    expect(edgeExists('e2')).toBe(false);

    await act(async () => {
      pressKey({ key: 'z', metaKey: true });
    });
    expect(nodeExists('m1')).toBe(true);
    expect(edgeExists('e1')).toBe(true);
    expect(edgeExists('e2')).toBe(true);
  });

  it('多选删除一次传入全部 id 后按一次 Cmd+Z：全部节点与连线恢复（IKFO73 基线）', async () => {
    await renderPage();

    await deleteNodes(['t1', 't1b', 'm1']);
    expect(nodeExists('t1')).toBe(false);
    expect(nodeExists('t1b')).toBe(false);
    expect(nodeExists('m1')).toBe(false);
    expect(edgeExists('e1')).toBe(false);
    expect(edgeExists('e2')).toBe(false);

    await act(async () => {
      pressKey({ key: 'z', metaKey: true });
    });
    expect(nodeExists('t1')).toBe(true);
    expect(nodeExists('t1b')).toBe(true);
    expect(nodeExists('m1')).toBe(true);
    expect(edgeExists('e1')).toBe(true);
    expect(edgeExists('e2')).toBe(true);
  });

  it('Windows Ctrl+Z 与 macOS Cmd+Z 行为一致', async () => {
    await renderPage();
    await deleteNodes(['m1']);
    expect(nodeExists('m1')).toBe(false);

    await act(async () => {
      pressKey({ key: 'z', ctrlKey: true });
    });
    expect(nodeExists('m1')).toBe(true);
    expect(edgeExists('e1')).toBe(true);
  });

  it('撤销栈走空后再按 Cmd+Z：静默无反应', async () => {
    await renderPage();
    await deleteNodes(['m1']);
    await act(async () => {
      pressKey({ key: 'z', metaKey: true });
    });
    expect(nodeExists('m1')).toBe(true);

    // 栈已空：再按 Z 不抛错、不改变画布
    await act(async () => {
      pressKey({ key: 'z', metaKey: true });
    });
    expect(nodeExists('m1')).toBe(true);
    expect(nodeExists('t1')).toBe(true);
    expect(edgeExists('e1')).toBe(true);
  });

  it('Cmd+Shift+Z 不触发撤销：走既有重做判定', async () => {
    await renderPage();
    await deleteNodes(['m1']);
    expect(nodeExists('m1')).toBe(false);

    // 删除后 redo 栈为空：Shift+Z 无操作，不产生回退
    await act(async () => {
      pressKey({ key: 'Z', metaKey: true, shiftKey: true });
    });
    expect(nodeExists('m1')).toBe(false);

    // 撤销恢复后 Shift+Z 是既有重做：卡片再度消失（重做方向，非撤销）
    await act(async () => {
      pressKey({ key: 'z', metaKey: true });
    });
    expect(nodeExists('m1')).toBe(true);
    await act(async () => {
      pressKey({ key: 'Z', metaKey: true, shiftKey: true });
    });
    expect(nodeExists('m1')).toBe(false);
  });
});

describe('IKGBPC 让位场景：编辑器与 @ 菜单', () => {
  it('焦点在输入框内时 Cmd+Z 让位浏览器原生撤销：不进画布栈、不 preventDefault', async () => {
    await renderPage();
    await deleteNodes(['m1']);
    expect(nodeExists('m1')).toBe(false);

    const input = document.createElement('input');
    document.body.appendChild(input);
    let evt: KeyboardEvent;
    await act(async () => {
      evt = pressKey({ key: 'z', metaKey: true }, input);
    });
    expect(evt!.defaultPrevented).toBe(false);
    expect(nodeExists('m1')).toBe(false);
    input.remove();
  });

  it('contentEditable 编辑器内 Cmd+Z 同样让位', async () => {
    await renderPage();
    await deleteNodes(['m1']);
    expect(nodeExists('m1')).toBe(false);

    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
    let evt: KeyboardEvent;
    await act(async () => {
      evt = pressKey({ key: 'z', metaKey: true }, editor);
    });
    expect(evt!.defaultPrevented).toBe(false);
    expect(nodeExists('m1')).toBe(false);
    editor.remove();
  });

  it('@ 菜单打开期间 Cmd+Z 不被画布截断；菜单关闭后恢复生效', async () => {
    await renderPage();
    await deleteNodes(['m1']);
    expect(nodeExists('m1')).toBe(false);

    const menu = document.createElement('div');
    menu.setAttribute('data-canvas-keyboard-scope', 'mention');
    document.body.appendChild(menu);

    let evt: KeyboardEvent;
    await act(async () => {
      evt = pressKey({ key: 'z', metaKey: true });
    });
    expect(evt!.defaultPrevented).toBe(false);
    expect(nodeExists('m1')).toBe(false);

    menu.remove();
    await act(async () => {
      pressKey({ key: 'z', metaKey: true });
    });
    expect(nodeExists('m1')).toBe(true);
    expect(edgeExists('e1')).toBe(true);
  });
});

describe('IKGBPC 画布空白右键菜单「撤销/重做」保留且状态正确', () => {
  function menuItem(label: string): HTMLButtonElement {
    return Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label)!;
  }

  async function openPaneMenu() {
    await act(async () => {
      flowProps.current.onPaneContextMenu({ clientX: 10, clientY: 10 });
    });
  }

  it('无操作时两项均灰；删除后撤销可点、重做仍灰；点击撤销恢复；再开后状态互换', async () => {
    await renderPage();
    await openPaneMenu();
    expect(menuItem('撤销').disabled).toBe(true);
    expect(menuItem('重做').disabled).toBe(true);

    // 关菜单 → 删除 → 重开：撤销可点、重做灰
    await act(async () => {
      menuItem('撤销').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await deleteNodes(['m1']);
    await openPaneMenu();
    expect(menuItem('撤销').disabled).toBe(false);
    expect(menuItem('重做').disabled).toBe(true);

    // 点击「撤销」：卡片与连线恢复，菜单关闭
    await act(async () => {
      menuItem('撤销').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(nodeExists('m1')).toBe(true);
    expect(edgeExists('e1')).toBe(true);

    // 重开：撤销灰、重做可点
    await openPaneMenu();
    expect(menuItem('撤销').disabled).toBe(true);
    expect(menuItem('重做').disabled).toBe(false);
  });
});
