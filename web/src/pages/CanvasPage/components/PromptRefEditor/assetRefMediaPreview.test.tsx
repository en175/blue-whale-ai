// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PromptRefEditor from './index';
import ReplaceRefMenu from './ReplaceRefMenu';
import type { AssetRefMeta } from './AssetRefNode';
import type { PromptDoc } from '@/lib/prompt-doc';
import chipStyles from '../mediaChip.module.css';

vi.mock('@floating-ui/react', () => ({
  FloatingPortal: ({ children }: { children: unknown }) => children,
  autoUpdate: () => () => {},
  flip: () => ({}),
  offset: () => ({}),
  shift: () => ({}),
  useFloating: () => ({
    refs: { setReference: () => {}, setFloating: () => {} },
    floatingStyles: {},
  }),
}));

let root: Root;
let container: HTMLDivElement;

const META: Record<string, AssetRefMeta> = {
  v1: { url: 'https://x/clip.mp4', name: '镜头A', mediaType: 'video' },
  a1: { url: 'https://x/voice.mp3', name: '旁白', mediaType: 'audio' },
  i1: { url: 'https://x/a.png', name: '角色图', mediaType: 'image' },
  t1: { url: 'https://x/note.txt', name: '设定文本', mediaType: 'text' },
};

const DOC: PromptDoc = {
  version: 1,
  segments: [
    { kind: 'text', text: '参考' },
    { kind: 'asset_ref', asset_id: 'v1', label: '视频1' },
    { kind: 'asset_ref', asset_id: 'a1', label: '音频1' },
    { kind: 'asset_ref', asset_id: 'i1', label: '图片1' },
    { kind: 'asset_ref', asset_id: 't1', label: '文本1' },
  ],
};

async function renderEditor(invalidIds: string[] = []) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(PromptRefEditor, {
      labelOf: (key) => (invalidIds.includes(key.id) ? null : '标签'),
      reconcileKey: `k-${invalidIds.join(',')}`,
      labels: new Map(Object.keys(META).map(id => [id, `${META[id].mediaType}1`])),
      refsMeta: new Map(Object.entries(META)),
      initialDoc: DOC,
      onChange: vi.fn(),
    }));
  });
}

async function renderChipWithMeta(meta: AssetRefMeta, id = 'x1'): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(PromptRefEditor, {
      labelOf: () => '标签',
      reconcileKey: 'k2',
      labels: new Map([[id, '素材1']]),
      refsMeta: new Map([[id, meta]]),
      initialDoc: { version: 1, segments: [{ kind: 'asset_ref', asset_id: id, label: '素材1' }] },
      onChange: vi.fn(),
    }));
  });
  const chip = container.querySelector<HTMLElement>('[data-testid="asset-ref-valid"]');
  expect(chip).toBeTruthy();
  return chip!;
}

function chipOf(assetId: string): HTMLElement {
  const chips = [...container.querySelectorAll<HTMLElement>('[data-testid="asset-ref-valid"]')];
  const chip = chips.find(el => el.title === META[assetId].name || el.textContent?.includes(`${META[assetId].mediaType}1`));
  expect(chip).toBeTruthy();
  return chip!;
}

async function hover(chip: HTMLElement) {
  await act(async () => chip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
}

async function leave(chip: HTMLElement) {
  await act(async () => chip.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
}

const waitPreviewDelay = () => new Promise(resolve => setTimeout(resolve, 170));

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('IKGABW 生成面板素材标签缩略图（有效标签）', () => {
  it('视频标签渲染 <video preload="metadata"> 首帧缩略图，挂共享缩略图类', async () => {
    await renderEditor();
    const video = chipOf('v1').querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.getAttribute('src')).toBe('https://x/clip.mp4');
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect((video as HTMLVideoElement).muted).toBe(true);
    expect(video?.classList.contains(chipStyles.mediaChipThumb)).toBe(true);
  });

  it('音频标签渲染 ♫ 图标占位，挂共享音频图标类', async () => {
    await renderEditor();
    const icon = chipOf('a1').querySelector(`.${chipStyles.mediaChipAudioIcon}`);
    expect(icon).toBeTruthy();
    expect(icon?.textContent).toBe('♫');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(chipOf('a1').querySelector('video')).toBeNull();
  });

  it('图片标签保持 <img> 缩略图（现状回归）', async () => {
    await renderEditor();
    const img = chipOf('i1').querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://x/a.png');
    expect(img?.classList.contains(chipStyles.mediaChipThumb)).toBe(true);
  });

  it('文本附件标签无缩略图（维持文字标签现状）', async () => {
    await renderEditor();
    const chip = chipOf('t1');
    expect(chip.querySelector('img, video')).toBeNull();
    expect(chip.querySelector(`.${chipStyles.mediaChipAudioIcon}`)).toBeNull();
  });

  it('mediaType 未指定按图片渲染缩略图（旧数据零退化）', async () => {
    const chip = await renderChipWithMeta({ url: 'https://x/legacy.png', name: '旧素材' });
    expect(chip.querySelector('img')?.getAttribute('src')).toBe('https://x/legacy.png');
    expect(chip.querySelector('video')).toBeNull();
  });
});

describe('IKGABW 生成面板素材标签悬停预览（同文本卡形态）', () => {
  it('悬停视频标签 150ms 后出预览浮层：静音自动播放视频 + 名称行 + 共享预览类', async () => {
    await renderEditor();
    await hover(chipOf('v1'));
    await act(async () => { await waitPreviewDelay(); });
    const preview = document.querySelector<HTMLElement>('[data-testid="asset-ref-preview"]');
    expect(preview).toBeTruthy();
    expect(preview?.classList.contains(chipStyles.chipPreview)).toBe(true);
    const video = preview?.querySelector('video');
    expect(video?.getAttribute('src')).toBe('https://x/clip.mp4');
    expect((video as HTMLVideoElement).muted).toBe(true);
    expect(video?.hasAttribute('autoplay')).toBe(true);
    expect(video?.hasAttribute('loop')).toBe(true);
    expect(preview?.textContent).toContain('镜头A');
  });

  it('悬停图片标签出大图预览', async () => {
    await renderEditor();
    await hover(chipOf('i1'));
    await act(async () => { await waitPreviewDelay(); });
    const preview = document.querySelector('[data-testid="asset-ref-preview"]');
    expect(preview?.querySelector('img')?.getAttribute('src')).toBe('https://x/a.png');
    expect(preview?.textContent).toContain('角色图');
  });

  it('悬停音频标签出类型标识与名称（不可试听，无 audio 控件）', async () => {
    await renderEditor();
    await hover(chipOf('a1'));
    await act(async () => { await waitPreviewDelay(); });
    const preview = document.querySelector('[data-testid="asset-ref-preview"]');
    expect(preview?.textContent).toContain('音频');
    expect(preview?.textContent).toContain('旁白');
    expect(preview?.querySelector('audio')).toBeNull();
  });

  it('150ms 内移开不出预览；出预览后移开即关', async () => {
    await renderEditor();
    const chip = chipOf('v1');
    await hover(chip);
    await leave(chip);
    await act(async () => { await waitPreviewDelay(); });
    expect(document.querySelector('[data-testid="asset-ref-preview"]')).toBeNull();

    await hover(chip);
    await act(async () => { await waitPreviewDelay(); });
    expect(document.querySelector('[data-testid="asset-ref-preview"]')).toBeTruthy();
    await leave(chip);
    expect(document.querySelector('[data-testid="asset-ref-preview"]')).toBeNull();
  });

  it('失效标签悬停不出预览（同文本卡契约 §5）', async () => {
    await renderEditor(['v1']);
    const invalid = container.querySelector<HTMLElement>('[data-testid="asset-ref-invalid"]');
    expect(invalid).toBeTruthy();
    await hover(invalid!);
    await act(async () => { await waitPreviewDelay(); });
    expect(document.querySelector('[data-testid="asset-ref-preview"]')).toBeNull();
  });

  it('文本附件标签悬停不出预览（无画面可预览）', async () => {
    await renderEditor();
    await hover(chipOf('t1'));
    await act(async () => { await waitPreviewDelay(); });
    expect(document.querySelector('[data-testid="asset-ref-preview"]')).toBeNull();
  });
});

describe('IKGABW 失效替换菜单视频行补首帧缩略图', () => {
  it('ReplaceRefMenu 视频行渲染 <video preload="metadata">，不再只有类型图标', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(ReplaceRefMenu, {
        items: [
          { assetId: 'v1', url: 'https://x/clip.mp4', name: '镜头A', badge: '视频1', mediaType: 'video' },
          { assetId: 'i1', url: 'https://x/a.png', name: '角色图', badge: '图片1', mediaType: 'image' },
        ],
        onPick: vi.fn(),
      }));
    });
    const video = container.querySelector('[data-testid="replace-ref-item"] video');
    expect(video?.getAttribute('src')).toBe('https://x/clip.mp4');
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect((video as HTMLVideoElement).muted).toBe(true);
  });
});
