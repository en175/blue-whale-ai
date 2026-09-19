// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageDialog, { type ImageTextAttachment, type UploadedFile } from './index';
import type { ImageMediaRef } from '../../mediaRefs';

/* IKFCKT：ImageDialog 参考栏拖拽换位——统一序列 = 媒体（连线 edgeRefs / 本地 files）+ 文本附件；
   换位后按类型提取新相对序分别落权威源（连线媒体 → onReorderMediaRefs、本地 files → 内部重排、
   文本 → onReorderAttachments），编号角标随新序紧凑重派生；只读态禁拖。 */

const fetchGenerationModels = vi.hoisted(() =>
  vi.fn(async () => [
    {
      model_id: 'm-test',
      provider_id: 'prov',
      model_label: '测试生图模型',
      icon: null,
      supported_sizes: [{ id: '2k', label: '2K' }],
      supported_aspect_ratios: ['1:1'],
      supported_formats: [],
      supported_durations: null,
      default_size: '2k',
      default_format: null,
      default_aspect_ratio: '1:1',
      default_duration: null,
      features: {},
      version: 1,
      digest: '',
    },
  ]),
);

vi.mock('@/api/generation', () => ({ fetchGenerationModels }));

let root: Root;
let container: HTMLDivElement;

interface DialogOptions {
  initialFiles?: UploadedFile[];
  mediaRefs?: ImageMediaRef[];
  attachments?: ImageTextAttachment[];
  onReorderMediaRefs?: ReturnType<typeof vi.fn>;
  onReorderAttachments?: ReturnType<typeof vi.fn>;
  submitting?: boolean;
}

async function renderDialog(opts: DialogOptions = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(ImageDialog, {
        onClose: vi.fn(),
        onSend: vi.fn(),
        initialFiles: opts.initialFiles,
        mediaRefs: opts.mediaRefs,
        attachments: opts.attachments,
        onReorderMediaRefs: opts.onReorderMediaRefs,
        onReorderAttachments: opts.onReorderAttachments,
        draftBinding: opts.submitting
          ? { submitting: true, onParamsChange: () => {} }
          : undefined,
      }),
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
}

/** jsdom 无 DragEvent 且 rect 恒 0：手工挂 dataTransfer / clientX，rect 按需 mock 出前/后半落点 */
function dragEvent(type: 'dragstart' | 'dragover' | 'drop', init?: { clientX?: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    dataTransfer: { setData: () => void; effectAllowed: string; dropEffect: string };
    clientX: number;
  };
  event.dataTransfer = { setData: () => {}, effectAllowed: '', dropEffect: '' };
  event.clientX = init?.clientX ?? 0;
  return event;
}

/** 让目标项宽度 100、左缘 0：clientX<50 落前半、≥50 落后半 */
function wideRect() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

function dragAndDrop(from: Element, to: Element, half: 'before' | 'after') {
  act(() => { from.dispatchEvent(dragEvent('dragstart')); });
  act(() => { to.dispatchEvent(dragEvent('dragover', { clientX: half === 'before' ? 10 : 90 })); });
  act(() => { to.dispatchEvent(dragEvent('drop', { clientX: half === 'before' ? 10 : 90 })); });
}

const mediaThumbs = () => [...container.querySelectorAll('[data-testid="dock-media-ref"], [data-testid="ref-thumb"]')]
  .filter((el) => el.getAttribute('data-testid') !== 'dock-text-ref');
const textThumbs = () => [...container.querySelectorAll('[data-testid="dock-text-ref"]')];
const badgeOf = (el: Element) => el.querySelector('[data-testid="ref-thumb-badge"]')?.textContent;
const file = (id: string, name: string): UploadedFile => ({ id, type: 'image', url: `https://x/${id}.png`, name } as UploadedFile);
const attachment = (nodeId: string, title: string): ImageTextAttachment => ({ nodeId, title, text: `${title}-正文`, isPromptPlan: false } as ImageTextAttachment);

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe('ImageDialog 参考栏拖拽换位（IKFCKT）', () => {
  it('连线模式媒体换位：onReorderMediaRefs 携带新边序（编号=边序派生）', async () => {
    const onReorderMediaRefs = vi.fn();
    await renderDialog({
      mediaRefs: [
        { nodeId: 'n1', assetId: 'a1', url: 'https://x/1.png', name: '图一' },
        { nodeId: 'n2', assetId: 'a2', url: 'https://x/2.png', name: '图二' },
      ],
      onReorderMediaRefs,
    });
    const thumbs = mediaThumbs();
    expect(thumbs).toHaveLength(2);
    wideRect();
    dragAndDrop(thumbs[1]!, thumbs[0]!, 'before');
    expect(onReorderMediaRefs).toHaveBeenCalledTimes(1);
    expect(onReorderMediaRefs).toHaveBeenCalledWith(['n2', 'n1']);
    expect(mediaThumbs().map(badgeOf)).toEqual(['1', '2']);
  });

  it('本地模式媒体换位：files 内部重排，编号角标随新序紧凑重派生', async () => {
    await renderDialog({ initialFiles: [file('f1', '甲'), file('f2', '乙'), file('f3', '丙')] });
    const thumbs = () => mediaThumbs();
    expect(thumbs().map((el) => el.getAttribute('title'))).toEqual(['甲', '乙', '丙']);
    expect(thumbs().map(badgeOf)).toEqual(['1', '2', '3']);
    wideRect();
    dragAndDrop(thumbs()[0]!, thumbs()[2]!, 'after');
    expect(thumbs().map((el) => el.getAttribute('title'))).toEqual(['乙', '丙', '甲']);
    expect(thumbs().map(badgeOf)).toEqual(['1', '2', '3']);
  });

  it('文本附件换位：onReorderAttachments 携带新 nodeId 序列（顺序即拼接顺序）', async () => {
    const onReorderAttachments = vi.fn();
    await renderDialog({
      attachments: [attachment('t1', '文本一'), attachment('t2', '文本二'), attachment('t3', '文本三')],
      onReorderAttachments,
    });
    wideRect();
    const thumbs = textThumbs();
    dragAndDrop(thumbs[2]!, thumbs[0]!, 'before');
    expect(onReorderAttachments).toHaveBeenCalledTimes(1);
    expect(onReorderAttachments).toHaveBeenCalledWith(['t3', 't1', 't2']);
  });

  it('混排换位：文本拖到媒体之前 → 媒体子序不变仅文本重排（编号按类型独立）', async () => {
    const onReorderMediaRefs = vi.fn();
    const onReorderAttachments = vi.fn();
    await renderDialog({
      mediaRefs: [
        { nodeId: 'n1', assetId: 'a1', url: 'https://x/1.png', name: '图一' },
        { nodeId: 'n2', assetId: 'a2', url: 'https://x/2.png', name: '图二' },
      ],
      attachments: [attachment('t1', '文本一'), attachment('t2', '文本二')],
      onReorderMediaRefs,
      onReorderAttachments,
    });
    wideRect();
    // 统一序列 [n1, n2, t1, t2]：拖 t2(index 3) 到 n1(index 0) 前半 → 新统一序 [t2, n1, n2, t1]
    // → 媒体 [n1, n2] 不变、文本 [t2, t1] 重排
    dragAndDrop(textThumbs()[1]!, mediaThumbs()[0]!, 'before');
    expect(onReorderMediaRefs).not.toHaveBeenCalled();
    expect(onReorderAttachments).toHaveBeenCalledTimes(1);
    expect(onReorderAttachments).toHaveBeenCalledWith(['t2', 't1']);
  });

  it('跨类型拖拽真正改变 DOM，且可拖回原位', async () => {
    await renderDialog({ mediaRefs: [{ nodeId: 'same', assetId: 'a1', url: 'https://x/1.png', name: '图片A' }], attachments: [attachment('same', '文本B')] });
    const order = () => [...container.querySelectorAll('[data-testid="dock-media-ref"], [data-testid="dock-text-ref"]')].map(el => el.getAttribute('title'));
    wideRect();
    dragAndDrop(textThumbs()[0]!, mediaThumbs()[0]!, 'before');
    expect(order()).toEqual(['文本B', '图片A']);
    dragAndDrop(textThumbs()[0]!, mediaThumbs()[0]!, 'after');
    expect(order()).toEqual(['图片A', '文本B']);
  });

  it('生成中只读态：draggable=false，拖拽不换位', async () => {
    await renderDialog({
      initialFiles: [file('f1', '甲'), file('f2', '乙')],
      submitting: true,
    });
    const thumbs = mediaThumbs();
    expect(thumbs.every((el) => el.getAttribute('draggable') === 'false')).toBe(true);
    wideRect();
    dragAndDrop(thumbs[0]!, thumbs[1]!, 'after');
    expect(mediaThumbs().map((el) => el.getAttribute('title'))).toEqual(['甲', '乙']);
  });
});
