// @vitest-environment jsdom
/* IKFCKS：AudioDialog 新建参考缩略图条——参考音频 chip（点击播放形态）替换为共享参考缩略图、
 *  画布文本卡连线附件以 FileText 缩略图进栏（× 仅断开连线）、@ 与手动 @ 选择同一入口、
 *  生成中只读不渲染 × / @、发送参数回归 */
import { $getRoot } from 'lexical';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioDialog, { type AudioRefItem } from './index';
import type { ImageTextAttachment } from '../ImageDialog';
import { readPromptRefText, typePromptRefText, typePromptRefRaw, promptRefEditorInstance } from '../../testing/promptRefEditor';
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
    expect(onMentionCanvas).not.toHaveBeenCalled();
    expect(readPromptRefText(container)).toBe('音频1');
    expect(container.querySelector('[data-testid=asset-ref-valid]')).not.toBeNull();
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
    await typePromptRefText(container, '生成深夜城市白噪音');
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

 describe('IKFCJG 音频正文引用', () => {
  it('文本附件缩略图 @ 插入真实 text_ref，移除后标签失效并阻发', async () => {
    await renderDialog({ attachments: [TEXT_ATTACHMENT] });
    expect(atButton('旁白文案')).not.toBeNull();
    await act(async () => atButton('旁白文案')!.click());
    expect(readPromptRefText(container)).toBe('文本1');
    await act(async () => root.render(createElement(AudioDialog, { onClose: vi.fn(), onSend: vi.fn(), attachments: [] })));
    expect(readPromptRefText(container)).toContain('已失效');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="audio-send"]')!.disabled).toBe(true);
  });
  it('恢复混排序：DOM 编号正文与发送同源', async () => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    const b = { ...CANVAS_REF, id: 'b', assetId: '602', name: '风声' };
    const onSend = vi.fn();
    await act(async () => root.render(createElement(AudioDialog, {
      onClose: vi.fn(), onSend, initialText: '参考', initialRefs: [CANVAS_REF, b],
      stripOrder: ['media:canvas:b', 'media:canvas:n1'],
      initialDoc: { version: 1, segments: [{ kind: 'asset_ref', asset_id: '601', label: '音频1' }] },
    } as Parameters<typeof AudioDialog>[0])));
    expect(audioThumbs().map(n => n.title)).toEqual(['风声', '雨声白噪音']);
    expect(audioThumbs().map(n => n.querySelector('[data-testid="ref-thumb-badge"]')!.textContent)).toEqual(['1', '2']);
    expect(readPromptRefText(container)).toBe('音频2');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="audio-send"]')!.click());
    expect(onSend.mock.calls[0][2]).toEqual([b, CANVAS_REF]);
    expect(onSend.mock.calls[0][3].segments[0]).toMatchObject({ kind: 'asset_ref', asset_id: '601' });
  });
});

 describe('IKFCJG 真实正文光标引用', () => {
  it('手动 @ 在正文中间原位替换，保留前后文字且不重复附件', async () => {
    await renderDialog();
    // IKFA1J 起 @ 检索直接弹出 AtMentionMenu（经 portal 挂在 body），原「引用画布素材」二级入口已随素材菜单改版移除
    await typePromptRefRaw(container, '前@雨声');
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="at-mention-canvas-item"]')).toBeTruthy());
    const button = [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="at-mention-canvas-item"]')].find(
      (b) => b.textContent === '雨声白噪音',
    )!;
    await act(async () => button.click());
    expect(readPromptRefText(container)).toBe('前音频1');
    expect(audioThumbs()).toHaveLength(1);
  });
  it('本地未落库项没有可插入身份', async () => {
    await renderDialog();
    await act(async () => root.render(createElement(AudioDialog, { onClose: vi.fn(), onSend: vi.fn(), externalPick: { ts: 2, item: { ...CANVAS_REF, id: 'local', source: 'local', assetId: undefined, name: '本地音频' } } })));
    expect(atButton('本地音频')).toBeNull();
  });
 });

 describe('IKFCJG 缩略图光标插入', () => {
  it('缩略图 @ 在中间光标插入，保留后文', async () => {
    await renderDialog();
    await typePromptRefText(container, '前后');
    await act(async () => promptRefEditorInstance(container).update(() => { $getRoot().getAllTextNodes()[0].select(1, 1); }));
    await act(async () => atButton('雨声白噪音')!.click());
    expect(readPromptRefText(container)).toBe('前音频1后');
  });
});

 describe('IKFCJG 画布列表选择身份', () => {
  it('从面板画布列表选择已落库音频后能插入正文标签', async () => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(createElement(AudioDialog, { onClose: vi.fn(), onSend: vi.fn(), canvasMedia: [{ id: 'n1', src: CANVAS_REF.src, name: '雨声', mediaType: 'audio', assetId: '601' }] } as Parameters<typeof AudioDialog>[0])));
    await act(async () => container.querySelector<HTMLButtonElement>('[title="添加参考音频（最多 3 段）"]')!.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '从画布选择')!.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '雨声')!.click());
    expect(atButton('雨声')).not.toBeNull();
    await act(async () => atButton('雨声')!.click());
    expect(readPromptRefText(container)).toBe('音频1');
  });
});

describe('IKFCJG 异步失效换绑', () => {
  it('失效 A 换绑未加入参考栏的 B：成功后原位替换，下一次手动 @ 不复用旧换绑点', async () => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    const b: AudioRefItem = { ...CANVAS_REF, id: 'b', assetId: '602', name: '风声' };
    const onMentionCanvas = vi.fn();
    const onSend = vi.fn();
    const props = { onClose: vi.fn(), onSend, initialRefs: [CANVAS_REF], initialDoc: {
      version: 1 as const, segments: [{ kind: 'text' as const, text: '前' }, { kind: 'asset_ref' as const, asset_id: '601', label: '音频1' }, { kind: 'text' as const, text: '后' }],
    }, mentionItems: [{ id: 'b', kind: 'audio' as const, name: '风声', assetId: '602', thumbUrl: b.src }], onMentionCanvas };
    await act(async () => root.render(createElement(AudioDialog, props)));
    await act(async () => removeButton('雨声白噪音')!.click());
    await act(async () => container.querySelector<HTMLElement>('[data-testid="asset-ref-invalid"]')!.click());
    const search = document.querySelector<HTMLInputElement>('input[placeholder="搜索"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, '风声');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="at-mention-canvas-item"]')].find(n => n.textContent === '风声')!.click());
    expect(onMentionCanvas).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="asset-ref-invalid"]')).not.toBeNull();
    await act(async () => root.render(createElement(AudioDialog, { ...props, externalPick: { ts: 1, item: b } })));
    expect(readPromptRefText(container)).toBe('前音频1后');
    expect(container.querySelector('[data-testid="asset-ref-invalid"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="audio-send"]')!.disabled).toBe(false);
    await typePromptRefRaw(container, '@风声');
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="at-mention-canvas-item"]')].find(n => n.textContent === '风声')!.click());
    expect(readPromptRefText(container)).toBe('前音频1后音频1');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="audio-send"]')!.click());
    expect(onSend.mock.calls[0][3].segments.filter((s: { kind: string }) => s.kind === 'asset_ref')).toEqual([
      { kind: 'asset_ref', asset_id: '602', label: '音频1' }, { kind: 'asset_ref', asset_id: '602', label: '音频1' },
    ]);
  });
});
