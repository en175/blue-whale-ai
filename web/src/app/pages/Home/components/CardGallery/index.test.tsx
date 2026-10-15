// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CardGallery from './index';

const api = vi.hoisted(() => ({
  fetchTemplatePage: vi.fn(),
  fetchTemplateTags: vi.fn(),
}));

vi.mock('@/app/api/agent', () => api);

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
  });
}

beforeEach(() => {
  api.fetchTemplateTags.mockResolvedValue([
    { tag_code: 'picture', label: '图片' },
    { tag_code: 'video', label: '视频' },
  ]);
  api.fetchTemplatePage.mockImplementation(async (tagCode: string) => {
    if (tagCode === 'picture') {
      return pageOf([
        {
          title: '空图模板',
          video: 'https://example.com/should-not-play.mp4',
          images: [],
          layout: 'wide',
          content: null,
        },
      ]);
    }
    return pageOf([
      {
        title: '视频模板',
        video: 'https://example.com/clip.mp4',
        images: [],
        layout: 'wide',
        content: null,
      },
    ]);
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.clearAllMocks();
});

describe('CardGallery', () => {
  it('图片 tab 空 images 不展示视频播放 UI，点击仍切到 image', async () => {
    const onCardClick = vi.fn();
    await mountGallery(onCardClick);

    const card = mountNode.querySelector('[data-testid="gallery-card"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.getAttribute('data-media-kind')).toBe('image');
    expect(card.textContent).toContain('空图模板');
    expect(mountNode.querySelector('[data-testid="gallery-play-overlay"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="gallery-hover-video"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="gallery-image-placeholder"]')).toBeTruthy();

    await act(async () => {
      card.click();
    });
    expect(onCardClick).toHaveBeenCalledWith('空图模板', 'image');
  });

  it('图片 tab 与视频 tab 共用同一行 4 卡网格', async () => {
    await mountGallery();

    const pictureGrid = mountNode.querySelector('[data-testid="gallery-card-grid"]');
    expect(pictureGrid).toBeTruthy();
    expect(pictureGrid?.className.split(/\s+/).filter(Boolean)).toHaveLength(1);

    const videoTab = [...mountNode.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('视频'),
    );
    await act(async () => {
      videoTab?.click();
      await Promise.resolve();
    });

    const videoGrid = mountNode.querySelector('[data-testid="gallery-card-grid"]');
    expect(videoGrid?.className).toBe(pictureGrid?.className);
  });

  it('视频 tab 才展示播放按钮，形态不由 images 是否为空决定', async () => {
    await mountGallery();

    const videoTab = [...mountNode.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('视频'),
    );
    expect(videoTab).toBeTruthy();
    await act(async () => {
      videoTab?.click();
      await Promise.resolve();
    });

    const card = mountNode.querySelector('[data-testid="gallery-card"]') as HTMLElement;
    expect(card.getAttribute('data-media-kind')).toBe('video');
    expect(card.textContent).toContain('视频模板');
    expect(mountNode.querySelector('[data-testid="gallery-play-overlay"]')).toBeTruthy();
    expect(api.fetchTemplatePage).toHaveBeenCalledWith('video');
  });
});
