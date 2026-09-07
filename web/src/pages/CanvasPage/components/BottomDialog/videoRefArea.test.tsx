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
  onRemoveVideoRef: vi.fn(),
  onSetVideoRefRole: vi.fn(),
  onToast: vi.fn(),
};

interface RenderOptions {
  mediaRefs?: VideoMediaRefs;
  status?: 'draft' | 'generating' | 'failed' | 'cancelled';
}

async function renderDialog({ mediaRefs, status }: RenderOptions = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(BottomDialog, {
        onClose: vi.fn(),
        onSend: handlers.onSend,
        onPickFromCanvas: handlers.onPickFromCanvas,
        onRemoveVideoRef: handlers.onRemoveVideoRef,
        onSetVideoRefRole: handlers.onSetVideoRefRole,
        onToast: handlers.onToast,
        ...(mediaRefs !== undefined
          ? {
              videoMediaRefs: mediaRefs,
              videoDraftBinding: {
                status,
                onParamsChange: vi.fn(),
              },
            }
          : {}),
      }),
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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
  it('按角色分组渲染连线推导项：首帧/尾帧/普通参考槽与角色徽标；隐藏模式选择器与上传入口', async () => {
    const mediaRefs: VideoMediaRefs = {
      reference: [ref('m1'), ref('v1', 'video')],
      first: ref('f1'),
      last: ref('f2'),
    };
    await renderDialog({ mediaRefs });

    expect(mountNode.textContent).toContain('首帧');
    expect(mountNode.textContent).toContain('尾帧');
    expect(mountNode.textContent).toContain('普通参考');
    const roles = [...mountNode.querySelectorAll('[data-testid="dock-video-ref"] [data-role]')].map(
      (n) => n.getAttribute('data-role'),
    );
    expect(roles).toEqual(['first', 'last', 'reference', 'reference']);
    // 模式选择器隐藏（角色槽显式表达取代模式预设）
    expect(mountNode.textContent).not.toContain('全能参考');
    // 无本地上传：不渲染文件选择 input
    expect(mountNode.querySelector('input[type="file"]')).toBeNull();
  });

  it('非草稿绑定路径（无 videoMediaRefs）保持模式选择器与本地列表渲染', async () => {
    await renderDialog();
    expect(mountNode.textContent).toContain('全能参考');
    // 无上传入口，图片/视频按钮直达「到节点选择」
    expect(slotButton('到节点选择图片')).toBeTruthy();
    expect(slotButton('到节点选择视频')).toBeTruthy();
    expect(mountNode.querySelector('input[type="file"]')).toBeNull();
    expect(mountNode.textContent).not.toContain('角色库');
  });
});

describe('IKDMQS 角色槽能力约束', () => {
  it('模型不支持首帧时首帧入口禁用；无首帧时尾帧入口禁用并提示原因', async () => {
    await renderDialog({ mediaRefs: { reference: [] } });
    // 全能力模型：首帧可加；尾帧需先有首帧
    expect(slotButton('到节点选择首帧')!.disabled).toBe(false);
    const lastBtn = slotButton('尾帧必须与首帧一起使用，请先指定首帧')!;
    expect(lastBtn.disabled).toBe(true);
  });

  it('无帧能力模型：首帧/尾帧入口均禁用', async () => {
    fetchGenerationModels.mockResolvedValue([noFrameModel]);
    await renderDialog({ mediaRefs: { reference: [] } });
    expect(slotButton('当前模型不支持首帧')!.disabled).toBe(true);
    expect(slotButton('当前模型不支持尾帧')!.disabled).toBe(true);
  });
});

describe('IKDMQS 角色显式指定与移除', () => {
  it('首帧槽「+」按首帧角色发起节点选择；普通参考「+」不带角色', async () => {
    await renderDialog({ mediaRefs: { reference: [] } });
    await act(async () => { slotButton('到节点选择首帧')!.click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenCalledWith('image', 'first');
    await act(async () => { slotButton('到节点选择图片')!.click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenCalledWith('image');
    await act(async () => { slotButton('到节点选择视频')!.click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenCalledWith('video');
  });

  it('移除参考回调携带来源节点 id（父级断开连线）', async () => {
    await renderDialog({ mediaRefs: { reference: [], first: ref('f1') } });
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
    await renderDialog({ mediaRefs: { reference: [ref('m1')] }, status: 'generating' });
    expect(mountNode.querySelector('[data-testid="dock-video-ref"]')).toBeTruthy();
    expect(mountNode.querySelector('button[title="移除（断开连线）"]')).toBeNull();
    expect(slotButton('到节点选择图片')).toBeUndefined();
    expect(mountNode.textContent).toContain('生成中，参数与连线只读');
    expect(sendButton().disabled).toBe(true);
    expect(sendButton().getAttribute('title')).toBe('生成中，输入只读');
  });

  it('合法输入（仅首尾帧或仅普通参考）不提示冲突，可发送', async () => {
    await renderDialog({ mediaRefs: { reference: [], first: ref('f1'), last: ref('f2') } });
    expect(mountNode.textContent).not.toContain('不能混用');
    await typePrompt('首尾帧驱动视频');
    expect(sendButton().disabled).toBe(false);
    await act(async () => { sendButton().click(); });
    expect(handlers.onSend).toHaveBeenCalledTimes(1);
    const [, opts, refs] = handlers.onSend.mock.calls[0]!;
    expect(opts.modelId).toBe('m-full');
    expect(refs).toEqual([]);
  });
});
