// @vitest-environment jsdom
/* 选中态悬浮工具条用例已随实现迁出（IKGYYD）：工具条 DOM 迁出节点卡后由
   NodeFollowToolbar 钉屏幕容器承载，行为覆盖见 ./Toolbar.test.tsx 与
   ../NodeFollowToolbar/index.test.tsx（按钮构成/顺序/回调/置灰门槛/显隐时机不变）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import MediaNode, { type MediaGenStatus } from './index';

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
}

async function renderNode(
  mediaType: 'image' | 'video' | 'audio',
  extra?: RenderExtra,
) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(ReactFlowProvider, null, createElement(MediaNode, {
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
      } as never)),
    );
  });
}

/** 图片/视频新布局：外部标题行与内容主体（与 e2e 共用 data-testid 锚点） */
function contentCard(): HTMLElement {
  return mountNode.querySelector('[data-testid="media-content"]') as HTMLElement;
}

function titleRow(): HTMLElement {
  return mountNode.querySelector('[data-testid="media-title"]') as HTMLElement;
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
});

describe('MediaNode generating overlay', () => {
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
    expect(mountNode.querySelector('video')).toBeTruthy();
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

  it('keeps the content body square regardless of dims or target ratio', async () => {
    await renderNode('audio', { selected: false, data: { width: 1600, height: 900, targetRatio: '16:9' } });
    expect(parseFloat(contentCard().style.width)).toBe(280);
    expect(parseFloat(contentCard().style.height)).toBe(280);
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

  it('keeps the square body for generating, failed and missing audio', async () => {
    await renderNode('audio', { selected: false, genStatus: 'generating', progress: 0 });
    expect(parseFloat(contentCard().style.width)).toBe(280);
    expect(parseFloat(contentCard().style.height)).toBe(280);

    await renderNode('audio', { selected: false, genStatus: 'failed', errorText: '视频没有音轨' });
    expect(mountNode.textContent).toContain('视频没有音轨');
    expect(parseFloat(contentCard().style.height)).toBe(280);

    await renderNode('audio', { selected: false, data: { assetMissing: true } });
    expect(mountNode.textContent).toContain('素材已被删除');
    expect(parseFloat(contentCard().style.height)).toBe(280);
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
    const video = mountNode.querySelector('video')!;
    Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
    Object.defineProperty(video, 'duration', { value: 12.4, configurable: true });
    await act(async () => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(onMediaDims).toHaveBeenCalledWith('video-node', { width: 1920, height: 1080, duration: 12.4 });
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
    // jsdom 不加载媒体：拦截 HTMLMediaElement.prototype.pause 验证编辑态注入即暂停在当前帧
    const pauseSpy = vi.fn();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseSpy);
    await renderNode('video', { data: { subtitleEraseEditing: editing } });
    expect(pauseSpy).toHaveBeenCalled();
    pause.mockRestore();
    const layer = mountNode.querySelector('[data-testid="subtitle-erase-boxes-layer"]');
    expect(layer).toBeTruthy();
    expect(layer!.className).toContain('nodrag');
    expect(layer!.className).toContain('nopan');
    // 未注入的正常视频卡不渲染框层
    await renderNode('video', {});
    expect(mountNode.querySelector('[data-testid="subtitle-erase-boxes-layer"]')).toBeNull();
  });

  /** 会话锁定播放控件（IKH3NP 审查修订）：会话期 toolMode 恒 select，原生 controls 必须自己
      关掉（智能模式不再注入框层，没有 inset:0 覆盖层替视频挡控件），指针一并交还画布；
      两模式都停帧；无会话标记的选中态视频卡维持原生控件不动。 */
  it('会话锁定期关原生播放控件与指针，智能与框选两模式都生效；无标记时保留 controls', async () => {
    const pauseSpy = vi.fn();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseSpy);
    // 智能模式：只注入停帧标记（无框层），会话期 toolMode 仍为 select
    await renderNode('video', { data: { toolMode: 'select', subtitleErasePaused: true } });
    const smartVideo = mountNode.querySelector('video')!;
    expect(smartVideo.hasAttribute('controls')).toBe(false);
    expect(smartVideo.style.pointerEvents).toBe('none');
    expect(pauseSpy).toHaveBeenCalled();
    // 框选模式：注入框层（本改动对它同样生效，不再只靠框层遮挡）
    pauseSpy.mockClear();
    const editing = {
      boxes: [],
      liveBox: null,
      onBoxStart: () => {},
      onBoxMove: () => {},
      onBoxEnd: () => {},
    };
    await renderNode('video', { data: { toolMode: 'select', subtitleEraseEditing: editing } });
    const boxVideo = mountNode.querySelector('video')!;
    expect(boxVideo.hasAttribute('controls')).toBe(false);
    expect(boxVideo.style.pointerEvents).toBe('none');
    expect(pauseSpy).toHaveBeenCalled();
    // 回归：无会话标记的选中态视频卡保留原生控件且可交互
    await renderNode('video', { data: { toolMode: 'select' } });
    const normalVideo = mountNode.querySelector('video')!;
    expect(normalVideo.hasAttribute('controls')).toBe(true);
    expect(normalVideo.style.pointerEvents).toBe('');
    pause.mockRestore();
  });
});

describe('MediaNode 音视频分离编辑态锁定层（IKH28U）', () => {
  /** 视频卡注入 splitEditing 时：透明锁定层全覆盖内容区接管指针（nodrag/nopan 同框层口径）
      且视频元素被暂停在当前帧；未注入（正常视频卡）不渲染。 */
  it('注入 splitEditing：渲染锁定层并暂停视频；未注入不渲染', async () => {
    // jsdom 不加载媒体：拦截 HTMLMediaElement.prototype.pause 验证编辑态注入即暂停在当前帧
    const pauseSpy = vi.fn();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseSpy);
    await renderNode('video', { data: { splitEditing: true } });
    expect(pauseSpy).toHaveBeenCalled();
    pause.mockRestore();
    const layer = mountNode.querySelector('[data-testid="split-lock-layer"]');
    expect(layer).toBeTruthy();
    expect(layer!.className).toContain('nodrag');
    expect(layer!.className).toContain('nopan');
    // 未注入的正常视频卡不渲染锁定层
    await renderNode('video', {});
    expect(mountNode.querySelector('[data-testid="split-lock-layer"]')).toBeNull();
  });
});
