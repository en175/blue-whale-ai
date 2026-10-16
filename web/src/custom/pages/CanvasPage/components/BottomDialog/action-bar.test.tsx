// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationModel } from '@/custom/api/generation';
import BottomDialog from './index';
import {
  ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
} from '../AttachmentActionBar';
import barStyles from '../AttachmentActionBar/index.module.css';
import { REF_SOURCE_ENTRY_TITLE } from '../RefSourceMenu';
import dialogStyles from './index.module.css';
import type { VideoMediaRef, VideoMediaRefs } from '../../tools/video/videoMediaRefs';


const fetchGenerationModels = vi.hoisted(() => vi.fn());

vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels }));

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

const baseFeatures = {
  reference_image: true,
  image_reference_max: 10,
  watermark: false,
  quantity_max: 1,
  sequential_image_generation: false,
  stream: false,
  tools: false,
  first_frame: true,
  last_frame: true,
  first_last_frame: true,
  task_types: {
    text2video: {},
    omni: {},
    image_reference: {},
    first_frame: {},
    first_last_frame: {},
  },
  audio: false,
};

const fullModel: GenerationModel = {
  model_id: 'm-full',
  provider_id: 'p',
  model_label: '全能力模型',
  icon: null,
  supported_sizes: [{ id: '720p', label: '720p', api_value: '720p', width: null, height: null }],
  supported_aspect_ratios: [{ id: '16:9', label: '16:9' }],
  supported_formats: ['mp4'],
  supported_durations: { min: 4, max: 15, step: 1 },
  default_size: '720p',
  default_format: 'mp4',
  default_aspect_ratio: '16:9',
  default_duration: 10,
  features: baseFeatures,
  is_default: false,
  version: 1,
  digest: '',
};

const noRefCapModel: GenerationModel = {
  ...fullModel,
  model_id: 'm-noref',
  model_label: '无参考能力模型',
  features: { ...baseFeatures, reference_image: false },
};

const ref = (id: string, mediaType: 'image' | 'video' | 'audio' = 'image'): VideoMediaRef => ({
  nodeId: id,
  url: `http://img/${id}.png`,
  name: `图${id}`,
  assetId: `a-${id}`,
  mediaType,
});

let root: Root;
let container: HTMLDivElement;

interface RenderOptions {
  mediaRefs?: VideoMediaRefs;
  attachments?: Array<{ nodeId: string; title: string; text: string }>;
  mode?: 'omni' | 'first_last_frame' | 'text2video' | 'image_reference';
  status?: 'draft' | 'generating';
  submitting?: boolean;
  pickMode?: 'image' | 'video' | null;
  models?: GenerationModel[];
}

async function renderDialog({ mediaRefs, attachments, mode, status, submitting, pickMode, models }: RenderOptions = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onPickFromCanvas = vi.fn();
  const onPickFromAssets = vi.fn();
  fetchGenerationModels.mockResolvedValue(models ?? [fullModel]);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BottomDialog, {
          onClose: vi.fn(),
          onSend: vi.fn(),
          initialParams: mode ? { mode } : undefined,
          attachments,
          onPickFromCanvas,
          onPickFromAssets,
          pickMode: pickMode ?? null,
          videoMediaRefs: mediaRefs ?? { reference: [] },
          videoDraftBinding: { status, submitting, onParamsChange: vi.fn() },
        })
      ),
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain((models ?? [fullModel])[0]!.model_label));
  return { onPickFromCanvas, onPickFromAssets };
}

const actionBar = () => container.querySelector(`.${barStyles.actionBar}`);
const attachmentStrip = () => container.querySelector(`.${dialogStyles.refSlot}`);
const pickCanvasBtn = () =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '参考')!;
const pickAssetsBtn = () =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '资产库')!;

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe('IKGB7W 操作条渲染与位置（三段布局）', () => {
  it('普通参考模式：操作条为第一行，左「+ 参考」「资产库」pill，右侧并入展开/关闭按钮', async () => {
    await renderDialog({ mode: 'omni' });

    const bar = actionBar()!;
    expect(bar).toBeTruthy();
    const actions = bar.querySelector(`.${barStyles.actions}`)!;
    expect(actions.querySelector(`button[title="${ATTACHMENT_ACTION_PICK_CANVAS_TITLE}"]`)).toBeTruthy();
    expect(actions.querySelector(`button[title="${ATTACHMENT_ACTION_PICK_ASSETS_TITLE}"]`)).toBeTruthy();
    const trailing = bar.querySelector(`.${barStyles.trailing}`)!;
    expect(trailing.querySelector('button[title="展开"]')).toBeTruthy();
    expect(trailing.querySelector('button[title="关闭"]')).toBeTruthy();
    const editor = container.querySelector('[data-testid="chip-editor"]')!;
    expect(bar.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('无普通参考且无文本附件时附件栏整条不渲染（操作条 + 输入框两段）', async () => {
    await renderDialog({ mode: 'omni' });
    expect(attachmentStrip()).toBeNull();
    expect(actionBar()).toBeTruthy();
  });

  it('有普通参考时附件栏出现在操作条与输入框之间；删光后重新隐藏', async () => {
    await renderDialog({ mode: 'omni', mediaRefs: { reference: [ref('m1')] } });

    const bar = actionBar()!;
    const strip = attachmentStrip()!;
    expect(strip).toBeTruthy();
    const editor = container.querySelector('[data-testid="chip-editor"]')!;
    expect(bar.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.textContent).toContain('1/13');

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(BottomDialog, {
            onClose: vi.fn(),
            onSend: vi.fn(),
            initialParams: { mode: 'omni' },
            videoMediaRefs: { reference: [] },
            videoDraftBinding: { onParamsChange: vi.fn() },
          })
        ),
      );
    });
    expect(attachmentStrip()).toBeNull();
    expect(actionBar()).toBeTruthy();
  });

  it('仅文本附件时附件栏同样出现（空态由实际附件项派生）', async () => {
    await renderDialog({ mode: 'omni', attachments: [{ nodeId: 't1', title: '故事文案', text: '一只蓝鲸在海里' }] });
    expect(attachmentStrip()).toBeTruthy();
    expect(attachmentStrip()!.querySelector('[data-testid="dock-text-ref"]')).toBeTruthy();
  });

  it('栏尾旧「+」菜单普通变体退役（任何模式下都不出现）', async () => {
    await renderDialog({ mode: 'omni' });
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('button')].some(
        (b) => b.getAttribute('title') === REF_SOURCE_ENTRY_TITLE,
      ),
    ).toBe(false);
  });
});

describe('IKGB7W 两类点击分派（kind/role 与旧「+」同口径）', () => {
  it('全能参考：「+ 参考」分派 onPickFromCanvas("video","reference")，「资产库」分派 onPickFromAssets 同参', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({ mode: 'omni' });

    await click(pickCanvasBtn());
    expect(onPickFromCanvas).toHaveBeenCalledWith('video', 'reference');
    expect(onPickFromAssets).not.toHaveBeenCalled();

    await click(pickAssetsBtn());
    expect(onPickFromAssets).toHaveBeenCalledWith('video', 'reference');
    expect(onPickFromCanvas).toHaveBeenCalledTimes(1);
  });

  it('图生视频：类型边界仅图片，分派 onPickFromCanvas("image","reference")', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({ mode: 'image_reference', mediaRefs: { reference: [ref('m1')] } });

    await click(pickCanvasBtn());
    expect(onPickFromCanvas).toHaveBeenCalledWith('image', 'reference');
    await click(pickAssetsBtn());
    expect(onPickFromAssets).toHaveBeenCalledWith('image', 'reference');
  });

  it('文生视频保留添加入口（媒体成为参考时自动切全能参考，IKFC1T 口径不变）', async () => {
    const { onPickFromCanvas } = await renderDialog({ mode: 'text2video' });
    await click(pickCanvasBtn());
    expect(onPickFromCanvas).toHaveBeenCalledWith('video', 'reference');
  });

  it('画布点选进行中「+ 参考」高亮（picking 态），「资产库」不高亮', async () => {
    await renderDialog({ mode: 'omni', pickMode: 'video' });
    expect(pickCanvasBtn().classList.contains(barStyles.picking)).toBe(true);
    expect(pickAssetsBtn().classList.contains(barStyles.picking)).toBe(false);
  });
});

describe('IKGB7W 三种禁用态：常显置灰 + 悬停原因（替代旧「+ 不出现」）', () => {
  it('模型能力位不支持参考：两按钮 aria-disabled、悬停说明不支持，点击不分派（旧行为为入口不出现）', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({ mode: 'omni', models: [noRefCapModel] });

    for (const btn of [pickCanvasBtn(), pickAssetsBtn()]) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('当前模型不支持参考');
    }
    await click(pickCanvasBtn());
    await click(pickAssetsBtn());
    expect(onPickFromCanvas).not.toHaveBeenCalled();
    expect(onPickFromAssets).not.toHaveBeenCalled();
  });

  it('普通参考达上限：两按钮 aria-disabled、悬停说明已达上限，n/N 计数保留在附件栏原位', async () => {
    const refs = Array.from({ length: 13 }, (_, i) => ref(`m${i}`));
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({ mode: 'omni', mediaRefs: { reference: refs } });

    for (const btn of [pickCanvasBtn(), pickAssetsBtn()]) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('普通参考最多 13 条，已达上限');
    }
    expect(attachmentStrip()!.textContent).toContain('13/13');
    await click(pickCanvasBtn());
    await click(pickAssetsBtn());
    expect(onPickFromCanvas).not.toHaveBeenCalled();
    expect(onPickFromAssets).not.toHaveBeenCalled();
  });

  it('生成中只读：两按钮 aria-disabled、悬停文案与只读提示条同一来源，点击不分派', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({ mode: 'omni', status: 'generating' });

    for (const btn of [pickCanvasBtn(), pickAssetsBtn()]) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('生成中，参数与连线只读；可在画布卡片上取消生成');
    }
    expect(container.textContent).toContain('生成中，参数与连线只读；可在画布卡片上取消生成');
    await click(pickCanvasBtn());
    await click(pickAssetsBtn());
    expect(onPickFromCanvas).not.toHaveBeenCalled();
    expect(onPickFromAssets).not.toHaveBeenCalled();
  });

  it('保存提交中只读：悬停文案为保存提交口径（与只读提示条同一来源分叉）', async () => {
    await renderDialog({ mode: 'omni', submitting: true });
    for (const btn of [pickCanvasBtn(), pickAssetsBtn()]) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('正在保存并提交，参数与连线只读');
    }
  });

  it('未达上限且非只读：按钮可用且悬停为入口语义', async () => {
    await renderDialog({ mode: 'omni', mediaRefs: { reference: [ref('m1')] } });
    expect(pickCanvasBtn().getAttribute('aria-disabled')).toBeNull();
    expect(pickAssetsBtn().getAttribute('aria-disabled')).toBeNull();
    expect(pickCanvasBtn().getAttribute('title')).toBe(ATTACHMENT_ACTION_PICK_CANVAS_TITLE);
    expect(pickAssetsBtn().getAttribute('title')).toBe(ATTACHMENT_ACTION_PICK_ASSETS_TITLE);
  });
});

describe('IKGB7Y 首尾帧顺序填充（操作条按首空槽分派，两槽满置灰）', () => {
  it('两槽均空：两按钮可用，「+ 参考」「资产库」均以首帧角色分派（仅图片边界），效果与槽位入口一致', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({ mode: 'first_last_frame', mediaRefs: { reference: [] } });

    expect(pickCanvasBtn().getAttribute('aria-disabled')).toBeNull();
    expect(pickAssetsBtn().getAttribute('aria-disabled')).toBeNull();
    expect(pickCanvasBtn().getAttribute('title')).toBe(ATTACHMENT_ACTION_PICK_CANVAS_TITLE);
    expect(pickAssetsBtn().getAttribute('title')).toBe(ATTACHMENT_ACTION_PICK_ASSETS_TITLE);

    await click(pickCanvasBtn());
    expect(onPickFromCanvas).toHaveBeenCalledWith('image', 'first');
    await click(pickAssetsBtn());
    expect(onPickFromAssets).toHaveBeenCalledWith('image', 'first');
  });

  it('首帧已有、尾帧为空：两按钮以尾帧角色分派（顺序填充第二槽）', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({
      mode: 'first_last_frame',
      mediaRefs: { reference: [], first: ref('f1') },
    });

    await click(pickCanvasBtn());
    expect(onPickFromCanvas).toHaveBeenCalledWith('image', 'last');
    await click(pickAssetsBtn());
    expect(onPickFromAssets).toHaveBeenCalledWith('image', 'last');
  });

  it('两槽均满：两按钮置灰并悬停说明，点击不分派；槽位缩略图与角色徽标保持', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({
      mode: 'first_last_frame',
      mediaRefs: { reference: [], first: ref('f1'), last: ref('f2') },
    });

    for (const btn of [pickCanvasBtn(), pickAssetsBtn()]) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('首帧已指定，请先移除后再添加');
    }
    await click(pickCanvasBtn());
    await click(pickAssetsBtn());
    expect(onPickFromCanvas).not.toHaveBeenCalled();
    expect(onPickFromAssets).not.toHaveBeenCalled();
    const badges = [...container.querySelectorAll('[data-testid="dock-video-ref"] [data-testid="ref-thumb-badge"]')].map(
      (n) => n.textContent,
    );
    expect(badges).toEqual(['首帧', '尾帧']);
  });

  it('首尾帧模式生成中只读：两按钮同样置灰（沿用 §3 只读口径），点击不分派', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({
      mode: 'first_last_frame',
      status: 'generating',
      mediaRefs: { reference: [] },
    });

    for (const btn of [pickCanvasBtn(), pickAssetsBtn()]) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('生成中，参数与连线只读；可在画布卡片上取消生成');
    }
    await click(pickCanvasBtn());
    await click(pickAssetsBtn());
    expect(onPickFromCanvas).not.toHaveBeenCalled();
    expect(onPickFromAssets).not.toHaveBeenCalled();
  });

  it('首尾帧画布点选进行中「+ 参考」高亮（picking 态，kind 边界 image 匹配），「资产库」不高亮', async () => {
    await renderDialog({ mode: 'first_last_frame', mediaRefs: { reference: [] }, pickMode: 'image' });
    expect(pickCanvasBtn().classList.contains(barStyles.picking)).toBe(true);
    expect(pickAssetsBtn().classList.contains(barStyles.picking)).toBe(false);
  });

  it('「+ 首帧」「+ 尾帧」槽位入口原样保留：空槽常显、label 变体按角色分派', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({ mode: 'first_last_frame', mediaRefs: { reference: [] } });

    const strip = attachmentStrip()!;
    expect(strip).toBeTruthy();
    const firstSlot = [...strip.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.title === '添加首帧（从资产中选择 / 从节点添加素材）',
    )!;
    const lastSlot = [...strip.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.title === '添加尾帧（从资产中选择 / 从节点添加素材）',
    )!;
    expect(firstSlot).toBeTruthy();
    expect(lastSlot).toBeTruthy();

    await click(firstSlot);
    await click([...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '从节点添加素材')!);
    expect(onPickFromCanvas).toHaveBeenCalledWith('image', 'first');
    await click(lastSlot);
    await click([...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '从资产中选择')!);
    expect(onPickFromAssets).toHaveBeenCalledWith('image', 'last');
  });
});
