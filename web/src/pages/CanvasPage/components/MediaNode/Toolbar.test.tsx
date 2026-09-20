// @vitest-environment jsdom
/* IKGYYD 媒体卡悬浮工具条（迁出 MediaNode/index.tsx、钉屏幕层内容组件 MediaNodeToolbar）测试：
   用例自 MediaNode/index.test.tsx 迁移；渲染模式沿用该文件（createRoot + act）；
   「唯一选中」门在 NodeFollowToolbar 容器（index.test.tsx 已覆盖），本文件覆盖数据条件
   （生成中/素材缺失/空壳不显）与工具条本体。IKH3WE 撤除「重新编辑」「生成图片」「生成视频」
   三按钮：派生新卡唯一路径 = 拖线落空白类型菜单，原卡重跑唯一路径 = 点卡片开绑定面板。
   IKH3XZ 五画质工具横排常显：高清/扩图/裁切/擦除/抠图离开「高清 ▾」下拉直接排上工具条，
   「高清」图标换 ZoomIn，触发钮最近工具记忆与悬浮展开整套退役（ADR-0107）。
   IKH8Q3（ADR-0109）音频卡横矩形改版：音频分支改五功能置灰占位钮（截取/调速/混合/
   音视频合成/转码，悬停「即将上线」、不绑定点击）+ 分隔线 + 下载，详情对音频退役。
   IKHA2E：视频卡「音视频分离」自单按钮改「音视频分离 ▾」下拉触发钮（同构 SubtitleEraseMenu
   独立实例），第二项「人声背景分离」仅派发挂接点（编辑态本体归后续票）。 */
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
  it('音频卡五占位钮连排 + 分隔线 + 下载，详情退役、@ 隐藏（IKH8Q3）', async () => {
    await renderToolbar('audio');
    expect(labels()).toEqual(['截取', '调速', '混合', '音视频合成', '转码', '下载']);
  });

  it('图片卡全显（五画质工具横排 + 详情/下载/@，IKH3XZ）', async () => {
    await renderToolbar('image');
    expect(labels()).toEqual(['高清', '扩图', '裁切', '擦除', '抠图', '详情', '下载', '添加到 Agent 聊天']);
  });

  it('画质五按钮连排且整体在「详情」之前（IKGM9F 位次不变）', async () => {
    await renderToolbar('image');
    const order = labels();
    expect(order.indexOf('抠图')).toBeLessThan(order.indexOf('详情'));
  });

  it('工具条容器底类存在，「添加到对话」为透明底 toolBtn 而非胶囊类（IKGZ8B）', async () => {
    await renderToolbar('image');
    expect(mountNode.querySelector(`.${styles.toolbar}`)).not.toBeNull();
    const addToChat = [...mountNode.querySelectorAll('button')]
      .find((b) => b.getAttribute('title') === '添加到 Agent 聊天')!;
    expect(addToChat.classList.contains(styles.toolBtn)).toBe(true);
  });

  it('视频卡保留 HD（首位）与智能去字幕与 @，隐藏「高清 ▾」，多音视频分离', async () => {
    await renderToolbar('video');
    expect(labels()).toEqual(['HD高清', '智能去字幕', '音视频分离', '详情', '下载', '添加到 Agent 聊天']);
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

/* IKH8Q3（ADR-0109）：音频卡五功能占位钮——「截取、调速、混合、音视频合成、转码」图标加文字
   横排（ADR-0107 家族口径），本期全部置灰占位：aria-disabled 置灰沿用画质横排先例
   （灰字/not-allowed/透明底，见 .toolBtn[aria-disabled='true']），悬停提示「即将上线」，
   不绑定任何点击行为；竖直分隔线后「下载」在最右且可正常下载；详情钮随改版对音频退役，
   不出现「替换」入口。 */
describe('MediaNodeToolbar 音频卡五功能占位钮（IKH8Q3）', () => {
  const audioTool = (id: string) =>
    mountNode.querySelector<HTMLButtonElement>(`[data-testid="audio-tool-${id}"]`)!;
  const audioToolIds = ['trim', 'speed', 'mix', 'compose', 'transcode'] as const;
  const audioToolLabels = ['截取', '调速', '混合', '音视频合成', '转码'];

  it('五钮顺序截取/调速/混合/音视频合成/转码，图标加文字横排（复用透明底 toolBtn）', async () => {
    await renderToolbar('audio');
    const rendered = audioToolIds.map(audioTool);
    expect(rendered.map((b) => b.textContent)).toEqual(audioToolLabels);
    rendered.forEach((b) => {
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.querySelector('span')).not.toBeNull();
      expect(b.classList.contains(styles.toolBtn)).toBe(true);
    });
  });

  it('五钮全部 aria-disabled 置灰（口径同画质横排）且悬停提示「即将上线」', async () => {
    await renderToolbar('audio');
    audioToolIds.map(audioTool).forEach((b) => {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('title')).toBe('即将上线');
    });
  });

  it('五钮不绑定任何点击行为：点击不派发任何回调', async () => {
    const onShowDetails = vi.fn();
    const onDownload = vi.fn();
    await renderToolbar('audio', { data: { onShowDetails, onDownload } });
    await act(async () => {
      audioToolIds.map(audioTool).forEach((b) => b.click());
    });
    expect(onShowDetails).not.toHaveBeenCalled();
    expect(onDownload).not.toHaveBeenCalled();
  });

  it('竖直分隔线在「转码」之后、「下载」之前（分隔线后下载在最右）', async () => {
    await renderToolbar('audio');
    const toolbar = mountNode.querySelector(`.${styles.toolbar}`)!;
    const seq = [...toolbar.children].map((el) =>
      el.classList.contains(styles.toolDivider)
        ? 'divider'
        : (el.textContent?.trim() || el.getAttribute('title') || ''),
    );
    expect(seq).toEqual([...audioToolLabels, 'divider', '下载']);
  });

  it('详情钮退役、无「替换」入口（音频分支，图片/视频详情不受影响）', async () => {
    await renderToolbar('audio');
    expect(labels()).not.toContain('详情');
    expect(labels()).not.toContain('替换');
    expect(
      [...mountNode.querySelectorAll('button')].some((b) => b.getAttribute('title') === '详情'),
    ).toBe(false);
  });

  it('分隔线后「下载」可正常下载（派发 onDownload 携带节点 id）', async () => {
    const onDownload = vi.fn();
    await renderToolbar('audio', { data: { onDownload } });
    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('[title="下载"]')!.click();
    });
    expect(onDownload).toHaveBeenCalledWith('audio-node');
  });
});

describe('MediaNodeToolbar 画质工具横排按钮（IKH3XZ：五工具离开「高清 ▾」下拉）', () => {
  const tool = (id: string) => mountNode.querySelector<HTMLButtonElement>(`[data-testid="quality-tool-${id}"]`)!;

  it('五按钮顺序高清/扩图/裁切/擦除/抠图（ADR-0101 顺序不变），图标与文字齐全', async () => {
    await renderToolbar('image');
    const rendered = [...mountNode.querySelectorAll('[data-testid^="quality-tool-"]')];
    expect(rendered.map((b) => b.textContent)).toEqual(['高清', '扩图', '裁切', '擦除', '抠图']);
    rendered.forEach((b) => {
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.querySelector('span')).not.toBeNull();
    });
    // 复用透明底 toolBtn（与详情/下载同款家族口径）
    rendered.forEach((b) => expect(b.classList.contains(styles.toolBtn)).toBe(true));
  });

  it('「高清」图标为 ZoomIn，与「扩图」Maximize2 区分（IKH3XZ：Expand 并排撞脸）', async () => {
    await renderToolbar('image');
    expect(tool('enhance').querySelector('svg')?.classList.contains('lucide-zoom-in')).toBe(true);
    expect(tool('outpaint').querySelector('svg')?.classList.contains('lucide-maximize-2')).toBe(true);
  });

  it('可用态悬停 title 为各自 hint（置灰态为原因，同一 title 通道互斥）', async () => {
    await renderToolbar('image', { data: { width: 1600, height: 900, size: 1000, mime: 'image/png' } });
    expect(tool('enhance').getAttribute('title')).toBe('在右侧新建高清放大草稿卡');
    expect(tool('outpaint').getAttribute('title')).toBe('进入扩图模式，拖动边框向外扩展画面');
    expect(tool('crop').getAttribute('title')).toBe('拖动裁切框，裁掉边缘保留选定区域');
    expect(tool('erase').getAttribute('title')).toBe('涂抹或框选抹掉图中不要的内容');
    expect(tool('cutout').getAttribute('title')).toBe('自动识别主体并移除背景');
  });

  it('下拉触发钮与菜单不再渲染（悬浮展开/最近工具记忆整套退役，ADR-0107）', async () => {
    await renderToolbar('image');
    expect(mountNode.querySelector('[data-testid="image-quality-trigger"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).toBeNull();
  });

  it('点「高清」派发 onEnhanceImage（携带节点 id）', async () => {
    const onEnhanceImage = vi.fn();
    await renderToolbar('image', { data: { onEnhanceImage } });
    await act(async () => {
      tool('enhance').click();
    });
    expect(onEnhanceImage).toHaveBeenCalledWith('image-node');
  });

  it('点「抠图」派发 onCutoutImage（携带节点 id）', async () => {
    const onCutoutImage = vi.fn();
    await renderToolbar('image', { data: { onCutoutImage, mime: 'image/png' } });
    await act(async () => {
      tool('cutout').click();
    });
    expect(onCutoutImage).toHaveBeenCalledWith('image-node');
  });

  it('点「裁切」派发 onCropImage（携带节点 id）', async () => {
    const onCropImage = vi.fn();
    await renderToolbar('image', { data: { onCropImage } });
    await act(async () => {
      tool('crop').click();
    });
    expect(onCropImage).toHaveBeenCalledWith('image-node');
  });

  it('点「擦除」派发 onEraseImage（携带节点 id）', async () => {
    const onEraseImage = vi.fn();
    // mime 补 png：默认 fixture 文件名 .bin 在擦除格式白名单外（png/jpg/jpeg/heic）会被置灰
    await renderToolbar('image', { data: { onEraseImage, mime: 'image/png' } });
    await act(async () => {
      tool('erase').click();
    });
    expect(onEraseImage).toHaveBeenCalledWith('image-node');
  });

  it('裁切无置灰门槛：超尺寸/超大小/webp 的图也不置灰（与擦除门槛对照）', async () => {
    await renderToolbar('image', { data: { width: 3000, height: 1440, size: 10 * 1024 * 1024 + 1, mime: 'image/webp' } });
    expect(tool('crop').getAttribute('aria-disabled')).toBeNull();
    // 擦除项按门槛置灰，裁切不受影响
    expect(tool('erase').getAttribute('aria-disabled')).toBe('true');
  });

  it('超尺寸（长边>2560 或短边>1440）：擦除置灰并悬停原因，高清项不受影响', async () => {
    await renderToolbar('image', { data: { width: 3000, height: 1440, mime: 'image/png' } });
    const erase = tool('erase');
    expect(erase.getAttribute('aria-disabled')).toBe('true');
    expect(erase.getAttribute('title')).toContain('长边超过 2560');
    expect(tool('enhance').getAttribute('aria-disabled')).toBeNull();

    // 短边>1440 同样置灰（横图 2000×1441：短边 1441 超上限；竖图 1440×2560 合法另测于 imageErase.test）
    await renderToolbar('image', { id: 'tall-node', data: { width: 2000, height: 1441, mime: 'image/png', onEraseImage: vi.fn() } });
    expect(tool('erase').getAttribute('title')).toContain('短边超过 1440');
  });

  it('超大小（>10MB）：擦除置灰并悬停原因', async () => {
    await renderToolbar('image', { data: { width: 1600, height: 900, size: 10 * 1024 * 1024 + 1, mime: 'image/png' } });
    const erase = tool('erase');
    expect(erase.getAttribute('aria-disabled')).toBe('true');
    expect(erase.getAttribute('title')).toContain('10MB');
  });

  it('webp 与 gif（mime / src 后缀）：擦除置灰并说明格式不支持', async () => {
    await renderToolbar('image', { data: { width: 1600, height: 900, mime: 'image/webp' } });
    const erase = tool('erase');
    expect(erase.getAttribute('aria-disabled')).toBe('true');
    expect(erase.getAttribute('title')).toContain('webp');

    await renderToolbar('image', { id: 'gif-node', data: { width: 1600, height: 900, src: 'http://img/x.gif' } });
    const gifErase = tool('erase');
    expect(gifErase.getAttribute('aria-disabled')).toBe('true');
    expect(gifErase.getAttribute('title')).toContain('gif');
  });

  it('尺寸 null 的存量图：擦除不置灰', async () => {
    await renderToolbar('image', { data: { mime: 'image/png' } });
    expect(tool('erase').getAttribute('aria-disabled')).toBeNull();
  });

  it('菜单项「扩图」派发 onOutpaintImage（携带节点 id）', async () => {
    const onOutpaintImage = vi.fn();
    await renderToolbar('image', { data: { onOutpaintImage, width: 1600, height: 900, size: 1000 } });
    await act(async () => {
      tool('outpaint').click();
    });
    expect(onOutpaintImage).toHaveBeenCalledWith('image-node');
  });

  it('源图门槛达标时「扩图」可用（长边恰 4160、文件恰 10MB）', async () => {
    const onOutpaintImage = vi.fn();
    await renderToolbar('image', {
      data: { onOutpaintImage, width: 4160, height: 2000, size: 10 * 1024 * 1024 },
    });
    const btn = tool('outpaint');
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    await act(async () => {
      btn.click();
    });
    expect(onOutpaintImage).toHaveBeenCalledWith('image-node');
  });

  it('扩图置灰矩阵：长边超 4160 / 文件超 10MB / 真实宽高缺失，悬停说明原因且点击不派发', async () => {
    // 长边超限
    const overLong = { onOutpaintImage: vi.fn(), width: 4161, height: 2000, size: 1000 };
    await renderToolbar('image', { data: overLong });
    const item1 = tool('outpaint');
    expect(item1.getAttribute('aria-disabled')).toBe('true');
    expect(item1.getAttribute('title')).toContain('4160');
    await act(async () => {
      item1.click();
    });
    expect(overLong.onOutpaintImage).not.toHaveBeenCalled();

    // 文件超限
    const overSize = { onOutpaintImage: vi.fn(), width: 2000, height: 1000, size: 10 * 1024 * 1024 + 1 };
    await renderToolbar('image', { data: overSize });
    const item2 = tool('outpaint');
    expect(item2.getAttribute('aria-disabled')).toBe('true');
    expect(item2.getAttribute('title')).toContain('10MB');
    await act(async () => {
      item2.click();
    });
    expect(overSize.onOutpaintImage).not.toHaveBeenCalled();

    // 真实宽高缺失
    const noDims = { onOutpaintImage: vi.fn(), size: 1000 };
    await renderToolbar('image', { data: noDims });
    const item3 = tool('outpaint');
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
    expect(tool('outpaint').getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      tool('enhance').click();
    });
    expect(onEnhanceImage).toHaveBeenCalledWith('image-node');
  });

  it('webp 卡「抠图」置灰悬停原因且点击不派发（横排保持渲染不隐藏，ADR-0107 置灰口径）', async () => {
    const onCutoutImage = vi.fn();
    await renderToolbar('image', { data: { onCutoutImage, width: 1600, height: 900, mime: 'image/webp' } });
    const cutout = tool('cutout');
    expect(cutout).not.toBeNull();
    expect(cutout.getAttribute('aria-disabled')).toBe('true');
    expect(cutout.getAttribute('title')).toContain('webp');
    await act(async () => {
      cutout.click();
    });
    expect(onCutoutImage).not.toHaveBeenCalled();
  });
});

/* IKH3OU（ADR-0104）：入口从单按钮改「智能去字幕 ▾」下拉触发钮，交互口径同图片画质工具
   家族旧下拉形态（悬停自动展开、移出 120ms 延迟关闭、Esc/点外立即关闭、整钮 aria-disabled
   置灰但 hover 仍展开菜单看原因），差异是菜单项纯文字无图标。图片侧已随 IKH3XZ 横排退役
   下拉，本家族仅剩视频卡这一处下拉。合成事件口径：mouseover/mouseout + relatedTarget 在 wrap 外。 */
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

/* IKHA2E：「音视频分离」自单按钮改「音视频分离 ▾」下拉触发钮，交互口径与「智能去字幕 ▾」
   同构但独立实例（悬停自动展开、移出 120ms 延迟关闭、Esc/点外立即关闭、点击触发钮直启首项）。
   家族差异：触发钮可用态 title 保留入口效果边界说明（去字幕可用态无 title，ADR-0104）；
   第二项「人声背景分离」仅派发挂接点（编辑态本体由后续票实现，未注入回调时安全 no-op）。
   门槛=视频未关联资产唯一置灰（ADR-0103 决策四，无时长/分辨率/大小前置拦截）：整钮
   aria-disabled 置灰、点击无效，hover 仍展开菜单看两项说明与置灰原因。
   合成事件口径同上：mouseover/mouseout + relatedTarget 在 wrap 外。 */
describe('MediaNodeToolbar 「音视频分离 ▾」下拉入口（IKHA2E）', () => {
  const trigger = () => mountNode.querySelector<HTMLButtonElement>('[data-testid="audio-video-split-menu-trigger"]')!;
  const menu = () => mountNode.querySelector('[data-testid="audio-video-split-menu"]');
  const item = (id: string) =>
    mountNode.querySelector<HTMLButtonElement>(`[data-testid="audio-video-split-menu-item-${id}"]`);

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

  it('仅视频卡渲染，位次在「智能去字幕」之后、详情之前（原单按钮位置承继）', async () => {
    await renderToolbar('video');
    const order = labels();
    expect(order.indexOf('音视频分离')).toBeGreaterThan(order.indexOf('智能去字幕'));
    expect(order.indexOf('音视频分离')).toBeLessThan(order.indexOf('详情'));
    await renderToolbar('image');
    expect(labels().includes('音视频分离')).toBe(false);
    await renderToolbar('audio');
    expect(labels().includes('音视频分离')).toBe(false);
  });

  it('触发钮形态：AudioLines 图标 + 「音视频分离」文字 + ChevronDown 下拉箭头（默认收起）', async () => {
    await renderToolbar('video');
    const btn = trigger();
    expect(btn.textContent).toBe('音视频分离');
    expect(btn.querySelector('svg.lucide-audio-lines')).not.toBeNull();
    expect(btn.querySelector('svg.lucide-chevron-down')).not.toBeNull();
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(menu()).toBeNull();
  });

  it('悬停自动展开两项菜单：首项「音视频分离」+ 第二项「人声背景分离」，各项 title 为自己的 hint', async () => {
    await renderToolbar('video', { data: { onAudioVideoSplit: vi.fn(), assetId: 'a1' } });
    await hoverIn();
    const rendered = [...mountNode.querySelectorAll('[data-testid^="audio-video-split-menu-item-"]')];
    expect(rendered.map((b) => b.textContent)).toEqual(['音视频分离', '人声背景分离']);
    expect(item('split')!.getAttribute('title')).toContain('将视频完整音轨分离为音频卡片');
    expect(item('vocalBackground')!.getAttribute('title')).toBe('把人声与背景音分离为多张音频卡');
  });

  it('移出触发钮延迟后关闭；延迟窗口内重新进入不关闭', async () => {
    await renderToolbar('video', { data: { onAudioVideoSplit: vi.fn(), assetId: 'a1' } });
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
    await renderToolbar('video', { data: { onAudioVideoSplit: vi.fn(), assetId: 'a1' } });
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

  it('点击触发钮直启首项「音视频分离」（原行为不变，携带节点 id），菜单收起', async () => {
    const onAudioVideoSplit = vi.fn();
    await renderToolbar('video', { data: { onAudioVideoSplit, assetId: 'a1' } });
    await act(async () => {
      trigger().click();
    });
    expect(onAudioVideoSplit).toHaveBeenCalledWith('video-node');
    expect(menu()).toBeNull();
  });

  it('两菜单项各自派发：首项派发 onAudioVideoSplit、第二项派发 onVocalBackgroundSplit 挂接点（携带节点 id）', async () => {
    const onAudioVideoSplit = vi.fn();
    const onVocalBackgroundSplit = vi.fn();
    await renderToolbar('video', { data: { onAudioVideoSplit, onVocalBackgroundSplit, assetId: 'a1' } });
    await hoverIn();
    await act(async () => {
      item('vocalBackground')!.click();
    });
    expect(onVocalBackgroundSplit).toHaveBeenCalledWith('video-node');
    expect(onAudioVideoSplit).not.toHaveBeenCalled();
    // 选择后菜单收起
    expect(menu()).toBeNull();

    await hoverIn();
    await act(async () => {
      item('split')!.click();
    });
    expect(onAudioVideoSplit).toHaveBeenCalledWith('video-node');
  });

  it('第二项挂接点未注入时点击安全 no-op（不抛错、首项回调不受影响）', async () => {
    const onAudioVideoSplit = vi.fn();
    await renderToolbar('video', { data: { onAudioVideoSplit, assetId: 'a1' } });
    await hoverIn();
    await act(async () => {
      item('vocalBackground')!.click();
    });
    expect(onAudioVideoSplit).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it('未关联资产：整钮 aria-disabled 置灰 + title 展示原因、点击无效；hover 仍展开菜单且两项一并置灰', async () => {
    const onAudioVideoSplit = vi.fn();
    const onVocalBackgroundSplit = vi.fn();
    await renderToolbar('video', { data: { onAudioVideoSplit, onVocalBackgroundSplit } });
    const btn = trigger();
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false); // aria-disabled 而非原生 disabled：hover 仍需可展开
    expect(btn.getAttribute('title')).toContain('尚未关联资产');
    await act(async () => {
      btn.click();
    });
    expect(onAudioVideoSplit).not.toHaveBeenCalled();

    // hover 仍可展开看说明与原因：两项 title 恒为自己的 hint，点击均不派发
    await hoverIn();
    expect(menu()).not.toBeNull();
    const split = item('split')!;
    const vocal = item('vocalBackground')!;
    expect(split.getAttribute('aria-disabled')).toBe('true');
    expect(vocal.getAttribute('aria-disabled')).toBe('true');
    expect(split.getAttribute('title')).toContain('将视频完整音轨分离为音频卡片');
    expect(vocal.getAttribute('title')).toBe('把人声与背景音分离为多张音频卡');
    await act(async () => {
      split.click();
      vocal.click();
    });
    expect(onAudioVideoSplit).not.toHaveBeenCalled();
    expect(onVocalBackgroundSplit).not.toHaveBeenCalled();
  });

  it('关联资产后整钮可用（aria-disabled 移除），触发钮可用态 title 为入口效果边界说明', async () => {
    await renderToolbar('video', { data: { assetId: 'a1' } });
    const btn = trigger();
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    expect(btn.getAttribute('title')).toContain('仅音频'); // AUDIO_VIDEO_SPLIT_ENTRY_HINT
  });
});

describe('MediaNodeToolbar HD 高清入口（IKH3VG）', () => {
  const hdBtn = () => mountNode.querySelector<HTMLButtonElement>('[data-testid="video-enhance-btn"]')!;

  it('仅视频卡渲染（图片卡/音频卡不出现 HD）', async () => {
    await renderToolbar('image');
    expect(mountNode.querySelector('[data-testid="video-enhance-btn"]')).toBeNull();
    await renderToolbar('audio');
    expect(mountNode.querySelector('[data-testid="video-enhance-btn"]')).toBeNull();
    await renderToolbar('video');
    expect(hdBtn()).toBeTruthy();
  });

  it('HD 徽标为视频卡工具条首位（IKH3WE 三按钮撤除后 HD 继承第一位，ADR-0106 取代 ADR-0105 排位表述）', async () => {
    await renderToolbar('video');
    const order = labels();
    expect(order[0]).toBe('HD高清');
    expect(order.indexOf('HD高清')).toBeLessThan(order.indexOf('智能去字幕'));
  });

  it('徽标 icon + 中文功能名形态：HD 描边小方标 + 「高清」文字（家族「图标 + 文字」同构）', async () => {
    await renderToolbar('video');
    expect(hdBtn().querySelector(`.${styles.hdBadge}`)?.textContent).toBe('HD');
    expect(hdBtn().textContent).toBe('HD高清');
  });

  it('点击派发 onVideoEnhance（携带节点 id）', async () => {
    const onVideoEnhance = vi.fn();
    await renderToolbar('video', { data: { onVideoEnhance, assetId: 'a1' } });
    await act(async () => {
      hdBtn().click();
    });
    expect(onVideoEnhance).toHaveBeenCalledWith('video-node');
  });

  it('置灰四情形之未关联资产：置灰并悬停唯一原因（宽高缺失不叠加拦截）', async () => {
    await renderToolbar('video');
    expect(hdBtn().disabled).toBe(true);
    expect(hdBtn().getAttribute('title')).toContain('尚未关联资产');
    // 宽高缺失（存量视频）不拦：关联资产即可用
    await renderToolbar('video', { id: 'v2', data: { assetId: 'a1' } });
    expect(hdBtn().disabled).toBe(false);
    expect(hdBtn().getAttribute('title')).toContain('4K');
  });

  it('置灰四情形之短/长边超上限：横屏长边>1920、竖屏短边>1080 均置灰并悬停原因；竖屏 1080×1920 合法', async () => {
    const onVideoEnhance = vi.fn();
    // 横屏长边超限（2561>1920）
    await renderToolbar('video', { data: { onVideoEnhance, assetId: 'a1', width: 2561, height: 1440 } });
    expect(hdBtn().disabled).toBe(true);
    expect(hdBtn().getAttribute('title')).toContain('1920');
    // 竖屏短边超限（短边 1081>1080）
    await renderToolbar('video', { id: 'tall', data: { onVideoEnhance, assetId: 'a1', width: 1081, height: 1920 } });
    expect(hdBtn().disabled).toBe(true);
    expect(hdBtn().getAttribute('title')).toContain('1080');
    // 竖屏恰 1080×1920 合法（契约「短边 [360,1080]、长边 [360,1920]」）
    await renderToolbar('video', { id: 'legal', data: { onVideoEnhance, assetId: 'a1', width: 1080, height: 1920 } });
    expect(hdBtn().disabled).toBe(false);
    // 置灰点击不派发
    await renderToolbar('video', { id: 'over', data: { onVideoEnhance, assetId: 'a1', width: 3840, height: 2160 } });
    await act(async () => {
      hdBtn().click();
    });
    expect(onVideoEnhance).not.toHaveBeenCalled();
  });

  it('置灰四情形之短边不足 360：置灰并悬停原因；恰 360 放行', async () => {
    await renderToolbar('video', { data: { assetId: 'a1', width: 640, height: 359 } });
    expect(hdBtn().disabled).toBe(true);
    expect(hdBtn().getAttribute('title')).toContain('360');
    await renderToolbar('video', { id: 'exact', data: { assetId: 'a1', width: 640, height: 360 } });
    expect(hdBtn().disabled).toBe(false);
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
});
