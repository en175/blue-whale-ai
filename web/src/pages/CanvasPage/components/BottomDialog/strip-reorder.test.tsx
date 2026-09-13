// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BottomDialog from './index';
import type { VideoMediaRef, VideoMediaRefs } from '../../videoMediaRefs';
import type { ImageTextAttachment } from '../ImageDialog';

/* IKFCKT：BottomDialog 参考栏拖拽换位——统一序列 = 普通参考 + 文本附件；
   媒体回传 onReorderMediaRefs（nodeId/materialId 混合 key）、文本回传 onReorderAttachments；
   首尾帧角色槽不参与拖拽；生成中只读禁拖。PromptRefEditor 打桩同 videoRefArea。 */

vi.mock('@/api/generation', () => ({
  fetchGenerationModels: vi.fn(async () => []),
}));

vi.mock('../PromptRefEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(function StubPromptRefEditor(
      { onChange }: { onChange?: (doc: { version: number; segments: Array<{ kind: 'text'; text: string }> }) => void },
      ref: React.Ref<unknown>,
    ) {
      useImperativeHandle(ref, () => ({
        insertRefAtMention: () => {},
        consumeMentionForPendingInsert: () => {},
        insertRefAtPending: () => {},
        dismissMention: () => {},
        replaceRefAt: () => {},
        clear: () => {},
      }));
      return createElement('textarea', {
        'data-testid': 'chip-editor',
        onChange: (e: Event) => {
          const value = (e.target as HTMLTextAreaElement).value;
          onChange?.({ version: 1, segments: value ? [{ kind: 'text', text: value }] : [] });
        },
      });
    }),
  };
});

const edgeRef = (id: string): VideoMediaRef => ({
  nodeId: id,
  url: `http://img/${id}.png`,
  name: `图${id}`,
  assetId: `a-${id}`,
  mediaType: 'image',
});

/** 角色库 material 参考（asset- 前缀 materialId；nodeId 与 materialId 同值） */
const materialRef = (id: string): VideoMediaRef => ({
  nodeId: id,
  url: `http://img/${id}.png`,
  name: `角色${id}`,
  assetId: id,
  mediaType: 'image',
  materialId: id,
});

const attachment = (nodeId: string, title: string): ImageTextAttachment =>
  ({ nodeId, title, text: `${title}-正文`, isPromptPlan: false } as ImageTextAttachment);

let root: Root;
let mountNode: HTMLDivElement;

interface RenderOptions {
  mediaRefs?: VideoMediaRefs;
  attachments?: ImageTextAttachment[];
  mode?: 'all' | 'keyframe' | 'prompt';
  status?: 'generating';
  onReorderMediaRefs?: ReturnType<typeof vi.fn>;
  onReorderAttachments?: ReturnType<typeof vi.fn>;
}

async function renderDialog({ mediaRefs, attachments, mode, status, onReorderMediaRefs, onReorderAttachments }: RenderOptions = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(BottomDialog, {
        onClose: vi.fn(),
        initialParams: { mode },
        onSend: vi.fn(),
        onRemoveVideoRef: vi.fn(),
        onRemoveMaterialRef: vi.fn(),
        onReorderMediaRefs,
        onReorderAttachments,
        attachments,
        videoMediaRefs: mediaRefs ?? { reference: [] },
        videoDraftBinding: { status, onParamsChange: vi.fn() },
      }),
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function dragEvent(type: 'dragstart' | 'dragover' | 'drop', init?: { clientX?: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    dataTransfer: { setData: () => void; effectAllowed: string; dropEffect: string };
    clientX: number;
  };
  event.dataTransfer = { setData: () => {}, effectAllowed: '', dropEffect: '' };
  event.clientX = init?.clientX ?? 0;
  return event;
}

function wideRect() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

function dragAndDrop(from: Element, to: Element, half: 'before' | 'after') {
  const x = half === 'before' ? 10 : 90;
  act(() => { from.dispatchEvent(dragEvent('dragstart')); });
  act(() => { to.dispatchEvent(dragEvent('dragover', { clientX: x })); });
  act(() => { to.dispatchEvent(dragEvent('drop', { clientX: x })); });
}

const refThumbs = () => [...mountNode.querySelectorAll('[data-testid="dock-video-ref"]')];
const textThumbs = () => [...mountNode.querySelectorAll('[data-testid="dock-text-ref"]')];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) act(() => root.unmount());
  mountNode?.remove();
  vi.restoreAllMocks();
});

describe('BottomDialog 参考栏拖拽换位（IKFCKT）', () => {
  it('普通参考换位：onReorderMediaRefs 携带新 key 序（边项 nodeId）', async () => {
    const onReorderMediaRefs = vi.fn();
    await renderDialog({
      mediaRefs: { reference: [edgeRef('r1'), edgeRef('r2'), edgeRef('r3')] },
      onReorderMediaRefs,
    });
    wideRect();
    const thumbs = refThumbs();
    expect(thumbs).toHaveLength(3);
    dragAndDrop(thumbs[2]!, thumbs[0]!, 'before');
    expect(onReorderMediaRefs).toHaveBeenCalledTimes(1);
    expect(onReorderMediaRefs).toHaveBeenCalledWith(['r3', 'r1', 'r2']);
  });

  it('material 参考换位：key 为 materialId（与边项混合序列中保序提取）', async () => {
    const onReorderMediaRefs = vi.fn();
    await renderDialog({
      mediaRefs: { reference: [edgeRef('r1'), edgeRef('r2'), materialRef('asset-9')] },
      onReorderMediaRefs,
    });
    wideRect();
    const thumbs = refThumbs();
    // 统一序列 [r1, r2, asset-9]：拖 material 项到最前 → 新 key 序 [asset-9, r1, r2]
    dragAndDrop(thumbs[2]!, thumbs[0]!, 'before');
    expect(onReorderMediaRefs).toHaveBeenCalledWith(['asset-9', 'r1', 'r2']);
  });

  it('文本附件换位：onReorderAttachments 携带新 nodeId 序列', async () => {
    const onReorderAttachments = vi.fn();
    await renderDialog({
      mediaRefs: { reference: [edgeRef('r1')] },
      attachments: [attachment('t1', '文本一'), attachment('t2', '文本二')],
      onReorderAttachments,
    });
    wideRect();
    // 统一序列 [r1, t1, t2]：拖 t2(index 2) 到 t1(index 1) 前半 → 文本 [t2, t1]、媒体不变
    dragAndDrop(textThumbs()[1]!, textThumbs()[0]!, 'before');
    expect(onReorderAttachments).toHaveBeenCalledTimes(1);
    expect(onReorderAttachments).toHaveBeenCalledWith(['t2', 't1']);
  });

  it('首尾帧角色槽不参与拖拽：draggable 缺省 false，文本仍可换位', async () => {
    const onReorderAttachments = vi.fn();
    const first = { ...edgeRef('f'), mediaType: 'image' as const };
    const last = { ...edgeRef('l'), mediaType: 'image' as const };
    await renderDialog({
      mediaRefs: { reference: [], first, last },
      attachments: [attachment('t1', '文本一'), attachment('t2', '文本二')],
      mode: 'keyframe',
      onReorderAttachments,
    });
    const thumbs = refThumbs();
    expect(thumbs).toHaveLength(2);
    // 首帧/尾帧无 dragProps：draggable 不是 true
    expect(thumbs.every((el) => el.getAttribute('draggable') !== 'true')).toBe(true);
    wideRect();
    dragAndDrop(textThumbs()[1]!, textThumbs()[0]!, 'before');
    expect(onReorderAttachments).toHaveBeenCalledWith(['t2', 't1']);
  });

  it('生成中只读：draggable=false 且不换位', async () => {
    const onReorderMediaRefs = vi.fn();
    await renderDialog({
      mediaRefs: { reference: [edgeRef('r1'), edgeRef('r2')] },
      status: 'generating',
      onReorderMediaRefs,
    });
    const thumbs = refThumbs();
    expect(thumbs.every((el) => el.getAttribute('draggable') === 'false')).toBe(true);
    wideRect();
    dragAndDrop(thumbs[0]!, thumbs[1]!, 'after');
    expect(onReorderMediaRefs).not.toHaveBeenCalled();
  });
});
