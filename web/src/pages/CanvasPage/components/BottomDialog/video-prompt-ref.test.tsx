// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { $getSelection, $isRangeSelection } from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BottomDialog from './index';
import type { VideoMediaRef, VideoMediaRefs } from '../../videoMediaRefs';
import type { PromptDoc } from '@/lib/prompt-doc';
import { collapseCaretAt, promptRefCaretOffset, promptRefEditorInstance, readPromptRefText, typePromptRefRaw, typePromptRefText } from '../../testing/promptRefEditor';

const fetchGenerationModels = vi.hoisted(() =>
  vi.fn(async () => [
    {
      model_id: 'seedance-2',
      provider_id: 'prov',
      model_label: '测试生视频模型',
      icon: null,
      supported_sizes: [{ id: '1080p', label: '1080P', api_value: '1080p' }],
      supported_aspect_ratios: [{ id: '16:9', label: '16:9' }],
      supported_formats: [],
      supported_durations: { min: 5, max: 5, step: 5 },
      default_size: '1080p',
      default_format: null,
      default_aspect_ratio: '16:9',
      default_duration: 5,
      features: { reference_image: true, image_reference_max: 10, first_frame: true, last_frame: true, first_last_frame: true, video_reference: true, video_reference_max: 3, audio_reference: true, audio_reference_max: 3, task_types: { text2video: {}, omni: {}, image_reference: {}, first_frame: {}, first_last_frame: {} } },
      version: 1,
      digest: '',
    },
  ]),
);

vi.mock('@/api/generation', () => ({ fetchGenerationModels }));

const ref = (id: string, mediaType: 'image' | 'video' | 'audio'): VideoMediaRef => ({
  nodeId: `node-${id}`,
  url: `https://x/${id}`,
  name: `素材${id}`,
  assetId: id,
  mediaType,
});

const IMG_A = ref('101', 'image');
const IMG_B = ref('202', 'image');
const VID_B = ref('301', 'video');
const AUD_C = ref('401', 'audio');

const ALL_REFS: VideoMediaRefs = { reference: [IMG_A, VID_B, AUD_C] };
const KEYFRAME_REFS: VideoMediaRefs = { reference: [], first: ref('201', 'image'), last: ref('202', 'image') };

let root: Root;
let container: HTMLDivElement;

interface RenderOpts {
  videoMediaRefs?: VideoMediaRefs;
  initialDoc?: PromptDoc | null;
  initialParams?: { mode?: string };
  onSend?: ReturnType<typeof vi.fn>;
  onParamsChange?: ReturnType<typeof vi.fn>;
}

async function renderDialog(opts: RenderOpts = {}) {
  const onSend = opts.onSend ?? vi.fn();
  const onParamsChange = opts.onParamsChange ?? vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BottomDialog, {
          onClose: vi.fn(),
          onSend,
          initialDoc: opts.initialDoc ?? null,
          initialParams: opts.initialParams ?? { mode: 'omni' },
          videoDraftBinding: { onParamsChange },
          videoMediaRefs: opts.videoMediaRefs ?? { reference: [] },
        } as Parameters<typeof BottomDialog>[0])
      ),
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生视频模型'));
  return { onSend, onParamsChange };
}

async function rerender(opts: RenderOpts = {}) {
  await act(async () => { root.unmount(); });
  container.remove();
  await renderDialog(opts);
}

function sendButton(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('[data-testid="video-send"]')!;
}

function mentionMenuItems(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-testid="mention-ref-item"]')];
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('IKFA1O @ 菜单多媒体索引（A2）', () => {
  it('全能参考模式：图片/视频/音频已引用均可搜索选择，徽标按同类型编号', async () => {
    await renderDialog({ videoMediaRefs: ALL_REFS });
    await typePromptRefRaw(container, '结合@');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    const items = mentionMenuItems();
    expect(items.map((b) => b.textContent)).toEqual(['素材101图片1', '素材301视频1', '素材401音频1']);
    await act(async () => {
      items[1]!.click();
    });
    expect(readPromptRefText(container)).toBe('结合视频1');
  });

  it('IKFCKQ 缩略图 @ 按钮与手动 @ 选择产出同一种素材标签 chip', async () => {
    await renderDialog({ videoMediaRefs: ALL_REFS });
    const atBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="插入引用（优先插入上次 @ 的位置，其次当前光标处，否则追加到正文末尾）"]')!;
    await act(async () => { atBtn.click(); });

    expect(readPromptRefText(container)).toBe('图片1');
    await typePromptRefRaw(container, '结尾');
    expect(readPromptRefText(container)).toBe('图片1结尾');
  });

  it('搜索按名称过滤已引用项', async () => {
    await renderDialog({ videoMediaRefs: ALL_REFS });
    await typePromptRefRaw(container, '@301');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    const items = mentionMenuItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('视频1');
  });

  it('首尾帧模式：帧槽参考显示首帧/尾帧徽标并可插入（C1 前置）', async () => {
    await renderDialog({ videoMediaRefs: KEYFRAME_REFS, initialParams: { mode: 'first_last_frame' } });
    await typePromptRefRaw(container, '从@');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    const items = mentionMenuItems();
    expect(items.map((b) => b.textContent)).toEqual(['素材201首帧', '素材202尾帧']);
    await act(async () => {
      items[0]!.click();
    });
    expect(readPromptRefText(container)).toBe('从首帧');
  });
});

describe('IKFA1O 角色与模式同步（C1/C2/C5）', () => {
  it('普通图片参考改为首帧后，正文标签同步为首帧（C1）', async () => {
    const doc: PromptDoc = {
      version: 1,
      segments: [
        { kind: 'text', text: '以' },
        { kind: 'asset_ref', asset_id: '101', label: '图片1' },
        { kind: 'text', text: '为起点' },
      ],
    };
    await renderDialog({ videoMediaRefs: { reference: [IMG_A] }, initialDoc: doc });
    expect(readPromptRefText(container)).toBe('以图片1为起点');
    await rerender({
      videoMediaRefs: { reference: [], first: IMG_A },
      initialParams: { mode: 'first_last_frame' },
      initialDoc: doc,
    });
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('以首帧为起点'));
  });

  it('切到不兼容模式：标签失效保留原指向并阻止发送（C2）', async () => {
    const doc: PromptDoc = {
      version: 1,
      segments: [
        { kind: 'text', text: '参考' },
        { kind: 'asset_ref', asset_id: '202', label: '尾帧' },
        { kind: 'text', text: '的运镜' },
      ],
    };
    const frames = { reference: [], first: IMG_A, last: IMG_B };
    await renderDialog({
      videoMediaRefs: frames,
      initialParams: { mode: 'first_last_frame' },
      initialDoc: doc,
    });
    expect(readPromptRefText(container)).toBe('参考尾帧的运镜');
    await rerender({
      videoMediaRefs: frames,
      initialParams: { mode: 'first_frame' },
      initialDoc: doc,
    });
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('参考已失效：原尾帧的运镜'));
    expect(sendButton().disabled).toBe(true);
    expect(container.textContent).toContain('正文有已失效的素材标签');
  });

  it('身份仍在集合但模式仍不兼容：不误恢复（C5）；切回兼容模式才恢复', async () => {
    const invalidDoc: PromptDoc = {
      version: 1,
      segments: [{ kind: 'asset_ref', asset_id: '202', label: '尾帧', invalid_label: '尾帧' }],
    };
    const frames = { reference: [], first: IMG_A, last: IMG_B };
    await renderDialog({
      videoMediaRefs: frames,
      initialParams: { mode: 'first_frame' },
      initialDoc: invalidDoc,
    });
    expect(readPromptRefText(container)).toBe('已失效：原尾帧');

    await rerender({
      videoMediaRefs: frames,
      initialParams: { mode: 'first_frame' },
      initialDoc: invalidDoc,
    });
    expect(readPromptRefText(container)).toBe('已失效：原尾帧');
    await rerender({
      videoMediaRefs: frames,
      initialParams: { mode: 'first_last_frame' },
      initialDoc: invalidDoc,
    });
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('尾帧'));
  });
});

describe('IKFA1O 发送与草稿（快照/双写）', () => {
  it('携带标签的正文：发送带 prompt_doc 与拍平镜像，草稿双写 prompt+promptDoc', async () => {
    const { onSend, onParamsChange } = await renderDialog({
      videoMediaRefs: ALL_REFS,
      initialDoc: {
        version: 1,
        segments: [
          { kind: 'text', text: '让' },
          { kind: 'asset_ref', asset_id: '101', label: '图片1' },
          { kind: 'text', text: '的人物配合' },
          { kind: 'asset_ref', asset_id: '401', label: '音频1' },
        ],
      },
    });

    await typePromptRefRaw(container, '！');
    await act(async () => {
      sendButton().click();
    });
    await vi.waitFor(() => expect(onSend).toHaveBeenCalled());
    const [text, , doc] = onSend.mock.calls[0]!;
    expect(text).toBe('让图片1的人物配合音频1！');
    expect(doc).toMatchObject({ version: 1 });
    expect((doc as PromptDoc).segments.some((s) => s.kind === 'asset_ref' && s.asset_id === '401')).toBe(true);
    const drafts = onParamsChange.mock.calls.filter((c) => c[0]?.promptDoc !== undefined);
    expect(drafts.length).toBeGreaterThan(0);
    const last = drafts[drafts.length - 1]![0];
    expect(last.prompt).toBe('让图片1的人物配合音频1！');
    expect(last.promptDoc.flat).toBe('让图片1的人物配合音频1！');
  });

  it('纯文本正文：不携带 prompt_doc（沿用旧语义）', async () => {
    const { onSend } = await renderDialog({ initialDoc: null });
    await typePromptRefRaw(container, '普通描述');
    await act(async () => {
      sendButton().click();
    });
    await vi.waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]![2]).toBeNull();
    expect(onSend.mock.calls[0]![0]).toContain('普通描述');
  });
});



describe('IKIQ88 缩略图 @ 光标处插入', () => {
  it('光标置于文本中间：点击缩略图 @ 按钮，chip 插入光标处而非末尾', async () => {
    const { onParamsChange } = await renderDialog({ videoMediaRefs: ALL_REFS });
    await typePromptRefText(container, '让衣服');
    await collapseCaretAt(promptRefEditorInstance(container), 1);
    const atBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title^="插入引用"]')!;
    await act(async () => {
      atBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(readPromptRefText(container)).toBe('让图片1衣服');

    await typePromptRefRaw(container, '！');
    expect(readPromptRefText(container)).toBe('让图片1衣服！');

    const patch = onParamsChange.mock.calls.filter((c) => c[0]?.promptDoc !== undefined).pop()?.[0];
    expect(patch.promptDoc.segments).toEqual([
      { kind: 'text', text: '让' },
      { kind: 'asset_ref', asset_id: '101', label: '图片1' },
      { kind: 'text', text: '衣服！' },
    ]);
  });

  it('未聚焦过输入框：chip 追加末尾，插入后编辑器聚焦、光标落在 chip 之后', async () => {
    await renderDialog({ videoMediaRefs: ALL_REFS });
    (document.activeElement as HTMLElement | null)?.blur?.();
    const atBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title^="插入引用"]')!;
    await act(async () => {
      atBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(readPromptRefText(container)).toBe('图片1');

    await vi.waitFor(() => {
      expect(document.activeElement?.hasAttribute('contenteditable')).toBe(true);
    });

    await typePromptRefRaw(container, '尾巴');
    expect(readPromptRefText(container)).toBe('图片1尾巴');
  });
});

describe('IKFXOR @ 菜单关闭后的焦点与光标', () => {
  it('Esc 取消：菜单关闭、焦点回编辑器、光标落 @ 后可继续打字', async () => {
    await renderDialog({ videoMediaRefs: ALL_REFS });
    await typePromptRefRaw(container, '让@猫');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    const editor = promptRefEditorInstance(container);
    const focusSpy = vi.spyOn(editor, 'focus');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeNull());
    expect(focusSpy).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(promptRefCaretOffset(container)).toBe(3));
    await act(async () => {
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) sel.insertRawText('!');
      });
    });
    expect(readPromptRefText(container)).toBe('让@猫!');
  });

  it('点菜单外关闭：维持现状不抢编辑器焦点', async () => {
    await renderDialog({ videoMediaRefs: ALL_REFS });
    await typePromptRefRaw(container, '让@猫');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    const editor = promptRefEditorInstance(container);
    const focusSpy = vi.spyOn(editor, 'focus');
    await act(async () => document.body.dispatchEvent(new Event('pointerdown')));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeNull());
    expect(focusSpy).not.toHaveBeenCalled();

    expect(readPromptRefText(container)).toBe('让@猫');
  });
});
