// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationModel } from '@/api/generation';
import BottomDialog from './index';
import type { VideoMediaRef, VideoMediaRefs } from '../../videoMediaRefs';

/* IKDMQS 视频草稿绑定模式：模式与角色槽渲染 / 能力约束 / 来源菜单 / 组合冲突 /
   生成中只读 / 移除参考与禁用本地上传。PromptRefEditor 打桩为 textarea（IKFA1O 编辑器替换）。 */

const { fetchGenerationModels } = vi.hoisted(() => ({
  fetchGenerationModels: vi.fn(),
}));

vi.mock('@/api/generation', () => ({
  fetchGenerationModels,
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

const baseFeatures = {
  reference_image: true,
  max_reference_images: 10,
  watermark: false,
  quantity_max: 1,
  sequential_image_generation: false,
  stream: false,
  tools: false,
  first_frame: true,
  last_frame: true,
  first_last_frame: true,
  audio: false,
};

const fullModel: GenerationModel = {
  model_id: 'm-full',
  provider_id: 'p',
  model_label: '全能力模型',
  icon: null,
  supported_sizes: [{ id: '720p', label: '720p', api_value: '720p', width: null, height: null }],
  supported_aspect_ratios: ['16:9'],
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

const noFrameModel: GenerationModel = {
  ...fullModel,
  model_id: 'm-noframe',
  model_label: '无帧模型',
  features: { ...baseFeatures, first_frame: false, last_frame: false, first_last_frame: false },
};

const ref = (id: string, mediaType: 'image' | 'video' = 'image'): VideoMediaRef => ({
  nodeId: id,
  url: `http://img/${id}.png`,
  name: `图${id}`,
  assetId: `a-${id}`,
  mediaType,
});

let root: Root;
let mountNode: HTMLDivElement;
const handlers = {
  onSend: vi.fn(),
  onPickFromCanvas: vi.fn(),
  onPickFromAssets: vi.fn(),
  onOpenCharacterLibrary: vi.fn(),
  onRemoveVideoRef: vi.fn(),
  onSetVideoRefRole: vi.fn(),
  onRemoveMaterialRef: vi.fn(),
  onSetMaterialRefRole: vi.fn(),
  onToast: vi.fn(),
};

interface RenderOptions {
  mediaRefs?: VideoMediaRefs;
  mode?: 'all' | 'keyframe' | 'prompt';
  status?: 'draft' | 'generating' | 'failed' | 'cancelled';
}

async function renderDialog({ mediaRefs, status, mode }: RenderOptions = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(BottomDialog, {
        onClose: vi.fn(),
        initialParams: { mode },
        onSend: handlers.onSend,
        onPickFromCanvas: handlers.onPickFromCanvas,
        onPickFromAssets: handlers.onPickFromAssets,
        onOpenCharacterLibrary: handlers.onOpenCharacterLibrary,
        onRemoveVideoRef: handlers.onRemoveVideoRef,
        onSetVideoRefRole: handlers.onSetVideoRefRole,
        onRemoveMaterialRef: handlers.onRemoveMaterialRef,
        onSetMaterialRefRole: handlers.onSetMaterialRefRole,
        onToast: handlers.onToast,
        videoMediaRefs: mediaRefs ?? { reference: [] },
        videoDraftBinding: {
          status,
          onParamsChange: vi.fn(),
        },
      }),
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 来源菜单项按钮（菜单展开后按文案查找） */
function menuItem(label: string): HTMLButtonElement | undefined {
  return [...mountNode.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
}

function slotButton(label: string): HTMLButtonElement | undefined {
  return [...mountNode.querySelectorAll('button')].find((b) => b.title === label);
}

function sendButton(): HTMLButtonElement {
  return mountNode.querySelector<HTMLButtonElement>('[data-testid="video-send"]')!;
}

function typePrompt(text: string) {
  const textarea = mountNode.querySelector('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  return act(async () => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchGenerationModels.mockResolvedValue([fullModel]);
  vi.clearAllMocks();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('IKDMQS 草稿绑定模式渲染', () => {
  it('首尾帧模式恢复首帧和尾帧，普通参考入口与本地上传不显示', async () => {
    await renderDialog({ mode: 'keyframe', mediaRefs: {
      reference: [], first: ref('f1'), last: ref('f2'),
    } });
    const roles = [...mountNode.querySelectorAll('[data-testid="dock-video-ref"] [data-role]')]
      .map((n) => n.getAttribute('data-role'));
    expect(roles).toEqual(['first', 'last']);
    expect(menuItem('首尾帧')).toBeTruthy();
    expect(slotButton('添加图片参考（从资产中选择 / 到节点选择 / 角色库）')).toBeUndefined();
    expect(mountNode.querySelector('input[type="file"]')).toBeNull();
  });

  it('全能参考显示图片和视频缩略图，不显示普通参考角色徽标', async () => {
    // IKFC1T：dock 默认改为文生视频，本套用例显式回到全能参考场景
    await renderDialog({ mode: 'all', mediaRefs: { reference: [ref('m1'), ref('v1', 'video')] } });
    expect(mountNode.querySelectorAll('[data-testid="dock-video-ref"]')).toHaveLength(2);
    expect(mountNode.querySelector('[data-role="reference"]')).toBeNull();
    expect(menuItem('全能参考')).toBeTruthy();
  });

  it('统一草稿绑定：媒体入口为来源菜单（资产/节点/角色库，无上传）', async () => {
    await renderDialog({ mode: 'all' });
    expect(menuItem('全能参考')).toBeTruthy();
    // 图片/视频按钮改为弹出来源菜单（画布资产改造融合），不再直达「到节点选择」
    const entryButtons = [...mountNode.querySelectorAll('button')].filter(
      (b) => b.title === '添加图片参考（从资产中选择 / 到节点选择 / 角色库）'
        || b.title === '添加视频参考（从资产中选择 / 到节点选择 / 角色库）',
    );
    expect(entryButtons.length).toBe(2);
    await act(async () => {
      entryButtons[0].click();
    });
    const menuText = mountNode.textContent ?? '';
    expect(menuText).toContain('从资产中选择');
    expect(menuText).toContain('到节点选择');
    expect(menuText).toContain('角色库');
    // 上传入口退役：菜单不含上传项，也不渲染文件选择 input
    expect(menuText).not.toContain('图片上传');
    expect(menuText).not.toContain('视频上传');
    expect(mountNode.querySelector('input[type="file"]')).toBeNull();
  });
});

describe('IKDMQS 角色槽能力约束', () => {
  it('切换首尾帧模式后，空首帧和尾帧入口同时显示', async () => {
    await renderDialog({ mode: 'all', mediaRefs: { reference: [] } });
    await act(async () => { menuItem('全能参考')!.click(); });
    await act(async () => { menuItem('首尾帧')!.click(); });
    expect(slotButton('添加首帧（从资产中选择 / 到节点选择 / 角色库）')).toBeTruthy();
    expect(slotButton('添加尾帧（从资产中选择 / 到节点选择 / 角色库）')).toBeTruthy();
  });

  it('无首帧能力时首帧入口隐藏，尾帧空槽仍显示', async () => {
    fetchGenerationModels.mockResolvedValue([noFrameModel]);
    await renderDialog({ mode: 'keyframe', mediaRefs: { reference: [] } });
    expect(slotButton('添加首帧（从资产中选择 / 到节点选择 / 角色库）')).toBeUndefined();
    expect(slotButton('添加尾帧（从资产中选择 / 到节点选择 / 角色库）')).toBeTruthy();
  });
});

describe('IKDMQS 角色显式指定与移除', () => {
  it('首帧槽来源菜单「到节点选择」按首帧角色发起；普通参考按 reference 角色', async () => {
    await renderDialog({ mode: 'keyframe', mediaRefs: { reference: [] } });
    await act(async () => { slotButton('添加首帧（从资产中选择 / 到节点选择 / 角色库）')!.click(); });
    await act(async () => { menuItem('到节点选择')!.click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenCalledWith('image', 'first');
    await act(async () => { menuItem('首尾帧')!.click(); });
    await act(async () => { menuItem('全能参考')!.click(); });
    await act(async () => { slotButton('添加图片参考（从资产中选择 / 到节点选择 / 角色库）')!.click(); });
    await act(async () => { menuItem('到节点选择')!.click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenCalledWith('image', 'reference');
    await act(async () => { slotButton('添加视频参考（从资产中选择 / 到节点选择 / 角色库）')!.click(); });
    await act(async () => { menuItem('到节点选择')!.click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenCalledWith('video', 'reference');
  });

  it('来源菜单携带槽位角色：资产库/角色库入口按目标槽位发起', async () => {
    await renderDialog({ mode: 'keyframe', mediaRefs: { reference: [] } });
    await act(async () => { slotButton('添加首帧（从资产中选择 / 到节点选择 / 角色库）')!.click(); });
    await act(async () => { menuItem('从资产中选择')!.click(); });
    expect(handlers.onPickFromAssets).toHaveBeenCalledWith('image', 'first');
    await act(async () => { slotButton('添加首帧（从资产中选择 / 到节点选择 / 角色库）')!.click(); });
    await act(async () => { menuItem('角色库')!.click(); });
    expect(handlers.onOpenCharacterLibrary).toHaveBeenCalledWith('first');
  });

  it('移除参考回调携带来源节点 id（父级断开连线）', async () => {
    await renderDialog({ mode: 'keyframe', mediaRefs: { reference: [], first: ref('f1') } });
    const removeBtn = mountNode.querySelector<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除（断开连线）"]')!;
    await act(async () => { removeBtn.click(); });
    expect(handlers.onRemoveVideoRef).toHaveBeenCalledWith('f1');
  });
});

describe('IKDMQS 组合冲突与只读', () => {
  it('首尾帧与普通参考混用：提示条可见、发送禁用；输入提示词后仍被阻止', async () => {
    await renderDialog({ mediaRefs: { reference: [ref('m1')], first: ref('f1') } });
    expect(mountNode.textContent).toContain('首尾帧与普通参考不能混用');
    expect(sendButton().disabled).toBe(true);
    await typePrompt('蓝色大海');
    expect(sendButton().disabled).toBe(true);
    await act(async () => { sendButton().click(); });
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it('生成中只读：参考可见但无添加/移除入口，发送禁用并提示', async () => {
    await renderDialog({ mode: 'all', mediaRefs: { reference: [ref('m1')] }, status: 'generating' });
    expect(mountNode.querySelector('[data-testid="dock-video-ref"]')).toBeTruthy();
    expect(mountNode.querySelector('button[title="移除（断开连线）"]')).toBeNull();
    expect(slotButton('添加图片参考（从资产中选择 / 到节点选择 / 角色库）')).toBeUndefined();
    expect(mountNode.textContent).toContain('生成中，参数与连线只读');
    expect(sendButton().disabled).toBe(true);
    expect(sendButton().getAttribute('title')).toBe('生成中，输入只读');
  });

  it('完整首尾帧不提示冲突，按首尾帧模式发送', async () => {
    await renderDialog({ mode: 'keyframe', mediaRefs: { reference: [], first: ref('f1'), last: ref('f2') } });
    expect(mountNode.textContent).not.toContain('不能混用');
    await typePrompt('首尾帧驱动视频');
    expect(sendButton().disabled).toBe(false);
    await act(async () => { sendButton().click(); });
    expect(handlers.onSend).toHaveBeenCalledTimes(1);
    const [, opts] = handlers.onSend.mock.calls[0]!;
    expect(opts.modelId).toBe('m-full');
    expect(opts.mode).toBe('keyframe');
  });
});
