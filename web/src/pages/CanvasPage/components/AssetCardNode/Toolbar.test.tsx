// @vitest-environment jsdom
/* IKGYYF 资产卡悬浮工具条（迁出 AssetCardNode、钉屏幕层内容组件 AssetCardToolbar）测试：
   渲染模式沿用 MediaNode/Toolbar.test.tsx（createRoot + act）；
   「唯一选中 + hover」显示门在 NodeFollowToolbar 容器（../NodeFollowToolbar/index.test.tsx
   已覆盖 solo 门），集成级出现时机与屏幕层断言见 ./index.test.tsx；
   本文件覆盖内容构成（卡类型标签 + 添加到对话）、「添加到对话」回调与
   HIDE_ASSET_TOP_BAR 开关行为（assetCardToolbarVisible 纯函数，开关参数化可测隐藏分支）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AssetCardToolbar from './Toolbar';
import { assetCardToolbarVisible } from './toolbarVisibility';
import type { AssetCardNodeData } from './index';
import styles from './index.module.css';

let root: Root;
let mountNode: HTMLDivElement;

interface RenderExtra {
  id?: string;
  /** 故意放宽为 string：脏 kind 降级用例需要绕过类型（运行时水合容错场景） */
  kind?: string;
  data?: Record<string, unknown>;
}

async function renderToolbar(extra?: RenderExtra) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(AssetCardToolbar, {
      id: extra?.id ?? 'asset-node',
      data: { kind: extra?.kind as AssetCardNodeData['kind'], ...extra?.data } as AssetCardNodeData,
    }));
  });
}

function labels() {
  return [...mountNode.querySelectorAll('button')]
    .map((button) => button.textContent?.trim() || button.getAttribute('title') || '');
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.restoreAllMocks();
});

describe('AssetCardToolbar 内容构成（迁移前后一致）', () => {
  it('左侧卡类型标签 + 右侧「添加到对话」按钮', async () => {
    await renderToolbar({ kind: 'style' });
    expect(mountNode.textContent).toContain('风格卡');
    expect(labels()).toEqual(['添加到对话']);
  });

  it('各类型标签取 KIND_META 标题（角色卡/生成卡）', async () => {
    await renderToolbar({ kind: 'character' });
    expect(mountNode.textContent).toContain('角色卡');
    await renderToolbar({ kind: 'generation' });
    expect(mountNode.textContent).toContain('生成卡');
  });

  it('kind 缺失或为脏值时降级自定义卡标题', async () => {
    await renderToolbar({});
    expect(mountNode.textContent).toContain('自定义卡');
    await renderToolbar({ kind: 'legacy-junk' });
    expect(mountNode.textContent).toContain('自定义卡');
  });

  it('topBar 容器底类存在，「添加到对话」为透明底 addToChatBtn 而非胶囊类（IKGZ8B）', async () => {
    await renderToolbar({ kind: 'style' });
    expect(mountNode.querySelector(`.${styles.topBar}`)).not.toBeNull();
    expect(mountNode.querySelector(`.${styles.addToChatBtn}`)).not.toBeNull();
  });

  it('点击「添加到对话」派发 onAddToChat（携带节点 id）', async () => {
    const onAddToChat = vi.fn();
    await renderToolbar({ id: 'asset-1', kind: 'style', data: { onAddToChat } });
    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('button')!.click();
    });
    expect(onAddToChat).toHaveBeenCalledWith('asset-1');
  });
});

describe('assetCardToolbarVisible（HIDE_ASSET_TOP_BAR 开关行为，语义随悬浮化等价迁移）', () => {
  it('当前开关 false：纯资产卡与生成卡都显示', () => {
    expect(assetCardToolbarVisible('style')).toBe(true);
    expect(assetCardToolbarVisible('generation')).toBe(true);
  });

  it('开关 true：纯资产卡隐藏，生成卡不受影响恒显', () => {
    expect(assetCardToolbarVisible('style', true)).toBe(false);
    expect(assetCardToolbarVisible('character', true)).toBe(false);
    expect(assetCardToolbarVisible('generation', true)).toBe(true);
  });

  it('kind 缺省按 custom 判定（脏值不误判为生成卡）', () => {
    expect(assetCardToolbarVisible(undefined, true)).toBe(false);
    expect(assetCardToolbarVisible(undefined)).toBe(true);
  });
});
