// @vitest-environment jsdom
/* IKGYYD 媒体卡悬浮工具条（迁出 MediaNode、钉屏幕层内容组件 MediaNodeToolbar）测试：
   用例自 MediaNode/index.test.tsx 迁移（按钮构成/顺序/文案/回调/置灰门槛不变）；
   渲染模式沿用该文件（createRoot + act）；「唯一选中」门在 NodeFollowToolbar 容器
   （index.test.tsx 已覆盖），本文件覆盖数据条件（生成中/素材缺失/空壳不显）与工具条本体。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaNodeToolbar from './Toolbar';
import type { MediaGenStatus } from './index';

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

describe('MediaNodeToolbar 按钮构成与顺序（迁移前后一致）', () => {
  it('音频卡隐藏 @、生成图片、「高清 ▾」与生成视频', async () => {
    await renderToolbar('audio');
    expect(labels()).toEqual(['重新编辑', '详情', '下载']);
  });

  it('图片卡全显（重新编辑/生成图片/生成视频/高清▾/详情/下载/@）', async () => {
    await renderToolbar('image');
    expect(labels()).toEqual(['重新编辑', '生成图片', '生成视频', '高清', '详情', '下载', '添加到 Agent 聊天']);
  });

  it('视频卡保留生成视频与 @，隐藏生成图片与「高清 ▾」，多提取音频', async () => {
    await renderToolbar('video');
    expect(labels()).toEqual(['重新编辑', '生成视频', '提取音频', '详情', '下载', '添加到 Agent 聊天']);
  });

  it('「高清 ▾」下拉排在生成视频之后（IKGM9F 位次不变）', async () => {
    await renderToolbar('image');
    const order = labels();
    expect(order.indexOf('生成视频')).toBeLessThan(order.indexOf('高清'));
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

describe('MediaNodeToolbar 其余按钮回调（携带节点 id）', () => {
  async function clickButton(label: string) {
    const btn = [...mountNode.querySelectorAll('button')]
      .find((b) => (b.textContent?.trim() || b.getAttribute('title')) === label)!;
    await act(async () => {
      btn.click();
    });
  }

  it('重新编辑派发 onReEdit', async () => {
    const onReEdit = vi.fn();
    await renderToolbar('image', { data: { onReEdit } });
    await clickButton('重新编辑');
    expect(onReEdit).toHaveBeenCalledWith('image-node');
  });

  it('生成图片派发 onGenImage', async () => {
    const onGenImage = vi.fn();
    await renderToolbar('image', { data: { onGenImage } });
    await clickButton('生成图片');
    expect(onGenImage).toHaveBeenCalledWith('image-node');
  });

  it('生成视频派发 onGenVideo', async () => {
    const onGenVideo = vi.fn();
    await renderToolbar('image', { data: { onGenVideo } });
    await clickButton('生成视频');
    expect(onGenVideo).toHaveBeenCalledWith('image-node');
  });

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

  it('提取音频：无资产置灰；提交中禁用并显示「提交中…」；完成后恢复', async () => {
    let release: (() => void) | undefined;
    const onExtractAudio = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    await renderToolbar('video', { data: { onExtractAudio } });
    const btn = () => [...mountNode.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('提取音频') || b.textContent?.includes('提交中'))!;
    expect(btn().disabled).toBe(true); // 默认 fixture 无 assetId
    await renderToolbar('video', { id: 'v2', data: { onExtractAudio, assetId: 'a1' } });
    expect(btn().disabled).toBe(false);
    await act(async () => {
      btn().click();
    });
    expect(onExtractAudio).toHaveBeenCalledWith('v2');
    expect(btn().disabled).toBe(true); // 提交中
    expect(btn().textContent).toContain('提交中');
    await act(async () => {
      release!();
    });
    expect(btn().disabled).toBe(false);
    expect(btn().textContent).toContain('提取音频');
  });
});
