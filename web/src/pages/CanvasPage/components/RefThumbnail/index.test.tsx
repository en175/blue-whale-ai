// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RefThumbnail, { INSERT_REF_APPEND_TITLE, INSERT_REF_AT_SELECTION_TITLE, type RefThumbnailKind, type RefThumbnailProps } from './index';
import PromptRefEditor, { type PromptRefEditorHandle } from '../PromptRefEditor';
import { readPromptRefText, typePromptRefRaw, typePromptRefText } from '../../testing/promptRefEditor';

const mockFloatingRefs = vi.hoisted(() => ({
  reference: { current: null as Element | null },
  floating: { current: null as Element | null },
}));

vi.mock('@floating-ui/react', () => ({
  FloatingPortal: ({ children }: { children: unknown }) => children,
  autoUpdate: () => () => {},
  flip: () => ({}),
  offset: () => ({}),
  shift: () => ({}),
  useFloating: () => ({
    refs: {
      reference: mockFloatingRefs.reference,
      floating: mockFloatingRefs.floating,
      setReference: (el: Element | null) => { mockFloatingRefs.reference.current = el; },
      setFloating: (el: Element | null) => { mockFloatingRefs.floating.current = el; },
    },
    floatingStyles: {},
    context: {},
  }),
}));

interface HarnessItem {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'text';
  name: string;
  url?: string;
  text?: string;
  duration?: number;
}

function Harness({ items, editorRef }: {
  items: HarnessItem[];
  editorRef: { current: PromptRefEditorHandle | null };
}) {
  const [list, setList] = useState(items);
  const labels = new Map(list.map((it, i) => [it.id, `图片${i + 1}`] as const));
  return createElement('div', null,
    ...list.map((it, i) => createElement(RefThumbnail, {
      key: it.id,
      kind: it.kind,
      url: it.url,
      name: it.name,
      number: i + 1,
      textPreview: it.kind === 'text' ? it.text : undefined,
      audioDuration: it.kind === 'audio' ? it.duration : undefined,
      onRemove: () => setList((prev) => prev.filter((x) => x.id !== it.id)),
      onInsertRef: () => editorRef.current?.insertRefAtPending({ kind: 'asset_ref', id: it.id }),
    })),
    createElement(PromptRefEditor, {
      ref: editorRef,
      labelOf: (key: { id: string }) => labels.get(key.id) ?? null,
      reconcileKey: list.map((x) => x.id).join(','),
      labels,
      refsMeta: new Map(),
      onChange: () => {},
    }),
  );
}

let root: Root;
let mountNode: HTMLDivElement;

async function renderSingle(props: Partial<RefThumbnailProps> & { kind: RefThumbnailKind }) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(RefThumbnail, { name: '素材', ...props } as RefThumbnailProps));
  });
}

async function renderHarness(items: HarnessItem[], editorRef: { current: PromptRefEditorHandle | null }) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(Harness, { items, editorRef }));
  });
}

function thumb(): HTMLElement {
  return mountNode.querySelector('[data-testid="ref-thumb"]')!;
}

function hoverState(): string | null {
  return thumb().getAttribute('data-hovered');
}

function hover(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
  });
}

function unhover(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
  });
}

function preview(): Element | null {
  return mountNode.querySelector('[data-testid="ref-thumb-preview"]');
}

const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.clearAllMocks();
});

describe('RefThumbnail 三态交互（IKFCKK）', () => {
  it('默认态：编号圆钮仅显示数字，悬停标记关闭', async () => {
    await renderSingle({ kind: 'image', url: 'https://x/a.png', number: 3 });
    expect(hoverState()).toBe('false');
    const badge = mountNode.querySelector('[data-testid="ref-thumb-badge"]');
    expect(badge?.textContent).toBe('3');
    expect(thumb().textContent).toBe('3');
  });

  it('悬停翻转 data-hovered（编号淡出、×/@ 淡入），移出恢复', async () => {
    const onRemove = vi.fn();
    const onInsertRef = vi.fn();
    await renderSingle({ kind: 'image', url: 'https://x/a.png', number: 1, onRemove, onInsertRef });
    const el = thumb();
    hover(el);
    expect(hoverState()).toBe('true');
    unhover(el);
    expect(hoverState()).toBe('false');
  });

  it('悬停满 200ms 浮出放大预览；不足 200ms 不出；移出立即消失', async () => {
    await renderSingle({ kind: 'image', url: 'https://x/a.png', number: 1 });
    const el = thumb();
    await act(async () => {
      hover(el);
      await wait(80);
    });
    expect(preview()).toBeNull();
    await act(async () => {
      await wait(160);
    });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    unhover(el);
    expect(preview()).toBeNull();
  });

  it('预览浮层 pointer-events 穿透，纯展示不拦截鼠标', async () => {
    await renderSingle({ kind: 'image', url: 'https://x/a.png', number: 1 });
    const el = thumb();
    await act(async () => {
      hover(el);
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    expect((preview() as HTMLElement).style.pointerEvents).toBe('none');
  });
});

describe('RefThumbnail 角色徽标（IKFCKQ 视频面板首帧/尾帧）', () => {
  it('badgeText 渲染文字徽标并优先于 number；悬停同样淡出（编号圆钮三态一致）', async () => {
    await renderSingle({ kind: 'image', url: 'https://x/f.png', number: 1, badgeText: '首帧' });
    const badge = mountNode.querySelector('[data-testid="ref-thumb-badge"]');
    expect(badge?.textContent).toBe('首帧');
    const el = thumb();
    hover(el);
    expect(hoverState()).toBe('true');
    unhover(el);
    expect(hoverState()).toBe('false');
  });

  it('badgeText 缺省回退数字圆钮（既有编号口径不变）', async () => {
    await renderSingle({ kind: 'image', url: 'https://x/a.png', number: 2 });
    expect(mountNode.querySelector('[data-testid="ref-thumb-badge"]')?.textContent).toBe('2');
  });
});

describe('RefThumbnail 四类素材预览形态（IKFCKK）', () => {
  it('图片：object-fit contain 静态放大，原始宽高比不裁剪', async () => {
    await renderSingle({ kind: 'image', url: 'https://x/a.png', number: 1 });
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()?.querySelector('img')).toBeTruthy());
    const img = preview()!.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://x/a.png');
    expect(preview()!.querySelectorAll('img')).toHaveLength(1);
  });

  it('视频：autoPlay muted loop，仅预览存续期间挂载', async () => {
    await renderSingle({ kind: 'video', url: 'https://x/clip.mp4', number: 1 });
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()?.querySelector('video')).toBeTruthy());
    const video = preview()!.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('https://x/clip.mp4');
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    unhover(thumb());
    expect(preview()).toBeNull();
    const thumbVideo = mountNode.querySelector('video[src="https://x/clip.mp4"]') as HTMLVideoElement;
    expect(thumbVideo.autoplay).toBe(false);
  });

  it('音频：图标 + 名称 + 时长卡片', async () => {
    await renderSingle({ kind: 'audio', url: 'https://x/a.mp3', name: '旁白音频', number: 1, audioDuration: 95 });
    expect(thumb().querySelector('svg')).toBeTruthy();
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    expect(preview()!.textContent).toContain('旁白音频');
    expect(preview()!.textContent).toContain('1:35');
  });

  it('文本：正文内容卡片', async () => {
    await renderSingle({ kind: 'text', name: '故事文案', number: 1, textPreview: '一只蓝鲸在深海里游' });
    expect(thumb().querySelector('svg')).toBeTruthy();
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    expect(preview()!.textContent).toContain('一只蓝鲸在深海里游');
  });
});

describe('RefThumbnail 文本预览可交互（IKFCX4）', () => {
  it('文本浮层不穿透鼠标（可移入滚动阅读），媒体浮层保持穿透', async () => {
    await renderSingle({ kind: 'text', name: '长文案', number: 1, textPreview: '第一行\n第二行' });
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    expect((preview() as HTMLElement).style.pointerEvents, '文本浮层可交互').not.toBe('none');
    const card = preview()!.firstElementChild as HTMLElement;
    expect(card.className).toContain('textCard');
  });

  it('媒体浮层穿透不回退：移出图标立即关闭', async () => {
    await renderSingle({ kind: 'image', url: 'https://x/a.png', number: 1 });
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    expect((preview() as HTMLElement).style.pointerEvents).toBe('none');
    unhover(thumb());
    expect(preview(), '媒体预览移出立即消失（IKFCJG 穿透规格不变）').toBeNull();
  });

  it('移出图标后关闭延迟内浮层保持；移入浮层取消关闭持续打开', async () => {
    await renderSingle({ kind: 'text', name: '长文案', number: 1, textPreview: '长正文内容' });
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    unhover(thumb());
    await act(async () => {
      await wait(60);
    });
    expect(preview(), '移出图标后短窗内不关闭（给移入浮层留时间）').toBeTruthy();
    hover(preview()!);
    await act(async () => {
      await wait(300);
    });
    expect(preview(), '鼠标在浮层内保持打开').toBeTruthy();
  });

  it('移出图标且未移入浮层，超过延迟后自动关闭', async () => {
    await renderSingle({ kind: 'text', name: '长文案', number: 1, textPreview: '长正文内容' });
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    unhover(thumb());
    await act(async () => {
      await wait(300);
    });
    expect(preview(), '未移入浮层则延迟后关闭').toBeNull();
  });

  it('移出浮层后延迟关闭；浮层移回图标往返不中断阅读', async () => {
    await renderSingle({ kind: 'text', name: '长文案', number: 1, textPreview: '长正文内容' });
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    unhover(thumb());
    hover(preview()!);
    unhover(preview()!);
    hover(thumb());
    await act(async () => {
      await wait(300);
    });
    expect(preview(), '浮层与图标间往返不中断阅读').toBeTruthy();
    unhover(thumb());
    await act(async () => {
      await wait(60);
    });
    expect(preview(), '移出两者后短窗内不关闭').toBeTruthy();
    await act(async () => {
      await wait(300);
    });
    expect(preview(), '移出两者后延迟关闭').toBeNull();
  });
});

describe('RefThumbnail 删除与紧凑重编号（IKFCKK）', () => {
  it('× 立即删除回调，无确认弹窗', async () => {
    const onRemove = vi.fn();
    await renderSingle({ kind: 'image', url: 'https://x/a.png', number: 1, onRemove });
    const removeBtn = mountNode.querySelector<HTMLButtonElement>('button[title="移除"]')!;
    expect(removeBtn).toBeTruthy();
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(mountNode.querySelector('[role="dialog"]')).toBeNull();
  });

  it('删除中间项后剩余项紧凑重编号', async () => {
    const editorRef: { current: PromptRefEditorHandle | null } = { current: null };
    await renderHarness([
      { id: 'a', kind: 'image', name: '甲', url: 'https://x/a.png' },
      { id: 'b', kind: 'image', name: '乙', url: 'https://x/b.png' },
      { id: 'c', kind: 'image', name: '丙', url: 'https://x/c.png' },
    ], editorRef);
    const badges = () => [...mountNode.querySelectorAll('[data-testid="ref-thumb-badge"]')].map((el) => el.textContent);
    expect(badges()).toEqual(['1', '2', '3']);
    const removeBtns = mountNode.querySelectorAll<HTMLButtonElement>('button[title="移除"]');
    await act(async () => {
      removeBtns[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(badges()).toEqual(['1', '2']);
    expect(mountNode.querySelectorAll('[data-testid="ref-thumb"]')).toHaveLength(2);
  });

  it('未提供回调时不渲染 × 与 @ 按钮', async () => {
    await renderSingle({ kind: 'image', url: 'https://x/a.png', number: 1 });
    expect(mountNode.querySelector('button')).toBeNull();
  });
});

describe('RefThumbnail @ 插入两路（IKFCKK）', () => {
  it('无记忆光标：追加到文本末尾，插入后编辑器聚焦、光标落在插入内容之后', async () => {
    const editorRef: { current: PromptRefEditorHandle | null } = { current: null };
    await renderHarness([{ id: 'a', kind: 'image', name: '角色图', url: 'https://x/a.png' }], editorRef);
    await typePromptRefText(mountNode, '开头');
    (document.activeElement as HTMLElement | null)?.blur?.();
    const atBtn = mountNode.querySelector<HTMLButtonElement>('button[title="插入引用"]')!;
    await act(async () => {
      atBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(readPromptRefText(mountNode)).toBe('开头图片1');
    await vi.waitFor(() => {
      expect(document.activeElement?.hasAttribute('contenteditable')).toBe(true);
    });
    await typePromptRefRaw(mountNode, '尾巴');
    expect(readPromptRefText(mountNode)).toBe('开头图片1尾巴');
  });

  it('有记忆光标：@ 引用原位插入在记住的插入点', async () => {
    const editorRef: { current: PromptRefEditorHandle | null } = { current: null };
    await renderHarness([{ id: 'a', kind: 'image', name: '角色图', url: 'https://x/a.png' }], editorRef);
    await typePromptRefText(mountNode, 'AB');
    await typePromptRefRaw(mountNode, '@');
    await act(async () => {
      editorRef.current!.consumeMentionForPendingInsert();
    });
    expect(readPromptRefText(mountNode)).toBe('AB');
    const atBtn = mountNode.querySelector<HTMLButtonElement>('button[title="插入引用"]')!;
    await act(async () => {
      atBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(readPromptRefText(mountNode)).toBe('AB图片1');
    await typePromptRefRaw(mountNode, '尾巴');
    expect(readPromptRefText(mountNode)).toBe('AB图片1尾巴');
  });

  it('IKIPWW insertTitle 覆盖 @ 按钮 hover 与读屏提示（图片/视频面板文案含记忆点与末尾两路）；缺省「插入引用」由上方台架用例覆盖', async () => {
    await renderSingle({
      kind: 'image',
      url: 'https://x/a.png',
      name: '角色图',
      number: 1,
      onInsertRef: () => {},
      insertTitle: INSERT_REF_APPEND_TITLE,
    });
    const atBtn = mountNode.querySelector<HTMLButtonElement>(`button[title="${INSERT_REF_APPEND_TITLE}"]`)!;
    expect(atBtn).toBeTruthy();
    expect(atBtn.getAttribute('aria-label')).toBe(`${INSERT_REF_APPEND_TITLE} 角色图`);
  });

  it('IKIQGU 音频 insertTitle：title 与 aria-label 用「记忆点优先、否则当前光标」文案', async () => {
    await renderSingle({
      kind: 'audio',
      name: '雨声白噪音',
      number: 1,
      onInsertRef: () => {},
      insertTitle: INSERT_REF_AT_SELECTION_TITLE,
    });
    const atBtn = mountNode.querySelector<HTMLButtonElement>(`button[title="${INSERT_REF_AT_SELECTION_TITLE}"]`)!;
    expect(atBtn).toBeTruthy();
    expect(atBtn.getAttribute('aria-label')).toBe(`${INSERT_REF_AT_SELECTION_TITLE} 雨声白噪音`);
  });
});

describe('RefThumbnail 预览关闭新时机（IKIQ89）', () => {
  function mockRects(layout: Map<Element, { left: number; top: number; width: number; height: number }>) {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mock(this: HTMLElement) {
      const rect = layout.get(this);
      const zero = { left: 0, top: 0, width: 0, height: 0 };
      const r = rect ?? zero;
      return {
        left: r.left, top: r.top, width: r.width, height: r.height,
        right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}),
      } as DOMRect;
    });
  }

  function scrollStrip() {
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
  }

  it('预览打开状态下滚动参考栏（指针不动、缩略图移出指针下方）：浮层立即关闭', async () => {
    await renderSingle({ kind: 'image', url: 'https://x/a.png', number: 1 });
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    const restore = mockRects(new Map([[thumb(), { left: 240, top: 12, width: 64, height: 64 }]]));
    scrollStrip();
    expect(preview(), '缩略图离开指针下方即等同移出（媒体预览立即消失）').toBeNull();
    restore.mockRestore();
  });

  it('滚动后指针仍位于缩略图下方：浮层不误关', async () => {
    await renderSingle({ kind: 'image', url: 'https://x/a.png', number: 1 });
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    const restore = mockRects(new Map([[thumb(), { left: -8, top: -8, width: 64, height: 64 }]]));
    scrollStrip();
    expect(preview(), '缩略图仍在指针下方时滚动不关闭').toBeTruthy();
    restore.mockRestore();
  });

  it('文本浮层移入阅读时滚动不误关（IKFCX4 不回退）；指针离开缩略图与浮层后才延迟关闭', async () => {
    await renderSingle({ kind: 'text', name: '长文案', number: 1, textPreview: '长正文内容' });
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    unhover(thumb());
    hover(preview()!);
    const layout = new Map<Element, { left: number; top: number; width: number; height: number }>([
      [thumb(), { left: 240, top: 12, width: 64, height: 64 }],
      [preview()!, { left: -40, top: -40, width: 280, height: 200 }],
    ]);
    const restore = mockRects(layout);
    scrollStrip();
    await act(async () => {
      await wait(300);
    });
    expect(preview(), '移入文本浮层滚动阅读不被滚动关闭').toBeTruthy();
    layout.set(preview()!, { left: 240, top: 300, width: 280, height: 200 });
    scrollStrip();
    await act(async () => {
      await wait(60);
    });
    expect(preview(), '短窗内保持（文本移出延迟语义一致）').toBeTruthy();
    await act(async () => {
      await wait(300);
    });
    expect(preview(), '缩略图与浮层均离开指针下方后延迟关闭').toBeNull();
    restore.mockRestore();
  });

  it('打开计时期间缩略图滚出指针下方：到点不弹出浮层（挂载即命中判定）', async () => {
    await renderSingle({ kind: 'image', url: 'https://x/a.png', number: 1 });
    const restore = mockRects(new Map([[thumb(), { left: 240, top: 12, width: 64, height: 64 }]]));
    await act(async () => {
      hover(thumb());
      await wait(230);
    });
    expect(preview(), '锚点已滚出指针下方仍滞留浮层').toBeNull();
    restore.mockRestore();
  });
});
