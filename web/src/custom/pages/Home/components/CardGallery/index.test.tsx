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

describe('CardGallery', () => {
  it('图片与视频按场景混排在同一条网格，不再分层', async () => {
    await mountGallery();

    const kinds = cards().map((card) => card.getAttribute('data-media-kind'));
    expect(kinds).toEqual(['image', 'video']);
    expect(mountNode.querySelectorAll('[data-testid="gallery-card-grid"]')).toHaveLength(1);
    expect([...mountNode.querySelectorAll('button')].some((b) => b.textContent?.includes('图片'))).toBe(false);
  });

  it('两类卡都显示用途标签', async () => {
    await mountGallery();

    const labels = cards().map((card) => card.textContent);
    expect(labels[0]).toContain('商品展示');
    expect(labels[1]).toContain('人物种草');
  });

  it('过滤「测试20260828144946」', async () => {
    await mountGallery();

    expect(mountNode.textContent).not.toContain('测试20260828144946');
    expect(cards()).toHaveLength(2);
  });

  it('点击只把正文与模式回填，不提交', async () => {
    const onCardClick = vi.fn();
    await mountGallery(onCardClick);

    await act(async () => {
      cards()[0].click();
    });
    expect(onCardClick).toHaveBeenCalledTimes(1);
    expect(onCardClick).toHaveBeenCalledWith('填写商品正文', 'image');

    await act(async () => {
      cards()[1].click();
    });
    expect(onCardClick).toHaveBeenCalledWith('种草短片', 'video');
    expect(api.fetchTemplatePage).toHaveBeenCalledTimes(2);
  });

  it('只有视频卡展示播放 UI', async () => {
    await mountGallery();

    const [image, video] = cards();
    expect(image.querySelector('[data-testid="gallery-play-overlay"]')).toBeNull();
    expect(video.querySelector('[data-testid="gallery-play-overlay"]')).toBeTruthy();
  });
});
