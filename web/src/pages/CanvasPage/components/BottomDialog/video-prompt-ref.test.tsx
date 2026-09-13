// @vitest-environment jsdom
/* IKFA1O：BottomDialog 生视频正文素材标签——多媒体索引/首尾帧角色/模式失效/发送携带 prompt_doc */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BottomDialog from './index';
import type { VideoMediaRef, VideoMediaRefs } from '../../videoMediaRefs';
import type { PromptDoc } from '@/lib/prompt-doc';
import { readPromptRefText, typePromptRefRaw } from '../../testing/promptRefEditor';

const fetchGenerationModels = vi.hoisted(() =>
  vi.fn(async () => [
    {
      model_id: 'seedance-2',
      provider_id: 'prov',
      model_label: '测试生视频模型',
      icon: null,
      supported_sizes: [{ id: '1080p', label: '1080P', api_value: '1080p' }],
      supported_aspect_ratios: ['16:9'],
      supported_formats: [],
      supported_durations: { min: 5, max: 5, step: 5 },
      default_size: '1080p',
      default_format: null,
      default_aspect_ratio: '16:9',
      default_duration: 5,
      features: { reference_image: true, max_reference_images: 9, first_frame: true, last_frame: true, first_last_frame: true },
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
  enabledModes?: string[];
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
      createElement(BottomDialog, {
        onClose: vi.fn(),
        onSend,
        initialDoc: opts.initialDoc ?? null,
        initialParams: opts.initialParams ?? { mode: 'all' },
        enabledModes: opts.enabledModes as never,
        videoDraftBinding: { onParamsChange },
        videoMediaRefs: opts.videoMediaRefs ?? { reference: [] },
      } as Parameters<typeof BottomDialog>[0]),
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生视频模型'));
  return { onSend, onParamsChange };
}

async function rerender(opts: RenderOpts = {}) {
  await act(async () => {
    root.render(
      createElement(BottomDialog, {
        onClose: vi.fn(),
        onSend: vi.fn(),
        initialDoc: opts.initialDoc ?? null,
        enabledModes: opts.enabledModes as never,
        videoDraftBinding: { onParamsChange: opts.onParamsChange ?? vi.fn() },
        videoMediaRefs: opts.videoMediaRefs ?? { reference: [] },
      } as Parameters<typeof BottomDialog>[0]),
    );
  });
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
      items[1]!.click(); // 选择视频参考
    });
    expect(readPromptRefText(container)).toBe('结合视频1');
  });

  it('IKFCKQ 缩略图 @ 按钮与手动 @ 选择产出同一种素材标签 chip', async () => {
    await renderDialog({ videoMediaRefs: ALL_REFS });
    const atBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="插入引用"]')!;
    await act(async () => { atBtn.click(); });
    // 无记忆光标（未输入过正文）→ 追加末尾，chip 文案与手动 @ 选择一致（首个缩略图为图片1）
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
    await renderDialog({ videoMediaRefs: KEYFRAME_REFS, initialParams: { mode: 'keyframe' } });
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
    await renderDialog({
      videoMediaRefs: { reference: [IMG_A] },
      initialDoc: {
        version: 1,
        segments: [
          { kind: 'text', text: '以' },
          { kind: 'asset_ref', asset_id: '101', label: '图片1' },
          { kind: 'text', text: '为起点' },
        ],
      },
    });
    expect(readPromptRefText(container)).toBe('以图片1为起点');
    // 角色变化：同一身份从普通参考变为首帧 + 模式切 keyframe
    await rerender({ videoMediaRefs: { reference: [], first: IMG_A }, enabledModes: ['keyframe'] });
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('以首帧为起点'));
  });

  it('切换到不兼容模式：标签失效保留原指向并阻止发送（C2）', async () => {
    await renderDialog({
      videoMediaRefs: { reference: [IMG_A, VID_B] },
      initialDoc: {
        version: 1,
        segments: [
          { kind: 'text', text: '参考' },
          { kind: 'asset_ref', asset_id: '301', label: '视频1' },
          { kind: 'text', text: '的运镜' },
        ],
      },
    });
    expect(readPromptRefText(container)).toBe('参考视频1的运镜');
    // enabledModes 自动切到 text2video（视频参考不被接受）
    await rerender({ videoMediaRefs: { reference: [IMG_A, VID_B] }, enabledModes: ['text2video'] });
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('参考已失效：原视频1的运镜'));
    expect(sendButton().disabled).toBe(true);
    expect(container.textContent).toContain('正文有已失效的素材标签');
  });

  it('身份仍在集合但模式仍不兼容：不误恢复（C5）；切回兼容模式才恢复', async () => {
    const invalidDoc: PromptDoc = {
      version: 1,
      segments: [{ kind: 'asset_ref', asset_id: '301', label: '视频1', invalid_label: '视频1' }],
    };
    await renderDialog({ videoMediaRefs: { reference: [IMG_A, VID_B] }, initialParams: { mode: 'text2video' }, initialDoc: invalidDoc });
    expect(readPromptRefText(container)).toBe('已失效：原视频1');
    // 重开仍不兼容 → 保持失效
    await rerender({ videoMediaRefs: { reference: [IMG_A, VID_B] }, enabledModes: ['text2video'] });
    expect(readPromptRefText(container)).toBe('已失效：原视频1');
    // 切回全能参考 → 自动恢复
    await rerender({ videoMediaRefs: { reference: [IMG_A, VID_B] }, enabledModes: ['all'] });
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('视频1'));
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
    // 触发一次编辑（草稿双写发生在编辑时）
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
