// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationModel } from '@/custom/api/generation';
import BottomDialog from './index';
import { clickSelectOption } from '../../testing/radixSelect';
import styles from './index.module.css';
import { REF_SOURCE_ENTRY_TITLE } from '../RefSourceMenu';
import type { VideoMediaRef, VideoMediaRefs } from '../../tools/video/videoMediaRefs';




const { fetchGenerationModels, editorPendingCalls } = vi.hoisted(() => ({
  fetchGenerationModels: vi.fn(),

  editorPendingCalls: [] as Array<{ kind: string; id: string }>,
}));

vi.mock('@/custom/api/generation', () => ({
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
        insertRefAtPending: (key: { kind: string; id: string }) => { editorPendingCalls.push(key); },
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

const noFrameModel: GenerationModel = {
  ...fullModel,
  model_id: 'm-noframe',
  model_label: '无帧模型',
  features: { ...baseFeatures, first_frame: false, last_frame: false, first_last_frame: false },
};


const adaptiveModel: GenerationModel = {
  ...fullModel,
  model_id: 'm-25',
  model_label: 'Seedance 2.5',
  supported_aspect_ratios: [{ id: 'adaptive', label: 'adaptive' }, { id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }],
  features: { ...baseFeatures, video_reference: true, video_reference_max: 3 },
};

const ref = (id: string, mediaType: 'image' | 'video' | 'audio' = 'image'): VideoMediaRef => ({
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
  onRemoveVideoRef: vi.fn(),
  onRemoveMaterialRef: vi.fn(),
  onToast: vi.fn(),
};

interface RenderOptions {
  mediaRefs?: VideoMediaRefs;
  mode?: 'omni' | 'first_last_frame' | 'text2video';
  status?: 'draft' | 'generating' | 'failed' | 'cancelled';
}

async function renderDialog({ mediaRefs, status, mode }: RenderOptions = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BottomDialog, {
          onClose: vi.fn(),
          initialParams: { mode },
          onSend: handlers.onSend,
          onPickFromCanvas: handlers.onPickFromCanvas,
          onPickFromAssets: handlers.onPickFromAssets,
          onRemoveVideoRef: handlers.onRemoveVideoRef,
          onRemoveMaterialRef: handlers.onRemoveMaterialRef,
          onToast: handlers.onToast,
          videoMediaRefs: mediaRefs ?? { reference: [] },
          videoDraftBinding: {
            status,
            onParamsChange: vi.fn(),
          },
        })
      ),
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}


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
  editorPendingCalls.length = 0;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('IKDMQS 草稿绑定模式渲染', () => {
  it('首尾帧模式恢复首帧和尾帧，普通参考入口与本地上传不显示', async () => {
    await renderDialog({ mode: 'first_last_frame', mediaRefs: {
      reference: [], first: ref('f1'), last: ref('f2'),
    } });

    const badges = [...mountNode.querySelectorAll('[data-testid="dock-video-ref"] [data-testid="ref-thumb-badge"]')]
      .map((n) => n.textContent);
    expect(badges).toEqual(['首帧', '尾帧']);
    expect(menuItem('首尾帧')).toBeTruthy();
    expect(slotButton(REF_SOURCE_ENTRY_TITLE)).toBeUndefined();
    expect(mountNode.querySelector('input[type="file"]')).toBeNull();
  });

  it('全能参考显示图片和视频缩略图，不显示普通参考角色徽标', async () => {

    await renderDialog({ mode: 'omni', mediaRefs: { reference: [ref('m1'), ref('v1', 'video')] } });
    expect(mountNode.querySelectorAll('[data-testid="dock-video-ref"]')).toHaveLength(2);
    expect(mountNode.querySelector('[data-role="reference"]')).toBeNull();
    expect(menuItem('全能参考')).toBeTruthy();
  });

  it('统一草稿绑定：普通参考添加入口 = 附件操作条两 pill 直达（IKGB7W，栏尾旧「+」退役，无角色库项，无上传）', async () => {
    await renderDialog({ mode: 'omni' });
    expect(menuItem('全能参考')).toBeTruthy();

    const legacyEntries = [...mountNode.querySelectorAll('button')].filter(
      (b) => b.title === REF_SOURCE_ENTRY_TITLE,
    );
    expect(legacyEntries).toHaveLength(0);
    const pickCanvas = [...mountNode.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '参考')!;
    const pickAssets = [...mountNode.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '资产库')!;
    expect(pickCanvas).toBeTruthy();
    expect(pickAssets).toBeTruthy();
    await act(async () => { pickCanvas.click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenCalledWith('video', 'reference');
    await act(async () => { pickAssets.click(); });
    expect(handlers.onPickFromAssets).toHaveBeenCalledWith('video', 'reference');

    expect(mountNode.textContent).not.toContain('角色库');
    expect(mountNode.querySelector('input[type="file"]')).toBeNull();
  });
});

describe('IKDMQS 角色槽能力约束', () => {
  it('切换首尾帧模式后，空首帧和尾帧入口同时显示（统一入口具名槽位）', async () => {
    await renderDialog({ mode: 'omni', mediaRefs: { reference: [] } });
    await act(async () => { menuItem('全能参考')!.click(); });
    await clickSelectOption('首尾帧');
    expect(slotButton('添加首帧（从资产中选择 / 从节点添加素材）')).toBeTruthy();
    expect(slotButton('添加尾帧（从资产中选择 / 从节点添加素材）')).toBeTruthy();
  });

  it('无首帧能力时首帧入口隐藏，尾帧空槽仍显示', async () => {
    fetchGenerationModels.mockResolvedValue([noFrameModel]);
    await renderDialog({ mode: 'first_last_frame', mediaRefs: { reference: [] } });
    expect(slotButton('添加首帧（从资产中选择 / 从节点添加素材）')).toBeUndefined();
    expect(slotButton('添加尾帧（从资产中选择 / 从节点添加素材）')).toBeTruthy();
  });
});

describe('IKDMQS 角色显式指定与移除', () => {
  it('首帧槽「从节点添加素材」按首帧角色发起；普通参考经操作条按 reference 角色与模式类型边界分派', async () => {
    await renderDialog({ mode: 'first_last_frame', mediaRefs: { reference: [] } });
    await act(async () => { slotButton('添加首帧（从资产中选择 / 从节点添加素材）')!.click(); });
    await act(async () => { menuItem('从节点添加素材')!.click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenCalledWith('image', 'first');

    const pickCanvas = () => [...mountNode.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '参考')!;
    await act(async () => { menuItem('首尾帧')!.click(); });
    await clickSelectOption('全能参考');
    await act(async () => { pickCanvas().click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenCalledWith('video', 'reference');
    await act(async () => { menuItem('全能参考')!.click(); });
    await clickSelectOption('图生视频');
    await act(async () => { pickCanvas().click(); });
    expect(handlers.onPickFromCanvas).toHaveBeenLastCalledWith('image', 'first');
  });

  it('来源菜单携带槽位角色：资产入口按目标槽位发起（首帧槽仅图片）', async () => {
    await renderDialog({ mode: 'first_last_frame', mediaRefs: { reference: [] } });
    await act(async () => { slotButton('添加首帧（从资产中选择 / 从节点添加素材）')!.click(); });
    await act(async () => { menuItem('从资产中选择')!.click(); });
    expect(handlers.onPickFromAssets).toHaveBeenCalledWith('image', 'first');
  });

  it('移除参考回调携带来源节点 id（父级断开连线）', async () => {
    await renderDialog({ mode: 'first_last_frame', mediaRefs: { reference: [], first: ref('f1') } });

    const removeBtn = mountNode.querySelector<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]')!;
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

  it('生成中只读：参考可见但无添加/移除/@ 入口，发送禁用并提示', async () => {
    await renderDialog({ mode: 'omni', mediaRefs: { reference: [ref('m1')] }, status: 'generating' });
    expect(mountNode.querySelector('[data-testid="dock-video-ref"]')).toBeTruthy();
    expect(mountNode.querySelector('button[title="移除"]')).toBeNull();
    expect(mountNode.querySelector('button[title="插入引用（优先插入上次 @ 的位置，其次当前光标处，否则追加到正文末尾）"]')).toBeNull();

    expect(slotButton(REF_SOURCE_ENTRY_TITLE)).toBeUndefined();
    const pickCanvas = [...mountNode.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '参考')!;
    expect(pickCanvas.getAttribute('aria-disabled')).toBe('true');
    expect(pickCanvas.getAttribute('title')).toContain('只读');
    expect(mountNode.textContent).toContain('生成中，参数与连线只读');
    expect(sendButton().disabled).toBe(true);
    expect(sendButton().getAttribute('title')).toBe('生成中，输入只读');
  });

  it('完整首尾帧不提示冲突，按首尾帧模式发送', async () => {
    await renderDialog({ mode: 'first_last_frame', mediaRefs: { reference: [], first: ref('f1'), last: ref('f2') } });
    expect(mountNode.textContent).not.toContain('不能混用');
    await typePrompt('首尾帧驱动视频');
    expect(sendButton().disabled).toBe(false);
    await act(async () => { sendButton().click(); });
    expect(handlers.onSend).toHaveBeenCalledTimes(1);
    const [, opts] = handlers.onSend.mock.calls[0]!;
    expect(opts.modelId).toBe('m-full');
    expect(opts.mode).toBe('first_last_frame');
  });
});



describe('IKFCKQ 共享缩略图接入', () => {
  it('普通参考按类型独立编号（图片N/视频N/音频N 圆钮仅数字），媒体形态按 kind 渲染', async () => {
    await renderDialog({ mode: 'omni', mediaRefs: {
      reference: [ref('m1'), ref('a1', 'audio'), ref('v1', 'video'), ref('m2')],
    } });
    const thumbs = [...mountNode.querySelectorAll('[data-testid="dock-video-ref"]')];
    expect(thumbs).toHaveLength(4);

    const badges = thumbs.map((t) => t.querySelector('[data-testid="ref-thumb-badge"]')?.textContent);
    expect(badges).toEqual(['1', '1', '1', '2']);
    expect(thumbs[0]!.querySelector('img')).toBeTruthy();
    expect(thumbs[1]!.querySelector('video')).toBeNull();
    expect(thumbs[1]!.querySelector('svg')).toBeTruthy();
    expect(thumbs[2]!.querySelector('video')).toBeTruthy();
    expect(thumbs[0]!.querySelector('img')!.getAttribute('alt')).toBe('图m1');
  });

  it('缩略图 @ 按钮走 insertRefAtPending 记忆光标路径（媒体身份 asset_ref）', async () => {
    await renderDialog({ mode: 'omni', mediaRefs: { reference: [ref('m1')] } });
    const atBtn = mountNode.querySelector<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="插入引用（优先插入上次 @ 的位置，其次当前光标处，否则追加到正文末尾）"]')!;
    await act(async () => { atBtn.click(); });
    expect(editorPendingCalls).toEqual([{ kind: 'asset_ref', id: 'a-m1' }]);
  });

  it('首尾帧模式：帧槽 @ 按钮同样开放，角色徽标不参与数字编号', async () => {
    await renderDialog({ mode: 'first_last_frame', mediaRefs: { reference: [], first: ref('f1') } });
    const thumb = mountNode.querySelector('[data-testid="dock-video-ref"]')!;
    expect(thumb.querySelector('[data-testid="ref-thumb-badge"]')!.textContent).toBe('首帧');
    const atBtn = thumb.querySelector<HTMLButtonElement>('button[title="插入引用（优先插入上次 @ 的位置，其次当前光标处，否则追加到正文末尾）"]')!;
    await act(async () => { atBtn.click(); });
    expect(editorPendingCalls).toEqual([{ kind: 'asset_ref', id: 'a-f1' }]);
  });

  it('角色库 material 项：× 走移除 material 回调（操作草稿 data，非断连线）', async () => {
    await renderDialog({ mode: 'omni', mediaRefs: {
      reference: [{ ...ref('asset-x1'), assetId: 'asset-x1', materialId: 'asset-x1' }],
    } });
    const removeBtn = mountNode.querySelector<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]')!;
    await act(async () => { removeBtn.click(); });
    expect(handlers.onRemoveVideoRef).not.toHaveBeenCalled();
    expect(handlers.onRemoveMaterialRef).toHaveBeenCalledWith('asset-x1');
  });
});




describe('IKJ794 全能参考被动提示行', () => {
  it('Seedance 2.5 + 全能参考 + 挂参考视频 → 显示提示', async () => {
    fetchGenerationModels.mockResolvedValue([adaptiveModel]);
    await renderDialog({ mode: 'omni', mediaRefs: { reference: [ref('v1', 'video'), ref('m1')] } });
    expect(mountNode.textContent).toContain('提示词若涉及修改、替换或延长原视频，输出比例与时长将自动跟随参考视频');
  });

  it('首尾帧模式 → 不显示', async () => {
    fetchGenerationModels.mockResolvedValue([adaptiveModel]);
    await renderDialog({ mode: 'first_last_frame', mediaRefs: { reference: [], first: ref('f1'), last: ref('f2') } });
    expect(mountNode.textContent).not.toContain('自动跟随参考视频');
  });

  it('Seedance 2.0 系列（比例表无 adaptive）→ 不显示', async () => {
    await renderDialog({ mode: 'omni', mediaRefs: { reference: [ref('v1', 'video')] } });
    expect(mountNode.textContent).not.toContain('自动跟随参考视频');
  });

  it('全能参考 + 2.5 但只挂图片（未挂视频）→ 不显示', async () => {
    fetchGenerationModels.mockResolvedValue([adaptiveModel]);
    await renderDialog({ mode: 'omni', mediaRefs: { reference: [ref('m1'), ref('m2')] } });
    expect(mountNode.textContent).not.toContain('自动跟随参考视频');
  });

  it('比例选项 adaptive 档显示 auto，选中后状态栏与提交取值不变（仍为 adaptive）', async () => {
    fetchGenerationModels.mockResolvedValue([adaptiveModel]);
    await renderDialog({ mode: 'omni', mediaRefs: { reference: [] } });

    const configBtn = [...mountNode.querySelectorAll('button')].find((b) => b.textContent?.includes('auto'))!;
    await act(async () => { configBtn.click(); });
    const ratioBtns = [...mountNode.querySelectorAll<HTMLButtonElement>(`.${styles.ratioGroup} button`)];
    expect(ratioBtns.some((b) => b.textContent === 'auto')).toBe(true);
    expect(ratioBtns.some((b) => b.textContent === 'adaptive')).toBe(false);

    await act(async () => {
      ratioBtns.find((b) => b.textContent === 'auto')!.click();
    });
    expect(configBtn.textContent).toContain('auto');
    expect(configBtn.textContent).not.toContain('adaptive');
    await typePrompt('跟随参考视频生成');
    await act(async () => { sendButton().click(); });
    const [, opts] = handlers.onSend.mock.calls[0]!;
    expect(opts.aspectRatio).toBe('adaptive');
  });
});
