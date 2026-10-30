// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CardGallery from './index';

const api = vi.hoisted(() => ({
  fetchTemplatePage: vi.fn(),
  fetchTemplateTags: vi.fn(),
}));

vi.mock('@/custom/api/agent', () => api);

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mountNode: HTMLDivElement;

function pageOf(
  records: {
    title: string;
    video: string;
    images: string[];
    layout: string;
    content: string | null;
  }[],
) {
  return { records, total: records.length, current: 1, size: 50, pages: 1 };
}

async function mountGallery(onCardClick?: (text: string, mediaType: 'video' | 'image') => void) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(CardGallery, { onCardClick }));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function cards(): HTMLElement[] {
  return [...mountNode.querySelectorAll<HTMLElement>('[data-testid="gallery-card"]')];
}

beforeEach(() => {
  api.fetchTemplateTags.mockResolvedValue([
    { tag_code: 'marketing', label: '商品展示' },
    { tag_code: 'video', label: '人物种草' },
  ]);
  api.fetchTemplatePage.mockImplementation(async (tagCode: string) => {
    if (tagCode === 'marketing') {
      return pageOf([
        { title: '商品图一', video: '', images: [], layout: 'wide', content: '填写商品正文' },
        { title: '测试20260828144946', video: '', images: [], layout: 'wide', content: '测试正文' },
      ]);
    }
    return pageOf([{ title: '种草短片', video: 'https://example.com/clip.mp4', images: [], layout: 'wide', content: null }]);
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.clearAllMocks();
});

function filterButton(label: string): HTMLButtonElement | undefined {
  return [...mountNode.querySelectorAll<HTMLButtonElement>('[aria-label="案例分类"] button')].find(
    (b) => b.textContent === label,
  );
}

describe('CardGallery', () => {
  it('按场景筛选，默认选第一个场景', async () => {
    await mountGallery();

    const filters = [...mountNode.querySelectorAll('[aria-label="案例分类"] button')];
    expect(filters.map((b) => b.textContent)).toEqual(['商品展示', '人物种草']);
    expect(filters[0].getAttribute('aria-pressed')).toBe('true');
    expect(cards().map((card) => card.getAttribute('data-media-kind'))).toEqual(['image']);
  });

  it('切换场景后只展示该场景案例', async () => {
    await mountGallery();

    await act(async () => {
      filterButton('人物种草')?.click();
    });
    expect(cards().map((card) => card.getAttribute('data-media-kind'))).toEqual(['video']);
  });

  it('两类卡都带用途标签', async () => {
    await mountGallery();
    expect(cards()[0].textContent).toContain('商品展示');

    await act(async () => {
      filterButton('人物种草')?.click();
    });
    expect(cards()[0].textContent).toContain('人物种草');
  });

  it('过滤「测试20260828144946」', async () => {
    await mountGallery();

    expect(mountNode.textContent).not.toContain('测试20260828144946');
    expect(cards()).toHaveLength(1);
  });

  it('点击只把正文与模式回填，不提交', async () => {
    const onCardClick = vi.fn();
    await mountGallery(onCardClick);

    await act(async () => {
      cards()[0].click();
    });
    expect(onCardClick).toHaveBeenCalledTimes(1);
    expect(onCardClick).toHaveBeenCalledWith('填写商品正文', 'image');
  });

  it('视频场景卡片带类型角标', async () => {
    await mountGallery();

    await act(async () => {
      filterButton('人物种草')?.click();
    });
    expect(cards()[0].querySelector('svg')).not.toBeNull();
    expect(cards()[0].getAttribute('data-media-kind')).toBe('video');
  });

  it('视频卡直接自动播放，不依赖鼠标悬停', async () => {
    await mountGallery();

    await act(async () => {
      filterButton('人物种草')?.click();
    });
    const video = cards()[0].querySelector<HTMLVideoElement>('[data-testid="gallery-video"]')!;
    expect(video).not.toBeNull();
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(mountNode.querySelector('[data-testid="gallery-hover-video"]')).toBeNull();
  });

  it('当前 tab 的封面与视频走预加载', async () => {
    api.fetchTemplateTags.mockResolvedValue([
      { tag_code: 'a', label: '场景A' },
      { tag_code: 'b', label: '场景B' },
    ]);
    api.fetchTemplatePage.mockImplementation(async (tagCode: string) =>
      pageOf([
        {
          title: `${tagCode}-案例`,
          video: tagCode === 'b' ? 'https://example.com/b.mp4' : '',
          images: [`https://example.com/${tagCode}.jpg`],
          layout: 'wide',
          content: null,
        },
      ]),
    );

    await mountGallery();

    const eagerImg = cards()[0].querySelector<HTMLImageElement>('img')!;
    expect(eagerImg.getAttribute('loading')).toBe('eager');

    await act(async () => {
      filterButton('场景B')?.click();
    });
    const video = cards()[0].querySelector<HTMLVideoElement>('[data-testid="gallery-video"]')!;
    expect(video.getAttribute('data-preload')).toBe('eager');
    expect(video.preload).toBe('auto');
  });
});
