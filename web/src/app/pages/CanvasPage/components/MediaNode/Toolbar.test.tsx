// @vitest-environment jsdom
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
  it('音频卡「截取」「调速」「混合」「音视频合成」四功能钮连排 + 分隔线 + 下载，详情退役、@ 隐藏（IKHB6Y/IKH8Q3）', async () => {
    await renderToolbar('audio');
    expect(labels()).toEqual(['截取', '调速', '混合', '音视频合成', '下载']);
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

  it('视频卡保留 HD（首位）与智能去字幕与 @，隐藏「高清 ▾」，音视频分离后多场景切分与智能抠像（IKH8BJ/IKHK7N）', async () => {
    await renderToolbar('video');
    expect(labels()).toEqual(['HD高清', '智能去字幕', '音视频分离', '场景切分', '智能抠像', '详情', '下载', '添加到 Agent 聊天']);
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

describe('MediaNodeToolbar 音频卡「截取」「调速」「混合」「音视频合成」点亮（IKHB6Y/IKHW5C/IKH8Q3）', () => {
  const audioTool = (id: string) =>
    mountNode.querySelector<HTMLButtonElement>(`[data-testid="audio-tool-${id}"]`)!;
  const trimBtn = () => audioTool('trim');
  const placeholderIds = [] as const;
  const audioToolIds = ['trim', 'speed', 'mix', 'compose', ...placeholderIds];
  const audioToolLabels = ['截取', '调速', '混合', '音视频合成'];

  it('四钮顺序截取/调速/混合/音视频合成（调速第二、DOM 渲染序一致），图标加文字横排（复用透明底 toolBtn）', async () => {
    await renderToolbar('audio');
    const rendered = audioToolIds.map(audioTool);
    expect(rendered.map((b) => b.textContent)).toEqual(audioToolLabels);
    rendered.forEach((b) => {
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.querySelector('span')).not.toBeNull();
      expect(b.classList.contains(styles.toolBtn)).toBe(true);
    });
    expect([...mountNode.querySelectorAll('[data-testid^="audio-tool-"]')]
      .map((b) => b.getAttribute('data-testid')))
      .toEqual(audioToolIds.map((id) => `audio-tool-${id}`));
  });

  it('达标态「截取」可点：无 aria-disabled 且点击派发 onTrimAudio（携带节点 id）', async () => {
    const onTrimAudio = vi.fn();
    await renderToolbar('audio', { data: { onTrimAudio, duration: 12.5 } });
    const btn = trimBtn();
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    await act(async () => {
      btn.click();
    });
    expect(onTrimAudio).toHaveBeenCalledWith('audio-node');
  });

  it('达标态「截取」可用时无默认悬停文案（口径同智能去字幕触发钮）', async () => {
    await renderToolbar('audio', { data: { duration: 12.5 } });
    expect(trimBtn().getAttribute('title')).toBeNull();
  });

  it('门槛矩阵之 URL 缺失（undefined/null/空串）：截取置灰、悬停唯一原因、点击不派发', async () => {
    const onTrimAudio = vi.fn();
    const cases: Array<Record<string, unknown>> = [
      { src: undefined, duration: 12 },
      { src: null, duration: 12 },
      { src: '', duration: 12 },
    ];
    for (const data of cases) {
      await renderToolbar('audio', { id: 'gate-node', data: { onTrimAudio, ...data } });
      const btn = trimBtn();
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('音频时长缺失，无法截取');
      await act(async () => {
        btn.click();
      });
    }
    expect(onTrimAudio).not.toHaveBeenCalled();
  });

  it('门槛矩阵之时长缺失或为 0（undefined/null/0）：截取置灰、悬停唯一原因、点击不派发', async () => {
    const onTrimAudio = vi.fn();
    await renderToolbar('audio');
    expect(trimBtn().getAttribute('aria-disabled')).toBe('true');
    expect(trimBtn().getAttribute('title')).toBe('音频时长缺失，无法截取');

    const cases: Array<Record<string, unknown>> = [
      { src: 'blob:test', duration: null },
      { src: 'blob:test', duration: 0 },
    ];
    for (const data of cases) {
      await renderToolbar('audio', { id: 'gate-node', data: { onTrimAudio, ...data } });
      const btn = trimBtn();
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('音频时长缺失，无法截取');
      await act(async () => {
        btn.click();
      });
    }
    expect(onTrimAudio).not.toHaveBeenCalled();
  });

  it('占位钮维持置灰占位：aria-disabled 且悬停「即将上线」（当前占位项为空）', async () => {
    await renderToolbar('audio', { data: { duration: 12 } });
    placeholderIds.map(audioTool).forEach((b) => {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('title')).toBe('即将上线');
    });
  });

  it('占位钮不绑定任何点击行为：点击不派发音频回调', async () => {
    const onTrimAudio = vi.fn();
    const onAudioSpeed = vi.fn();
    const onShowDetails = vi.fn();
    const onDownload = vi.fn();
    await renderToolbar('audio', { data: { onTrimAudio, onAudioSpeed, onShowDetails, onDownload, duration: 12 } });
    await act(async () => {
      placeholderIds.map(audioTool).forEach((b) => b.click());
    });
    expect(onTrimAudio).not.toHaveBeenCalled();
    expect(onAudioSpeed).not.toHaveBeenCalled();
    expect(onShowDetails).not.toHaveBeenCalled();
    expect(onDownload).not.toHaveBeenCalled();
  });

  it('达标态「音视频合成」可点：无 aria-disabled 且点击派发 onComposeAudioVideo（携带节点 id）', async () => {
    const onComposeAudioVideo = vi.fn();
    const onMixAudio = vi.fn();
    await renderToolbar('audio', { data: { src: 'https://example.test/a.mp3', onComposeAudioVideo, onMixAudio } });
    const btn = audioTool('compose');
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    expect(btn.getAttribute('title')).toBeNull();
    await act(async () => {
      btn.click();
    });
    expect(onComposeAudioVideo).toHaveBeenCalledWith('audio-node');
    expect(onMixAudio).not.toHaveBeenCalled();
  });

  it('门槛之 URL 缺失（undefined/null/空串/blob 上传中）：合成置灰、悬停唯一原因、点击不派发', async () => {
    const onComposeAudioVideo = vi.fn();
    const cases: Array<Record<string, unknown>> = [
      { src: undefined },
      { src: null },
      { src: '' },
      { src: 'blob:upload-preview' },
    ];
    for (const data of cases) {
      await renderToolbar('audio', { id: 'gate-node', data: { onComposeAudioVideo, ...data } });
      const btn = audioTool('compose');
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('音频不可用，无法合成');
      await act(async () => {
        btn.click();
      });
    }
    expect(onComposeAudioVideo).not.toHaveBeenCalled();
  });

  it('在途合成（audioVideoMuxInFlight）按钮保留高亮：toolBtnActive + aria-pressed；无标记为普通态', async () => {
    await renderToolbar('audio', { data: { src: 'https://example.test/a.mp3', audioVideoMuxInFlight: true } });
    const active = audioTool('compose');
    expect(active.classList.contains(styles.toolBtnActive)).toBe(true);
    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(active.getAttribute('aria-disabled')).toBeNull();

    await renderToolbar('audio', { id: 'plain-node', data: { src: 'https://example.test/a.mp3' } });
    const plain = audioTool('compose');
    expect(plain.classList.contains(styles.toolBtnActive)).toBe(false);
    expect(plain.getAttribute('aria-pressed')).toBeNull();
  });

  it('非成品卡（草稿/生成中/失败）：整条工具条不渲染（数据门先拦）；门槛函数级覆盖见 audioVideoMux.test.ts', async () => {
    for (const genStatus of ['draft', 'generating', 'failed']) {
      await renderToolbar('audio', { id: 'gate-node', genStatus: genStatus as never });
      expect(audioTool('compose')).toBeNull();
      expect(labels()).toEqual([]);
    }
  });

  it('混合仅在完成且有资产的音频卡上可点，缺时长不拦', async () => {
    const onMixAudio = vi.fn();
    await renderToolbar('audio', { data: { src: 'https://example.test/a.mp3', assetId: '8', duration: undefined, onMixAudio } });
    expect(audioTool('mix').getAttribute('aria-disabled')).toBeNull();
    await act(async () => audioTool('mix').click());
    expect(onMixAudio).toHaveBeenCalledTimes(1);
    await renderToolbar('audio', { data: { src: 'blob:upload', assetId: '8', onMixAudio } });
    expect(audioTool('mix').getAttribute('aria-disabled')).toBe('true');
    await act(async () => audioTool('mix').click());
    expect(onMixAudio).toHaveBeenCalledTimes(1);
  });

  it('竖直分隔线在「音视频合成」之后、「下载」之前（分隔线后下载在最右）', async () => {
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

describe('MediaNodeToolbar 音频卡「调速」点亮（IKHW5C）', () => {
  const speedBtn = () =>
    mountNode.querySelector<HTMLButtonElement>('[data-testid="audio-tool-speed"]')!;

  it('达标态「调速」可点：无 aria-disabled 且点击派发 onAudioSpeed（携带节点 id）', async () => {
    const onAudioSpeed = vi.fn();
    await renderToolbar('audio', { data: { onAudioSpeed, assetId: '8' } });
    const btn = speedBtn();
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    await act(async () => {
      btn.click();
    });
    expect(onAudioSpeed).toHaveBeenCalledWith('audio-node');
  });

  it('达标态「调速」可用时无默认悬停文案（口径同「截取」钮先例）', async () => {
    await renderToolbar('audio', { data: { assetId: '8' } });
    expect(speedBtn().getAttribute('title')).toBeNull();
  });

  it('置灰唯一矩阵之音频 URL 缺失：调速置灰、悬停「音频不可用，无法调速」、点击不派发', async () => {
    const onAudioSpeed = vi.fn();
    const cases: Array<Record<string, unknown>> = [
      { src: undefined },
      { src: null },
      { src: '' },
    ];
    for (const data of cases) {
      await renderToolbar('audio', { id: 'gate-node', data: { onAudioSpeed, assetId: '8', ...data } });
      const btn = speedBtn();
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('音频不可用，无法调速');
      await act(async () => {
        btn.click();
      });
    }
    expect(onAudioSpeed).not.toHaveBeenCalled();
  });

  it('有 URL 无 assetId 或有 assetId 无 URL 均置灰', async () => {
    const onAudioSpeed = vi.fn();
    await renderToolbar('audio', { data: { onAudioSpeed, assetId: undefined } });
    expect(speedBtn().getAttribute('aria-disabled')).toBe('true');
    expect(speedBtn().getAttribute('title')).toBe('音频不可用，无法调速');
    await act(async () => {
      speedBtn().click();
    });
    expect(onAudioSpeed).not.toHaveBeenCalled();

    await renderToolbar('audio', { id: 'asset-node', data: { onAudioSpeed, src: '', assetId: 'a1' } });
    expect(speedBtn().getAttribute('aria-disabled')).toBe('true');
    expect(speedBtn().getAttribute('title')).toBe('音频不可用，无法调速');
    await act(async () => {
      speedBtn().click();
    });
    expect(onAudioSpeed).not.toHaveBeenCalled();
  });

  it('时长缺失不拦调速（用户故事 4）：duration 缺失/为 0 均可点，与「截取」门槛对照', async () => {
    const onAudioSpeed = vi.fn();
    for (const duration of [undefined, null, 0]) {
      await renderToolbar('audio', { data: { onAudioSpeed, assetId: '8', duration } });
      expect(speedBtn().getAttribute('aria-disabled')).toBeNull();
      await act(async () => {
        speedBtn().click();
      });
    }
    expect(onAudioSpeed).toHaveBeenCalledTimes(3);
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
    await renderToolbar('image', { data: { onEraseImage, mime: 'image/png' } });
    await act(async () => {
      tool('erase').click();
    });
    expect(onEraseImage).toHaveBeenCalledWith('image-node');
  });

  it('裁切无置灰门槛：超尺寸/超大小/webp 的图也不置灰（与擦除门槛对照）', async () => {
    await renderToolbar('image', { data: { width: 3000, height: 1440, size: 10 * 1024 * 1024 + 1, mime: 'image/webp' } });
    expect(tool('crop').getAttribute('aria-disabled')).toBeNull();
    expect(tool('erase').getAttribute('aria-disabled')).toBe('true');
  });

  it('超尺寸（长边>2560 或短边>1440）：擦除置灰并悬停原因，高清项不受影响', async () => {
    await renderToolbar('image', { data: { width: 3000, height: 1440, mime: 'image/png' } });
    const erase = tool('erase');
    expect(erase.getAttribute('aria-disabled')).toBe('true');
    expect(erase.getAttribute('title')).toContain('长边超过 2560');
    expect(tool('enhance').getAttribute('aria-disabled')).toBeNull();

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
    const overLong = { onOutpaintImage: vi.fn(), width: 4161, height: 2000, size: 1000 };
    await renderToolbar('image', { data: overLong });
    const item1 = tool('outpaint');
    expect(item1.getAttribute('aria-disabled')).toBe('true');
    expect(item1.getAttribute('title')).toContain('4160');
    await act(async () => {
      item1.click();
    });
    expect(overLong.onOutpaintImage).not.toHaveBeenCalled();

    const overSize = { onOutpaintImage: vi.fn(), width: 2000, height: 1000, size: 10 * 1024 * 1024 + 1 };
    await renderToolbar('image', { data: overSize });
    const item2 = tool('outpaint');
    expect(item2.getAttribute('aria-disabled')).toBe('true');
    expect(item2.getAttribute('title')).toContain('10MB');
    await act(async () => {
      item2.click();
    });
    expect(overSize.onOutpaintImage).not.toHaveBeenCalled();

    const noDims = { onOutpaintImage: vi.fn(), size: 1000 };
    await renderToolbar('image', { data: noDims });
    const item3 = tool('outpaint');
    expect(item3.getAttribute('aria-disabled')).toBe('true');
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
    await renderToolbar('image');
    expect(labels().includes('智能去字幕')).toBe(false);
  });

  it('悬停自动展开两项纯文字菜单（无图标、无最近工具记忆，文案固定）', async () => {
    await renderToolbar('video', { data: { onVideoSubtitleErase: vi.fn() } });
    expect(trigger().textContent).toContain('智能去字幕');
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(menu()).toBeNull();
    await hoverIn();
    const rendered = [...mountNode.querySelectorAll('[data-testid^="subtitle-erase-menu-item-"]')];
    expect(rendered.map((b) => b.textContent)).toEqual(['智能去字幕', '框选去字幕']);
    expect(rendered.every((b) => b.querySelector('svg') === null)).toBe(true);
  });

  it('移出触发钮延迟后关闭；延迟窗口内重新进入不关闭', async () => {
    await renderToolbar('video', { data: { onVideoSubtitleErase: vi.fn() } });
    await hoverIn();
    await hoverOut();
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
    expect(long.disabled).toBe(false);
    expect(long.getAttribute('title')).toContain('长边超过 2560');
    await act(async () => {
      long.click();
    });
    expect(onVideoSubtitleErase).not.toHaveBeenCalled();

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
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('title')).toContain('尚未关联资产');
    await act(async () => {
      btn.click();
    });
    expect(onAudioVideoSplit).not.toHaveBeenCalled();

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
    expect(btn.getAttribute('title')).toContain('仅音频');
  });
});

describe('MediaNodeToolbar 「高清 ▾」下拉入口（IKH3VG 原链路 / IKHLKR 改造）', () => {
  const trigger = () => mountNode.querySelector<HTMLButtonElement>('[data-testid="video-enhance-menu-trigger"]')!;
  const menu = () => mountNode.querySelector('[data-testid="video-enhance-menu"]');
  const item = (id: string) =>
    mountNode.querySelector<HTMLButtonElement>(`[data-testid="video-enhance-menu-item-${id}"]`);

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

  it('仅视频卡渲染（图片卡/音频卡不出现「高清 ▾」触发钮）', async () => {
    await renderToolbar('image');
    expect(mountNode.querySelector('[data-testid="video-enhance-menu-trigger"]')).toBeNull();
    await renderToolbar('audio');
    expect(mountNode.querySelector('[data-testid="video-enhance-menu-trigger"]')).toBeNull();
    await renderToolbar('video');
    expect(trigger()).toBeTruthy();
  });

  it('HD 徽标为视频卡工具条首位（IKH3WE 三按钮撤除后 HD 继承第一位，ADR-0106）', async () => {
    await renderToolbar('video');
    const order = labels();
    expect(order[0]).toBe('HD高清');
    expect(order.indexOf('HD高清')).toBeLessThan(order.indexOf('智能去字幕'));
  });

  it('触发钮形态：HD 描边小方标 + 「高清」文字 + ChevronDown 下拉箭头（默认收起）', async () => {
    await renderToolbar('video');
    const btn = trigger();
    expect(btn.querySelector(`.${styles.hdBadge}`)?.textContent).toBe('HD');
    expect(btn.textContent).toBe('HD高清');
    expect(btn.querySelector('svg.lucide-chevron-down')).not.toBeNull();
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(menu()).toBeNull();
  });

  it('悬停自动展开两项菜单：首项「HD 高清」+ 次项「插帧」，可用态各项 title 为自己的 hint', async () => {
    await renderToolbar('video', { data: { onVideoEnhance: vi.fn(), onFrameInterpolation: vi.fn(), assetId: 'a1' } });
    await hoverIn();
    expect(item('hd')!.textContent).toBe('HD 高清');
    expect(item('interpolation')!.textContent).toBe('插帧');
    expect(item('hd')!.getAttribute('title')).toContain('最高可至 4K');
    expect(item('interpolation')!.getAttribute('title')).toBe('提升视频帧率，画面更流畅');
    expect(item('hd')!.getAttribute('aria-disabled')).toBeNull();
    expect(item('interpolation')!.getAttribute('aria-disabled')).toBeNull();
  });

  it('移出触发钮延迟后关闭；延迟窗口内重新进入不关闭', async () => {
    await renderToolbar('video', { data: { assetId: 'a1' } });
    await hoverIn();
    await hoverOut();
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
    await renderToolbar('video', { data: { assetId: 'a1' } });
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

  it('点击触发钮直启首项「HD 高清」（原单按钮行为不变，携带节点 id），菜单收起', async () => {
    const onVideoEnhance = vi.fn();
    const onFrameInterpolation = vi.fn();
    await renderToolbar('video', { data: { onVideoEnhance, onFrameInterpolation, assetId: 'a1' } });
    await act(async () => {
      trigger().click();
    });
    expect(onVideoEnhance).toHaveBeenCalledWith('video-node');
    expect(onFrameInterpolation).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it('两菜单项各自派发：首项派发 onVideoEnhance、次项派发 onFrameInterpolation（携带节点 id）', async () => {
    const onVideoEnhance = vi.fn();
    const onFrameInterpolation = vi.fn();
    await renderToolbar('video', { data: { onVideoEnhance, onFrameInterpolation, assetId: 'a1' } });
    await hoverIn();
    await act(async () => {
      item('interpolation')!.click();
    });
    expect(onFrameInterpolation).toHaveBeenCalledWith('video-node');
    expect(onVideoEnhance).not.toHaveBeenCalled();
    expect(menu()).toBeNull();

    await hoverIn();
    await act(async () => {
      item('hd')!.click();
    });
    expect(onVideoEnhance).toHaveBeenCalledWith('video-node');
  });

  it('未关联资产：整钮 aria-disabled + title 展示原因、触发钮与两项点击均不派发；hover 仍展开看说明', async () => {
    const onVideoEnhance = vi.fn();
    const onFrameInterpolation = vi.fn();
    await renderToolbar('video', { data: { onVideoEnhance, onFrameInterpolation } });
    const btn = trigger();
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('title')).toContain('尚未关联资产');
    await act(async () => {
      btn.click();
    });
    expect(onVideoEnhance).not.toHaveBeenCalled();

    await hoverIn();
    expect(menu()).not.toBeNull();
    const hd = item('hd')!;
    const interp = item('interpolation')!;
    expect(hd.getAttribute('aria-disabled')).toBe('true');
    expect(interp.getAttribute('aria-disabled')).toBe('true');
    expect(hd.getAttribute('title')).toContain('尚未关联资产');
    expect(interp.getAttribute('title')).toContain('尚未关联资产');
    await act(async () => {
      hd.click();
      interp.click();
    });
    expect(onVideoEnhance).not.toHaveBeenCalled();
    expect(onFrameInterpolation).not.toHaveBeenCalled();
  });

  it('关联资产且宽高缺失放行：整钮可用（无 title），HD 项悬停为入口 hint', async () => {
    await renderToolbar('video', { data: { assetId: 'a1' } });
    const btn = trigger();
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    expect(btn.getAttribute('title')).toBeNull();
    await hoverIn();
    expect(item('hd')!.getAttribute('title')).toContain('4K');
    expect(item('hd')!.getAttribute('aria-disabled')).toBeNull();
  });

  it('HD 项置灰而插帧可用（超上限）：整钮仍可展开，HD 项 title 为原因、触发钮点击不派发', async () => {
    const onVideoEnhance = vi.fn();
    const onFrameInterpolation = vi.fn();
    const over = { onVideoEnhance, onFrameInterpolation, assetId: 'a1', width: 2561, height: 1440 };
    await renderToolbar('video', { data: over });
    expect(trigger().getAttribute('aria-disabled')).toBeNull();
    await hoverIn();
    expect(item('hd')!.getAttribute('aria-disabled')).toBe('true');
    expect(item('hd')!.getAttribute('title')).toContain('1920');
    expect(item('interpolation')!.getAttribute('aria-disabled')).toBeNull();
    expect(item('interpolation')!.getAttribute('title')).toBe('提升视频帧率，画面更流畅');
    await act(async () => {
      trigger().click();
    });
    expect(onVideoEnhance).not.toHaveBeenCalled();
    expect(onFrameInterpolation).not.toHaveBeenCalled();
    await hoverIn();
    await act(async () => {
      item('interpolation')!.click();
    });
    expect(onFrameInterpolation).toHaveBeenCalledWith('video-node');
  });

  it('HD 项置灰时触发钮带该项原因 title（ADR-0113 决策四）：点击不派发，用户知道「高清」为什么点不动', async () => {
    await renderToolbar('video', { data: { assetId: 'a1', width: 2561, height: 1440 } });
    expect(trigger().getAttribute('aria-disabled')).toBeNull();
    expect(trigger().getAttribute('title')).toContain('1920');

    await renderToolbar('video', { id: 'floor', data: { assetId: 'a1', width: 640, height: 359 } });
    expect(trigger().getAttribute('title')).toContain('360');

    await renderToolbar('video', { id: 'ok', data: { assetId: 'a1', width: 1280, height: 720 } });
    expect(trigger().getAttribute('title')).toBeNull();

    await renderToolbar('video', { id: 'noasset', data: {} });
    expect(trigger().getAttribute('aria-disabled')).toBe('true');
    expect(trigger().getAttribute('title')).toContain('尚未关联资产');
  });

  it('HD 项置灰之短边不足 360：项 title 为原因；恰 360 放行（竖屏 1080×1920 同口径）', async () => {
    await renderToolbar('video', { data: { assetId: 'a1', width: 640, height: 359 } });
    await hoverIn();
    expect(item('hd')!.getAttribute('aria-disabled')).toBe('true');
    expect(item('hd')!.getAttribute('title')).toContain('360');

    await renderToolbar('video', { id: 'exact', data: { assetId: 'a1', width: 640, height: 360 } });
    await hoverIn();
    expect(item('hd')!.getAttribute('aria-disabled')).toBeNull();

    await renderToolbar('video', { id: 'tall', data: { assetId: 'a1', width: 1080, height: 1920 } });
    await hoverIn();
    expect(item('hd')!.getAttribute('aria-disabled')).toBeNull();
  });

  it('插帧项挂接点未注入时点击安全 no-op（不抛错、HD 项回调不受影响）', async () => {
    const onVideoEnhance = vi.fn();
    await renderToolbar('video', { data: { onVideoEnhance, assetId: 'a1' } });
    await hoverIn();
    await act(async () => {
      item('interpolation')!.click();
    });
    expect(onVideoEnhance).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });
});

describe('MediaNodeToolbar 场景切分入口（IKH8BJ）', () => {
  const btn = () => [...mountNode.querySelectorAll('button')]
    .find((b) => b.textContent?.includes('场景切分'))!;

  it('落位「音视频分离」之后、分隔线之前（HD 与智能去字幕不变）', async () => {
    await renderToolbar('video');
    const toolbar = mountNode.querySelector(`.${styles.toolbar}`)!;
    const seq = [...toolbar.children].map((el) =>
      el.classList.contains(styles.toolDivider)
        ? 'divider'
        : (el.textContent?.trim() || el.getAttribute('title') || ''),
    );
    expect(seq).toEqual(['HD高清', '智能去字幕', '音视频分离', '场景切分', '智能抠像', 'divider', '详情', '下载', '添加到 Agent 聊天']);
  });

  it('仅视频卡显示：图片卡与音频卡不出现「场景切分」入口', async () => {
    await renderToolbar('image');
    expect(mountNode.querySelector('button')?.textContent).not.toContain('场景切分');
    expect(labels()).not.toContain('场景切分');
    await renderToolbar('audio');
    expect(labels()).not.toContain('场景切分');
    await renderToolbar('video');
    expect(btn()).toBeTruthy();
  });

  it('图标+文字形态（Film svg + 文字 span，复用透明底 toolBtn）', async () => {
    await renderToolbar('video');
    const sceneBtn = btn();
    expect(sceneBtn.querySelector('svg')?.classList.contains('lucide-film')).toBe(true);
    expect(sceneBtn.querySelector('span')?.textContent).toBe('场景切分');
    expect(sceneBtn.classList.contains(styles.toolBtn)).toBe(true);
  });

  it('未关联资产：置灰并悬停唯一原因，点击不派发（同音视频分离门槛一）', async () => {
    const onSceneSplit = vi.fn();
    await renderToolbar('video', { data: { onSceneSplit } });
    const sceneBtn = btn();
    expect(sceneBtn.disabled).toBe(true);
    expect(sceneBtn.getAttribute('title')).toContain('尚未关联资产');
    await act(async () => {
      sceneBtn.click();
    });
    expect(onSceneSplit).not.toHaveBeenCalled();
  });

  it('时长超 2 小时且有时长数据：置灰并悬停原因，点击不派发；恰 7200 放行', async () => {
    const onSceneSplit = vi.fn();
    await renderToolbar('video', { data: { onSceneSplit, assetId: 'a1', duration: 7200.001 } });
    const over = btn();
    expect(over.disabled).toBe(true);
    expect(over.getAttribute('title')).toContain('2 小时');
    await act(async () => {
      over.click();
    });
    expect(onSceneSplit).not.toHaveBeenCalled();

    await renderToolbar('video', { id: 'exact-node', data: { onSceneSplit, assetId: 'a1', duration: 7200 } });
    expect(btn().disabled).toBe(false);
  });

  it('时长数据缺失放行：关联资产即可点击，可用态悬停为效果边界 hint（后端按权威数据复核）', async () => {
    const onSceneSplit = vi.fn();
    await renderToolbar('video', { data: { onSceneSplit, assetId: 'a1' } });
    const sceneBtn = btn();
    expect(sceneBtn.disabled).toBe(false);
    expect(sceneBtn.getAttribute('title')).toContain('片段');
    await act(async () => {
      sceneBtn.click();
    });
    expect(onSceneSplit).toHaveBeenCalledWith('video-node');
  });
});

describe('MediaNodeToolbar 「智能抠像 ▾」下拉入口（IKHK7N）', () => {
  const trigger = () => mountNode.querySelector<HTMLButtonElement>('[data-testid="smart-matting-menu-trigger"]')!;
  const menu = () => mountNode.querySelector('[data-testid="smart-matting-menu"]');
  const item = (id: string) =>
    mountNode.querySelector<HTMLButtonElement>(`[data-testid="smart-matting-menu-item-${id}"]`);

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

  it('仅视频卡渲染，位次在「场景切分」之后、分隔线（详情）之前；图片/音频卡不出现', async () => {
    await renderToolbar('video');
    const order = labels();
    expect(order.indexOf('智能抠像')).toBeGreaterThan(order.indexOf('场景切分'));
    expect(order.indexOf('智能抠像')).toBeLessThan(order.indexOf('详情'));
    await renderToolbar('image');
    expect(labels().includes('智能抠像')).toBe(false);
    await renderToolbar('audio');
    expect(labels().includes('智能抠像')).toBe(false);
  });

  it('触发钮形态：WandSparkles 图标 + 「智能抠像」文字 + ChevronDown 下拉箭头（默认收起）', async () => {
    await renderToolbar('video');
    const btn = trigger();
    expect(btn.textContent).toBe('智能抠像');
    expect(btn.querySelector('svg.lucide-wand-sparkles')).not.toBeNull();
    expect(btn.querySelector('svg.lucide-chevron-down')).not.toBeNull();
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(menu()).toBeNull();
  });

  it('悬停自动展开两项纯文字菜单：人像抠像 + 绿幕抠像，各项 title 为自己的 hint', async () => {
    await renderToolbar('video', { data: { onSmartMatting: vi.fn(), assetId: 'a1' } });
    await hoverIn();
    const rendered = [...mountNode.querySelectorAll('[data-testid^="smart-matting-menu-item-"]')];
    expect(rendered.map((b) => b.textContent)).toEqual(['人像抠像', '绿幕抠像']);
    expect(rendered.every((b) => b.querySelector('svg') === null)).toBe(true);
    expect(item('portrait')!.getAttribute('title')).toContain('人物');
    expect(item('greenscreen')!.getAttribute('title')).toContain('纯色背景');
  });

  it('移出触发钮延迟后关闭；延迟窗口内重新进入不关闭', async () => {
    await renderToolbar('video', { data: { onSmartMatting: vi.fn(), assetId: 'a1' } });
    await hoverIn();
    await hoverOut();
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
    await renderToolbar('video', { data: { onSmartMatting: vi.fn(), assetId: 'a1' } });
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

  it('点击触发钮直启首项「人像抠像」（携带节点 id 与 mode=portrait），菜单收起', async () => {
    const onSmartMatting = vi.fn();
    await renderToolbar('video', { data: { onSmartMatting, assetId: 'a1' } });
    await act(async () => {
      trigger().click();
    });
    expect(onSmartMatting).toHaveBeenCalledWith('video-node', 'portrait');
    expect(menu()).toBeNull();
  });

  it('两菜单项各自派发：人像抠像派发 portrait、绿幕抠像派发 greenscreen（携带节点 id 与 mode）', async () => {
    const onSmartMatting = vi.fn();
    await renderToolbar('video', { data: { onSmartMatting, assetId: 'a1' } });
    await hoverIn();
    await act(async () => {
      item('greenscreen')!.click();
    });
    expect(onSmartMatting).toHaveBeenCalledWith('video-node', 'greenscreen');
    expect(menu()).toBeNull();

    await hoverIn();
    await act(async () => {
      item('portrait')!.click();
    });
    expect(onSmartMatting).toHaveBeenLastCalledWith('video-node', 'portrait');
  });

  it('未关联资产：整钮 aria-disabled 置灰 + title 展示原因、点击无效；hover 仍展开菜单且两项一并置灰', async () => {
    const onSmartMatting = vi.fn();
    await renderToolbar('video', { data: { onSmartMatting } });
    const btn = trigger();
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('title')).toContain('尚未关联资产');
    await act(async () => {
      btn.click();
    });
    expect(onSmartMatting).not.toHaveBeenCalled();

    await hoverIn();
    expect(menu()).not.toBeNull();
    const portrait = item('portrait')!;
    const greenscreen = item('greenscreen')!;
    expect(portrait.getAttribute('aria-disabled')).toBe('true');
    expect(greenscreen.getAttribute('aria-disabled')).toBe('true');
    expect(portrait.getAttribute('title')).toContain('人物');
    expect(greenscreen.getAttribute('title')).toContain('纯色背景');
    await act(async () => {
      portrait.click();
      greenscreen.click();
    });
    expect(onSmartMatting).not.toHaveBeenCalled();
  });

  it('时长超 10 分钟且有时长数据：置灰并悬停原因，点击不派发；恰 600 放行', async () => {
    const onSmartMatting = vi.fn();
    await renderToolbar('video', { data: { onSmartMatting, assetId: 'a1', duration: 600.001 } });
    const over = trigger();
    expect(over.getAttribute('aria-disabled')).toBe('true');
    expect(over.getAttribute('title')).toContain('10 分钟');
    await act(async () => {
      over.click();
    });
    expect(onSmartMatting).not.toHaveBeenCalled();

    await renderToolbar('video', { id: 'exact-node', data: { onSmartMatting, assetId: 'a1', duration: 600 } });
    expect(trigger().getAttribute('aria-disabled')).toBeNull();
  });

  it('时长数据缺失放行：关联资产即可点击，可用态触发钮 title 为入口效果边界说明（后端按权威数据复核）', async () => {
    const onSmartMatting = vi.fn();
    await renderToolbar('video', { data: { onSmartMatting, assetId: 'a1' } });
    const btn = trigger();
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    expect(btn.getAttribute('title')).toContain('背景');
    await act(async () => {
      btn.click();
    });
    expect(onSmartMatting).toHaveBeenCalledWith('video-node', 'portrait');
  });

  it('分辨率不参与置灰（4K/8K 视频关联资产即可用，超限由任务失败口径兜底）', async () => {
    await renderToolbar('video', { data: { assetId: 'a1', width: 3840, height: 2160 } });
    expect(trigger().getAttribute('aria-disabled')).toBeNull();
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
