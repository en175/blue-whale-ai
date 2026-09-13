// @vitest-environment jsdom
/* IKFCKS：MusicDialog 参考音频预览行替换为共享参考缩略图——三态接入面（编号圆钮、
 *  悬停 ×/@、外链注入）、曲风描述 @ 菜单（仅音频可选，选中结果与缩略图 @ 同一入口）、
 *  发送参数回归（refs 随 onSend 透传） */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MusicDialog from './index';
import type { AudioRefItem } from '../AudioDialog';
import type { AtMentionItem } from '../../atMention';

let root: Root;
let container: HTMLDivElement;

const CANVAS_REF: AudioRefItem = {
  id: 'n1',
  kind: 'audio',
  name: '鼓点采样',
  src: 'https://x/drum.mp3',
  source: 'canvas',
  assetId: 501,
};

const MENTION_AUDIO: AtMentionItem = {
  id: 'n2',
  kind: 'audio',
  name: '环境音',
  thumbUrl: 'https://x/amb.mp3',
  assetId: '502',
};

interface MountProps {
  externalPick?: { ts: number; item: AudioRefItem } | null;
  mentionItems?: AtMentionItem[];
  onMentionCanvas?: ReturnType<typeof vi.fn>;
}

async function renderDialog(props: MountProps = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(MusicDialog, {
        onClose: () => {},
        onSend: () => {},
        canvasMedia: [],
        onSwitchToAudio: () => {},
        mentionItems: props.mentionItems ?? [MENTION_AUDIO],
        onMentionCanvas: props.onMentionCanvas,
        externalPick: props.externalPick ?? null,
      }),
    );
  });
}

function thumbs(): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-testid="music-ref-thumb"]'));
}

function removeButton(name: string): HTMLButtonElement | null {
  return container.querySelector(`button[aria-label="移除 ${name}"]`);
}

function atButton(name: string): HTMLButtonElement | null {
  return container.querySelector(`button[aria-label="插入引用 ${name}"]`);
}

/** textarea 原生输入驱动（React onChange 监听 input 事件） */
async function typeText(text: string) {
  const textarea = container.querySelector('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('MusicDialog 参考缩略图条（IKFCKS）', () => {
  it('外部注入的画布参考渲染为共享缩略图：编号圆钮仅数字、无「音频N」文字标签', async () => {
    await renderDialog({ externalPick: { ts: 1, item: CANVAS_REF } });
    const list = thumbs();
    expect(list).toHaveLength(1);
    expect(list[0]!.getAttribute('title')).toBe('鼓点采样');
    const badge = list[0]!.querySelector('[data-testid="ref-thumb-badge"]');
    expect(badge?.textContent).toBe('1');
    // 自绘预览行的「音频·画布」文字标签形态不再出现
    expect(list[0]!.textContent).toBe('1');
  });

  it('× 立即移除面板参考（无确认弹窗），剩余参考紧凑重编号', async () => {
    const second: AudioRefItem = { ...CANVAS_REF, id: 'n9', name: '人声哼唱' };
    const third: AudioRefItem = { ...CANVAS_REF, id: 'n8', name: '合成器垫底' };
    await renderDialog({ externalPick: { ts: 1, item: CANVAS_REF } });
    // externalPick 为 ts 驱动事件：同一挂载连发两次 rerender 注入新对象即逐条消费
    const rerender = (pick: { ts: number; item: AudioRefItem }) =>
      act(async () => {
        root.render(
          createElement(MusicDialog, {
            onClose: () => {},
            onSend: () => {},
            canvasMedia: [],
            onSwitchToAudio: () => {},
            externalPick: pick,
          }),
        );
      });
    await rerender({ ts: 2, item: second });
    await rerender({ ts: 3, item: third });
    expect(thumbs()).toHaveLength(3);
    expect(thumbs()[1]!.querySelector('[data-testid="ref-thumb-badge"]')?.textContent).toBe('2');

    await act(async () => {
      removeButton('鼓点采样')!.click();
    });
    const after = thumbs();
    expect(after).toHaveLength(2);
    // 删除首项后剩余紧凑重编号：人声哼唱 1、合成器垫底 2
    expect(after[0]!.querySelector('[data-testid="ref-thumb-badge"]')?.textContent).toBe('1');
    expect(after[1]!.querySelector('[data-testid="ref-thumb-badge"]')?.textContent).toBe('2');
  });

  it('缩略图 @ 与手动 @ 选择走同一 onMentionCanvas 入口（结果等价：素材项形态一致）', async () => {
    const onMentionCanvas = vi.fn();
    await renderDialog({ externalPick: { ts: 1, item: CANVAS_REF }, onMentionCanvas });
    expect(atButton('鼓点采样')).not.toBeNull();
    await act(async () => {
      atButton('鼓点采样')!.click();
    });
    expect(onMentionCanvas).toHaveBeenCalledTimes(1);
    // audioRefToMentionItem：与手动 @ 菜单选中同一种素材项形态（id/kind/name/thumbUrl/assetId）
    expect(onMentionCanvas).toHaveBeenCalledWith({
      id: 'n1',
      kind: 'audio',
      name: '鼓点采样',
      thumbUrl: 'https://x/drum.mp3',
      assetId: '501',
    });
  });

  it('曲风描述输入 @ 弹出菜单：仅音频可选，选中后剥掉 @ 检索词并回调同一入口', async () => {
    const onMentionCanvas = vi.fn();
    const textItems: AtMentionItem[] = [
      MENTION_AUDIO,
      { id: 't1', kind: 'text', name: '环境音说明文档' },
      { id: 'v1', kind: 'video', name: '环境音视频' },
    ];
    await renderDialog({ mentionItems: textItems, onMentionCanvas });
    await typeText('@环境音');
    // 搜索态菜单：同名文本/视频项被禁用（仅音频可选）
    const rows = Array.from(document.querySelectorAll('button')).filter(
      (b) => b.textContent === '环境音',
    );
    expect(rows.length).toBeGreaterThan(0);
    await act(async () => {
      rows[0]!.click();
    });
    expect(onMentionCanvas).toHaveBeenCalledWith(MENTION_AUDIO);
    const textarea = container.querySelector('textarea')! as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
  });

  it('发送参数回归：refs 随 onSend 透传', async () => {
    const onSend = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(MusicDialog, {
          onClose: () => {},
          onSend,
          canvasMedia: [],
          onSwitchToAudio: () => {},
          externalPick: { ts: 1, item: CANVAS_REF },
        }),
      );
    });
    await typeText('轻快的爵士');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[title="发送"]')!.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    const [text, model, opts, refs] = onSend.mock.calls[0] as unknown as [
      string, string, { instrumental: boolean; speed: number; lyrics: string }, AudioRefItem[],
    ];
    expect(text).toBe('轻快的爵士');
    expect(model).toContain('mock');
    expect(opts.instrumental).toBe(false);
    expect(refs).toEqual([CANVAS_REF]);
  });
});
