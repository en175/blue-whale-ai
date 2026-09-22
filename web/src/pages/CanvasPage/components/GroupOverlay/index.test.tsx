// @vitest-environment jsdom
/* GroupOverlay 捕获阶段 pointerdown 拦截的放行规则（IKGOQ0 验收报障回归锁）：
   onDown 在 window 捕获阶段把「落点在内容卡盒内、目标不在卡元素上」的按下
   stopPropagation 拦死（防穿透框选）。扩图扩展框与裁切框的手柄命中带都压在
   源图卡盒边界上，落点必在卡盒内——不加放行时拖拽永远启动不了。此处钉死：
   命中 [data-outpaint-frame] / [data-crop-frame] 的按下放行；非豁免目标的
   同位置按下仍被拦。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider, type Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GroupOverlay from './index';

/** 内容卡：盒 (100,100)-(300,300)（flow 坐标；zoom=1、容器在原点时 flow == client） */
const MEDIA_NODE = {
  id: 'm1',
  type: 'mediaNode',
  position: { x: 100, y: 100 },
  measured: { width: 200, height: 200 },
  data: {},
} as Node;

let root: Root;
let container: HTMLDivElement;

/** jsdom 无 PointerEvent 构造器：MouseEvent 补指针属性（OutpaintFrame 测试同做法） */
function pointerDown(x: number, y: number) {
  const event = new MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y,
  });
  Object.defineProperty(event, 'isPrimary', { value: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

async function mountOverlay() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        ReactFlowProvider,
        null,
        createElement(GroupOverlay, {
          nodes: [MEDIA_NODE],
          groups: [],
          onCreateGroup: () => {},
          onUngroup: () => {},
          onDeleteGroup: () => {},
          onDownloadNodes: () => {},
          setNodes: () => {},
        }),
      ),
    );
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // 容器在视口原点：zoom=1 时 flow 坐标 == client 坐标
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900,
    toJSON: () => ({}),
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('GroupOverlay 捕获拦截的覆盖层放行', () => {
  it('按下目标是扩图扩展框（data-outpaint-frame 子树）：放行，不再拦死传播', async () => {
    await mountOverlay();
    const frame = document.createElement('div');
    frame.setAttribute('data-outpaint-frame', '');
    const handle = document.createElement('div');
    frame.appendChild(handle);
    document.body.appendChild(frame);
    let reached = false;
    handle.addEventListener('pointerdown', () => { reached = true; });
    // 落点 (150,150) 在内容卡盒 (100..300, 100..300) 内，目标不在 .react-flow__node 上：
    // 旧逻辑必拦（stopPropagation 于 window 捕获），豁免后须到达手柄
    handle.dispatchEvent(pointerDown(150, 150));
    expect(reached).toBe(true);
    frame.remove();
  });

  it('按下目标是裁切框（data-crop-frame 子树）：放行，不再拦死传播（IKH1WJ）', async () => {
    await mountOverlay();
    const frame = document.createElement('div');
    frame.setAttribute('data-crop-frame', '');
    const handle = document.createElement('div');
    frame.appendChild(handle);
    document.body.appendChild(frame);
    let reached = false;
    handle.addEventListener('pointerdown', () => { reached = true; });
    // 同上：边手柄命中带压在源图卡盒边界上，落点必在卡盒内，不豁免则拖拽永远启动不了
    handle.dispatchEvent(pointerDown(150, 150));
    expect(reached).toBe(true);
    frame.remove();
  });

  it('按下目标是钉屏幕浮层（data-gen-panel-territory 子树）：放行，不再拦死传播（IKHCUA）', async () => {
    await mountOverlay();
    const overlay = document.createElement('div');
    overlay.setAttribute('data-gen-panel-territory', '');
    const button = document.createElement('button');
    overlay.appendChild(button);
    document.body.appendChild(overlay);
    let reached = false;
    button.addEventListener('pointerdown', () => { reached = true; });
    button.dispatchEvent(pointerDown(150, 150));
    expect(reached).toBe(true);
    overlay.remove();
  });

  it('对照：非豁免目标同位置按下仍被拦死（防穿透框选语义不变）', async () => {
    await mountOverlay();
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    let reached = false;
    plain.addEventListener('pointerdown', () => { reached = true; });
    plain.dispatchEvent(pointerDown(150, 150));
    expect(reached).toBe(false);
    plain.remove();
  });
});
