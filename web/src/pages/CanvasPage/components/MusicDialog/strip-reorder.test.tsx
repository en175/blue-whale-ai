// @vitest-environment jsdom
/* IKFCKT：MusicDialog 参考条拖拽换位——面板本地序重排、编号随新序重派生、发送按新序携带 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MusicDialog from './index';
import type { AudioRefItem } from '../AudioDialog';

let root: Root;
let container: HTMLDivElement;

const REF_A: AudioRefItem = { id: 'n1', kind: 'audio', name: '鼓点采样', src: 'https://x/drum.mp3', source: 'canvas', assetId: 501 };
const REF_B: AudioRefItem = { id: 'n2', kind: 'audio', name: '环境音', src: 'https://x/amb.mp3', source: 'canvas', assetId: 502 };

const onSend = vi.fn();

/** 依次注入两个画布参考（externalPick 每次 ts 变化消费一次），返回 onSend 供发送断言 */
async function renderWithRefs() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const props = (ts: number, item: AudioRefItem | null) => createElement(MusicDialog, {
    onClose: () => {},
    onSend,
    canvasMedia: [],
    onSwitchToAudio: () => {},
    externalPick: item ? { ts, item } : null,
  });
  await act(async () => { root.render(props(1, REF_A)); });
  await act(async () => { root.render(props(2, REF_B)); });
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

function dragAndDrop(from: Element, to: Element, half: 'before' | 'after') {
  const x = half === 'before' ? 10 : 90;
  act(() => { from.dispatchEvent(dragEvent('dragstart')); });
  act(() => { to.dispatchEvent(dragEvent('dragover', { clientX: x })); });
  act(() => { to.dispatchEvent(dragEvent('drop', { clientX: x })); });
}

const thumbs = () => Array.from(container.querySelectorAll('[data-testid="music-ref-thumb"]'));
const badgeOf = (el: Element) => el.querySelector('[data-testid="ref-thumb-badge"]')?.textContent;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onSend.mockClear();
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe('MusicDialog 参考条拖拽换位（IKFCKT）', () => {
  it('参考换位：编号角标随新序重派生，发送按新序携带 refs', async () => {
    await renderWithRefs();
    const list = thumbs();
    expect(list.map((el) => el.getAttribute('title'))).toEqual(['鼓点采样', '环境音']);
    expect(list.map(badgeOf)).toEqual(['1', '2']);

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    dragAndDrop(thumbs()[1]!, thumbs()[0]!, 'before');

    // 换位后：环境音=1、鼓点采样=2；标题输入后发送 refs 序随之
    const after = thumbs();
    expect(after.map((el) => el.getAttribute('title'))).toEqual(['环境音', '鼓点采样']);
    expect(after.map(badgeOf)).toEqual(['1', '2']);

    const textarea = container.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(textarea, '轻快的曲风');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[title="发送"]')!.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    const sentRefs = onSend.mock.calls[0]![3] as AudioRefItem[];
    expect(sentRefs.map((r) => r.name)).toEqual(['环境音', '鼓点采样']);
  });
});
