// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import MediaNode from './index';
import { type MediaGenStatus } from '@/custom/enums';
import { videoSourceList } from './mediaPlayback';
import styles from './index.module.css';
import { HOVER_PREVIEW_DELAY_MS } from './hoverPreview';

const updateNodeInternalsMock = vi.hoisted(() => vi.fn());
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return { ...actual, useUpdateNodeInternals: () => updateNodeInternalsMock };
});

let root: Root;
let mountNode: HTMLDivElement;

function labels() {
  return [...mountNode.querySelectorAll('button')]
    .map((button) => button.textContent?.trim() || button.getAttribute('title') || '');
}

interface RenderExtra {
  id?: string;
  selected?: boolean;
  genStatus?: MediaGenStatus;
  progress?: number;
  errorText?: string;
  data?: Record<string, unknown>;
  storeNodes?: Array<{ id: string; selected?: boolean }>;
}

function StoreNodesSync({ nodes }: { nodes: Array<{ id: string; selected?: boolean }> }) {
  const store = useStoreApi();
  useEffect(() => {
    store.setState({
      nodes: nodes.map((node) => ({
        id: node.id,
        selected: node.selected === true,
        data: {},
        position: { x: 0, y: 0 },
      })),
    });
  }, [store, nodes]);
  return null;
}

function nodeElement(
  mediaType: 'image' | 'video' | 'audio',
  extra?: RenderExtra,
) {
  return createElement(ReactFlowProvider, null,
    extra?.storeNodes && createElement(StoreNodesSync, { nodes: extra.storeNodes }),
    createElement(MediaNode, {
    id: extra?.id ?? `${mediaType}-node`,
    data: {
      mediaType,
      src: 'blob:test',
      fileName: `${mediaType}.bin`,
      genStatus: extra?.genStatus,
      progress: extra?.progress,
      errorText: extra?.errorText,
      ...extra?.data,
    },
    selected: extra?.selected ?? true,
    type: 'mediaNode',
    dragging: false,
    zIndex: 1,
    selectable: true,
    deletable: true,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  } as never));
}

async function renderNode(
  mediaType: 'image' | 'video' | 'audio',
  extra?: RenderExtra,
) {
  if (root) await act(async () => { root.unmount(); });
  mountNode?.remove();
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(nodeElement(mediaType, extra));
  });
}

async function rerenderNode(
  mediaType: 'image' | 'video' | 'audio',
  extra?: RenderExtra,
) {
  await act(async () => {
    root.render(nodeElement(mediaType, extra));
  });
}

function offscreenVideo(): HTMLVideoElement {
  return document.body.querySelector<HTMLVideoElement>('div[aria-hidden="true"] video')!;
}

async function waitForVideoArm() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
}

function contentCard(): HTMLElement {
  return mountNode.querySelector('[data-testid="media-content"]') as HTMLElement;
}

function titleRow(): HTMLElement {
  return mountNode.querySelector('[data-testid="media-title"]') as HTMLElement;
}

function hoverPreviewLayer(): HTMLElement | null {
  return mountNode.querySelector<HTMLElement>('[data-testid="video-hover-preview"]');
}

function hoverPreviewVideo(): HTMLVideoElement | null {
  return hoverPreviewLayer()?.querySelector('video') ?? null;
}

function offscreenHostVideo(): HTMLVideoElement {
  return document.body.querySelector<HTMLVideoElement>('body > div[aria-hidden="true"] > video')!;
}

function pointerOn(
  target: Element,
  type: 'pointerover' | 'pointerout',
  relatedTarget: EventTarget | null = null,
  pointerType: string = 'mouse',
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
}

async function hoverInto(target: Element, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse') {
  await act(async () => { pointerOn(target, 'pointerover', null, pointerType); });
}

async function hoverOutOf(target: Element) {
  await act(async () => { pointerOn(target, 'pointerout', document.body); });
}

function stubHoverMedia() {
  return {
    playSpy: vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve()),
    pauseSpy: vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}),
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.restoreAllMocks();
});

describe('MediaNode 抠图结果卡渲染（IKGXMT）', () => {
  it('抠图结果卡（imageCutout 标记）：成品图片区垫棋盘格底底层（IKGXMT，规格故事 21）；无标记卡不渲染', async () => {
    await renderNode('image', {
      data: { mime: 'image/png', imageCutout: { sourceAssetId: '5' } },
    });
    const checker = mountNode.querySelector('[data-testid="cutout-checkerboard"]');
    expect(checker).toBeTruthy();
    expect(checker!.getAttribute('aria-hidden')).toBe('true');
    await renderNode('image', { data: { mime: 'image/png' } });
    expect(mountNode.querySelector('[data-testid="cutout-checkerboard"]')).toBeNull();
    await renderNode('image', {
      genStatus: 'generating',
      data: { mime: 'image/png', imageCutout: { sourceAssetId: '5' } },
    });
    expect(mountNode.querySelector('[data-testid="cutout-checkerboard"]')).toBeNull();
  });
});

describe('MediaNode 智能抠像透明结果卡渲染（IKHKAC）', () => {
  it('透明结果卡（transparentOutput 标记）：视频区垫棋盘格底底层 + 左下角「透明背景 · WEBM」角标；无标记卡（MP4 纯色）都不渲染', async () => {
    await renderNode('video', {
      data: { mime: 'video/webm', transparentOutput: true },
    });
    const checker = mountNode.querySelector('[data-testid="video-transparent-checkerboard"]');
    expect(checker).toBeTruthy();
    expect(checker!.getAttribute('aria-hidden')).toBe('true');
    const tag = mountNode.querySelector('[data-testid="video-transparent-tag"]');
    expect(tag).toBeTruthy();
    expect(tag!.textContent).toBe('透明背景 · WEBM');
    await renderNode('video', { data: { mime: 'video/mp4' } });
    expect(mountNode.querySelector('[data-testid="video-transparent-checkerboard"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="video-transparent-tag"]')).toBeNull();
    await renderNode('video', {
      genStatus: 'generating',
      data: { mime: 'video/webm', transparentOutput: true },
    });
    expect(mountNode.querySelector('[data-testid="video-transparent-checkerboard"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="video-transparent-tag"]')).toBeNull();
  });
});

describe('MediaNode draft overlay (IKDMQQ)', () => {
  it('待生成草稿：渲染按类型占位文案而非素材已被删除，无取消/重试按钮', async () => {
    await renderNode('image', { genStatus: 'draft', selected: false, data: { src: '', draft: true } });
    expect(mountNode.textContent).toContain('图片生成');
    expect(mountNode.textContent).not.toContain('素材已被删除');
    expect(mountNode.textContent).not.toContain('取消生成');
    expect(mountNode.textContent).not.toContain('重试');
  });

  it('高清草稿（IKGM9F）：占位文案为「配置参数生成高清图像」', async () => {
    await renderNode('image', {
      genStatus: 'draft',
      selected: false,
      data: { src: '', draft: true, fileName: '高清', imageEnhance: { sourceAssetId: 'a1' } },
    });
    expect(mountNode.textContent).toContain('配置参数生成高清图像');
    expect(mountNode.textContent).not.toContain('图片生成');
    expect(titleRow().textContent).toContain('高清');
  });

  it('HD 草稿（IKH3VG）：视频卡占位文案为「配置参数生成高清视频」', async () => {
    await renderNode('video', {
      genStatus: 'draft',
      selected: false,
      data: { src: '', draft: true, fileName: 'HD', videoEnhance: { sourceAssetId: 'a1' } },
    });
    expect(mountNode.textContent).toContain('配置参数生成高清视频');
    expect(mountNode.textContent).not.toContain('视频生成');
    expect(titleRow().textContent).toContain('HD');
  });

  it('插帧草稿（IKHLKR）：视频卡占位文案为「配置参数生成插帧视频」，标题为「插帧 · 60fps」', async () => {
    await renderNode('video', {
      genStatus: 'draft',
      selected: false,
      data: {
        src: '',
        draft: true,
        fileName: '插帧 · 60fps',
        frameInterpolation: { sourceAssetId: 'a1', lastParams: { fps: 60 } },
      },
    });
    expect(mountNode.textContent).toContain('配置参数生成插帧视频');
    expect(mountNode.textContent).not.toContain('视频生成');
    expect(titleRow().textContent).toContain('插帧 · 60fps');
  });
});

describe('MediaNode generating overlay', () => {
  it('音频混合卡等待删除取消终态时显示正在取消，不出现卡内取消钮', async () => {
    await renderNode('audio', {
      id: 'audio-mix-73', genStatus: 'generating', selected: false,
      data: { src: '', jobId: '73', audioMix: { format: 'mp3' }, audioMixCancelPending: true },
    });
    expect(mountNode.textContent).toContain('正在取消');
    expect(labels()).not.toContain('取消生成');
  });

  it('hides fake progress copy and bar for image generation, keeps cancel', async () => {
    await renderNode('image', { genStatus: 'generating', progress: 0, selected: false });
    expect(mountNode.textContent).not.toContain('正在生成');
    expect(mountNode.textContent).not.toContain('0%');
    expect(mountNode.querySelector('[role="progressbar"]')).toBeNull();
    expect(labels()).toEqual(['取消生成']);
  });

  it('hides fake progress copy and bar for video generation, keeps cancel', async () => {
    await renderNode('video', { genStatus: 'generating', progress: 0, selected: false });
    expect(mountNode.textContent).not.toContain('正在生成');
    expect(mountNode.textContent).not.toContain('0%');
    expect(mountNode.querySelector('[role="progressbar"]')).toBeNull();
    expect(labels()).toEqual(['取消生成']);
  });

  it('keeps extract progress copy and bar for audio video split (IKH28X 更名)', async () => {
    await renderNode('audio', {
      id: 'media-extract-job-1',
      genStatus: 'generating',
      progress: 42,
      selected: false,
    });
    expect(mountNode.textContent).toContain('音视频分离处理中 42%');
    expect(mountNode.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');
    expect(labels()).not.toContain('取消生成');
  });

  it('重新生成中的成品卡继续显示旧素材并叠加状态角标（IKDMQU Q5）', async () => {
    await renderNode('image', {
      genStatus: 'generating',
      progress: 30,
      selected: false,
      data: { src: 'http://img/old.png', fileName: '生成-j1', jobId: 'j1' },
    });
    const overlay = mountNode.querySelector('[data-testid="regen-overlay"]');
    expect(overlay).toBeTruthy();
    expect(overlay!.textContent).toContain('重新生成中 30%');
    expect(overlay!.textContent).toContain('取消');
    expect(mountNode.querySelector('img')?.getAttribute('src')).toBe('http://img/old.png');
  });
});

describe('MediaNode failed overlay', () => {
  it('shows the backend error message instead of 生成失败 for image cards', async () => {
    await renderNode('image', {
      genStatus: 'failed',
      errorText: '账户余额不足，请充值后重试',
      selected: false,
    });
    expect(mountNode.textContent).toContain('账户余额不足，请充值后重试');
    expect(mountNode.textContent).not.toContain('生成失败');
    expect(labels()).toEqual(['重试']);
  });

  it('falls back to 生成失败 when the video card has no backend message', async () => {
    await renderNode('video', { genStatus: 'failed', selected: false });
    expect(mountNode.textContent).toContain('生成失败');
    expect(labels()).toEqual(['重试']);
  });

  it('shows the backend error message for media extraction without duplicating 音频提取失败', async () => {
    await renderNode('audio', {
      id: 'media-extract-job-1',
      genStatus: 'failed',
      errorText: '视频没有音轨',
      selected: false,
    });
    expect(mountNode.textContent).toContain('视频没有音轨');
    expect(mountNode.textContent).not.toContain('音频提取失败');
    expect(labels()).not.toContain('重试');
  });

  it('IKH28X 带身份的失败提取卡渲染重试钮并派发 onRetryJob（原参数重发）', async () => {
    const onRetryJob = vi.fn();
    await renderNode('audio', {
      id: 'media-extract-j9',
      genStatus: 'failed',
      errorText: '音频提取失败，请重试',
      selected: false,
      data: {
        onRetryJob,
        mediaExtract: {
          sourceAssetId: '9',
          lastInput: { source_asset_id: '9', output_format: 'wav' },
        },
      },
    });
    expect(labels()).toContain('重试');
    await act(async () => {
      [...mountNode.querySelectorAll('button')].find((b) => b.textContent?.trim() === '重试')!.click();
    });
    expect(onRetryJob).toHaveBeenCalledWith('media-extract-j9');
  });
});

describe('MediaNode 一键修复按钮（IKJ79D：按码识别，零文案匹配）', () => {
  it('视频失败卡收到比例约束码（数值 1060）→ 显示「改为跟随视频并重试」并派发回调', async () => {
    const onFixFollowVideo = vi.fn();
    await renderNode('video', {
      id: 'media-gen-31',
      genStatus: 'failed',
      errorText: '提示词包含修改、替换或延长原视频的意图，输出比例将自动跟随参考视频，请将比例切换为「自动」后重试',
      selected: false,
      data: { errorCode: 1060, onFixFollowVideo },
    });
    const fix = [...mountNode.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '改为跟随视频并重试',
    );
    expect(fix).toBeTruthy();
    await act(async () => fix!.click());
    expect(onFixFollowVideo).toHaveBeenCalledWith('media-gen-31');
  });

  it('worker 归类信封（字符串 task_type_param_constraint）同码同显', async () => {
    await renderNode('video', {
      genStatus: 'failed',
      selected: false,
      data: { errorCode: 'task_type_param_constraint', onFixFollowVideo: vi.fn() },
    });
    expect(labels()).toContain('改为跟随视频并重试');
  });

  it('其他错误码（如 quota_exhausted=1001）→ 不显示一键修复，只有重试', async () => {
    await renderNode('video', {
      genStatus: 'failed',
      errorText: '积分不足',
      selected: false,
      data: { errorCode: 1001, onFixFollowVideo: vi.fn() },
    });
    expect(labels()).not.toContain('改为跟随视频并重试');
    expect(labels()).toContain('重试');
  });

  it('比例约束码但图片失败卡 → 不显示（一键修复仅视频）', async () => {
    await renderNode('image', {
      genStatus: 'failed',
      selected: false,
      data: { errorCode: 1060, onFixFollowVideo: vi.fn() },
    });
    expect(labels()).not.toContain('改为跟随视频并重试');
  });

  it('有旧素材的失败成品卡（fail-overlay 分支）同样按码显示一键修复', async () => {
    await renderNode('video', {
      genStatus: 'failed',
      selected: false,
      data: { src: 'http://img/old.mp4', errorCode: 1060, onFixFollowVideo: vi.fn() },
    });
    const overlay = mountNode.querySelector('[data-testid="fail-overlay"]');
    expect(overlay).toBeTruthy();
    expect(overlay!.textContent).toContain('改为跟随视频并重试');
  });

  it('IKJFGQ 字符串码 + 手选比例（16:9）→ 修复钮显示（数值码撞号重排后字符串锚点仍工作）', async () => {
    await renderNode('video', {
      genStatus: 'failed',
      selected: false,
      data: { errorCode: 'task_type_param_constraint', draftRatio: '16:9', onFixFollowVideo: vi.fn() },
    });
    expect(labels()).toContain('改为跟随视频并重试');
  });

  it('IKJFGQ 比例已 adaptive + 数值码 1060 → 不显示修复钮，降级普通重试', async () => {
    await renderNode('video', {
      genStatus: 'failed',
      selected: false,
      data: { errorCode: 1060, draftRatio: 'adaptive', onFixFollowVideo: vi.fn() },
    });
    expect(labels()).not.toContain('改为跟随视频并重试');
    expect(labels()).toContain('重试');
  });

  it('IKJFGQ 比例已 adaptive + 字符串码 → 同样降级普通重试', async () => {
    await renderNode('video', {
      genStatus: 'failed',
      selected: false,
      data: { errorCode: 'task_type_param_constraint', draftRatio: 'adaptive', onFixFollowVideo: vi.fn() },
    });
    expect(labels()).not.toContain('改为跟随视频并重试');
    expect(labels()).toContain('重试');
  });
});

describe('MediaNode 音频混合失败卡（IKI697）', () => {
  it('显示服务端原因与同卡重试入口，失败态不可播放', async () => {
    const onRetryJob = vi.fn();
    await renderNode('audio', {
      id: 'audio-mix-73', selected: false, genStatus: 'failed',
      errorText: '供应商任务失败', data: { jobId: '73', audioMix: { format: 'mp3' }, src: '', onRetryJob },
    });
    expect(mountNode.textContent).toContain('供应商任务失败');
    expect(mountNode.querySelector('audio')).toBeNull();
    const retry = [...mountNode.querySelectorAll('button')].find((button) => button.textContent?.trim() === '重试');
    expect(retry).toBeTruthy();
    await act(async () => retry!.click());
    expect(onRetryJob).toHaveBeenCalledWith('audio-mix-73');
  });
});

describe('MediaNode 插帧草稿卡（IKHLKX）', () => {
  it('生成中：仅转圈与「取消生成」，不展示百分比/进度条（插帧不属钱已扣画布工具卡，可取消）', async () => {
    const onCancelJob = vi.fn();
    await renderNode('video', {
      id: 'media-draft-7',
      genStatus: 'generating',
      progress: 42,
      selected: false,
      data: { src: '', draft: true, onCancelJob, frameInterpolation: { sourceAssetId: '5', lastParams: { fps: 60 } } },
    });
    expect(labels()).toEqual(['取消生成']);
    expect(mountNode.querySelector('[role="progressbar"]')).toBeNull();
    expect(mountNode.textContent).not.toContain('42');
    expect(mountNode.textContent).not.toContain('预计');
    await act(async () => {
      [...mountNode.querySelectorAll('button')].find((b) => b.textContent?.trim() === '取消生成')!.click();
    });
    expect(onCancelJob).toHaveBeenCalledWith('media-draft-7');
  });

  it('失败：带冻结源素材的插帧卡渲染重试钮并派发 onRetryJob（原 fps 重发）', async () => {
    const onRetryJob = vi.fn();
    await renderNode('video', {
      id: 'media-draft-7',
      genStatus: 'failed',
      errorText: '视频插帧失败，请重试',
      selected: false,
      data: { src: '', draft: true, onRetryJob, frameInterpolation: { sourceAssetId: '5', lastParams: { fps: 30 } } },
    });
    expect(mountNode.textContent).toContain('视频插帧失败，请重试');
    expect(labels()).toEqual(['重试']);
    await act(async () => {
      [...mountNode.querySelectorAll('button')].find((b) => b.textContent?.trim() === '重试')!.click();
    });
    expect(onRetryJob).toHaveBeenCalledWith('media-draft-7');
  });

  it('失败但身份残缺（无冻结源素材）：不渲染重试钮（同 media_extract / audio_trim 身份守卫口径）', async () => {
    await renderNode('video', {
      id: 'media-draft-7',
      genStatus: 'failed',
      errorText: '视频插帧失败，请重试',
      selected: false,
      data: { src: '', draft: true, frameInterpolation: { lastParams: { fps: 30 } } },
    });
    expect(mountNode.textContent).toContain('视频插帧失败，请重试');
    expect(labels()).not.toContain('重试');
  });
});

describe('MediaNode failed overlay with old media (IKDMQV)', () => {
  it('重新生成失败的成品卡保留旧素材，失败原因与重试收进底部角标', async () => {
    await renderNode('image', {
      genStatus: 'failed',
      errorText: '内容审核未通过',
      selected: false,
      data: { src: 'http://img/old.png', fileName: '生成-j1', jobId: 'j1' },
    });
    expect(mountNode.querySelector('img')?.getAttribute('src')).toBe('http://img/old.png');
    const overlay = mountNode.querySelector('[data-testid="fail-overlay"]');
    expect(overlay).toBeTruthy();
    expect(overlay!.textContent).toContain('内容审核未通过');
    expect(overlay!.textContent).toContain('重试');
    expect(mountNode.textContent).not.toContain('生成失败');
  });

  it('失败成品卡的角标重试点击派发 onRetryJob（沿用失败任务快照的入口）', async () => {
    const onRetryJob = vi.fn();
    await renderNode('image', {
      genStatus: 'failed',
      errorText: '内容审核未通过',
      selected: false,
      data: { src: 'http://img/old.png', fileName: '生成-j1', jobId: 'j1', onRetryJob },
    });
    const overlay = mountNode.querySelector('[data-testid="fail-overlay"]')!;
    const retry = [...overlay.querySelectorAll('button')].find((b) => b.textContent?.trim() === '重试')!;
    await act(async () => {
      retry.click();
    });
    expect(onRetryJob).toHaveBeenCalledWith('image-node');
  });

  it('无后端原因时角标回退「生成失败」文案', async () => {
    await renderNode('video', {
      genStatus: 'failed',
      selected: false,
      data: { src: 'http://img/old.mp4', fileName: '生成-j1', jobId: 'j1' },
    });
    const overlay = mountNode.querySelector('[data-testid="fail-overlay"]');
    expect(overlay!.textContent).toContain('生成失败');
    expect(overlay!.textContent).toContain('重试');
    expect(mountNode.querySelector('canvas')).toBeTruthy();
  });

  it('取消态成品卡显示旧素材与「已取消生成」角标，不提供重试', async () => {
    await renderNode('image', {
      genStatus: 'cancelled',
      selected: false,
      data: { src: 'http://img/old.png', fileName: '生成-j1', jobId: 'j1' },
    });
    expect(mountNode.querySelector('img')?.getAttribute('src')).toBe('http://img/old.png');
    const overlay = mountNode.querySelector('[data-testid="fail-overlay"]');
    expect(overlay!.textContent).toContain('已取消生成');
    expect(labels()).toEqual([]);
  });

  it('无旧素材的失败草稿卡维持占位与重试按钮（现状回归）', async () => {
    await renderNode('image', {
      genStatus: 'failed',
      errorText: '配额不足',
      selected: false,
      data: { src: '', draft: true, jobId: 'j1' },
    });
    expect(mountNode.querySelector('[data-testid="fail-overlay"]')).toBeNull();
    expect(mountNode.textContent).toContain('配额不足');
    expect(labels()).toEqual(['重试']);
  });
});

describe('MediaNode external title (image/video)', () => {
  it('shows real resolution for images without file size', async () => {
    await renderNode('image', {
      selected: false,
      data: { fileName: 'photo.png', width: 1600, height: 900, size: 2.4 * 1024 * 1024 },
    });
    const title = titleRow().textContent ?? '';
    expect(title).toContain('photo.png');
    expect(title).toContain('1600×900');
    expect(title).not.toContain('MB');
  });

  it('shows resolution and duration for videos', async () => {
    await renderNode('video', {
      selected: false,
      data: { fileName: 'clip.mp4', width: 1920, height: 1080, duration: 12.4, size: 8 * 1024 * 1024 },
    });
    const title = titleRow().textContent ?? '';
    expect(title).toContain('1920×1080');
    expect(title).toContain('12s');
    expect(title).not.toContain('MB');
  });

  it('shows the Seedance compliance icon above the image when compliancePassed', async () => {
    await renderNode('image', {
      selected: false,
      data: { fileName: 'photo.png', compliancePassed: true },
    });
    const badge = titleRow().querySelector('img[src="/success.png"]');
    expect(badge).toBeTruthy();
    expect(titleRow().querySelector('[title="校验通过，可用于seedance视频生成"]')).toBeTruthy();
  });

  it('does not show the Seedance compliance icon when the node is not verified', async () => {
    await renderNode('image', { selected: false, data: { fileName: 'photo.png' } });
    expect(titleRow().querySelector('img[src="/success.png"]')).toBeNull();
  });

  it('leaves meta blank when real dims are missing', async () => {
    await renderNode('image', { selected: false, data: { fileName: 'unknown.png' } });
    const title = titleRow().textContent ?? '';
    expect(title).toContain('unknown.png');
    expect(title).not.toContain('×');
  });

  it('never shows the target ratio as resolution', async () => {
    await renderNode('image', {
      selected: false,
      genStatus: 'generating',
      data: { fileName: '图片生成中', targetRatio: '16:9' },
    });
    const title = titleRow().textContent ?? '';
    expect(title).not.toContain('16:9');
    expect(title).not.toContain('×');
  });

  it('still shows known real dims on a failed node (缺失项留空，已知项照显)', async () => {
    await renderNode('video', {
      selected: false,
      genStatus: 'failed',
      data: { width: 1920, height: 1080, duration: 8 },
    });
    const title = titleRow().textContent ?? '';
    expect(title).toContain('1920×1080');
    expect(title).toContain('8s');
  });

  it('sizes the content body by real dims and ignores title/toolbar', async () => {
    await renderNode('image', {
      selected: false,
      data: { width: 1600, height: 900 },
    });
    const card = contentCard();
    expect(parseFloat(card.style.width)).toBeCloseTo(497.8, 1);
    expect(parseFloat(card.style.height)).toBeCloseTo(280, 1);
  });

  it('sizes a generating placeholder by targetRatio, else 280×280', async () => {
    await renderNode('image', {
      selected: false,
      genStatus: 'generating',
      data: { targetRatio: '16:9' },
    });
    expect(parseFloat(contentCard().style.width)).toBeCloseTo(497.8, 1);
    expect(parseFloat(contentCard().style.height)).toBeCloseTo(280, 1);

    await renderNode('video', { selected: false, genStatus: 'generating' });
    expect(parseFloat(contentCard().style.width)).toBeCloseTo(280, 1);
    expect(parseFloat(contentCard().style.height)).toBeCloseTo(280, 1);
  });

  it('keeps the known shape on failure', async () => {
    await renderNode('video', {
      selected: false,
      genStatus: 'failed',
      data: { targetRatio: '9:16' },
    });
    expect(parseFloat(contentCard().style.width)).toBeCloseTo(280, 1);
    expect(parseFloat(contentCard().style.height)).toBeCloseTo(497.8, 1);
  });
});

describe('MediaNode audio layout', () => {
  it('uses the external title and content body like image/video', async () => {
    await renderNode('audio', { selected: false, data: { fileName: '配音.wav', duration: 37.6 } });
    expect(titleRow().textContent).toContain('配音.wav');
    expect(contentCard()).toBeTruthy();
  });

  it('shows only the real duration in the title, never size or resolution', async () => {
    await renderNode('audio', {
      selected: false,
      data: { fileName: '配音.wav', duration: 37.6, size: 4.2 * 1024 * 1024, width: 1600, height: 900 },
    });
    const title = titleRow().textContent ?? '';
    expect(title).toContain('38s');
    expect(title).not.toContain('MB');
    expect(title).not.toContain('×');
  });

  it('leaves the title meta blank when duration is unknown', async () => {
    await renderNode('audio', { selected: false, data: { fileName: '配音.wav' } });
    const meta = titleRow().lastElementChild?.textContent ?? '';
    expect(meta.trim()).toBe('');
  });

  it('keeps the content body landscape regardless of dims or target ratio (IKH8PU)', async () => {
    await renderNode('audio', { selected: false, data: { width: 1600, height: 900, targetRatio: '16:9' } });
    expect(parseFloat(contentCard().style.width)).toBe(480);
    expect(parseFloat(contentCard().style.height)).toBe(240);
  });

  it('keeps player controls reachable and out of the node drag path', async () => {
    await renderNode('audio', { selected: false, data: { toolMode: 'select' } });
    const audio = mountNode.querySelector('audio');
    expect(audio).toBeTruthy();
    const playButton = contentCard().querySelector<HTMLButtonElement>('button[aria-label="播放"]')!;
    expect(playButton).toBeTruthy();
    expect(playButton.classList.contains('nodrag')).toBe(true);
    expect(playButton.classList.contains('nopan')).toBe(true);
    const play = vi.spyOn(audio!, 'play').mockImplementation(async () => {
      Object.defineProperty(audio, 'paused', { configurable: true, value: false });
      audio!.dispatchEvent(new Event('play'));
    });
    const pause = vi.spyOn(audio!, 'pause').mockImplementation(() => {
      Object.defineProperty(audio, 'paused', { configurable: true, value: true });
      audio!.dispatchEvent(new Event('pause'));
    });
    await act(async () => { playButton.click(); });
    expect(play).toHaveBeenCalledTimes(1);
    expect(playButton.getAttribute('aria-label')).toBe('暂停');
    await act(async () => { playButton.click(); });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(playButton.getAttribute('aria-label')).toBe('播放');

    const track = audio!.parentElement!.querySelector<HTMLElement>('div.nodrag.nopan')!;
    expect(track).toBeTruthy();
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200 } as DOMRect);
    Object.defineProperty(audio, 'duration', { configurable: true, value: 100 });
    await act(async () => { audio!.dispatchEvent(new Event('loadedmetadata')); });
    await act(async () => {
      track.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true }));
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, bubbles: true }));
    });
    expect(audio!.currentTime).toBe(50);
  });

  it('keeps the landscape body for generating, failed and missing audio (IKH8PU)', async () => {
    await renderNode('audio', { selected: false, genStatus: 'generating', progress: 0 });
    expect(parseFloat(contentCard().style.width)).toBe(480);
    expect(parseFloat(contentCard().style.height)).toBe(240);

    await renderNode('audio', { selected: false, genStatus: 'failed', errorText: '视频没有音轨' });
    expect(mountNode.textContent).toContain('视频没有音轨');
    expect(parseFloat(contentCard().style.height)).toBe(240);

    await renderNode('audio', { selected: false, data: { assetMissing: true } });
    expect(mountNode.textContent).toContain('素材已被删除');
    expect(parseFloat(contentCard().style.height)).toBe(240);
  });

  it('renders the densified waveform structure inside the seek track (IKH8PU)', async () => {
    await renderNode('audio', { selected: false, data: { toolMode: 'select' } });
    const track = mountNode.querySelector<HTMLElement>('audio')!.parentElement!.querySelector<HTMLElement>('div.nodrag.nopan')!;
    expect(track).toBeTruthy();
    expect(track.querySelectorAll('span').length).toBe(72);
    const directDivs = [...track.children].filter((el) => el.tagName === 'DIV');
    expect(directDivs.length).toBe(2);
  });
});

describe('MediaNode browser-measured dims fill-in', () => {
  it('reports real image dims on load when missing', async () => {
    const onMediaDims = vi.fn();
    await renderNode('image', { selected: false, data: { onMediaDims } });
    const img = mountNode.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 1600, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 900, configurable: true });
    await act(async () => {
      img.dispatchEvent(new Event('load'));
    });
    expect(onMediaDims).toHaveBeenCalledWith('image-node', { width: 1600, height: 900 });
  });

  it('does not report when dims already match', async () => {
    const onMediaDims = vi.fn();
    await renderNode('image', { selected: false, data: { width: 1600, height: 900, onMediaDims } });
    const img = mountNode.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 1600, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 900, configurable: true });
    await act(async () => {
      img.dispatchEvent(new Event('load'));
    });
    expect(onMediaDims).not.toHaveBeenCalled();
  });

  it('reports video dims and duration on loadedmetadata when duration missing', async () => {
    const onMediaDims = vi.fn();
    await renderNode('video', { selected: false, data: { width: 1920, height: 1080, onMediaDims } });
    const video = offscreenVideo();
    Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
    Object.defineProperty(video, 'duration', { value: 12.4, configurable: true });
    await act(async () => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(onMediaDims).toHaveBeenCalledWith('video-node', { width: 1920, height: 1080, duration: 12.4 });
  });
});

describe('MediaNode 视频双源与播放失败兜底', () => {
  it('videoSourceList：主源不标 codecs，H.264 兜底标 avc1，相同地址去重', () => {
    expect(videoSourceList('a.mp4', 'b.mp4')).toEqual([
      { src: 'a.mp4', type: 'video/mp4' },
      { src: 'b.mp4', type: 'video/mp4; codecs="avc1"' },
    ]);
    expect(videoSourceList('a.mp4')).toEqual([{ src: 'a.mp4', type: 'video/mp4' }]);
    expect(videoSourceList('a.mp4', 'a.mp4')).toEqual([{ src: 'a.mp4', type: 'video/mp4' }]);
    expect(videoSourceList(undefined, 'b.mp4')).toEqual([
      { src: 'b.mp4', type: 'video/mp4; codecs="avc1"' },
    ]);
  });

  it('渲染双 source：主源无 codecs、兜底带 avc1；无兜底时单 source', async () => {
    await renderNode('video', { data: { src: 'https://x/main.mp4', srcH264: 'https://x/fallback.mp4' } });
    let sources: Element[] = [...offscreenVideo().querySelectorAll('source')];
    expect(sources).toHaveLength(2);
    expect(sources[0].getAttribute('src')).toBe('https://x/main.mp4');
    expect(sources[0].getAttribute('type')).toBe('video/mp4');
    expect(sources[1].getAttribute('src')).toBe('https://x/fallback.mp4');
    expect(sources[1].getAttribute('type')).toBe('video/mp4; codecs="avc1"');
    await rerenderNode('video', { data: { src: 'https://x/main.mp4', srcH264: 'https://x/fallback.mp4', toolMode: 'select' } });
    await waitForVideoArm();
    sources = [...mountNode.querySelectorAll('video source')];
    expect(sources).toHaveLength(2);
    await rerenderNode('video', { data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    expect([...mountNode.querySelectorAll('video source')]).toHaveLength(1);
  });

  it('video error（code 4）渲染兜底占位与新窗口链接，src 变化复位', async () => {
    await renderNode('video', { data: { src: 'https://x/main.mp4' } });
    const video = offscreenVideo();
    Object.defineProperty(video, 'error', { value: { code: 4 }, configurable: true });
    await act(async () => {
      video.dispatchEvent(new Event('error'));
    });
    const box = mountNode.querySelector('[data-testid="video-error-box"]');
    expect(box).toBeTruthy();
    expect(box!.textContent).toContain('浏览器不支持该视频编码');
    const link = box!.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://x/main.mp4');
    expect(link?.getAttribute('target')).toBe('_blank');
    await rerenderNode('video', { data: { src: 'https://x/other.mp4' } });
    expect(mountNode.querySelector('[data-testid="video-error-box"]')).toBeNull();
    expect(mountNode.querySelector('canvas')).toBeTruthy();
    await rerenderNode('video', { data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    await waitForVideoArm();
    const armedVideo = mountNode.querySelector('video')!;
    Object.defineProperty(armedVideo, 'error', { value: { code: 4 }, configurable: true });
    await act(async () => {
      armedVideo.dispatchEvent(new Event('error'));
    });
    expect(mountNode.querySelector('[data-testid="video-error-box"]')).toBeTruthy();
  });

  it('code 1（换源主动中止）不触发错误占位', async () => {
    await renderNode('video', { data: { src: 'https://x/main.mp4' } });
    const video = offscreenVideo();
    Object.defineProperty(video, 'error', { value: { code: 1 }, configurable: true });
    await act(async () => {
      video.dispatchEvent(new Event('error'));
    });
    expect(mountNode.querySelector('[data-testid="video-error-box"]')).toBeNull();
    expect(mountNode.querySelector('canvas')).toBeTruthy();
  });

  it('静默解码失败（readyState≥2 但 videoWidth=0，无 error 事件）渲染兜底占位', async () => {
    await renderNode('video', { data: { src: 'https://x/main.mp4' } });
    const video = offscreenVideo();
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    await act(async () => {
      video.dispatchEvent(new Event('loadeddata'));
    });
    const box = mountNode.querySelector('[data-testid="video-error-box"]');
    expect(box).toBeTruthy();
    expect(box!.textContent).toContain('浏览器不支持该视频编码');
  });
});

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function keyOn(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}

describe('MediaNode card rename (IKFA8X)', () => {
  function titleInput(): HTMLInputElement | null {
    return titleRow().querySelector('input');
  }

  async function startRename() {
    await act(async () => {
      titleRow().querySelector('span')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
  }

  it('双击名称原位进入编辑，输入框带出当前名称', async () => {
    await renderNode('image', { data: { fileName: '海边日落.png', onTitleChange: vi.fn() } });
    expect(titleInput()).toBeNull();
    await startRename();
    expect(titleInput()?.value).toBe('海边日落.png');
  });

  it('回车保存去掉首尾空格后的名称并退出编辑', async () => {
    const onTitleChange = vi.fn();
    await renderNode('image', { data: { fileName: '海边日落.png', onTitleChange } });
    await startRename();
    await typeInto(titleInput()!, '  我的封面图  ');
    await keyOn(titleInput()!, 'Enter');
    expect(onTitleChange).toHaveBeenCalledWith('image-node', '我的封面图');
    expect(titleInput()).toBeNull();
  });

  it('失焦（点击别处）同样保存名称', async () => {
    const onTitleChange = vi.fn();
    await renderNode('video', { data: { fileName: '片段.mp4', onTitleChange } });
    await startRename();
    await typeInto(titleInput()!, '成片');
    await act(async () => {
      titleInput()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onTitleChange).toHaveBeenCalledWith('video-node', '成片');
    expect(titleInput()).toBeNull();
  });

  it('回车保存后的失焦不重复提交', async () => {
    const onTitleChange = vi.fn();
    await renderNode('image', { data: { fileName: 'a.png', onTitleChange } });
    await startRename();
    await typeInto(titleInput()!, 'b.png');
    await keyOn(titleInput()!, 'Enter');
    expect(onTitleChange).toHaveBeenCalledTimes(1);
  });

  it('Esc 恢复编辑前名称，随后的失焦不再保存取消内容', async () => {
    const onTitleChange = vi.fn();
    await renderNode('image', { data: { fileName: '海边日落.png', onTitleChange } });
    await startRename();
    await typeInto(titleInput()!, '被放弃的名字');
    await keyOn(titleInput()!, 'Escape');
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(titleInput()).toBeNull();
    expect(titleRow().textContent).toContain('海边日落.png');
  });

  it('空白或全空格提交保留原名', async () => {
    const onTitleChange = vi.fn();
    await renderNode('image', { data: { fileName: '海边日落.png', onTitleChange } });
    await startRename();
    await typeInto(titleInput()!, '   ');
    await keyOn(titleInput()!, 'Enter');
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(titleInput()).toBeNull();
    expect(titleRow().textContent).toContain('海边日落.png');
  });

  it('名称未变化时提交不触发回调', async () => {
    const onTitleChange = vi.fn();
    await renderNode('image', { data: { fileName: '海边日落.png', onTitleChange } });
    await startRename();
    await keyOn(titleInput()!, 'Enter');
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(titleInput()).toBeNull();
  });

  it('100 个字符可保存', async () => {
    const onTitleChange = vi.fn();
    await renderNode('image', { data: { fileName: 'a.png', onTitleChange } });
    const name = '鲸'.repeat(100);
    await startRename();
    await typeInto(titleInput()!, name);
    await keyOn(titleInput()!, 'Enter');
    expect(onTitleChange).toHaveBeenCalledWith('image-node', name);
  });

  it('101 个字符提示超长：保留编辑内容、不保存、不截断', async () => {
    const onTitleChange = vi.fn();
    await renderNode('image', { data: { fileName: 'a.png', onTitleChange } });
    const name = '鲸'.repeat(101);
    await startRename();
    await typeInto(titleInput()!, name);
    await keyOn(titleInput()!, 'Enter');
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(mountNode.querySelector('[role="alert"]')?.textContent).toContain('100');
    expect(titleInput()?.value).toBe(name);
  });

  it('超长报错后失焦不写入，修正后仍可正常保存', async () => {
    const onTitleChange = vi.fn();
    await renderNode('image', { data: { fileName: 'a.png', onTitleChange } });
    await startRename();
    await typeInto(titleInput()!, '鲸'.repeat(101));
    await act(async () => {
      titleInput()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onTitleChange).not.toHaveBeenCalled();
    await typeInto(titleInput()!, '修正后的名字');
    await keyOn(titleInput()!, 'Enter');
    expect(onTitleChange).toHaveBeenCalledWith('image-node', '修正后的名字');
    expect(mountNode.querySelector('[role="alert"]')).toBeNull();
  });

  it('中文输入法组合期间的回车不提交', async () => {
    const onTitleChange = vi.fn();
    await renderNode('image', { data: { fileName: 'a.png', onTitleChange } });
    await startRename();
    await typeInto(titleInput()!, '拼音');
    await keyOn(titleInput()!, 'Enter', { isComposing: true });
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(titleInput()).not.toBeNull();
    await keyOn(titleInput()!, 'Enter');
    expect(onTitleChange).toHaveBeenCalledWith('image-node', '拼音');
  });

  it('待生成草稿卡同样可改名', async () => {
    const onTitleChange = vi.fn();
    await renderNode('video', { genStatus: 'draft', data: { fileName: '视频草稿', onTitleChange } });
    await startRename();
    await typeInto(titleInput()!, '片头动画');
    await keyOn(titleInput()!, 'Enter');
    expect(onTitleChange).toHaveBeenCalledWith('video-node', '片头动画');
  });
});

describe('MediaNode 去字幕编辑态框层（IKGZ83）', () => {
  it('注入 subtitleEraseEditing：渲染框层并暂停视频；未注入不渲染', async () => {
    const editing = {
      boxes: [{ kind: 'box' as const, from: { x: 10, y: 10 }, to: { x: 100, y: 60 } }],
      liveBox: null,
      onBoxStart: () => {},
      onBoxMove: () => {},
      onBoxEnd: () => {},
    };
    const pauseSpy = vi.fn();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseSpy);
    await renderNode('video', { data: { toolMode: 'select' } });
    await waitForVideoArm();
    expect(mountNode.querySelector('video')).toBeTruthy();
    await rerenderNode('video', { data: { toolMode: 'select', subtitleEraseEditing: editing } });
    expect(pauseSpy).toHaveBeenCalled();
    pause.mockRestore();
    const layer = mountNode.querySelector('[data-testid="subtitle-erase-boxes-layer"]');
    expect(layer).toBeTruthy();
    expect(layer!.className).toContain('nodrag');
    expect(layer!.className).toContain('nopan');
    await renderNode('video', { data: { toolMode: 'select' } });
    expect(mountNode.querySelector('[data-testid="subtitle-erase-boxes-layer"]')).toBeNull();
  });

  it('会话锁定期关播放控件与指针，智能与框选两模式都生效；无标记时播放能力可达', async () => {
    await renderNode('video', { data: { toolMode: 'select', subtitleErasePaused: true } });
    expect(mountNode.querySelector('video')).toBeNull();
    expect(mountNode.querySelector('canvas')).toBeTruthy();
    const pauseSpy = vi.fn();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseSpy);
    await rerenderNode('video', { data: { toolMode: 'select' } });
    await waitForVideoArm();
    await rerenderNode('video', { data: { toolMode: 'select', subtitleErasePaused: true } });
    expect(pauseSpy).toHaveBeenCalled();
    pause.mockRestore();
    const editing = {
      boxes: [],
      liveBox: null,
      onBoxStart: () => {},
      onBoxMove: () => {},
      onBoxEnd: () => {},
    };
    await renderNode('video', { data: { toolMode: 'select', subtitleEraseEditing: editing } });
    expect(mountNode.querySelector('video')).toBeNull();
    expect(mountNode.querySelector('[data-testid="subtitle-erase-boxes-layer"]')).toBeTruthy();
    await renderNode('video', { data: { toolMode: 'select' } });
    await waitForVideoArm();
    const normalVideo = mountNode.querySelector('video')!;
    expect(normalVideo.hasAttribute('controls')).toBe(false);
    expect(normalVideo.classList.contains('nodrag')).toBe(false);
    expect(contentCard().querySelector('button[aria-label="播放"]')).toBeTruthy();
  });
});

describe('MediaNode 音视频分离编辑态锁定层（IKH28U）', () => {
  it('注入 splitEditing：渲染锁定层并暂停视频；未注入不渲染', async () => {
    const pauseSpy = vi.fn();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseSpy);
    await renderNode('video', { data: { toolMode: 'select' } });
    await waitForVideoArm();
    await rerenderNode('video', { data: { toolMode: 'select', splitEditing: true } });
    expect(pauseSpy).toHaveBeenCalled();
    pause.mockRestore();
    const layer = mountNode.querySelector('[data-testid="split-lock-layer"]');
    expect(layer).toBeTruthy();
    expect(layer!.className).toContain('nodrag');
    expect(layer!.className).toContain('nopan');
    await renderNode('video', { data: { toolMode: 'select' } });
    expect(mountNode.querySelector('[data-testid="split-lock-layer"]')).toBeNull();
  });
});

describe('MediaNode 视频画面区拖拽与自绘控件（IKI5YM）', () => {
  it('武装后画面区回归节点拖拽路径：树内 video 无 nodrag/nopan、无原生 controls、禁原生拖放', async () => {
    await renderNode('video', { data: { toolMode: 'select' } });
    await waitForVideoArm();
    const video = mountNode.querySelector('video')!;
    expect(video).toBeTruthy();
    expect(video.classList.contains('nodrag')).toBe(false);
    expect(video.classList.contains('nopan')).toBe(false);
    expect(video.hasAttribute('controls')).toBe(false);
    expect(video.draggable).toBe(false);
    await renderNode('video', { selected: false, data: { toolMode: 'select' } });
    const poster = mountNode.querySelector('canvas')!;
    expect(poster).toBeTruthy();
    expect(poster.classList.contains('nodrag')).toBe(false);
  });

  it('自绘播放控件可达且不入拖拽路径：播放钮切换播放/暂停，进度轨点按与拖拽 seek', async () => {
    await renderNode('video', { data: { toolMode: 'select', duration: 100 } });
    await waitForVideoArm();
    const video = mountNode.querySelector('video')!;
    const playButton = contentCard().querySelector<HTMLButtonElement>('button[aria-label="播放"]')!;
    expect(playButton).toBeTruthy();
    expect(playButton.classList.contains('nodrag')).toBe(true);
    expect(playButton.classList.contains('nopan')).toBe(true);
    const play = vi.spyOn(video, 'play').mockImplementation(async () => {
      Object.defineProperty(video, 'paused', { configurable: true, value: false });
      video.dispatchEvent(new Event('play'));
    });
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {
      Object.defineProperty(video, 'paused', { configurable: true, value: true });
      video.dispatchEvent(new Event('pause'));
    });
    await act(async () => { playButton.click(); });
    expect(play).toHaveBeenCalledTimes(1);
    expect(playButton.getAttribute('aria-label')).toBe('暂停');
    await act(async () => { playButton.click(); });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(playButton.getAttribute('aria-label')).toBe('播放');

    const track = contentCard().querySelector<HTMLElement>('[data-testid="video-seek-track"]')!;
    expect(track).toBeTruthy();
    expect(track.classList.contains('nodrag')).toBe(true);
    expect(track.classList.contains('nopan')).toBe(true);
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200 } as DOMRect);
    await act(async () => {
      track.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, bubbles: true }));
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 150, bubbles: true }));
    });
    expect(document.activeElement).toBe(track);
    expect(video.currentTime).toBe(75);
    expect(track.getAttribute('aria-valuenow')).toBe('75');
    expect(track.parentElement!.textContent).toContain('1:15');
    await act(async () => {
      track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    expect(video.currentTime).toBe(80);
    await act(async () => {
      track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    });
    expect(video.currentTime).toBe(75);
  });

  it('画面区点击切换播放/暂停；按住位移后松开（拖动整卡）不误触播放', async () => {
    await renderNode('video', { data: { toolMode: 'select' } });
    await waitForVideoArm();
    const video = mountNode.querySelector('video')!;
    const play = vi.spyOn(video, 'play').mockImplementation(async () => {
      Object.defineProperty(video, 'paused', { configurable: true, value: false });
      video.dispatchEvent(new Event('play'));
    });
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {
      Object.defineProperty(video, 'paused', { configurable: true, value: true });
      video.dispatchEvent(new Event('pause'));
    });
    await act(async () => {
      video.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
      video.dispatchEvent(new MouseEvent('click', { clientX: 80, clientY: 40, bubbles: true }));
    });
    expect(play).not.toHaveBeenCalled();
    await act(async () => {
      video.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
      video.dispatchEvent(new MouseEvent('click', { clientX: 12, clientY: 12, bubbles: true }));
    });
    expect(play).toHaveBeenCalledTimes(1);
    await act(async () => {
      video.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
      video.dispatchEvent(new MouseEvent('click', { clientX: 12, clientY: 12, bubbles: true }));
    });
    expect(pause).toHaveBeenCalledTimes(1);
  });
});

describe('MediaNode 手柄显隐翻转重测（IKHIT1）', () => {
  it('draft 挂载首测与显隐不变的 rerender 都不调；draft→generating 翻转重测一次', async () => {
    updateNodeInternalsMock.mockClear();
    await renderNode('image', { genStatus: 'draft', data: { src: '', draft: true } });
    expect(updateNodeInternalsMock).not.toHaveBeenCalled();
    await rerenderNode('image', { genStatus: 'draft', data: { src: '', draft: true, fileName: '改名后' } });
    expect(updateNodeInternalsMock).not.toHaveBeenCalled();
    await rerenderNode('image', { genStatus: 'generating', progress: 0 });
    expect(updateNodeInternalsMock).toHaveBeenCalledTimes(1);
    expect(updateNodeInternalsMock).toHaveBeenCalledWith('image-node');
  });
});

describe('MediaNode 视频卡悬停自动播放预览（IKJ7RS，未选中卡基础链路）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const boxEditing = {
    boxes: [],
    liveBox: null,
    onBoxStart: () => {},
    onBoxMove: () => {},
    onBoxEnd: () => {},
  };

  const hoverExclusionCases: Array<[string, RenderExtra]> = [
    ['去字幕会话锁定（智能模式停帧标记）', { data: { subtitleErasePaused: true } }],
    ['去字幕会话锁定（框选模式框层注入）', { data: { subtitleEraseEditing: boxEditing } }],
    ['音视频分离/场景切分/人声背景/抠像会话锁定', { data: { splitEditing: true } }],
    ['重生成中的成品卡', { genStatus: 'generating', progress: 30 }],
    ['失败成品卡（旧素材兜底）', { genStatus: 'failed' }],
    ['已取消成品卡', { genStatus: 'cancelled' }],
    ['待生成草稿', { genStatus: 'draft', data: { src: '', draft: true } }],
    ['素材缺失', { data: { assetMissing: true } }],
    ['空壳占位', { data: { emptyShell: true } }],
    ['抓手（拖动）工具模式', { data: { toolMode: 'drag' } }],
    ['blob 上传预览 src', { data: { src: 'blob:upload-preview' } }],
  ];

  async function renderHoverableVideo(extraData: Record<string, unknown> = {}) {
    await renderNode('video', {
      selected: false,
      data: { src: 'https://x/main.mp4', toolMode: 'select', ...extraData },
    });
  }

  it('进入内容区满 100ms：离屏解码元素移入播放层，有声、从头开播（currentTime=0）且无控件', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderHoverableVideo();
    expect(hoverPreviewLayer()).toBeTruthy();
    expect(hoverPreviewVideo()).toBeNull();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS - 1); });
    expect(playSpy).not.toHaveBeenCalled();
    expect(hoverPreviewVideo()).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    const playing = hoverPreviewVideo();
    expect(playing).toBe(decoder);
    expect(playing!.isConnected).toBe(true);
    expect(playing!.hasAttribute('controls')).toBe(false);
    expect(playing!.muted).toBe(false);
    expect(playing!.currentTime).toBe(0);
    expect(playing!.loop).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(mountNode.querySelector('canvas')).toBeTruthy();
  });

  it('进入后 100ms 内移开：不播，video 仍留离屏宿主，首帧海报画布无任何视觉变化', async () => {
    const { playSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS - 1); });
    await hoverOutOf(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS + 100); });
    expect(playSpy).not.toHaveBeenCalled();
    expect(hoverPreviewVideo()).toBeNull();
    expect(offscreenHostVideo()).toBe(decoder);
    expect(mountNode.querySelector('canvas')).toBeTruthy();
  });

  it('标题行悬停不触发播放；随后双击改名照常进入编辑（合规角标同层不受影响）', async () => {
    const { playSpy } = stubHoverMedia();
    const onTitleChange = vi.fn();
    await renderHoverableVideo({ fileName: '成片.mp4', onTitleChange });
    await hoverInto(titleRow());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS + 100); });
    expect(playSpy).not.toHaveBeenCalled();
    expect(hoverPreviewVideo()).toBeNull();
    await act(async () => {
      titleRow().querySelector('span')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    expect(titleRow().querySelector('input')).toBeTruthy();
  });

  it('播放中移开立即停止并回首帧海报；移开后再次进入满 100ms 从头重播', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(hoverPreviewVideo()).toBe(decoder);
    await hoverOutOf(contentCard());
    expect(pauseSpy).toHaveBeenCalled();
    expect(hoverPreviewVideo()).toBeNull();
    expect(decoder.currentTime).toBe(0);
    expect(offscreenHostVideo()).toBe(decoder);
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(hoverPreviewVideo()).toBe(decoder);
    expect(decoder.currentTime).toBe(0);
    expect(decoder.muted).toBe(false);
  });

  it('悬停不动播完一轮：定格末帧（currentTime 不归零）不循环，元素留在播放层；移开才回首帧海报', async () => {
    const { playSpy } = stubHoverMedia();
    await renderHoverableVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    const playing = hoverPreviewVideo()!;
    playing.currentTime = 5.2;
    await act(async () => { playing.dispatchEvent(new Event('ended')); });
    expect(hoverPreviewVideo()).toBe(playing);
    expect(playing.currentTime).toBe(5.2);
    expect(playing.loop).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);
    await hoverOutOf(contentCard());
    expect(hoverPreviewVideo()).toBeNull();
    expect(mountNode.querySelector('canvas')).toBeTruthy();
  });

  it('play() 被自动播放策略拒绝：静默降级静音重试开播，无任何提示', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValueOnce(new Error('NotAllowedError: play() failed'))
      .mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    await renderHoverableVideo();
    await hoverInto(contentCard());
    let playing: HTMLVideoElement | null = null;
    act(() => {
      vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
      playing = hoverPreviewVideo();
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(playing!.muted).toBe(false);
    });
    await act(async () => {});
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(playing!.muted).toBe(true);
    expect(mountNode.querySelector('[data-testid="video-error-box"]')).toBeNull();
    expect(mountNode.querySelector('[role="alert"]')).toBeNull();
  });

  it('点选过渡收养（故事16；IKI5YM 审查修订）：不开原生控件、无 nodrag/nopan，自绘控件叠加同一会话元素，声画不中断', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(hoverPreviewVideo()).toBe(decoder);
    await rerenderNode('video', {
      selected: true,
      data: { src: 'https://x/main.mp4', toolMode: 'select' },
    });
    expect(hoverPreviewVideo()).toBe(decoder);
    expect(decoder.isConnected).toBe(true);
    expect(decoder.muted).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(mountNode.querySelector('video[controls]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(decoder.controls).toBe(false);
    expect(mountNode.querySelector('video[controls]')).toBeNull();
    expect(decoder.classList.contains('nodrag')).toBe(false);
    expect(decoder.classList.contains('nopan')).toBe(false);
    expect(decoder.classList.contains(styles.adopted)).toBe(true);
    expect(contentCard().querySelector('button[aria-label="播放"]')).toBeTruthy();
    expect(contentCard().querySelector('[data-testid="video-seek-track"]')).toBeTruthy();
    const css = readFileSync(fileURLToPath(new NodeURL('./index.module.css', import.meta.url)), 'utf8');
    const adoptedRule = css.match(/\.mediaHoverPreviewLayer video\.adopted\s*\{[^}]*\}/)?.[0] ?? '';
    expect(adoptedRule).toContain('pointer-events: auto');
    expect(css).not.toContain('[controls]');
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('收养路径时长/进度兜底（IKJEHZ）：data.duration 缺失且 loadedmetadata 不重放，控件挂载即对齐实测 duration 与 currentTime，seek 可用', async () => {
    stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(hoverPreviewVideo()).toBe(decoder);
    Object.defineProperty(decoder, 'duration', { configurable: true, value: 40 });
    Object.defineProperty(decoder, 'paused', { configurable: true, value: false });
    decoder.currentTime = 7.5;
    await rerenderNode('video', { selected: true, data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    const track = contentCard().querySelector<HTMLElement>('[data-testid="video-seek-track"]')!;
    expect(track).toBeTruthy();
    expect(track.getAttribute('aria-valuemax')).toBe('40');
    expect(track.getAttribute('aria-valuenow')).toBe('8');
    expect(track.parentElement!.textContent).toContain('0:07 / 0:40');
    expect(contentCard().querySelector('button[aria-label="暂停"]')).toBeTruthy();
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200 } as DOMRect);
    await act(async () => {
      track.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true }));
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, bubbles: true }));
    });
    expect(decoder.currentTime).toBe(20);
    await act(async () => {
      track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    expect(decoder.currentTime).toBe(22);
  });

  it('收养态画面区点击切换播放/暂停，拖动整卡松开不误触（IKI5YM 审查修订）', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    await rerenderNode('video', { selected: true, data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    await act(async () => { vi.advanceTimersByTime(200); });
    Object.defineProperty(decoder, 'paused', { configurable: true, value: false });
    await act(async () => {
      decoder.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
      decoder.dispatchEvent(new MouseEvent('click', { clientX: 80, clientY: 40, bubbles: true }));
    });
    expect(pauseSpy).not.toHaveBeenCalled();
    await act(async () => {
      decoder.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
      decoder.dispatchEvent(new MouseEvent('click', { clientX: 12, clientY: 12, bubbles: true }));
    });
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    Object.defineProperty(decoder, 'paused', { configurable: true, value: true });
    await act(async () => {
      decoder.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
      decoder.dispatchEvent(new MouseEvent('click', { clientX: 12, clientY: 12, bubbles: true }));
    });
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it('过渡定格保持挂载（决策8）：收养会话播完 ended 元素停末帧不重建；再次进入重播仍同元素从头', async () => {
    const { playSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    await rerenderNode('video', { selected: true, data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    await act(async () => { vi.advanceTimersByTime(80); });
    expect(decoder.controls).toBe(false);
    expect(contentCard().querySelector('[data-testid="video-seek-track"]')).toBeTruthy();
    decoder.currentTime = 7.7;
    await act(async () => { decoder.dispatchEvent(new Event('ended')); });
    expect(hoverPreviewVideo()).toBe(decoder);
    expect(decoder.isConnected).toBe(true);
    expect(decoder.currentTime).toBe(7.7);
    expect(playSpy).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(mountNode.querySelectorAll('video')).toHaveLength(1);
    expect(mountNode.querySelector('video')).toBe(decoder);
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(hoverPreviewVideo()).toBe(decoder);
    expect(decoder.currentTime).toBe(0);
    expect(decoder.controls).toBe(false);
    expect(contentCard().querySelector('[data-testid="video-seek-track"]')).toBeTruthy();
  });

  it('过渡后手动暂停再移开：暂停帧保持挂载（keepFrame 占屏），不触发树内布防重建', async () => {
    const { playSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    await rerenderNode('video', { selected: true, data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    await act(async () => { vi.advanceTimersByTime(80); });
    expect(decoder.controls).toBe(false);
    expect(contentCard().querySelector('[data-testid="video-seek-track"]')).toBeTruthy();
    decoder.currentTime = 3.3;
    await act(async () => { decoder.dispatchEvent(new Event('pause')); });
    await hoverOutOf(contentCard());
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(hoverPreviewVideo()).toBe(decoder);
    expect(decoder.currentTime).toBe(3.3);
    expect(decoder.isConnected).toBe(true);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(mountNode.querySelectorAll('video')).toHaveLength(1);
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(hoverPreviewVideo()).toBe(decoder);
    expect(decoder.currentTime).toBe(0);
  });

  it('收养会话拖进度（故事14/15 收养路）：seeked 即接管从拖动点续播、让位解除，不归零不打回开头', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    await rerenderNode('video', { selected: true, data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    await act(async () => { vi.advanceTimersByTime(80); });
    expect(decoder.controls).toBe(false);
    await act(async () => { decoder.dispatchEvent(new Event('pause')); });
    decoder.currentTime = 4.4;
    await act(async () => { decoder.dispatchEvent(new Event('seeked')); });
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(decoder.currentTime).toBe(4.4);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('触屏 pointerenter 不起播：悬停起播限定鼠标指针，触屏维持点选+控件现状（故事29）', async () => {
    const { playSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard(), 'touch');
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS + 100); });
    expect(playSpy).not.toHaveBeenCalled();
    expect(hoverPreviewVideo()).toBeNull();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(hoverPreviewVideo()).toBe(decoder);
  });

  it('会话归位离屏宿主即复位悬停期状态：muted 回 true（离屏解码器默认静音，决策9）', async () => {
    const { playSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    expect(decoder.muted).toBe(true);
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(decoder.muted).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);
    await hoverOutOf(contentCard());
    expect(offscreenHostVideo()).toBe(decoder);
    expect(decoder.currentTime).toBe(0);
    expect(decoder.muted).toBe(true);
  });

  it('进入后 100ms 内点选（布防未满即选中）：不起播，布防计时取消', async () => {
    const { playSpy } = stubHoverMedia();
    await renderHoverableVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS - 50); });
    await rerenderNode('video', {
      selected: true,
      data: { src: 'https://x/main.mp4', toolMode: 'select' },
    });
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS + 100); });
    expect(playSpy).not.toHaveBeenCalled();
    expect(hoverPreviewVideo()).toBeNull();
  });

  it('点选过渡后取消选中：回到未选中规则立即停播回首帧海报', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderHoverableVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    await rerenderNode('video', { selected: true, data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    expect(playSpy).toHaveBeenCalledTimes(1);
    await rerenderNode('video', { selected: false, data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    expect(pauseSpy).toHaveBeenCalled();
    expect(hoverPreviewVideo()).toBeNull();
    expect(mountNode.querySelector('canvas')).toBeTruthy();
  });

  it('播放中注入会话锁定（splitEditing）：立即停播回首帧海报，锁定层照常渲染', async () => {
    const { pauseSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(hoverPreviewVideo()).toBe(decoder);
    await rerenderNode('video', {
      selected: false,
      data: { src: 'https://x/main.mp4', toolMode: 'select', splitEditing: true },
    });
    expect(hoverPreviewVideo()).toBeNull();
    expect(pauseSpy).toHaveBeenCalled();
    expect(decoder.currentTime).toBe(0);
    expect(mountNode.querySelector('[data-testid="split-lock-layer"]')).toBeTruthy();
  });

  it('加载失败兜底卡不播：error 后内容区为错误占位，悬停无反应', async () => {
    const { playSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    Object.defineProperty(decoder, 'error', { value: { code: 4 }, configurable: true });
    await act(async () => { decoder.dispatchEvent(new Event('error')); });
    expect(mountNode.querySelector('[data-testid="video-error-box"]')).toBeTruthy();
    expect(hoverPreviewLayer()).toBeNull();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS + 100); });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it.each(hoverExclusionCases)('排除态不播：%s', async (_name, extra) => {
    const { playSpy } = stubHoverMedia();
    await renderNode('video', {
      selected: false,
      ...extra,
      data: { src: 'https://x/main.mp4', toolMode: 'select', ...extra.data },
    });
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS + 100); });
    expect(playSpy).not.toHaveBeenCalled();
    expect(hoverPreviewVideo()).toBeNull();
  });

  it('选中卡悬停同样自动开播（IKJ7S1 翻转起播门）：已布防卡在树内控件视频上就地起播', async () => {
    const { playSpy } = stubHoverMedia();
    await renderNode('video', { data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    await act(async () => { vi.advanceTimersByTime(200); });
    const armed = mountNode.querySelector('video')!;
    expect(armed.hasAttribute('controls')).toBe(false);
    expect(contentCard().querySelector('button[aria-label="播放"]')).toBeTruthy();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS - 1); });
    expect(playSpy).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(mountNode.querySelector('video')).toBe(armed);
    expect(armed.isConnected).toBe(true);
  });

  it('图片卡、音频卡行为完全不变：悬停不播、无悬停播放层', async () => {
    const { playSpy } = stubHoverMedia();
    await renderNode('image', { selected: false, data: { src: 'https://x/a.png', toolMode: 'select' } });
    expect(hoverPreviewLayer()).toBeNull();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS + 100); });
    expect(playSpy).not.toHaveBeenCalled();
    await renderNode('audio', { selected: false, data: { src: 'https://x/a.mp3', toolMode: 'select' } });
    expect(hoverPreviewLayer()).toBeNull();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS + 100); });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('播放层合同：pointer-events:none、不打 transform、空层零视觉、无控件、aria-hidden（!832 回归面）', async () => {
    const { playSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const layer = hoverPreviewLayer()!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.classList.contains(styles.mediaHoverPreviewLayer)).toBe(true);
    expect(layer.childElementCount).toBe(0);
    expect(layer.previousElementSibling?.tagName).toBe('CANVAS');
    const css = readFileSync(fileURLToPath(new NodeURL('./index.module.css', import.meta.url)), 'utf8');
    const layerRule = css.match(/\.mediaHoverPreviewLayer\s*\{[^}]*\}/)?.[0] ?? '';
    expect(layerRule).toContain('pointer-events: none');
    expect(layerRule).not.toContain('transform');
    const videoRule = css.match(/\.mediaHoverPreviewLayer video\s*\{[^}]*\}/)?.[0] ?? '';
    expect(videoRule).toContain('object-fit: contain');
    expect(videoRule).not.toContain('transform');
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(hoverPreviewVideo()!.hasAttribute('controls')).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});

describe('MediaNode 视频卡选中态悬停播放（IKJ7S1：尾播特权与手动控制让位）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  async function renderSelectedArmedVideo(extraData: Record<string, unknown> = {}, extra?: RenderExtra) {
    await renderNode('video', {
      selected: true,
      ...extra,
      data: { src: 'https://x/main.mp4', toolMode: 'select', ...extraData },
    });
    await act(async () => { vi.advanceTimersByTime(200); });
  }

  function armedVideo(): HTMLVideoElement {
    return mountNode.querySelector('video')!;
  }

  it('选中卡悬停自动开播：树内控件视频就地起播，自绘控件承担播放控制（IKI5YM 合并口径）', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderSelectedArmedVideo();
    const armed = armedVideo();
    expect(armed.hasAttribute('controls')).toBe(false);
    expect(contentCard().querySelector('[data-testid="video-seek-track"]')).toBeTruthy();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(armedVideo()).toBe(armed);
    expect(hoverPreviewLayer()).toBeNull();
    expect(armed.muted).toBe(false);
    expect(armed.currentTime).toBe(0);
    expect(armed.loop).toBe(false);
    expect(armed.hasAttribute('controls')).toBe(false);
    expect(contentCard().querySelector('[data-testid="video-seek-track"]')).toBeTruthy();
  });

  it('尾播特权：播放中移开不停止，继续播到本轮 ended 定格末帧（不归零、不移出）', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderSelectedArmedVideo();
    const armed = armedVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(1);
    await hoverOutOf(contentCard());
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(armed.isConnected).toBe(true);
    armed.currentTime = 7.7;
    await act(async () => { armed.dispatchEvent(new Event('ended')); });
    expect(armed.isConnected).toBe(true);
    expect(armed.currentTime).toBe(7.7);
    expect(armed.loop).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('尾播完成后（指针在外定格）再次进入：残留会话就地收尾，满 100ms 从头重播', async () => {
    const { playSpy } = stubHoverMedia();
    await renderSelectedArmedVideo();
    const armed = armedVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    await hoverOutOf(contentCard());
    armed.currentTime = 7.7;
    await act(async () => { armed.dispatchEvent(new Event('ended')); });
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS - 1); });
    expect(playSpy).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(armed.currentTime).toBe(0);
    expect(armedVideo()).toBe(armed);
  });

  it('手动暂停让位：本次悬停不自动续播；移开不尾播保持暂停帧；再次进入从头重播', async () => {
    const { playSpy } = stubHoverMedia();
    await renderSelectedArmedVideo();
    const armed = armedVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(1);
    armed.currentTime = 3.3;
    await act(async () => { armed.dispatchEvent(new Event('pause')); });
    await hoverOutOf(contentCard());
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(armed.currentTime).toBe(3.3);
    expect(armed.isConnected).toBe(true);
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(armed.currentTime).toBe(0);
  });

  it('手动恢复播放解除让位：暂停后点播放再移开，按播放中尾播处理（不停止不重启）', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderSelectedArmedVideo();
    const armed = armedVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    armed.currentTime = 2;
    await act(async () => { armed.dispatchEvent(new Event('pause')); });
    await act(async () => { armed.dispatchEvent(new Event('play')); });
    await hoverOutOf(contentCard());
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(armed.currentTime).toBe(2);
    expect(armed.isConnected).toBe(true);
  });

  it('手动拖进度从拖动点续播：暂停让位后 seeked 恢复播放；移开从拖动点尾播到结尾定格（不打回开头）', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderSelectedArmedVideo();
    const armed = armedVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(1);
    await act(async () => { armed.dispatchEvent(new Event('pause')); });
    armed.currentTime = 0.5;
    await act(async () => { armed.dispatchEvent(new Event('seeked')); });
    expect(playSpy).toHaveBeenCalledTimes(2);
    await hoverOutOf(contentCard());
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(armed.currentTime).toBe(0.5);
    expect(playSpy).toHaveBeenCalledTimes(2);
    await act(async () => { armed.dispatchEvent(new Event('ended')); });
    expect(armed.isConnected).toBe(true);
    expect(armed.currentTime).toBe(0.5);
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it('多选（框选/Ctrl+A）抑制：多选期间选中卡悬停不自动开播，恢复唯一选中后照常', async () => {
    const { playSpy } = stubHoverMedia();
    await renderSelectedArmedVideo({}, {
      storeNodes: [{ id: 'a', selected: true }, { id: 'video-node', selected: true }],
    });
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS + 100); });
    expect(playSpy).not.toHaveBeenCalled();
    await rerenderNode('video', {
      selected: true,
      storeNodes: [{ id: 'video-node', selected: true }],
      data: { src: 'https://x/main.mp4', toolMode: 'select' },
    });
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('播放中进入多选：立即停播（会话排除态同口径），树内画面停在当前帧不清回开头', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderSelectedArmedVideo();
    const armed = armedVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(1);
    armed.currentTime = 2.2;
    await rerenderNode('video', {
      selected: true,
      storeNodes: [{ id: 'a', selected: true }, { id: 'video-node', selected: true }],
      data: { src: 'https://x/main.mp4', toolMode: 'select' },
    });
    expect(pauseSpy).toHaveBeenCalled();
    expect(armed.isConnected).toBe(true);
    expect(armed.currentTime).toBe(2.2);
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS + 200); });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('音量调节不记忆：悬停开播尊重控件静音；元素卸载重建后 muted/volume 回默认', async () => {
    const { playSpy } = stubHoverMedia();
    await renderSelectedArmedVideo();
    const first = armedVideo();
    first.muted = true;
    first.volume = 0.3;
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(first.muted).toBe(true);
    expect(first.volume).toBe(0.3);
    await renderNode('video', { selected: true, data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    await act(async () => { vi.advanceTimersByTime(200); });
    const rebuilt = armedVideo();
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.muted).toBe(false);
    expect(rebuilt.volume).toBe(1);
  });
});

describe('MediaNode 样片/成片画面内角标（IKJ7UI）', () => {
  it('生成中样片卡：不挂角标（生成中靠自动命名识别），标题行无卡外徽标', async () => {
    await renderNode('video', { genStatus: 'generating', progress: 10, data: { videoStage: 'sample' } });
    expect(mountNode.querySelector('[data-testid="video-sample-badge"]')).toBeNull();
    expect(titleRow().textContent).not.toContain('样片 480P');
  });

  it('失败样片卡：不挂角标（失败卡不挂）', async () => {
    await renderNode('video', { genStatus: 'failed', errorText: '样片生成失败', data: { videoStage: 'sample', jobId: '9001' } });
    expect(mountNode.querySelector('[data-testid="video-sample-badge"]')).toBeNull();
  });

  it('成功样片卡：角标在视频画面内右上角（内容区内、标题行外），文案含「截止 MM-DD HH:mm」', async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    await renderNode('video', { data: { videoStage: 'sample', finalizeDeadlineAt: future, src: 'http://vid/s.mp4' } });
    const badge = mountNode.querySelector('[data-testid="video-sample-badge"]');
    expect(badge).toBeTruthy();
    expect(contentCard().contains(badge!)).toBe(true);
    expect(titleRow().contains(badge!)).toBe(false);
    expect(badge!.className).toContain('stageTag');
    expect(badge!.className).not.toContain('stageTagExpired');
    expect(badge!.textContent).toContain('样片 480P');
    expect(badge!.textContent).toMatch(/截止 \d{2}-\d{2} \d{2}:\d{2}$/);
    expect(badge!.textContent).not.toContain('积分');
    expect(mountNode.querySelector('[data-testid="media-content"]')).toBeTruthy();
  });

  it('过期样片卡：角标转警告橙「已过期」，素材保留（不删除）', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await renderNode('video', { data: { videoStage: 'sample', finalizeDeadlineAt: past, src: 'http://vid/s.mp4' } });
    const badge = mountNode.querySelector('[data-testid="video-sample-badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain('stageTagExpired');
    expect(badge!.textContent).toContain('已过期');
    expect(badge!.getAttribute('title')).toContain('期限已过');
  });

  it('普通视频卡：不渲染样片角标；缺可信截止（null）的样片卡视同过期（警告橙，不新增第三态）', async () => {
    await renderNode('video', { data: { src: 'http://vid/n.mp4' } });
    expect(mountNode.querySelector('[data-testid="video-sample-badge"]')).toBeNull();
    await renderNode('video', { data: { videoStage: 'sample', finalizeDeadlineAt: null, src: 'http://vid/s2.mp4' } });
    const badge = mountNode.querySelector('[data-testid="video-sample-badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain('stageTagExpired');
    expect(badge!.textContent).toContain('已过期');
    expect(badge!.getAttribute('title')).toContain('缺少可信创建时间');
  });

  it('成功成片卡：画面内右上角「成片 1080P」角标（紫色点缀），已结算不拼积分', async () => {
    await renderNode('video', {
      data: {
        videoStage: 'final', sourceSampleJobId: '9001', src: 'http://vid/f.mp4',
        chargeState: 'settled', actualCredits: 80,
      },
    });
    const badge = mountNode.querySelector('[data-testid="video-final-badge"]');
    expect(badge).toBeTruthy();
    expect(contentCard().contains(badge!)).toBe(true);
    expect(titleRow().contains(badge!)).toBe(false);
    expect(badge!.className).toContain('stageTagFinal');
    expect(badge!.textContent).toBe('成片 1080P');
    expect(mountNode.querySelector('[data-testid="video-sample-badge"]')).toBeNull();
  });

  it('成片生成中/失败卡：不挂角标（仅成功态显示）', async () => {
    await renderNode('video', { genStatus: 'generating', progress: 5, data: { videoStage: 'final', sourceSampleJobId: '9001', jobId: '9002' } });
    expect(mountNode.querySelector('[data-testid="video-final-badge"]')).toBeNull();
    await renderNode('video', {
      genStatus: 'failed',
      data: { videoStage: 'final', sourceSampleJobId: '9001', jobId: '9002', errorText: '上游生成失败' },
    });
    expect(mountNode.querySelector('[data-testid="video-final-badge"]')).toBeNull();
  });
});

describe('MediaNode 样片卡标题行成片按钮（IKIZQE）', () => {
  function ctaButton(): HTMLButtonElement | null {
    return mountNode.querySelector<HTMLButtonElement>('[data-testid="finalize-cta"]');
  }

  it('ready：按钮唯一渲染在标题行，展示成片预计积分，点击派发 onFinalizeSample', async () => {
    const onFinalizeSample = vi.fn();
    await renderNode('video', {
      data: {
        videoStage: 'sample', jobId: '9001', src: 'http://vid/s.mp4',
        finalizeDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        finalizeCta: { phase: 'ready', credits: 80 }, onFinalizeSample,
      },
    });
    const btn = ctaButton();
    expect(btn).toBeTruthy();
    expect(mountNode.querySelectorAll('[data-testid="finalize-cta"]')).toHaveLength(1);
    expect(titleRow().contains(btn!)).toBe(true);
    expect(btn!.textContent).toBe('生成 1080P 成片 · 80 积分');
    expect(btn!.disabled).toBe(false);
    expect(btn!.title).toContain('预计消耗 80 积分');
    await act(async () => { btn!.click(); });
    expect(onFinalizeSample).toHaveBeenCalledTimes(1);
    expect(onFinalizeSample).toHaveBeenCalledWith('video-node');
  });

  it('loading/submitting/running/checking/expired/unavailable：禁用且不派发，文案随态切换', async () => {
    const onFinalizeSample = vi.fn();
    const base = {
      videoStage: 'sample' as const, jobId: '9001', src: 'http://vid/s.mp4',
      finalizeDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      onFinalizeSample,
    };
    await renderNode('video', { data: { ...base, finalizeCta: { phase: 'loading' } } });
    expect(ctaButton()!.textContent).toBe('生成 1080P 成片');
    expect(ctaButton()!.disabled).toBe(true);
    expect(ctaButton()!.title).toContain('正在获取成片报价');

    await rerenderNode('video', { data: { ...base, finalizeCta: { phase: 'running' } } });
    expect(ctaButton()!.textContent).toBe('成片生成中…');

    await rerenderNode('video', { data: { ...base, finalizeCta: { phase: 'checking' } } });
    expect(ctaButton()!.textContent).toBe('状态核对中…');
    expect(ctaButton()!.title).toContain('请勿重复提交');

    await rerenderNode('video', { data: { ...base, finalizeCta: { phase: 'unavailable' } } });
    expect(ctaButton()!.disabled).toBe(true);
    expect(ctaButton()!.title).toContain('暂不能生成成片');

    for (const phase of ['running', 'checking', 'unavailable'] as const) {
      await rerenderNode('video', { data: { ...base, finalizeCta: { phase } } });
      await act(async () => { ctaButton()!.click(); });
    }
    expect(onFinalizeSample).not.toHaveBeenCalled();
  });

  it('expired（过期/缺可信截止）：整钮不渲染（IKJ7UI——死按钮没有行动价值，过期信息由角标表达）', async () => {
    const onFinalizeSample = vi.fn();
    const base = {
      videoStage: 'sample' as const, jobId: '9001', src: 'http://vid/s.mp4',
      onFinalizeSample,
    };
    await renderNode('video', { data: { ...base, finalizeDeadlineAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), finalizeCta: { phase: 'expired' } } });
    expect(ctaButton()).toBeNull();
    await renderNode('video', {
      data: { ...base, finalizeDeadlineAt: null, finalizeCta: { phase: 'expired' } },
    });
    expect(ctaButton()).toBeNull();
    await act(async () => { titleRow().querySelectorAll('button').forEach((b) => b.click()); });
    expect(onFinalizeSample).not.toHaveBeenCalled();
  });

  it('未注入 finalizeCta（普通卡/生成中样片）：不渲染成片按钮', async () => {
    await renderNode('video', { data: { src: 'http://vid/n.mp4' } });
    expect(ctaButton()).toBeNull();
    await renderNode('video', { genStatus: 'generating', progress: 10, data: { videoStage: 'sample', jobId: '9001' } });
    expect(ctaButton()).toBeNull();
  });
});

describe('MediaNode 成片卡与两阶段状态呈现（IKIZQE）', () => {
  it('成功成片卡：普通视频卡体验 + 画面内「成片 1080P」角标，不拼已用积分（IKJ7UI）', async () => {
    await renderNode('video', {
      data: {
        videoStage: 'final', sourceSampleJobId: '9001', src: 'http://vid/f.mp4',
        fileName: '成片', width: 1920, height: 1080, jobId: '9002',
        chargeState: 'settled', actualCredits: 80,
      },
    });
    const badge = mountNode.querySelector('[data-testid="video-final-badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe('成片 1080P');
    expect(mountNode.querySelector('[data-testid="video-sample-badge"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="finalize-cta"]')).toBeNull();
  });

  it('成片生成中/失败卡：不挂角标；失败显示原因与退费状态，未注入入口时无任何动作按钮', async () => {
    await renderNode('video', { genStatus: 'generating', progress: 5, data: { videoStage: 'final', sourceSampleJobId: '9001', jobId: '9002' } });
    expect(mountNode.querySelector('[data-testid="video-final-badge"]')).toBeNull();

    await renderNode('video', {
      genStatus: 'failed',
      data: { videoStage: 'final', sourceSampleJobId: '9001', jobId: '9002', errorText: '上游生成失败', chargeState: 'released' },
    });
    expect(mountNode.textContent).toContain('上游生成失败');
    expect(mountNode.querySelector('[data-testid="charge-refund-note"]')!.textContent).toContain('预扣已退回');
    expect([...mountNode.querySelectorAll('button')].filter((b) => b.textContent === '重试')).toHaveLength(0);
  });

  it('样片失败卡：不挂角标（失败卡不挂）、显示退费状态，保留重试（普通失败卡形态不受本票影响）', async () => {
    await renderNode('video', {
      genStatus: 'failed',
      data: { videoStage: 'sample', jobId: '9001', errorText: '样片生成失败', chargeState: 'released' },
    });
    expect(mountNode.querySelector('[data-testid="video-sample-badge"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="charge-refund-note"]')!.textContent).toContain('预扣已退回');
    expect([...mountNode.querySelectorAll('button')].some((b) => b.textContent === '重试')).toBe(true);
  });

  it('checking 态（提交结果不明）：占位显示「状态核对中」与勿重复提交说明，无取消按钮', async () => {
    await renderNode('video', { genStatus: 'checking', data: { videoStage: 'final', sourceSampleJobId: '9001', jobId: '9002' } });
    const box = mountNode.querySelector('[data-testid="job-checking-box"]');
    expect(box).toBeTruthy();
    expect(box!.textContent).toContain('状态核对中');
    expect(box!.textContent).toContain('请勿重复提交');
    expect([...mountNode.querySelectorAll('button')].some((b) => b.textContent === '取消生成')).toBe(false);
  });

  it('样片角标：已结算（settled）不拼「已用 N 积分」（费用展示归历史记录与详情）', async () => {
    await renderNode('video', {
      data: {
        videoStage: 'sample', jobId: '9001', src: 'http://vid/s.mp4',
        finalizeDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        chargeState: 'settled', actualCredits: 20,
      },
    });
    const badge = mountNode.querySelector('[data-testid="video-sample-badge"]')!;
    expect(badge.textContent).toContain('样片 480P');
    expect(badge.textContent).toContain('截止 ');
    expect(badge.textContent).not.toContain('积分');
  });
});

describe('MediaNode 重新生成样片入口（IKIZQG / IKJ7UI 形态）', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  function regenButton(): HTMLButtonElement | null {
    return mountNode.querySelector<HTMLButtonElement>('[data-testid="regenerate-cta"]');
  }

  it('过期样片卡：标题行无任何按钮（重新生成入口已随 ADR-0119 移除，即使误注入也不渲染）', async () => {
    const onRegenerateSample = vi.fn();
    await renderNode('video', {
      data: {
        videoStage: 'sample', jobId: '9001', src: 'http://vid/s.mp4', finalizeDeadlineAt: past,
        regenerateCta: { phase: 'ready', credits: 40 }, onRegenerateSample,
      },
    });
    expect(regenButton()).toBeNull();
    expect(titleRow().querySelectorAll('button')).toHaveLength(0);
  });

  it('成功样片卡：标题行只有「生成 1080P 成片」一个按钮（唯一链式动作）', async () => {
    await renderNode('video', {
      data: {
        videoStage: 'sample', jobId: '9001', src: 'http://vid/s.mp4', finalizeDeadlineAt: future,
        finalizeCta: { phase: 'ready', credits: 80 },
      },
    });
    const rowButtons = [...titleRow().querySelectorAll('button')];
    expect(rowButtons).toHaveLength(1);
    expect(rowButtons[0]!.getAttribute('data-testid')).toBe('finalize-cta');
    expect(regenButton()).toBeNull();
  });

  it('成片失败卡失败区：同形「重试」（不带积分），悬停给新样片报价与另行计费说明，点击派发 onRegenerateSample', async () => {
    const onRegenerateSample = vi.fn();
    await renderNode('video', {
      genStatus: 'failed',
      data: {
        videoStage: 'final', sourceSampleJobId: '9001', jobId: '9002',
        errorText: '上游成片失败', chargeState: 'released',
        regenerateCta: { phase: 'ready', credits: 40 }, onRegenerateSample,
      },
    });
    const btn = regenButton();
    expect(btn).toBeTruthy();
    expect(btn!.className).toContain('genBtn');
    expect(btn!.textContent).toBe('重试');
    expect(btn!.disabled).toBe(false);
    expect(btn!.title).toContain('预计消耗 40 积分');
    expect(btn!.title).toContain('样片完成后再单独发起成片（另行计费）');
    expect(mountNode.textContent).toContain('上游成片失败');
    expect(mountNode.querySelector('[data-testid="charge-refund-note"]')!.textContent).toContain('预扣已退回');
    await act(async () => { btn!.click(); });
    expect(onRegenerateSample).toHaveBeenCalledWith('video-node');
  });

  it('成片失败卡失败区：loading/checking/unavailable 禁用且不派发', async () => {
    const onRegenerateSample = vi.fn();
    const base = {
      videoStage: 'final' as const, sourceSampleJobId: '9001', jobId: '9002',
      errorText: '上游成片失败', chargeState: 'released' as const, onRegenerateSample,
    };
    await renderNode('video', { genStatus: 'failed', data: { ...base, regenerateCta: { phase: 'loading' } } });
    expect(regenButton()!.disabled).toBe(true);
    expect(regenButton()!.title).toContain('正在获取样片报价');
    await rerenderNode('video', { genStatus: 'failed', data: { ...base, regenerateCta: { phase: 'checking' } } });
    expect(regenButton()!.disabled).toBe(true);
    expect(regenButton()!.title).toContain('请勿重复提交');
    await rerenderNode('video', { genStatus: 'failed', data: { ...base, regenerateCta: { phase: 'unavailable' } } });
    expect(regenButton()!.disabled).toBe(true);
    await act(async () => { regenButton()!.click(); });
    expect(onRegenerateSample).not.toHaveBeenCalled();
  });

  it('样片失败卡：失败区不渲染重新生成入口（同输入原卡重试沿用现有重试入口）', async () => {
    await renderNode('video', {
      genStatus: 'failed',
      data: { videoStage: 'sample', jobId: '9001', errorText: '样片生成失败', chargeState: 'released' },
    });
    expect(regenButton()).toBeNull();
    expect([...mountNode.querySelectorAll('button')].some((b) => b.textContent === '重试')).toBe(true);
  });
});
