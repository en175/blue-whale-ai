// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import MediaNode, { type MediaGenStatus } from './index';

let root: Root;
let mountNode: HTMLDivElement;

function labels(toolbarOnly = false) {
  return [...mountNode.querySelectorAll('button')]
    .filter((button) => !toolbarOnly || !button.closest('[data-testid="media-content"]'))
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
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.restoreAllMocks();
});

describe('MediaNode selected toolbar', () => {
  it('hides @, generate-image, enhance-image and generate-video on an audio node', async () => {
    await renderNode('audio');
    expect(labels(true)).toEqual(['重新编辑', '详情', '下载']);
  });

  it('keeps @ and generate actions on an image node', async () => {
    await renderNode('image');
    expect(labels()).toEqual(['重新编辑', '生成图片', '生成视频', '高清', '详情', '下载', '添加到 Agent 聊天']);
  });

  it('keeps @ and generate-video on a video node, still hides enhance-image', async () => {
    await renderNode('video');
    expect(labels()).toEqual(['重新编辑', '生成视频', '提取音频', '详情', '下载', '添加到 Agent 聊天']);
  });

  it('高清入口排在生成视频之后（IKGM9F，IKGOQX 改为下拉按钮）', async () => {
    await renderNode('image');
    const order = labels();
    expect(order.indexOf('生成视频')).toBeLessThan(order.indexOf('高清'));
    expect(order.indexOf('高清')).toBeLessThan(order.indexOf('详情'));
  });

  it('点击高清放大派发 onEnhanceImage（携带节点 id；IKGOQX 起经下拉菜单项触发）', async () => {
    const onEnhanceImage = vi.fn();
    await renderNode('image', { data: { onEnhanceImage } });
    // 工具条按钮「高清 ▾」先展开菜单，再点菜单项「高清」触发既有行为
    const dropdown = mountNode.querySelector<HTMLButtonElement>('[data-testid="enhance-menu-btn"]')!;
    await act(async () => {
      dropdown.click();
    });
    const item = mountNode.querySelector<HTMLButtonElement>('[data-testid="enhance-menu-enhance"]')!;
    await act(async () => {
      item.click();
    });
    expect(onEnhanceImage).toHaveBeenCalledWith('image-node');
  });

  it('生成中的图片卡不显示高清放大（工具条整体隐藏）', async () => {
    await renderNode('image', { genStatus: 'generating', progress: 0, selected: true, data: { src: 'http://img/old.png' } });
    expect(labels()).not.toContain('高清');
  });

  it('已失败的图片卡不显示高清放大（工具条整体隐藏）', async () => {
    await renderNode('image', { genStatus: 'failed', errorText: '配额不足', selected: true, data: { src: '', draft: true } });
    expect(labels()).not.toContain('高清');
  });

  it('素材缺失的图片卡不显示高清放大（工具条整体隐藏）', async () => {
    await renderNode('image', { selected: true, data: { assetMissing: true, src: '' } });
    expect(labels()).not.toContain('高清');
    expect(mountNode.textContent).toContain('素材已被删除');
  });
});

describe('MediaNode enhance dropdown menu (IKGOQX)', () => {
  const menuBtn = () => mountNode.querySelector<HTMLButtonElement>('[data-testid="enhance-menu-btn"]')!;
  const menu = () => mountNode.querySelector('[data-testid="enhance-menu"]');
  const menuItem = (id: string) => mountNode.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

  async function openMenu() {
    await act(async () => {
      menuBtn().click();
    });
    expect(menu()).toBeTruthy();
  }

  it('点「高清 ▾」展开菜单：只含「高清」「扩图」两项，不含未实现功能', async () => {
    await renderNode('image');
    expect(menu()).toBeNull();
    await openMenu();
    const items = [...menu()!.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(items).toEqual(['高清', '扩图']);
  });

  it('菜单项「高清」行为与改造前一致：派发 onEnhanceImage 并收起菜单', async () => {
    const onEnhanceImage = vi.fn();
    await renderNode('image', { data: { onEnhanceImage } });
    await openMenu();
    await act(async () => {
      menuItem('enhance-menu-enhance').click();
    });
    expect(onEnhanceImage).toHaveBeenCalledWith('image-node');
    expect(menu()).toBeNull();
  });

  it('菜单项「扩图」派发 onOutpaintImage 并收起菜单', async () => {
    const onOutpaintImage = vi.fn();
    await renderNode('image', { data: { onOutpaintImage, width: 1600, height: 900, size: 1000 } });
    await openMenu();
    await act(async () => {
      menuItem('enhance-menu-outpaint').click();
    });
    expect(onOutpaintImage).toHaveBeenCalledWith('image-node');
    expect(menu()).toBeNull();
  });

  it('再点一次按钮收起菜单', async () => {
    await renderNode('image');
    await openMenu();
    await act(async () => {
      menuBtn().click();
    });
    expect(menu()).toBeNull();
  });

  it('点菜单外区域收起菜单', async () => {
    await renderNode('image');
    await openMenu();
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it('源图门槛达标时「扩图」可用（长边恰 4160、文件恰 10MB）', async () => {
    const onOutpaintImage = vi.fn();
    await renderNode('image', {
      data: { onOutpaintImage, width: 4160, height: 2000, size: 10 * 1024 * 1024 },
    });
    await openMenu();
    const item = menuItem('enhance-menu-outpaint');
    expect(item.getAttribute('aria-disabled')).toBeNull();
    await act(async () => {
      item.click();
    });
    expect(onOutpaintImage).toHaveBeenCalledWith('image-node');
  });

  it('扩图置灰矩阵：长边超 4160 / 文件超 10MB / 真实宽高缺失，悬停说明原因且点击不派发', async () => {
    // 长边超限
    const overLong = { onOutpaintImage: vi.fn(), width: 4161, height: 2000, size: 1000 };
    await renderNode('image', { data: overLong });
    await openMenu();
    const item1 = menuItem('enhance-menu-outpaint');
    expect(item1.getAttribute('aria-disabled')).toBe('true');
    expect(item1.getAttribute('title')).toContain('4160');
    await act(async () => {
      item1.click();
    });
    expect(overLong.onOutpaintImage).not.toHaveBeenCalled();
    expect(menu()).toBeTruthy(); // 置灰点击不收菜单
    await act(async () => {
      menuBtn().click();
    });

    // 文件超限
    const overSize = { onOutpaintImage: vi.fn(), width: 2000, height: 1000, size: 10 * 1024 * 1024 + 1 };
    await renderNode('image', { data: overSize });
    await openMenu();
    const item2 = menuItem('enhance-menu-outpaint');
    expect(item2.getAttribute('aria-disabled')).toBe('true');
    expect(item2.getAttribute('title')).toContain('10MB');
    await act(async () => {
      item2.click();
    });
    expect(overSize.onOutpaintImage).not.toHaveBeenCalled();
    await act(async () => {
      menuBtn().click();
    });

    // 真实宽高缺失
    const noDims = { onOutpaintImage: vi.fn(), size: 1000 };
    await renderNode('image', { data: noDims });
    await openMenu();
    const item3 = menuItem('enhance-menu-outpaint');
    expect(item3.getAttribute('aria-disabled')).toBe('true');
    expect(item3.getAttribute('title')).toContain('尺寸未知');
    await act(async () => {
      item3.click();
    });
    expect(noDims.onOutpaintImage).not.toHaveBeenCalled();
  });

  it('扩图门槛不影响「高清」项：门槛超标时高清仍可点', async () => {
    const onEnhanceImage = vi.fn();
    await renderNode('image', { data: { onEnhanceImage, width: 5000, height: 4000, size: 20 * 1024 * 1024 } });
    await openMenu();
    expect(menuItem('enhance-menu-outpaint').getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      menuItem('enhance-menu-enhance').click();
    });
    expect(onEnhanceImage).toHaveBeenCalledWith('image-node');
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

  it('待生成草稿：选中态不显示媒体工具条（无有效素材可操作）', async () => {
    await renderNode('image', { genStatus: 'draft', selected: true, data: { src: '', draft: true } });
    expect(labels()).toEqual([]);
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

  it('keeps extract progress copy and bar for audio extraction', async () => {
    await renderNode('audio', {
      id: 'media-extract-job-1',
      genStatus: 'generating',
      progress: 42,
      selected: false,
    });
    expect(mountNode.textContent).toContain('正在提取音频 42%');
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
