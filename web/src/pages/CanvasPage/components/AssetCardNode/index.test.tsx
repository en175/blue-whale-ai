// @vitest-environment jsdom
/* IKGYYF 资产卡顶部操作条悬浮化（迁出文档流、钉屏幕层）集成测试：
   渲染模式沿用 MediaNode/index.test.tsx（ReactFlowProvider + createRoot/act + NodeProps 兜底）；
   钉屏幕层 store 注入沿用 ../NodeFollowToolbar/index.test.tsx（StateInjector 直写
   nodeLookup/transform/width，不依赖真实 ReactFlow 测量）。模拟 CanvasPage 接线
   （整卡 + NodeFollowToolbar 包 AssetCardToolbar 同挂），锁四件事：
   屏幕层渲染（不在节点卡 DOM 内）、悬浮形态（不占文档流）、出现时机
   （唯一选中 / hover / HIDE_ASSET_TOP_BAR 开关现值）、「添加到对话」回调。 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import AssetCardNode, { type AssetCardNodeData } from './index';
import AssetCardToolbar from './Toolbar';
import NodeFollowToolbar from '../NodeFollowToolbar';
import { computeFollowAnchorAbove } from '../../followDialog';
import styles from './index.module.css';

let root: Root;
let mountNode: HTMLDivElement;

function StateInjector({ state }: { state: Record<string, unknown> }) {
  const { setState } = useStoreApi();
  useEffect(() => {
    setState(state as never);
  }, [state, setState]);
  return null;
}

/** 构造注入 store：目标资产卡 asset-1（320×340）+ 可选多选干扰节点 */
function flowState(selected: boolean, extraNodes: Array<{ id: string; selected: boolean }> = []) {
  const mk = (id: string, sel: boolean, x = 100, y = 200): [string, unknown] => [
    id,
    {
      id,
      position: { x, y },
      internals: { positionAbsolute: { x, y }, z: 0 },
      measured: { width: 320, height: 340 },
      selected: sel,
      data: {},
    },
  ];
  const lookup = new Map<string, unknown>([mk('asset-1', selected), ...extraNodes.map((n) => mk(n.id, n.selected, 800))]);
  return {
    nodeLookup: lookup,
    nodes: [{ id: 'asset-1', selected }, ...extraNodes.map((n) => ({ id: n.id, selected: n.selected }))],
    transform: [0, 0, 1],
    width: 1200,
    height: 800,
  };
}

interface RenderExtra {
  selected?: boolean;
  hovered?: boolean;
  /** 故意放宽为 string：脏 kind 降级用例需要绕过类型（运行时水合容错场景） */
  kind?: string;
  data?: Record<string, unknown>;
  extraNodes?: Array<{ id: string; selected: boolean }>;
}

async function renderCard(extra?: RenderExtra) {
  const onAddToChat = vi.fn();
  const onHoverChange = vi.fn();
  const kind = (extra?.kind ?? 'style') as AssetCardNodeData['kind'];
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      <ReactFlowProvider>
        <StateInjector key="state" state={flowState(extra?.selected ?? true, extra?.extraNodes)} />
        <AssetCardNode
          key="card"
          id="asset-1"
          data={{ kind, onAddToChat, onHoverChange, ...extra?.data } as never}
          selected={extra?.selected ?? true}
          type="assetNode"
          dragging={false}
          zIndex={1}
          selectable={true}
          deletable={true}
          draggable={true}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
        <NodeFollowToolbar key="toolbar" nodeId="asset-1" hovered={extra?.hovered ?? false}>
          <AssetCardToolbar id="asset-1" data={{ kind, onAddToChat } as AssetCardNodeData} />
        </NodeFollowToolbar>
      </ReactFlowProvider>,
    );
  });
  return { onAddToChat, onHoverChange };
}

/** 钉屏幕层根（NodeFollowToolbar 容器，data-gen-panel-territory） */
function pinnedLayer(): HTMLElement | null {
  return mountNode.querySelector('[data-gen-panel-territory]');
}

/** 节点卡 DOM（AssetCardNode 根 .wrapper） */
function cardDom(): HTMLElement {
  return mountNode.querySelector(`.${styles.wrapper}`) as HTMLElement;
}

/** jsdom 无 PointerEvent 构造器：MouseEvent 带指针类型触发 React 合成指针事件（仓库测试同做法） */
function pointerOn(target: Element, type: string) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.restoreAllMocks();
});

describe('IKGYYF 资产卡顶部操作条悬浮化（钉屏幕层）', () => {
  it('唯一选中：工具条渲染在钉屏幕层（data-gen-panel-territory 内），不在节点卡 DOM 内', async () => {
    await renderCard({ selected: true });
    expect(pinnedLayer()).toBeTruthy();
    expect(pinnedLayer()!.textContent).toContain('风格卡');
    expect(pinnedLayer()!.textContent).toContain('添加到对话');
    // 卡内不再有顶部操作条（DOM 已迁出节点卡）
    expect(cardDom().textContent).not.toContain('添加到对话');
  });

  it('悬浮形态：不占卡片文档流（卡内无 topBar 元素），钉屏幕层按卡片上方锚定定位', async () => {
    await renderCard({ selected: true });
    expect(cardDom().querySelector(`.${styles.topBar}`)).toBeNull();
    const layer = pinnedLayer()!;
    const anchor = computeFollowAnchorAbove({
      nodeX: 100,
      nodeY: 200,
      nodeWidth: 320,
      viewport: { x: 0, y: 0, zoom: 1 },
      containerWidth: 1200,
    });
    expect(layer.style.left).toBe(`${anchor.left}px`);
    expect(layer.style.top).toBe(`${anchor.top}px`);
  });

  it('未选中且未 hover：不渲染（隐藏时机同迁移前）', async () => {
    await renderCard({ selected: false, hovered: false });
    expect(pinnedLayer()).toBeNull();
  });

  it('hover 未选中：渲染（hover 显示等价原 .wrapper:hover，不受唯一选中门约束）', async () => {
    await renderCard({ selected: false, hovered: true });
    expect(pinnedLayer()).toBeTruthy();
    expect(pinnedLayer()!.textContent).toContain('添加到对话');
  });

  it('多选抑制下 hover 仍显示（hover 语义与选中集合无关，等价原 CSS 口径）', async () => {
    await renderCard({
      selected: true,
      hovered: true,
      extraNodes: [{ id: 'n2', selected: true }],
    });
    expect(pinnedLayer()).toBeTruthy();
  });

  it('生成卡（kind=generation）在钉屏幕层渲染工具条（渲染条件随悬浮化等价迁移）', async () => {
    await renderCard({ selected: true, kind: 'generation' });
    expect(pinnedLayer()!.textContent).toContain('生成卡');
    expect(pinnedLayer()!.textContent).toContain('添加到对话');
  });

  it('点击钉屏幕层「添加到对话」派发 onAddToChat（携带节点 id）', async () => {
    const { onAddToChat } = await renderCard({ selected: true });
    const btn = [...pinnedLayer()!.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === '添加到对话')!;
    await act(async () => {
      btn.click();
    });
    expect(onAddToChat).toHaveBeenCalledWith('asset-1');
  });

  it('指针进入/离开卡上报 onHoverChange（hover 显示的数据来源，JS 指针事件等价原 CSS :hover）', async () => {
    const { onHoverChange } = await renderCard({ selected: false });
    const card = cardDom();
    await act(async () => {
      pointerOn(card, 'pointerover');
    });
    expect(onHoverChange).toHaveBeenCalledWith('asset-1', true);
    await act(async () => {
      pointerOn(card, 'pointerout');
    });
    expect(onHoverChange).toHaveBeenCalledWith('asset-1', false);
  });

  it('卡卸载时上报 hover 清理（节点删除后不留悬空 hover 态）', async () => {
    const { onHoverChange } = await renderCard({ selected: false });
    const card = cardDom();
    await act(async () => {
      pointerOn(card, 'pointerover');
    });
    await act(async () => {
      root.unmount();
    });
    expect(onHoverChange).toHaveBeenLastCalledWith('asset-1', false);
  });
});
