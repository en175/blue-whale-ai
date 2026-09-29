// @vitest-environment jsdom
/* 选中态悬浮工具条用例已随实现迁出（IKGYYD）：工具条 DOM 迁出节点卡后由
   NodeFollowToolbar 钉屏幕容器承载，行为覆盖见 ./Toolbar.test.tsx 与
   ../NodeFollowToolbar/index.test.tsx（按钮构成/顺序/回调/置灰门槛/显隐时机不变）。 */
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
// jsdom 环境的全局 URL 会把 file: base 解析回 http:（jsdom 页面源），须用 node:url 的 URL 按文件定位
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import MediaNode, { videoSourceList, type MediaGenStatus } from './index';
import styles from './index.module.css';
import { HOVER_PREVIEW_DELAY_MS } from './hoverPreview';

/** IKHIT1：只替换手柄重测钩子以断言调用时机，其余导出（Provider/Handle/useStore）
    保持官方实现；jsdom 不起真实 ReactFlow 测量。 */
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
  /** IKJ7S1 多选抑制用：向 ReactFlow store 注入画布节点（MediaNode 经 useStore 计数读多选） */
  storeNodes?: Array<{ id: string; selected?: boolean }>;
}

/** 把画布节点写入 ReactFlow 内部 store（Provider 模式）：MediaNode 的
    useStore((state) => isMultiNodeSelection(state.nodes)) 据此感知框选 / Ctrl+A 多选 */
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
  // !834 起未布防视频卡在 body 挂离屏解码宿主：复用旧实现会连 root 一起泄漏，
  // 遗留宿主会干扰 offscreenVideo() 定位，先卸载上一个实例保证任一时刻仅一个宿主
  if (root) await act(async () => { root.unmount(); });
  mountNode?.remove();
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(nodeElement(mediaType, extra));
  });
}

/** 同实例重渲（IKHIT1）：复用既有 root 更新属性，不断组件身份 */
async function rerenderNode(
  mediaType: 'image' | 'video' | 'audio',
  extra?: RenderExtra,
) {
  await act(async () => {
    root.render(nodeElement(mediaType, extra));
  });
}

/** !834 起未布防（未选中/非选择工具/编辑锁定期）的视频卡不渲染树内 <video>：
    解码器挂在 body 的离屏宿主里（aria-hidden 固定定位小盒），卡片内以首帧画布占位。 */
function offscreenVideo(): HTMLVideoElement {
  return document.body.querySelector<HTMLVideoElement>('div[aria-hidden="true"] video')!;
}

/** 选中 + 选择工具下原生控件延迟 80ms 布防（防穿透点击锁）：等布防完成再取树内 video。
 *  裕量 200ms（80ms 布防 + 120ms 余量），避免慢机 CI 上竞态。 */
async function waitForVideoArm() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
}

/** 图片/视频新布局：外部标题行与内容主体（与 e2e 共用 data-testid 锚点） */
function contentCard(): HTMLElement {
  return mountNode.querySelector('[data-testid="media-content"]') as HTMLElement;
}

function titleRow(): HTMLElement {
  return mountNode.querySelector('[data-testid="media-title"]') as HTMLElement;
}

/** 悬停预览播放层（IKJ7RS）：内容区内命令式承载离屏解码 video 的可见层 */
function hoverPreviewLayer(): HTMLElement | null {
  return mountNode.querySelector<HTMLElement>('[data-testid="video-hover-preview"]');
}

function hoverPreviewVideo(): HTMLVideoElement | null {
  return hoverPreviewLayer()?.querySelector('video') ?? null;
}

/** 未选中卡 body 离屏宿主内的解码 video：直接子级定位，不会误取悬停层内已移入的元素 */
function offscreenHostVideo(): HTMLVideoElement {
  return document.body.querySelector<HTMLVideoElement>('body > div[aria-hidden="true"] > video')!;
}

/** jsdom 无 PointerEvent 构造器：MouseEvent 带指针类型触发 React 合成指针事件
 *  （EnterLeaveEventPlugin 由 pointerover/pointerout 派生 enter/leave，仓库先例做法）。
 *  pointerType 定义到实例上（MouseEventInit 无此字段），悬停起播按其分流鼠标/触屏（故事 29） */
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

/** IKJ7RS 悬停预览用媒体打桩：jsdom 不实现 HTMLMediaElement play/pause */
function stubHoverMedia() {
  return {
    playSpy: vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve()),
    pauseSpy: vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}),
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); // IKGZ5P 触发钮显示全局记忆的最近工具，测试间清空回默认「高清」
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
    // 无标记的普通图片卡不渲染棋盘格
    await renderNode('image', { data: { mime: 'image/png' } });
    expect(mountNode.querySelector('[data-testid="cutout-checkerboard"]')).toBeNull();
    // 生成中占位态不渲染（棋盘格仅成品图片分支）
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
    // 角标（形态取交互验收基准原型 done 态）：标注透明产物格式，与棋盘格同条件渲染
    const tag = mountNode.querySelector('[data-testid="video-transparent-tag"]');
    expect(tag).toBeTruthy();
    expect(tag!.textContent).toBe('透明背景 · WEBM');
    // MP4 纯色结果卡不设标记：棋盘格与角标都不渲染
    await renderNode('video', { data: { mime: 'video/mp4' } });
    expect(mountNode.querySelector('[data-testid="video-transparent-checkerboard"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="video-transparent-tag"]')).toBeNull();
    // 生成中占位态不渲染（棋盘格与角标仅成品视频分支）
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
    // 标题可见且可双击改名（沿用既有改名链路）
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
    // 存量直发时代失败卡无 mediaExtract 身份：不渲染重试钮（IKH28X 身份分流）
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
    // 旧素材继续显示（IKDMQU Q5：失败后仍保留旧素材）
    expect(mountNode.querySelector('img')?.getAttribute('src')).toBe('http://img/old.png');
    const overlay = mountNode.querySelector('[data-testid="fail-overlay"]');
    expect(overlay).toBeTruthy();
    expect(overlay!.textContent).toContain('内容审核未通过');
    expect(overlay!.textContent).toContain('重试');
    // 不再整卡遮成失败占位
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
    // !834 起未选中视频卡的素材区由离屏解码 + 首帧画布承载：占位画布仍在即旧素材仍在显示
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
    // 自定义 AudioPlayer 取代原生 controls：audio 元素仍在 DOM 中，
    // 播放/暂停按钮与波形区携带 nodrag nopan 确保不落入节点拖拽路径。
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

    // 波形负责进度跳转；操作区域同样排除节点拖动和画布平移。
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
    // 横矩形成品卡：波形区为唯一主区，seek 轨道（nodrag nopan）内含
    // 72 根竖条（条容器 + playhead 两个直接子 div）——只锁结构不锁像素。
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
    // 未选中卡走离屏解码（!834）：loadedmetadata 换宿主不换上报合同
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
    // 未布防（默认非选择工具）：离屏解码器同样按双源列表挂 <source>
    await renderNode('video', { data: { src: 'https://x/main.mp4', srcH264: 'https://x/fallback.mp4' } });
    let sources: Element[] = [...offscreenVideo().querySelectorAll('source')];
    expect(sources).toHaveLength(2);
    expect(sources[0].getAttribute('src')).toBe('https://x/main.mp4');
    expect(sources[0].getAttribute('type')).toBe('video/mp4');
    expect(sources[1].getAttribute('src')).toBe('https://x/fallback.mp4');
    expect(sources[1].getAttribute('type')).toBe('video/mp4; codecs="avc1"');
    // 布防（选中 + 选择工具 + 80ms）后树内 video 渲染同一双源列表
    await rerenderNode('video', { data: { src: 'https://x/main.mp4', srcH264: 'https://x/fallback.mp4', toolMode: 'select' } });
    await waitForVideoArm();
    sources = [...mountNode.querySelectorAll('video source')];
    expect(sources).toHaveLength(2);
    await rerenderNode('video', { data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    expect([...mountNode.querySelectorAll('video source')]).toHaveLength(1);
  });

  it('video error（code 4）渲染兜底占位与新窗口链接，src 变化复位', async () => {
    await renderNode('video', { data: { src: 'https://x/main.mp4' } });
    // 未选中卡（离屏解码）的 error 同样要进兜底（IKI7XQ：!834 离屏迁移曾丢失此合同）
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
    // src 变化复位：错误占位消失、回到首帧画布占位
    await rerenderNode('video', { data: { src: 'https://x/other.mp4' } });
    expect(mountNode.querySelector('[data-testid="video-error-box"]')).toBeNull();
    expect(mountNode.querySelector('canvas')).toBeTruthy();
    // 布防后树内 video 的 error 仍进兜底（选中态原生控件路）
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
    // jsdom videoWidth/videoHeight 默认即 0，只需就绪状态
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    await act(async () => {
      video.dispatchEvent(new Event('loadeddata'));
    });
    const box = mountNode.querySelector('[data-testid="video-error-box"]');
    expect(box).toBeTruthy();
    expect(box!.textContent).toContain('浏览器不支持该视频编码');
  });
});

/** React 受控输入框填值：绕过 value tracker 后派发 input 事件 */
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
    // Enter 提交后输入框卸载，随后的 blur 不再派发（无第二次回调）
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
    // 保留编辑内容继续修改
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
    // 修正到 100 内后保存成功并清除报错
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
    // 组合结束后的回车正常提交
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
  /** 视频卡注入 subtitleEraseEditing 时：内容区叠加检测框层（半透明矩形描边渲染层挂载、
      指针接管 nodrag/nopan）且视频元素被暂停在当前帧；未注入（正常视频卡）不渲染。 */
  it('注入 subtitleEraseEditing：渲染框层并暂停视频；未注入不渲染', async () => {
    const editing = {
      boxes: [{ kind: 'box' as const, from: { x: 10, y: 10 }, to: { x: 100, y: 60 } }],
      liveBox: null,
      onBoxStart: () => {},
      onBoxMove: () => {},
      onBoxEnd: () => {},
    };
    // jsdom 不加载媒体：拦截 HTMLMediaElement.prototype.pause 验证编辑态注入即暂停在当前帧。
    // !834 起锁定期卡内不再渲染 <video>，须先布防成可播卡再注入标记验证转场暂停
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
    // 未注入的正常视频卡不渲染框层
    await renderNode('video', { data: { toolMode: 'select' } });
    expect(mountNode.querySelector('[data-testid="subtitle-erase-boxes-layer"]')).toBeNull();
  });

  /** 会话锁定播放控件（IKH3NP 审查修订）：会话期 toolMode 恒 select，原生控件必须自己
      关掉（智能模式不再注入框层，没有 inset:0 覆盖层替视频挡控件），指针一并交还画布；
      两模式都停帧；无会话标记的选中态视频卡维持原生控件不动。!834 起锁定期卡内整个
      不渲染 <video>（离屏解码 + 首帧画布占位），控件与指针随元素一起从卡内收回。 */
  it('会话锁定期关原生播放控件与指针，智能与框选两模式都生效；无标记时保留 controls', async () => {
    // 智能模式：只注入停帧标记（无框层），会话期 toolMode 仍为 select
    await renderNode('video', { data: { toolMode: 'select', subtitleErasePaused: true } });
    expect(mountNode.querySelector('video')).toBeNull();
    expect(mountNode.querySelector('canvas')).toBeTruthy();
    // 智能模式转场停帧（初始锁定渲染时离屏 video 天生暂停、无 pause 调用）：
    // 先布防成可播卡再注入停帧标记，转场必须暂停树内 video——与框层/splitEditing 同口径
    const pauseSpy = vi.fn();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseSpy);
    await rerenderNode('video', { data: { toolMode: 'select' } });
    await waitForVideoArm();
    await rerenderNode('video', { data: { toolMode: 'select', subtitleErasePaused: true } });
    expect(pauseSpy).toHaveBeenCalled();
    pause.mockRestore();
    // 框选模式：注入框层（本改动对它同样生效，不再只靠框层遮挡）
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
    // 回归：无会话标记的选中态视频卡布防后保留原生控件且可交互
    await renderNode('video', { data: { toolMode: 'select' } });
    await waitForVideoArm();
    const normalVideo = mountNode.querySelector('video')!;
    expect(normalVideo.hasAttribute('controls')).toBe(true);
    expect(normalVideo.style.pointerEvents).toBe('');
  });
});

describe('MediaNode 音视频分离编辑态锁定层（IKH28U）', () => {
  /** 视频卡注入 splitEditing 时：透明锁定层全覆盖内容区接管指针（nodrag/nopan 同框层口径）
      且视频元素被暂停在当前帧；未注入（正常视频卡）不渲染。 */
  it('注入 splitEditing：渲染锁定层并暂停视频；未注入不渲染', async () => {
    // jsdom 不加载媒体：拦截 HTMLMediaElement.prototype.pause 验证编辑态注入即暂停在当前帧。
    // !834 起锁定期卡内不渲染 <video>，同 IKGZ83 先布防再注入验证转场暂停
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
    // 未注入的正常视频卡不渲染锁定层
    await renderNode('video', { data: { toolMode: 'select' } });
    expect(mountNode.querySelector('[data-testid="split-lock-layer"]')).toBeNull();
  });
});

describe('MediaNode 手柄显隐翻转重测（IKHIT1）', () => {
  /** React Flow 只在首测与尺寸变化时量 handleBounds：同尺寸下显隐翻转必须手动补测
      （IKHHCN 根因），否则新挂手柄不注册、拖线静默失效。挂载首测跳过是 jsdom 缺
      DOMMatrixReadOnly 桩的既定口径（冗余首调会崩测试文件），本用例一并锁住。 */
  it('draft 挂载首测与显隐不变的 rerender 都不调；draft→generating 翻转重测一次', async () => {
    updateNodeInternalsMock.mockClear();
    await renderNode('image', { genStatus: 'draft', data: { src: '', draft: true } });
    expect(updateNodeInternalsMock).not.toHaveBeenCalled();
    // 显隐不变的 rerender（仅改名）：不补测
    await rerenderNode('image', { genStatus: 'draft', data: { src: '', draft: true, fileName: '改名后' } });
    expect(updateNodeInternalsMock).not.toHaveBeenCalled();
    // 同实例 draft→generating：右侧出源手柄补挂（显隐翻转），须重测一次；
    // 随 genStatus 翻转 src 也从 '' 回落默认 blob:test（data 整体重传），断言只认调用次数
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

  /** 成品视频未选中卡基准渲染：真实 http src + 选择工具 */
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
    // 计时未满不播
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS - 1); });
    expect(playSpy).not.toHaveBeenCalled();
    expect(hoverPreviewVideo()).toBeNull();
    // 满 100ms 开播：同一离屏解码元素、有声、从头
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
    // 海报画布仍在层下（移开即回首帧海报）
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
    // 播放中移开：立即停、归零回首帧、元素原址移回离屏宿主（解码缓存不丢）
    await hoverOutOf(contentCard());
    expect(pauseSpy).toHaveBeenCalled();
    expect(hoverPreviewVideo()).toBeNull();
    expect(decoder.currentTime).toBe(0);
    expect(offscreenHostVideo()).toBe(decoder);
    // 再次进入满 100ms：同一元素从头重播（有声）
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
    // 定格末帧：元素不移出、currentTime 不归零、不循环、不重播
    expect(hoverPreviewVideo()).toBe(playing);
    expect(playing.currentTime).toBe(5.2);
    expect(playing.loop).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);
    // 移开后才回到首帧海报
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
    // 同步观测点：开播瞬间有声（拒播 promise 尚未兑现，microtask 未排空）
    let playing: HTMLVideoElement | null = null;
    act(() => {
      vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
      playing = hoverPreviewVideo();
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(playing!.muted).toBe(false);
    });
    // 拒播 promise 兑现后降级静音重试
    await act(async () => {});
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(playing!.muted).toBe(true);
    // 无任何提示：不出错误占位、不出告警
    expect(mountNode.querySelector('[data-testid="video-error-box"]')).toBeNull();
    expect(mountNode.querySelector('[role="alert"]')).toBeNull();
  });

  it('点选过渡控件布防（故事16）：播放中点选 80ms 后原生控件开在同一元素上，声画不中断', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(hoverPreviewVideo()).toBe(decoder);
    // 点击选中（rerender selected=true 模拟 ReactFlow 选中流转）：收养悬停会话
    await rerenderNode('video', {
      selected: true,
      data: { src: 'https://x/main.mp4', toolMode: 'select' },
    });
    // 同一元素续播：不暂停、不重启、不重建树内控件 video
    expect(hoverPreviewVideo()).toBe(decoder);
    expect(decoder.isConnected).toBe(true);
    expect(decoder.muted).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(mountNode.querySelector('video[controls]')).toBeNull();
    // 80ms 布防语义：控件出现在悬停会话元素上（不是新建树内元素）
    await act(async () => { vi.advanceTimersByTime(79); });
    expect(decoder.controls).toBe(false);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(decoder.controls).toBe(true);
    expect(mountNode.querySelector('video[controls]')).toBe(decoder);
    // 收养控件合同（IKJ7OS 评审收口）：元素自创建即带 nodrag/nopan——在控件上拖进度/音量
    // 不连动节点拖动（React Flow 沿祖先链找 .nodrag 放行）；controlslist 同树内口径禁下载/倍速
    expect(decoder.classList.contains('nodrag')).toBe(true);
    expect(decoder.classList.contains('nopan')).toBe(true);
    expect(decoder.getAttribute('controlslist')).toBe('nodownload noplaybackrate noremoteplayback nopictureinpicture');
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('过渡定格保持挂载（决策8）：收养会话播完 ended 元素停末帧不重建；再次进入重播仍同元素从头', async () => {
    const { playSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    await rerenderNode('video', { selected: true, data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    await act(async () => { vi.advanceTimersByTime(80); });
    expect(decoder.controls).toBe(true);
    // 播到本轮结束：定格末帧——元素保持挂载、currentTime 不归零、无第二次 play
    decoder.currentTime = 7.7;
    await act(async () => { decoder.dispatchEvent(new Event('ended')); });
    expect(hoverPreviewVideo()).toBe(decoder);
    expect(decoder.isConnected).toBe(true);
    expect(decoder.currentTime).toBe(7.7);
    expect(playSpy).toHaveBeenCalledTimes(1);
    // 布防不因 ended 翻转：等过布防窗口也没有新树内 video 重建（旧元素不被卸载回首帧）
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(mountNode.querySelectorAll('video')).toHaveLength(1);
    expect(mountNode.querySelector('video')).toBe(decoder);
    // 再次进入：定格帧保持（keepFrame 收尾）到重播清层，重播轮就地再收养从头播
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(hoverPreviewVideo()).toBe(decoder);
    expect(decoder.currentTime).toBe(0);
    expect(decoder.controls).toBe(true);
  });

  it('过渡后手动暂停再移开：暂停帧保持挂载（keepFrame 占屏），不触发树内布防重建', async () => {
    const { playSpy } = stubHoverMedia();
    await renderHoverableVideo();
    const decoder = offscreenHostVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    await rerenderNode('video', { selected: true, data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    await act(async () => { vi.advanceTimersByTime(80); });
    expect(decoder.controls).toBe(true);
    // 用户点原生控件暂停（收养会话补挂的让位监听）→ 手动让位
    decoder.currentTime = 3.3;
    await act(async () => { decoder.dispatchEvent(new Event('pause')); });
    // 移开：不再开播、暂停帧保持挂载（元素留播放层、不归零）
    await hoverOutOf(contentCard());
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(hoverPreviewVideo()).toBe(decoder);
    expect(decoder.currentTime).toBe(3.3);
    expect(decoder.isConnected).toBe(true);
    // 占屏阻断布防：等过布防窗口也没有树内重建
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(mountNode.querySelectorAll('video')).toHaveLength(1);
    // 再次进入：重播语义从头（同元素、控件保持）
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
    expect(decoder.controls).toBe(true);
    // 先手动暂停让位，再拖进度：seeked 解除让位、从拖动点续播（jsdom 恒 paused，play 必调）
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
    // 触屏长按/点按进入内容区：不布防不开播
    await hoverInto(contentCard(), 'touch');
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS + 100); });
    expect(playSpy).not.toHaveBeenCalled();
    expect(hoverPreviewVideo()).toBeNull();
    // 鼠标进入照常起播（对照）：同一离屏解码元素移入播放层
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
    // 悬停期有声开播
    expect(decoder.muted).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);
    // 移开收尾归位：muted 复位回默认静音
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
    // selected 默认 true：80ms 布防后树内控件 video 挂载，悬停满 100ms 在其上自动开播
    await renderNode('video', { data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    await act(async () => { vi.advanceTimersByTime(200); });
    const armed = mountNode.querySelector('video')!;
    expect(armed.hasAttribute('controls')).toBe(true);
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
    // 层垫在海报画布之上（fragment 顺序：canvas → 播放层）
    expect(layer.previousElementSibling?.tagName).toBe('CANVAS');
    // CSS 合同：指针穿透 + 不打会合成层化的 transform（fs 直读源文件，绕过 CSS modules 桩；
    // 按测试文件定位，不依赖 cwd=web/ 的调用姿势）
    const css = readFileSync(fileURLToPath(new NodeURL('./index.module.css', import.meta.url)), 'utf8');
    const layerRule = css.match(/\.mediaHoverPreviewLayer\s*\{[^}]*\}/)?.[0] ?? '';
    expect(layerRule).toContain('pointer-events: none');
    expect(layerRule).not.toContain('transform');
    const videoRule = css.match(/\.mediaHoverPreviewLayer video\s*\{[^}]*\}/)?.[0] ?? '';
    expect(videoRule).toContain('object-fit: contain');
    expect(videoRule).not.toContain('transform');
    // 开播后的元素依旧无控件、纯展示
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(hoverPreviewVideo()!.hasAttribute('controls')).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});

describe('MediaNode 视频卡选中态悬停播放（IKJ7S1：尾播特权与手动控制让位）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** 选中成品视频卡基准渲染：真实 http src + 选择工具 + 80ms 布防完成（树内控件 video 在位） */
  async function renderSelectedArmedVideo(extraData: Record<string, unknown> = {}, extra?: RenderExtra) {
    await renderNode('video', {
      selected: true,
      ...extra,
      data: { src: 'https://x/main.mp4', toolMode: 'select', ...extraData },
    });
    // 80ms 布防 + 余量（fake timers 下 waitForVideoArm 的真实 sleep 不会走）
    await act(async () => { vi.advanceTimersByTime(200); });
  }

  function armedVideo(): HTMLVideoElement {
    return mountNode.querySelector('video')!;
  }

  it('选中卡悬停自动开播：树内控件视频就地起播，原生控件与禁画中画/下载/倍速配置保留', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderSelectedArmedVideo();
    const armed = armedVideo();
    expect(armed.hasAttribute('controls')).toBe(true);
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    // 就地开播：同一元素、不迁移进播放层（布防卡无播放层）、有声从头
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(armedVideo()).toBe(armed);
    expect(hoverPreviewLayer()).toBeNull();
    expect(armed.muted).toBe(false);
    expect(armed.currentTime).toBe(0);
    expect(armed.loop).toBe(false);
    // 原生控件与控件配置在播放中保持：controls、禁下载/倍速列表、禁画中画
    expect(armed.hasAttribute('controls')).toBe(true);
    expect(armed.outerHTML).toContain('nodownload noplaybackrate');
    expect(armed.outerHTML).toContain('disablepictureinpicture');
  });

  it('尾播特权：播放中移开不停止，继续播到本轮 ended 定格末帧（不归零、不移出）', async () => {
    const { playSpy, pauseSpy } = stubHoverMedia();
    await renderSelectedArmedVideo();
    const armed = armedVideo();
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(playSpy).toHaveBeenCalledTimes(1);
    // 播放中移开：不暂停、不重启、元素原位（树内）保留
    await hoverOutOf(contentCard());
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(armed.isConnected).toBe(true);
    // 播到本轮结束：定格末帧（currentTime 不归零、不循环），元素原位停住
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
    // 再次进入：清掉定格残留会话并重新布防，从头播（currentTime 归零、第二次 play）
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
    // 用户点原生控件暂停（pause 事件）→ 手动让位
    armed.currentTime = 3.3;
    await act(async () => { armed.dispatchEvent(new Event('pause')); });
    // 移开：不尾播（不再次开播）、不归零——保持暂停帧
    await hoverOutOf(contentCard());
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(armed.currentTime).toBe(3.3);
    expect(armed.isConnected).toBe(true);
    // 再次进入：重播语义，从头播
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
    // 用户已手动接管播放：移开不停止也不重新起播（原生控件行为优先）
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
    // 手动暂停（让位）→ 拖动进度到 0.5：让位解除并从拖动点续播
    await act(async () => { armed.dispatchEvent(new Event('pause')); });
    armed.currentTime = 0.5;
    await act(async () => { armed.dispatchEvent(new Event('seeked')); });
    expect(playSpy).toHaveBeenCalledTimes(2);
    // 移开：从拖动点继续播到结尾（不重置 currentTime），ended 定格末帧
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
    // 恢复唯一选中：悬停照常自动开播
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
    // 多选期不再自动开播
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS + 200); });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('音量调节不记忆：悬停开播尊重控件静音；元素卸载重建后 muted/volume 回默认', async () => {
    const { playSpy } = stubHoverMedia();
    await renderSelectedArmedVideo();
    const first = armedVideo();
    // 用户经原生控件静音 + 调低音量（元素存活期内有效）
    first.muted = true;
    first.volume = 0.3;
    await hoverInto(contentCard());
    await act(async () => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    // 悬停开播不覆盖用户控件状态：仍静音、音量不变
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(first.muted).toBe(true);
    expect(first.volume).toBe(0.3);
    // 卸载重建（重新布防的新元素）：无任何记忆，回浏览器默认
    await renderNode('video', { selected: true, data: { src: 'https://x/main.mp4', toolMode: 'select' } });
    await act(async () => { vi.advanceTimersByTime(200); });
    const rebuilt = armedVideo();
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.muted).toBe(false);
    expect(rebuilt.volume).toBe(1);
  });
});

describe('MediaNode 样片卡徽标（IKIZQB）', () => {
  it('videoStage=sample 的生成中卡：右上角标「样片 480P」，无截止时间时不拼时间段', async () => {
    await renderNode('video', { genStatus: 'generating', progress: 10, data: { videoStage: 'sample' } });
    const badge = mountNode.querySelector('[data-testid="video-sample-badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe('样片 480P');
    expect(badge!.className).not.toContain('sampleBadgeExpired');
  });

  it('成功样片卡：徽标合并显示实际截止时间（服务端 finalize_deadline_at 投影回填）', async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    await renderNode('video', { data: { videoStage: 'sample', finalizeDeadlineAt: future, src: 'http://vid/s.mp4' } });
    const badge = mountNode.querySelector('[data-testid="video-sample-badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain('样片 480P · 截止 ');
    // 本地时区 yyyy-MM-dd HH:mm（分钟精度）
    expect(badge!.textContent).toMatch(/截止 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(badge!.className).not.toContain('sampleBadgeExpired');
    // 样片素材照常渲染（可预览下载由既有视频卡承载——过期不删除已交付样片）
    expect(mountNode.querySelector('[data-testid="media-content"]')).toBeTruthy();
  });

  it('过期样片卡：徽标改警告色，卡片与素材保留（不删除）', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await renderNode('video', { data: { videoStage: 'sample', finalizeDeadlineAt: past, src: 'http://vid/s.mp4' } });
    const badge = mountNode.querySelector('[data-testid="video-sample-badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain('sampleBadgeExpired');
    expect(badge!.getAttribute('title')).toContain('期限已过');
  });

  it('普通视频卡与缺截止样片卡：普通卡不渲染徽标；缺截止（null）只标样片不标时间', async () => {
    await renderNode('video', { data: { src: 'http://vid/n.mp4' } });
    expect(mountNode.querySelector('[data-testid="video-sample-badge"]')).toBeNull();
    await renderNode('video', { data: { videoStage: 'sample', finalizeDeadlineAt: null, src: 'http://vid/s2.mp4' } });
    const badge = mountNode.querySelector('[data-testid="video-sample-badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe('样片 480P');
    expect(badge!.className).not.toContain('sampleBadgeExpired');
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
    // 唯一入口：整卡只有一个成片按钮，且挂在标题行内
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

    await rerenderNode('video', { data: { ...base, finalizeCta: { phase: 'expired' } } });
    expect(ctaButton()!.disabled).toBe(true);
    expect(ctaButton()!.title).toContain('期限已过');

    await rerenderNode('video', { data: { ...base, finalizeCta: { phase: 'unavailable' } } });
    expect(ctaButton()!.disabled).toBe(true);
    expect(ctaButton()!.title).toContain('暂不能生成成片');

    // 禁用态点击不派发（生成中/核对中禁止再次点击）
    for (const phase of ['running', 'checking', 'expired', 'unavailable'] as const) {
      await rerenderNode('video', { data: { ...base, finalizeCta: { phase } } });
      await act(async () => { ctaButton()!.click(); });
    }
    expect(onFinalizeSample).not.toHaveBeenCalled();
  });

  it('缺截止时间（expired 且 finalizeDeadlineAt=null）：title 说明缺可信创建时间', async () => {
    await renderNode('video', {
      data: { videoStage: 'sample', jobId: '9001', src: 'http://vid/s.mp4', finalizeDeadlineAt: null, finalizeCta: { phase: 'expired' } },
    });
    expect(ctaButton()!.disabled).toBe(true);
    expect(ctaButton()!.title).toContain('缺少可信创建时间');
  });

  it('未注入 finalizeCta（普通卡/生成中样片）：不渲染成片按钮', async () => {
    await renderNode('video', { data: { src: 'http://vid/n.mp4' } });
    expect(ctaButton()).toBeNull();
    await renderNode('video', { genStatus: 'generating', progress: 10, data: { videoStage: 'sample', jobId: '9001' } });
    expect(ctaButton()).toBeNull();
  });
});

describe('MediaNode 成片卡与两阶段状态呈现（IKIZQE）', () => {
  it('成功成片卡：普通视频卡体验 + 「成片 1080P」角标，已结算合并实际费用', async () => {
    await renderNode('video', {
      data: {
        videoStage: 'final', sourceSampleJobId: '9001', src: 'http://vid/f.mp4',
        fileName: '成片', width: 1920, height: 1080, jobId: '9002',
        chargeState: 'settled', actualCredits: 80,
      },
    });
    const badge = mountNode.querySelector('[data-testid="video-final-badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe('成片 1080P · 已用 80 积分');
    // 成片卡不渲染样片徽标，也不渲染成片按钮（100% 普通卡）
    expect(mountNode.querySelector('[data-testid="video-sample-badge"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="finalize-cta"]')).toBeNull();
  });

  it('成片生成中/失败卡：角标仍在；失败显示原因与退费状态，不提供重试', async () => {
    await renderNode('video', { genStatus: 'generating', progress: 5, data: { videoStage: 'final', sourceSampleJobId: '9001', jobId: '9002' } });
    expect(mountNode.querySelector('[data-testid="video-final-badge"]')!.textContent).toBe('成片 1080P');

    await renderNode('video', {
      genStatus: 'failed',
      data: { videoStage: 'final', sourceSampleJobId: '9001', jobId: '9002', errorText: '上游生成失败', chargeState: 'released' },
    });
    expect(mountNode.textContent).toContain('上游生成失败');
    expect(mountNode.querySelector('[data-testid="charge-refund-note"]')!.textContent).toContain('预扣已退回');
    // 成片失败不提供同 Draft ID 重试（重新生成入口归 IKIZQG）
    expect([...mountNode.querySelectorAll('button')].some((b) => b.textContent === '重试')).toBe(false);
  });

  it('样片失败卡：标样片、显示退费状态，保留重试（普通失败卡形态不受本票影响）', async () => {
    await renderNode('video', {
      genStatus: 'failed',
      data: { videoStage: 'sample', jobId: '9001', errorText: '样片生成失败', chargeState: 'released' },
    });
    expect(mountNode.querySelector('[data-testid="video-sample-badge"]')).toBeTruthy();
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

  it('样片徽标：已结算（settled）时合并该阶段实际费用（两阶段分别显示费用）', async () => {
    await renderNode('video', {
      data: {
        videoStage: 'sample', jobId: '9001', src: 'http://vid/s.mp4',
        finalizeDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        chargeState: 'settled', actualCredits: 20,
      },
    });
    expect(mountNode.querySelector('[data-testid="video-sample-badge"]')!.textContent)
      .toMatch(/样片 480P · 截止 .+ · 已用 20 积分$/);
  });
});

describe('MediaNode 重新生成样片入口（IKIZQG）', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  function regenButton(): HTMLButtonElement | null {
    return mountNode.querySelector<HTMLButtonElement>('[data-testid="regenerate-cta"]');
  }

  it('过期样片卡标题行：ready 展示新样片费用，title 注明成片另收费与不覆盖旧结果', async () => {
    const onRegenerateSample = vi.fn();
    await renderNode('video', {
      data: {
        videoStage: 'sample', jobId: '9001', src: 'http://vid/s.mp4', finalizeDeadlineAt: past,
        regenerateCta: { phase: 'ready', credits: 40 }, onRegenerateSample,
      },
    });
    const btn = regenButton();
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(false);
    expect(btn!.textContent).toContain('重新生成样片');
    expect(btn!.textContent).toContain('40 积分');
    expect(btn!.getAttribute('title')).toContain('成片另行计费');
    expect(btn!.getAttribute('title')).toContain('不覆盖旧结果');
    await act(async () => { btn!.click(); });
    expect(onRegenerateSample).toHaveBeenCalledWith('video-node');
  });

  it('过期样片卡标题行：loading/checking/unavailable 禁用；未注入不渲染', async () => {
    const base = { videoStage: 'sample', jobId: '9001', src: 'http://vid/s.mp4', finalizeDeadlineAt: past } as const;
    await renderNode('video', { data: { ...base } });
    expect(regenButton()).toBeNull(); // 未注入 regenerateCta：不渲染
    await renderNode('video', { data: { ...base, regenerateCta: { phase: 'loading' } } });
    expect(regenButton()!.disabled).toBe(true);
    await rerenderNode('video', { data: { ...base, regenerateCta: { phase: 'checking' } } });
    expect(regenButton()!.disabled).toBe(true);
    expect(regenButton()!.textContent).toContain('状态核对中');
    await rerenderNode('video', { data: { ...base, regenerateCta: { phase: 'unavailable' } } });
    expect(regenButton()!.disabled).toBe(true);
    // 禁用态点击不派发
    await act(async () => { regenButton()!.click(); });
  });

  it('成片失败卡失败区：入口与失败原因、退费状态并存（可提交态展示费用）', async () => {
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
    expect(btn!.disabled).toBe(false);
    expect(btn!.textContent).toContain('40 积分');
    expect(mountNode.textContent).toContain('上游成片失败');
    expect(mountNode.querySelector('[data-testid="charge-refund-note"]')!.textContent).toContain('预扣已退回');
    // 仍不提供同 Draft ID 重试
    expect([...mountNode.querySelectorAll('button')].some((b) => b.textContent === '重试')).toBe(false);
    await act(async () => { btn!.click(); });
    expect(onRegenerateSample).toHaveBeenCalledWith('video-node');
  });

  it('样片失败卡：失败区不渲染重新生成入口（同输入原卡重试沿用现有重试入口）', async () => {
    await renderNode('video', {
      genStatus: 'failed',
      data: { videoStage: 'sample', jobId: '9001', errorText: '样片生成失败', chargeState: 'released' },
    });
    expect(regenButton()).toBeNull();
    expect([...mountNode.querySelectorAll('button')].some((b) => b.textContent === '重试')).toBe(true);
  });

  it('成功样片卡（未过期）未注入 regenerateCta：标题行无重新生成按钮（成片按钮归 IKIZQE）', async () => {
    await renderNode('video', {
      data: { videoStage: 'sample', jobId: '9001', src: 'http://vid/s.mp4', finalizeDeadlineAt: future },
    });
    expect(regenButton()).toBeNull();
  });
});
