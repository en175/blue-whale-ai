// @vitest-environment jsdom
/* IKFCKS：AudioDialog 新建参考缩略图条——参考音频 chip（点击播放形态）替换为共享参考缩略图、
 *  画布文本卡连线附件以 FileText 缩略图进栏（× 仅断开连线）、@ 与手动 @ 选择同一入口、
 *  生成中只读不渲染 × / @、发送参数回归 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioDialog, { type AudioRefItem } from './index';
import type { ImageTextAttachment } from '../ImageDialog';
import type { AtMentionItem } from '../../atMention';

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

const CANVAS_REF: AudioRefItem = {
  id: 'n1',
  kind: 'audio',
  name: '雨声白噪音',
  src: 'https://x/rain.mp3',
  source: 'canvas',
  assetId: 601,
};

const TEXT_ATTACHMENT: ImageTextAttachment = {
  nodeId: 't1',
  title: '旁白文案',
  text: '夜幕降临，城市渐渐安静下来。',
};

interface MountProps {
  attachments?: ImageTextAttachment[];
  onRemoveAttachment?: ReturnType<typeof vi.fn>;
  onMentionCanvas?: ReturnType<typeof vi.fn>;
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
        externalPick: { ts: 1, item: CANVAS_REF },
        attachments: props.attachments,
        onRemoveAttachment: props.onRemoveAttachment,
        mentionItems: props.onMentionCanvas ? ([] as AtMentionItem[]) : undefined,
        onMentionCanvas: props.onMentionCanvas,
        draftBinding: props.readOnly
          ? { status: 'generating', onParamsChange: () => {} }
          : undefined,
      }),
    );
  });
}

function audioThumbs(): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-testid="audio-ref-thumb"]'));
}

function textThumbs(): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-testid="dock-text-ref"]'));
}

function removeButton(name: string): HTMLButtonElement | null {
  return container.querySelector(`button[aria-label="移除 ${name}"]`);
}

function atButton(name: string): HTMLButtonElement | null {
  return container.querySelector(`button[aria-label="插入引用 ${name}"]`);
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('AudioDialog 参考缩略图条（IKFCKS）', () => {
  it('参考音频渲染为共享缩略图：编号圆钮仅数字，播放 chip（点击播放/常显移除）形态下线', async () => {
    await renderDialog();
    const list = audioThumbs();
    expect(list).toHaveLength(1);
    expect(list[0]!.getAttribute('title')).toBe('雨声白噪音');
    expect(list[0]!.querySelector('[data-testid="ref-thumb-badge"]')?.textContent).toBe('1');
    // 播放按钮不再渲染（放大预览为图标+名称+时长卡片，属 RefThumbnail 组件行为）
    expect(container.querySelector('button[title^="播放"]')).toBeNull();
  });

  it('文本附件进参考栏：FileText 缩略图 + 独立编号，× 仅断开连线（回调 nodeId）', async () => {
    const onRemoveAttachment = vi.fn();
    await renderDialog({ attachments: [TEXT_ATTACHMENT], onRemoveAttachment });
    const list = textThumbs();
    expect(list).toHaveLength(1);
    expect(list[0]!.getAttribute('title')).toBe('旁白文案');
    // 文本附件独立编号（文本N，不与音频参考混排编号）
    expect(list[0]!.querySelector('[data-testid="ref-thumb-badge"]')?.textContent).toBe('1');
    await act(async () => {
      removeButton('旁白文案')!.click();
    });
    expect(onRemoveAttachment).toHaveBeenCalledWith('t1');
  });

  it('缩略图 @ 与手动 @ 选择走同一 onMentionCanvas 入口（结果等价：素材项形态一致）', async () => {
    const onMentionCanvas = vi.fn();
    await renderDialog({ onMentionCanvas });
    expect(atButton('雨声白噪音')).not.toBeNull();
    await act(async () => {
      atButton('雨声白噪音')!.click();
    });
    expect(onMentionCanvas).toHaveBeenCalledTimes(1);
    expect(onMentionCanvas).toHaveBeenCalledWith({
      id: 'n1',
      kind: 'audio',
      name: '雨声白噪音',
      thumbUrl: 'https://x/rain.mp3',
      assetId: '601',
    });
  });

  it('生成中只读：× 与 @ 均不渲染（参考只读展示）', async () => {
    await renderDialog({
      readOnly: true,
      attachments: [TEXT_ATTACHMENT],
      onMentionCanvas: vi.fn(),
    });
    expect(audioThumbs()).toHaveLength(1);
    expect(textThumbs()).toHaveLength(1);
    expect(removeButton('雨声白噪音')).toBeNull();
    expect(removeButton('旁白文案')).toBeNull();
    expect(atButton('雨声白噪音')).toBeNull();
  });

  it('× 移除面板参考后紧凑重编号', async () => {
    const second: AudioRefItem = { ...CANVAS_REF, id: 'n2', name: '风声' };
    await renderDialog();
    await act(async () => {
      root.render(
        createElement(AudioDialog, {
          onClose: () => {},
          onSend: () => {},
          canvasMedia: [],
          externalPick: { ts: 2, item: second },
        }),
      );
    });
    expect(audioThumbs()).toHaveLength(2);
    await act(async () => {
      removeButton('雨声白噪音')!.click();
    });
    const after = audioThumbs();
    expect(after).toHaveLength(1);
    expect(after[0]!.querySelector('[data-testid="ref-thumb-badge"]')?.textContent).toBe('1');
    expect(after[0]!.getAttribute('title')).toBe('风声');
  });

  it('发送参数回归：提示词 + 模型 + 参考随 onSend 透传', async () => {
    const onSend = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(AudioDialog, {
          onClose: () => {},
          onSend,
          canvasMedia: [],
          externalPick: { ts: 1, item: CANVAS_REF },
        }),
      );
    });
    const textarea = container.querySelector('textarea[data-testid="audio-input"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(textarea, '生成深夜城市白噪音');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-testid="audio-send"]')!.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    const [text, modelId, refs] = onSend.mock.calls[0] as unknown as [string, string, AudioRefItem[]];
    expect(text).toBe('生成深夜城市白噪音');
    expect(modelId).toBe('m-audio');
    expect(refs).toEqual([CANVAS_REF]);
  });
});
