import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectPlayableHeroSlides, uploadHomepageHeroFile, type HomepageHeroPublic } from './homepageHeroes';
import { http, putToPresignedUrl } from './http';

vi.mock('./http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./http')>();
  return { ...actual, putToPresignedUrl: vi.fn() };
});

function item(overrides: Partial<HomepageHeroPublic> = {}): HomepageHeroPublic {
  return {
    id: '1',
    media_type: 'video',
    media_url: 'https://cdn.example.com/hero.mp4',
    poster_url: 'https://cdn.example.com/hero.jpg',
    sort_order: 0,
    ...overrides,
  };
}

describe('selectPlayableHeroSlides', () => {
  it('drops empty, blank and non-http media_url so migration placeholders cannot break the carousel', () => {
    const slides = selectPlayableHeroSlides([
      item({ id: 'empty', media_url: '' }),
      item({ id: 'blank', media_url: '   ' }),
      item({ id: 'relative', media_url: '/local/hero.mp4' }),
      item({ id: 'ok', media_url: ' https://cdn.example.com/ok.mp4 ' }),
    ]);
    expect(slides).toEqual([
      {
        id: 'ok',
        mediaType: 'video',
        src: 'https://cdn.example.com/ok.mp4',
        poster: 'https://cdn.example.com/hero.jpg',
      },
    ]);
  });

  it('treats empty public list and undefined as no slides', () => {
    expect(selectPlayableHeroSlides(undefined)).toEqual([]);
    expect(selectPlayableHeroSlides([])).toEqual([]);
  });

  it('keeps image slides and ignores unusable posters', () => {
    const slides = selectPlayableHeroSlides([
      item({
        id: 'img',
        media_type: 'image',
        media_url: 'https://cdn.example.com/bg.png',
        poster_url: null,
      }),
    ]);
    expect(slides[0]).toEqual({
      id: 'img',
      mediaType: 'image',
      src: 'https://cdn.example.com/bg.png',
      poster: null,
    });
  });
});

describe('uploadHomepageHeroFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('goes through putToPresignedUrl then complete, and returns the public url', async () => {
    vi.mocked(putToPresignedUrl).mockResolvedValue(undefined);
    const post = vi.spyOn(http, 'post')
      .mockResolvedValueOnce({
        storage_key: 'admin/site-config/video/xxx',
        upload_url: 'https://tos.example.com/put',
        headers: { 'Content-Type': 'video/mp4' },
        expires_in: 3600,
      })
      .mockResolvedValueOnce({ url: 'https://cdn.example.com/ok.mp4' });

    const file = new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' });
    await expect(uploadHomepageHeroFile(file, 'video')).resolves.toBe('https://cdn.example.com/ok.mp4');
    expect(post).toHaveBeenNthCalledWith(
      1,
      '/api/admin/site-config/homepage-heroes/uploads/presign',
      { type: 'video', mime: 'video/mp4', size: 3 },
      { silent: true },
    );
    expect(putToPresignedUrl).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/api/admin/site-config/homepage-heroes/uploads/complete',
      {
        type: 'video',
        mime: 'video/mp4',
        size: 3,
        storage_key: 'admin/site-config/video/xxx',
      },
      { silent: true },
    );
  });

  it('rejects unsupported mime before calling the network', async () => {
    const file = new File([new Uint8Array([1])], 'clip.mov', { type: 'video/quicktime' });
    await expect(uploadHomepageHeroFile(file, 'video')).rejects.toThrow('视频仅支持 mp4');
    expect(putToPresignedUrl).not.toHaveBeenCalled();
  });
});
