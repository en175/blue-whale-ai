// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationModel } from '@/api/generation';
import BottomDialog from './index';
import type { VideoMediaRef, VideoMediaRefs } from '../../videoMediaRefs';

/* IKDMQS 视频草稿绑定模式：角色槽渲染 / 能力约束 / 角色切换 / 组合冲突 /
   生成中只读 / 移除上传与角色库入口。ChipTextEditor 打桩为 textarea。 */

const { fetchGenerationModels } = vi.hoisted(() => ({
  fetchGenerationModels: vi.fn(),
}));

vi.mock('@/api/generation', () => ({
  fetchGenerationModels,
}));

vi.mock('../ChipTextEditor', () => ({
  default: ({ onChange }: { onChange?: (v: { segments: Array<{ kind: string; value: string }> }) => void }) =>
    createElement('textarea', {
      'data-testid': 'chip-editor',
      onChange: (e: Event) =>
        onChange?.({ segments: [{ kind: 'text', value: (e.target as HTMLTextAreaElement).value }] }),
    }),
}));

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
  status?: 'draft' | 'generating' | 'failed' | 'cancelled';
  /**
   * 参考模式（9d0ec91e「首尾帧提示规范调整。交互优化」之后）：
   * `all` 全能参考只有普通参考槽，`keyframe` 首尾帧才有首帧/尾帧两个槽，`text2video` 图生视频不收视频。
   * 草稿从自己的参数里恢复模式，不传就是默认的全能参考。
   */
  mode?: 'all' | 'keyframe' | 'text2video';
}

async function renderDialog({ mediaRefs, status, mode }: RenderOptions = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(BottomDialog, {
        onClose: vi.fn(),
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
        // 恢复既有草稿这条路要求参数齐全：缺分辨率/比例/时长会落进「原参数不可用」，发送按钮直接禁用。
        ...(mode
          ? {
              initialParams: {
                modelId: 'm-full',
                resolution: '720p',
                aspectRatio: '16:9',
                duration: 10,
                mode,
              },
            }
          : {}),
        videoDraftBinding: {
          status,
          restoreExisting: Boolean(mode),
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
  // 模式决定看得见哪些槽（9d0ec91e）：一张草稿要么走首尾帧，要么走普通参考，不再同屏并列。
  // 「可见槽 = 实际参考」这条原则没变，变的是由模式来保证，而不是由三种槽同时摆着。
  it('首尾帧模式：只渲染首帧与尾帧两个槽，各带角色徽标', async () => {
    await renderDialog({ mediaRefs: { reference: [], first: ref('f1'), last: ref('f2') }, mode: 'keyframe' });

    expect(mountNode.textContent).toContain('首帧');
    expect(mountNode.textContent).toContain('尾帧');
    const roles = [...mountNode.querySelectorAll('[data-testid="dock-video-ref"] [data-role]')].map(
      (n) => n.getAttribute('data-role'),
    );
    expect(roles).toEqual(['first', 'last']);
    // 无本地上传：不渲染文件选择 input
    expect(mountNode.querySelector('input[type="file"]')).toBeNull();
  });

  it('全能参考模式：只渲染普通参考，图片与视频都收', async () => {
    await renderDialog({ mediaRefs: { reference: [ref('m1'), ref('v1', 'video')] } });

    const roles = [...mountNode.querySelectorAll('[data-testid="dock-video-ref"] [data-role]')].map(
      (n) => n.getAttribute('data-role'),
    );
    expect(roles.filter((role) => role === 'first' || role === 'last')).toEqual([]);
    expect(mountNode.querySelectorAll('[data-testid="dock-video-ref"]').length).toBe(2);
  });

  it('统一草稿绑定：媒体入口为来源菜单（资产/节点/角色库，无上传）', async () => {
    await renderDialog();
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
  // 首帧与尾帧在添加阶段互相独立：先放哪个都行，缺的那个到发送时才提示补全（9d0ec91e）。
  it('首尾帧模式：两个槽的入口都在，先放哪个都行', async () => {
    await renderDialog({ mediaRefs: { reference: [] }, mode: 'keyframe' });
    expect(slotButton('添加首帧（从资产中选择 / 到节点选择 / 角色库）')).toBeTruthy();
    expect(slotButton('添加尾帧（从资产中选择 / 到节点选择 / 角色库）')).toBeTruthy();
  });

  it('全能参考模式下没有首尾帧槽——那是另一种模式的事', async () => {
    await renderDialog({ mediaRefs: { reference: [] } });
    expect(slotButton('添加首帧（从资产中选择 / 到节点选择 / 角色库）')).toBeUndefined();
    expect(slotButton('添加尾帧（从资产中选择 / 到节点选择 / 角色库）')).toBeUndefined();
  });
});

describe('IKDMQS 角色显式指定与移除', () => {
  it('首帧槽来源菜单「到节点选择」按首帧角色发起；普通参考按 reference 角色', async () => {
    await renderDialog({ mediaRefs: { reference: [] }, mode: 'keyframe' });
    await act(async () => { slotButton('添加首帧（从资产中选择 / 到节点选择 / 角色库）')!.click(); });
    await act(async () => { menuItem('到节点选择')!.click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenCalledWith('image', 'first');
    // 普通参考在全能参考模式里，另起一次渲染。
    if (root) await act(async () => root.unmount());
    mountNode.remove();
    await renderDialog({ mediaRefs: { reference: [] } });
    await act(async () => { slotButton('添加图片参考（从资产中选择 / 到节点选择 / 角色库）')!.click(); });
    await act(async () => { menuItem('到节点选择')!.click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenCalledWith('image', 'reference');
    await act(async () => { slotButton('添加视频参考（从资产中选择 / 到节点选择 / 角色库）')!.click(); });
    await act(async () => { menuItem('到节点选择')!.click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenCalledWith('video', 'reference');
  });

  it('来源菜单携带槽位角色：资产库/角色库入口按目标槽位发起', async () => {
    await renderDialog({ mediaRefs: { reference: [] }, mode: 'keyframe' });
    await act(async () => { slotButton('添加首帧（从资产中选择 / 到节点选择 / 角色库）')!.click(); });
    await act(async () => { menuItem('从资产中选择')!.click(); });
    expect(handlers.onPickFromAssets).toHaveBeenCalledWith('image', 'first');
    await act(async () => { slotButton('添加首帧（从资产中选择 / 到节点选择 / 角色库）')!.click(); });
    await act(async () => { menuItem('角色库')!.click(); });
    expect(handlers.onOpenCharacterLibrary).toHaveBeenCalledWith('first');
  });

  it('移除参考回调携带来源节点 id（父级断开连线）', async () => {
    await renderDialog({ mediaRefs: { reference: [], first: ref('f1') }, mode: 'keyframe' });
    const removeBtn = mountNode.querySelector<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除（断开连线）"]')!;
    await act(async () => { removeBtn.click(); });
    expect(handlers.onRemoveVideoRef).toHaveBeenCalledWith('f1');
  });
});

describe('IKDMQS 组合冲突与只读', () => {
  it('首尾帧与普通参考混用：提示条可见、发送禁用；输入提示词后仍被阻止', async () => {
    await renderDialog({ mediaRefs: { reference: [ref('m1')], first: ref('f1') }, mode: 'keyframe' });
    expect(mountNode.textContent).toContain('首尾帧与普通参考不能混用');
    expect(sendButton().disabled).toBe(true);
    await typePrompt('蓝色大海');
    expect(sendButton().disabled).toBe(true);
    await act(async () => { sendButton().click(); });
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it('生成中只读：参考可见但无添加/移除入口，发送禁用并提示', async () => {
    await renderDialog({ mediaRefs: { reference: [ref('m1')] }, status: 'generating' });
    expect(mountNode.querySelector('[data-testid="dock-video-ref"]')).toBeTruthy();
    expect(mountNode.querySelector('button[title="移除（断开连线）"]')).toBeNull();
    expect(slotButton('添加图片参考（从资产中选择 / 到节点选择 / 角色库）')).toBeUndefined();
    expect(mountNode.textContent).toContain('生成中，参数与连线只读');
    expect(sendButton().disabled).toBe(true);
    expect(sendButton().getAttribute('title')).toBe('生成中，输入只读');
  });

  it('合法输入（仅首尾帧或仅普通参考）不提示冲突，可发送', async () => {
    await renderDialog({ mediaRefs: { reference: [], first: ref('f1'), last: ref('f2') }, mode: 'keyframe' });
    expect(mountNode.textContent).not.toContain('不能混用');
    await typePrompt('首尾帧驱动视频');
    expect(sendButton().disabled).toBe(false);
    await act(async () => { sendButton().click(); });
    expect(handlers.onSend).toHaveBeenCalledTimes(1);
    const [, opts] = handlers.onSend.mock.calls[0]!;
    expect(opts.modelId).toBe('m-full');
  });
});
