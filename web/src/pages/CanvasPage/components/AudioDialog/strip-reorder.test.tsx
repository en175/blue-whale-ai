// @vitest-environment jsdom
/* IKFCKT：AudioDialog 参考栏拖拽换位——参考音频（面板本地序）与文本附件（连入边序）混排统一序列；
   参考音频换位重排本地 refs、文本按新相对序回传 onReorderAttachments；生成中只读禁拖 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioDialog, { type AudioRefItem } from './index';
import type { ImageTextAttachment } from '../ImageDialog';

const fetchGenerationModels = vi.hoisted(() =>
  vi.fn(async () => [
    {
      model_id: 'm-audio',
      provider_id: 'prov',
      model_label: '测试音频模型',
      icon: null,
      supported_sizes: [],
      supported_aspect_ratios: [],
      supported_formats: [],
      supported_durations: { min: 1, max: 120, step: 1 },
      default_size: null,
      default_format: null,
      default_aspect_ratio: null,
      default_duration: null,
      features: {},
      is_default: false,
      version: 1,
      digest: '',
    },
  ]),
);

vi.mock('@/api/generation', () => ({ fetchGenerationModels }));

let root: Root;
let container: HTMLDivElement;

const REF: AudioRefItem = { id: 'n1', kind: 'audio', name: '雨声白噪音', src: 'https://x/rain.mp3', source: 'canvas', assetId: 601 };

const attachment = (nodeId: string, title: string): ImageTextAttachment =>
  ({ nodeId, title, text: `${title}-正文` } as ImageTextAttachment);

interface MountProps {
  attachments?: ImageTextAttachment[];
  onReorderAttachments?: ReturnType<typeof vi.fn>;
  readOnly?: boolean;
}

async function renderDialog(props: MountProps = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(AudioDialog, {
        onClose: () => {},
        onSend: () => {},
        canvasMedia: [],
        externalPick: { ts: 1, item: REF },
        attachments: props.attachments,
        onRemoveAttachment: vi.fn(),
        onReorderAttachments: props.onReorderAttachments,
        draftBinding: props.readOnly
          ? { status: 'generating', onParamsChange: () => {} }
          : undefined,
      }),
    );
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

const audioThumbs = () => Array.from(container.querySelectorAll('[data-testid="audio-ref-thumb"]'));
const textThumbs = () => Array.from(container.querySelectorAll('[data-testid="dock-text-ref"]'));
const badgeOf = (el: Element) => el.querySelector('[data-testid="ref-thumb-badge"]')?.textContent;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe('AudioDialog 参考栏拖拽换位（IKFCKT）', () => {
  it('文本附件换位：onReorderAttachments 携带新 nodeId 序列（音频N/文本N 编号独立）', async () => {
    const onReorderAttachments = vi.fn();
    await renderDialog({
      attachments: [attachment('t1', '文本一'), attachment('t2', '文本二')],
      onReorderAttachments,
    });
    wideRect();
    // 统一序列 [n1, t1, t2]：拖 t2(index 2) 到 t1(index 1) 前半 → 文本 [t2, t1]
    dragAndDrop(textThumbs()[1]!, textThumbs()[0]!, 'before');
    expect(onReorderAttachments).toHaveBeenCalledTimes(1);
    expect(onReorderAttachments).toHaveBeenCalledWith(['t2', 't1']);
  });

  it('混排换位：文本拖到音频之前 → 音频子序不变仅文本重排', async () => {
    const onReorderAttachments = vi.fn();
    await renderDialog({
      attachments: [attachment('t1', '文本一'), attachment('t2', '文本二')],
      onReorderAttachments,
    });
    wideRect();
    // 统一序列 [n1, t1, t2]：拖 t2(index 2) 到 n1(index 0) 前半 → 新统一序 [t2, n1, t1]
    // → 音频 [n1] 不变、文本 [t2, t1]
    dragAndDrop(textThumbs()[1]!, audioThumbs()[0]!, 'before');
    expect(onReorderAttachments).toHaveBeenCalledWith(['t2', 't1']);
    expect([...container.querySelectorAll('[data-testid="audio-ref-thumb"], [data-testid="dock-text-ref"]')].map(el => el.getAttribute('title'))).toEqual(['文本二', REF.name, '文本一']);
    // 音频编号不受文本换位影响（音频N 独立编号）
    expect(badgeOf(audioThumbs()[0]!)).toBe('1');
    expect(textThumbs().map(badgeOf)).toEqual(['1', '2']);
  });

  it('生成中只读：draggable=false 且不换位', async () => {
    const onReorderAttachments = vi.fn();
    await renderDialog({
      attachments: [attachment('t1', '文本一'), attachment('t2', '文本二')],
      onReorderAttachments,
      readOnly: true,
    });
    const thumbs = [...audioThumbs(), ...textThumbs()];
    expect(thumbs.every((el) => el.getAttribute('draggable') === 'false')).toBe(true);
    wideRect();
    dragAndDrop(textThumbs()[1]!, textThumbs()[0]!, 'before');
    expect(onReorderAttachments).not.toHaveBeenCalled();
  });
});
