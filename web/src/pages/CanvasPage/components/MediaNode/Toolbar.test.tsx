// @vitest-environment jsdom
/* IKGYYD 媒体卡悬浮工具条（迁出 MediaNode/index.tsx、钉屏幕层内容组件 MediaNodeToolbar）测试：
   用例自 MediaNode/index.test.tsx 迁移；渲染模式沿用该文件（createRoot + act）；
   「唯一选中」门在 NodeFollowToolbar 容器（index.test.tsx 已覆盖），本文件覆盖数据条件
   （生成中/素材缺失/空壳不显）与工具条本体。IKH3WE 撤除「重新编辑」「生成图片」「生成视频」
   三按钮：派生新卡唯一路径 = 拖线落空白类型菜单，原卡重跑唯一路径 = 点卡片开绑定面板。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaNodeToolbar from './Toolbar';
import type { MediaGenStatus } from './index';
import styles from './index.module.css';

let root: Root;
let mountNode: HTMLDivElement;

function labels() {
  return [...mountNode.querySelectorAll('button')]
    .map((button) => button.textContent?.trim() || button.getAttribute('title') || '');
}

interface RenderExtra {
  id?: string;
  genStatus?: MediaGenStatus;
  data?: Record<string, unknown>;
}

async function renderToolbar(
  mediaType: 'image' | 'video' | 'audio',
  extra?: RenderExtra,
) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(MediaNodeToolbar, {
      id: extra?.id ?? `${mediaType}-node`,
      data: {
        mediaType,
        src: 'blob:test',
        fileName: `${mediaType}.bin`,
        jobId: 'job-1',
        genStatus: extra?.genStatus,
        ...extra?.data,
      },
    }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.restoreAllMocks();
});

describe('MediaNodeToolbar 按钮构成与顺序（IKH3WE 撤除生成类按钮后）', () => {
  it('音频卡只有详情与下载（@ 本就隐藏）', async () => {
    await renderToolbar('audio');
    expect(labels()).toEqual(['详情', '下载']);
  });

  it('图片卡全显（高清▾/详情/下载/@）', async () => {
    await renderToolbar('image');
    expect(labels()).toEqual(['高清', '详情', '下载', '添加到 Agent 聊天']);
  });

  it('工具条容器底类存在，「添加到对话」为透明底 toolBtn 而非胶囊类（IKGZ8B）', async () => {
    await renderToolbar('image');
    expect(mountNode.querySelector(`.${styles.toolbar}`)).not.toBeNull();
    const addToChat = [...mountNode.querySelectorAll('button')]
      .find((b) => b.getAttribute('title') === '添加到 Agent 聊天')!;
    expect(addToChat.classList.contains(styles.toolBtn)).toBe(true);
  });

  it('视频卡保留智能去字幕与 @，隐藏「高清 ▾」，多音视频分离', async () => {
    await renderToolbar('video');
    expect(labels()).toEqual(['智能去字幕', '音视频分离', '详情', '下载', '添加到 Agent 聊天']);
  });

  it('「重新编辑」「生成图片」「生成视频」不再渲染（IKH3WE：派生新卡走拖线类型菜单、原卡重跑走点卡片）', async () => {
    await renderToolbar('image');
    expect(labels()).not.toContain('重新编辑');
    expect(labels()).not.toContain('生成图片');
    expect(labels()).not.toContain('生成视频');
    await renderToolbar('video');
    expect(labels()).not.toContain('重新编辑');
    expect(labels()).not.toContain('生成图片');
    expect(labels()).not.toContain('生成视频');
    await renderToolbar('audio');
    expect(labels()).not.toContain('重新编辑');
    expect(labels()).not.toContain('生成图片');
    expect(labels()).not.toContain('生成视频');
  });

  it('「高清 ▾」下拉在详情之前（IKGM9F 位次不变）', async () => {
    await renderToolbar('image');
    const order = labels();
    expect(order.indexOf('高清')).toBeLessThan(order.indexOf('详情'));
  });

  it('点击高清放大派发 onEnhanceImage（携带节点 id；经「高清 ▾」下拉菜单项触发）', async () => {
    const onEnhanceImage = vi.fn();
    await renderToolbar('image', { data: { onEnhanceImage } });
    const trigger = [...mountNode.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === '高清')!;
    // IKGZ5P：悬浮展开（mouseover），点击触发钮改为直启所显示工具
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    const item = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-enhance"]')!;
    await act(async () => {
      item.click();
    });
    expect(onEnhanceImage).toHaveBeenCalledWith('image-node');
  });

  it('生成中的图片卡不显示工具条（数据条件，同迁移前）', async () => {
    await renderToolbar('image', { genStatus: 'generating', data: { src: 'http://img/old.png' } });
    expect(labels()).toEqual([]);
  });

  it('已失败的图片卡不显示工具条（数据条件，同迁移前）', async () => {
    await renderToolbar('image', { genStatus: 'failed', data: { src: '', draft: true } });
    expect(labels()).toEqual([]);
  });

  it('待生成草稿卡不显示工具条（数据条件，同迁移前）', async () => {
    await renderToolbar('image', { genStatus: 'draft', data: { src: '', draft: true } });
    expect(labels()).toEqual([]);
  });

  it('素材缺失的图片卡不显示工具条（数据条件，同迁移前）', async () => {
    await renderToolbar('image', { data: { assetMissing: true, src: '' } });
    expect(labels()).toEqual([]);
  });

  it('空壳上传卡不显示工具条（数据条件，同迁移前）', async () => {
    await renderToolbar('image', { data: { emptyShell: true, src: '' } });
    expect(labels()).toEqual([]);
  });
});

describe('MediaNodeToolbar image-quality menu（高清 ▾）', () => {
  /** 展开「高清 ▾」下拉（IKGZ5P 悬浮展开：mouseover 合成 onMouseEnter） */
  async function openQualityMenu() {
    const trigger = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-trigger"]')!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
  }

  it('图片卡展开菜单含「高清」「扩图」「裁切」「擦除」「抠图」五项（IKGW1H+IKGOQ0+IKGXLT 合并顺序）', async () => {
    await renderToolbar('image');
    await openQualityMenu();
    const rendered = [...mountNode.querySelectorAll('[data-testid^="image-quality-item-"]')];
    expect(rendered.map((b) => b.textContent)).toEqual(['高清', '扩图', '裁切', '擦除', '抠图']);
  });

  it('点「抠图」派发 onCutoutImage（携带节点 id）', async () => {
    const onCutoutImage = vi.fn();
    await renderToolbar('image', { data: { onCutoutImage, mime: 'image/png' } });
    await openQualityMenu();
    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-cutout"]')!.click();
    });
    expect(onCutoutImage).toHaveBeenCalledWith('image-node');
  });

  it('点「裁切」派发 onCropImage（携带节点 id）', async () => {
    const onCropImage = vi.fn();
    await renderToolbar('image', { data: { onCropImage } });
    await openQualityMenu();
    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-crop"]')!.click();
    });
    expect(onCropImage).toHaveBeenCalledWith('image-node');
  });

  it('裁切项无置灰门槛：超尺寸/超大小/webp 的图也不置灰（与擦除门槛对照）', async () => {
    await renderToolbar('image', { data: { width: 3000, height: 1440, size: 10 * 1024 * 1024 + 1, mime: 'image/webp' } });
    await openQualityMenu();
    const crop = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-crop"]')!;
    expect(crop.getAttribute('aria-disabled')).toBeNull();
    // 擦除项按门槛置灰，裁切不受影响
    const erase = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-erase"]')!;
    expect(erase.getAttribute('aria-disabled')).toBe('true');
  });

  it('点「擦除」派发 onEraseImage（携带节点 id）', async () => {
    const onEraseImage = vi.fn();
    // mime 补 png：默认 fixture 文件名 .bin 在擦除格式白名单外（png/jpg/jpeg/heic）会被置灰
    await renderToolbar('image', { data: { onEraseImage, mime: 'image/png' } });
    await openQualityMenu();
    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-erase"]')!.click();
    });
    expect(onEraseImage).toHaveBeenCalledWith('image-node');
  });

  it('超尺寸（长边>2560 或短边>1440）：擦除置灰并悬停原因，高清项不受影响', async () => {
    await renderToolbar('image', { data: { width: 3000, height: 1440, mime: 'image/png' } });
    await openQualityMenu();
    const erase = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-erase"]')!;
    expect(erase.getAttribute('aria-disabled')).toBe('true');
    expect(erase.getAttribute('title')).toContain('长边超过 2560');
    const enhance = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-enhance"]')!;
    expect(enhance.getAttribute('aria-disabled')).toBeNull();

    // 短边>1440 同样置灰（横图 2000×1441：短边 1441 超上限；竖图 1440×2560 合法另测于 imageErase.test）
    await renderToolbar('image', { id: 'tall-node', data: { width: 2000, height: 1441, mime: 'image/png', onEraseImage: vi.fn() } });
    await openQualityMenu();
    expect(
      mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-erase"]')!.getAttribute('title'),
    ).toContain('短边超过 1440');
  });

  it('超大小（>10MB）：擦除置灰并悬停原因', async () => {
    await renderToolbar('image', { data: { width: 1600, height: 900, size: 10 * 1024 * 1024 + 1, mime: 'image/png' } });
    await openQualityMenu();
    const erase = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-erase"]')!;
    expect(erase.getAttribute('aria-disabled')).toBe('true');
    expect(erase.getAttribute('title')).toContain('10MB');
  });

  it('webp 与 gif（mime / src 后缀）：擦除置灰并说明格式不支持', async () => {
    await renderToolbar('image', { data: { width: 1600, height: 900, mime: 'image/webp' } });
    await openQualityMenu();
    const erase = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-erase"]')!;
    expect(erase.getAttribute('aria-disabled')).toBe('true');
    expect(erase.getAttribute('title')).toContain('webp');

    await renderToolbar('image', { id: 'gif-node', data: { width: 1600, height: 900, src: 'http://img/x.gif' } });
    await openQualityMenu();
    const gifErase = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-erase"]')!;
    expect(gifErase.getAttribute('aria-disabled')).toBe('true');
    expect(gifErase.getAttribute('title')).toContain('gif');
  });

  it('尺寸 null 的存量图：擦除不置灰', async () => {
    await renderToolbar('image', { data: { mime: 'image/png' } });
    await openQualityMenu();
    const erase = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-erase"]')!;
    expect(erase.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('MediaNodeToolbar enhance dropdown menu 扩图项（IKGOQX）', () => {
  const menuBtn = () => mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-trigger"]')!;
  const menu = () => mountNode.querySelector('[data-testid="image-quality-menu"]');
  const menuItem = (id: string) => mountNode.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

  /** IKGZ5P 悬浮展开：mouseover 合成 onMouseEnter（点击触发钮已改为直启最近工具） */
  async function openMenu() {
    await act(async () => {
      menuBtn().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    expect(menu()).toBeTruthy();
  }

  it('菜单项「扩图」派发 onOutpaintImage 并收起菜单', async () => {
    const onOutpaintImage = vi.fn();
    await renderToolbar('image', { data: { onOutpaintImage, width: 1600, height: 900, size: 1000 } });
    await openMenu();
    await act(async () => {
      menuItem('image-quality-item-outpaint').click();
    });
    expect(onOutpaintImage).toHaveBeenCalledWith('image-node');
    expect(menu()).toBeNull();
  });

  it('源图门槛达标时「扩图」可用（长边恰 4160、文件恰 10MB）', async () => {
    const onOutpaintImage = vi.fn();
    await renderToolbar('image', {
      data: { onOutpaintImage, width: 4160, height: 2000, size: 10 * 1024 * 1024 },
    });
    await openMenu();
    const item = menuItem('image-quality-item-outpaint');
    expect(item.getAttribute('aria-disabled')).toBeNull();
    await act(async () => {
      item.click();
    });
    expect(onOutpaintImage).toHaveBeenCalledWith('image-node');
  });

  it('扩图置灰矩阵：长边超 4160 / 文件超 10MB / 真实宽高缺失，悬停说明原因且点击不派发', async () => {
    // 长边超限
    const overLong = { onOutpaintImage: vi.fn(), width: 4161, height: 2000, size: 1000 };
    await renderToolbar('image', { data: overLong });
    await openMenu();
    const item1 = menuItem('image-quality-item-outpaint');
    expect(item1.getAttribute('aria-disabled')).toBe('true');
    expect(item1.getAttribute('title')).toContain('4160');
    await act(async () => {
      item1.click();
    });
    expect(overLong.onOutpaintImage).not.toHaveBeenCalled();
    expect(menu()).toBeTruthy(); // 置灰点击不收菜单
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    // 文件超限
    const overSize = { onOutpaintImage: vi.fn(), width: 2000, height: 1000, size: 10 * 1024 * 1024 + 1 };
    await renderToolbar('image', { data: overSize });
    await openMenu();
    const item2 = menuItem('image-quality-item-outpaint');
    expect(item2.getAttribute('aria-disabled')).toBe('true');
    expect(item2.getAttribute('title')).toContain('10MB');
    await act(async () => {
      item2.click();
    });
    expect(overSize.onOutpaintImage).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    // 真实宽高缺失
    const noDims = { onOutpaintImage: vi.fn(), size: 1000 };
    await renderToolbar('image', { data: noDims });
    await openMenu();
    const item3 = menuItem('image-quality-item-outpaint');
    expect(item3.getAttribute('aria-disabled')).toBe('true');
    // 拒绝文案与契约单处定义同源（IKGOR6 切契约后不再是本地「尺寸未知」措辞）
    expect(item3.getAttribute('title')).toContain('缺少真实尺寸信息');
    await act(async () => {
      item3.click();
    });
    expect(noDims.onOutpaintImage).not.toHaveBeenCalled();
  });

  it('扩图门槛不影响「高清」项：门槛超标时高清仍可点', async () => {
    const onEnhanceImage = vi.fn();
    await renderToolbar('image', { data: { onEnhanceImage, width: 5000, height: 4000, size: 20 * 1024 * 1024 } });
    await openMenu();
    expect(menuItem('image-quality-item-outpaint').getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      menuItem('image-quality-item-enhance').click();
    });
    expect(onEnhanceImage).toHaveBeenCalledWith('image-node');
  });
});

/* IKH3OU（ADR-0104）：入口从单按钮改「智能去字幕 ▾」下拉触发钮，交互口径同图片「高清 ▾」
   家族（悬停自动展开、移出 120ms 延迟关闭、Esc/点外立即关闭、整钮 aria-disabled 置灰但
   hover 仍展开菜单看原因），差异是无最近工具记忆（文案固定）与菜单项纯文字无图标。
   合成事件口径沿用 ImageQualityMenu.test.tsx（mouseover/mouseout + relatedTarget 在 wrap 外）。 */
describe('MediaNodeToolbar 「智能去字幕 ▾」下拉入口（IKH3OU）', () => {
  const trigger = () => mountNode.querySelector<HTMLButtonElement>('[data-testid="subtitle-erase-menu-trigger"]')!;
  const menu = () => mountNode.querySelector('[data-testid="subtitle-erase-menu"]');
  const item = (id: string) =>
    mountNode.querySelector<HTMLButtonElement>(`[data-testid="subtitle-erase-menu-item-${id}"]`);

  async function hoverIn() {
    await act(async () => {
      trigger().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
  }

  async function hoverOut() {
    await act(async () => {
      trigger().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    });
  }

  /** 推进 hover 延迟关闭的等待时间（120ms 窗口 + 余量） */
  async function settleHoverClose() {
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('仅视频卡显示，位置在「音视频分离」之前', async () => {
    await renderToolbar('video');
    const order = labels();
    expect(order.indexOf('智能去字幕')).toBeLessThan(order.indexOf('音视频分离'));
    // 图片卡/音频卡不显示（精确数组用例「图片卡全显」「音频卡隐藏」已覆盖，此处再断不冗余出现）
    await renderToolbar('image');
    expect(labels().includes('智能去字幕')).toBe(false);
  });

  it('悬停自动展开两项纯文字菜单（无图标、无最近工具记忆，文案固定）', async () => {
    await renderToolbar('video', { data: { onVideoSubtitleErase: vi.fn() } });
    expect(trigger().textContent).toContain('智能去字幕');
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    // 默认收起
    expect(menu()).toBeNull();
    await hoverIn();
    const rendered = [...mountNode.querySelectorAll('[data-testid^="subtitle-erase-menu-item-"]')];
    expect(rendered.map((b) => b.textContent)).toEqual(['智能去字幕', '框选去字幕']);
    // 纯文字：菜单项内不渲染图标（svg）
    expect(rendered.every((b) => b.querySelector('svg') === null)).toBe(true);
  });

  it('移出触发钮延迟后关闭；延迟窗口内重新进入不关闭', async () => {
    await renderToolbar('video', { data: { onVideoSubtitleErase: vi.fn() } });
    await hoverIn();
    await hoverOut();
    // 延迟窗口内菜单保持（指针可从触发钮滑向菜单项）
    expect(menu()).not.toBeNull();
    await settleHoverClose();
    expect(menu()).toBeNull();

    await hoverIn();
    await hoverOut();
    await hoverIn();
    await settleHoverClose();
    expect(menu()).not.toBeNull();
  });

  it('Esc 与点外立即关闭（不等待延迟窗口）', async () => {
    await renderToolbar('video', { data: { onVideoSubtitleErase: vi.fn() } });
    await hoverIn();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(menu()).toBeNull();

    await hoverIn();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it('菜单项直启两模式会话：智能去字幕派发 smart、框选去字幕派发 box（携带节点 id）', async () => {
    const onVideoSubtitleErase = vi.fn();
    await renderToolbar('video', { data: { onVideoSubtitleErase } });
    await hoverIn();
    await act(async () => {
      item('box')!.click();
    });
    expect(onVideoSubtitleErase).toHaveBeenCalledWith('video-node', 'box');
    // 选择后菜单收起
    expect(menu()).toBeNull();

    await hoverIn();
    await act(async () => {
      item('smart')!.click();
    });
    expect(onVideoSubtitleErase).toHaveBeenLastCalledWith('video-node', 'smart');
  });

  it('点击触发钮直启首项智能模式（文案固定无记忆，口径同家族触发钮直启所显示工具）', async () => {
    const onVideoSubtitleErase = vi.fn();
    await renderToolbar('video', { data: { onVideoSubtitleErase } });
    await act(async () => {
      trigger().click();
    });
    expect(onVideoSubtitleErase).toHaveBeenCalledWith('video-node', 'smart');
  });

  it('超 2K 置灰：整钮 aria-disabled + 悬停原因，点击不派发；竖屏短长边语义放行', async () => {
    const onVideoSubtitleErase = vi.fn();
    await renderToolbar('video', { data: { onVideoSubtitleErase, width: 2561, height: 1440 } });
    const long = trigger();
    expect(long.getAttribute('aria-disabled')).toBe('true');
    expect(long.disabled).toBe(false); // aria-disabled 而非原生 disabled：hover 仍需可展开
    expect(long.getAttribute('title')).toContain('长边超过 2560');
    await act(async () => {
      long.click();
    });
    expect(onVideoSubtitleErase).not.toHaveBeenCalled();

    // 竖屏短长边语义：1440×2560 合法；短边 1441 超上限（横屏 2560×1441）
    await renderToolbar('video', { id: 'tall-node', data: { onVideoSubtitleErase, width: 1440, height: 2560 } });
    expect(trigger().getAttribute('aria-disabled')).toBeNull();
    await renderToolbar('video', { id: 'wide-node', data: { onVideoSubtitleErase, width: 2560, height: 1441 } });
    const wide = trigger();
    expect(wide.getAttribute('aria-disabled')).toBe('true');
    expect(wide.getAttribute('title')).toContain('短边超过 1440');
    await act(async () => {
      wide.click();
    });
    expect(onVideoSubtitleErase).not.toHaveBeenCalled();
  });

  it('超 10 分钟置灰并悬停原因；恰 10 分钟放行', async () => {
    await renderToolbar('video', { data: { width: 1920, height: 1080, duration: 600.001 } });
    const over = trigger();
    expect(over.getAttribute('aria-disabled')).toBe('true');
    expect(over.getAttribute('title')).toContain('10 分钟');
    await renderToolbar('video', { id: 'exact-node', data: { width: 1920, height: 1080, duration: 600 } });
    expect(trigger().getAttribute('aria-disabled')).toBeNull();
  });

  it('宽高/时长缺失（null）放行不置灰（存量视频不误拦），触发钮无默认悬停文案', async () => {
    await renderToolbar('video');
    const btn = trigger();
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    // 旧可用态效果边界句随「全画面文字」开关废除（ADR-0104），可用态不再有默认 title
    expect(btn.getAttribute('title')).toBeNull();
  });

  it('整卡置灰时 hover 仍展开菜单，两项各自 aria-disabled 且 title 保留自己的 hint', async () => {
    const onVideoSubtitleErase = vi.fn();
    await renderToolbar('video', { data: { onVideoSubtitleErase, width: 3840, height: 2160 } });
    await hoverIn();
    expect(menu()).not.toBeNull();
    const smart = item('smart')!;
    const box = item('box')!;
    expect(smart.getAttribute('aria-disabled')).toBe('true');
    expect(box.getAttribute('aria-disabled')).toBe('true');
    // 故事 7：置灰时仍能看两项说明——title 恒为自己的 hint，不替换成整卡原因
    expect(smart.getAttribute('title')).toBe('自动擦除画面下半字幕');
    expect(box.getAttribute('title')).toBe('拉框指定要擦的区域');
    await act(async () => {
      smart.click();
      box.click();
    });
    expect(onVideoSubtitleErase).not.toHaveBeenCalled();
  });

  it('门槛为空时两项均可点，title 各为自己的 hint', async () => {
    const onVideoSubtitleErase = vi.fn();
    await renderToolbar('video', { data: { onVideoSubtitleErase, width: 1920, height: 1080, duration: 30 } });
    await hoverIn();
    const smart = item('smart')!;
    const box = item('box')!;
    expect(smart.getAttribute('aria-disabled')).toBeNull();
    expect(box.getAttribute('aria-disabled')).toBeNull();
    expect(smart.getAttribute('title')).toBe('自动擦除画面下半字幕');
    expect(box.getAttribute('title')).toBe('拉框指定要擦的区域');
  });
});

describe('MediaNodeToolbar 其余按钮回调（携带节点 id）', () => {
  async function clickButton(label: string) {
    const btn = [...mountNode.querySelectorAll('button')]
      .find((b) => (b.textContent?.trim() || b.getAttribute('title')) === label)!;
    await act(async () => {
      btn.click();
    });
  }

  it('详情与下载派发 onShowDetails / onDownload', async () => {
    const onShowDetails = vi.fn();
    const onDownload = vi.fn();
    await renderToolbar('image', { data: { onShowDetails, onDownload } });
    await clickButton('详情');
    await clickButton('下载');
    expect(onShowDetails).toHaveBeenCalledWith('image-node');
    expect(onDownload).toHaveBeenCalledWith('image-node');
  });

  it('@ 派发 onAddToChat', async () => {
    const onAddToChat = vi.fn();
    await renderToolbar('image', { data: { onAddToChat } });
    await clickButton('添加到 Agent 聊天');
    expect(onAddToChat).toHaveBeenCalledWith('image-node');
  });

  it('音视频分离（IKH28U）：无资产置灰并悬停唯一原因；点击派发进入编辑态回调（不再一键直发、无提交中态）', async () => {
    const onAudioVideoSplit = vi.fn();
    await renderToolbar('video', { data: { onAudioVideoSplit } });
    const btn = () => [...mountNode.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('音视频分离'))!;
    expect(btn().disabled).toBe(true); // 默认 fixture 无 assetId（唯一置灰条件）
    expect(btn().getAttribute('title')).toContain('尚未关联资产');
    expect(btn().getAttribute('title')).not.toContain('仅音频'); // 置灰原因与可用态 hint 互斥（同一 title 通道）
    await act(async () => {
      btn().click();
    });
    expect(onAudioVideoSplit).not.toHaveBeenCalled(); // 置灰点击不派发

    await renderToolbar('video', { id: 'v2', data: { onAudioVideoSplit, assetId: 'a1' } });
    expect(btn().disabled).toBe(false);
    expect(btn().textContent).toContain('音视频分离');
    expect(btn().getAttribute('title')).toContain('仅音频'); // 可用态悬停为效果边界一句
    await act(async () => {
      btn().click();
    });
    expect(onAudioVideoSplit).toHaveBeenCalledWith('v2'); // 同步进入会话派发，无「提交中…」中间态
  });
});
