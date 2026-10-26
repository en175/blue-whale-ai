import { queryOptions } from '@tanstack/react-query';
import { http, putToPresignedUrl, type ApiRequestInit, type PresignData } from './http';

export const HOMEPAGE_HERO_MAX_ENABLED = 8;

export type HomepageHeroMediaType = 'image' | 'video';
export type HomepageHeroScene = 'homepage' | 'auth';

export interface HomepageHeroPublic {
  id: string;
  media_type: HomepageHeroMediaType;
  media_url: string;
  poster_url: string | null;
  sort_order: number;
}

export interface HomepageHeroAdmin extends HomepageHeroPublic {
  scene: HomepageHeroScene;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface HomepageHeroPayload {
  scene?: HomepageHeroScene;
  media_type: HomepageHeroMediaType;
  media_url?: string;
  poster_url?: string | null;
  sort_order?: number;
  enabled?: number;
}

export interface HeroSlide {
  id: string;
  mediaType: HomepageHeroMediaType;
  src: string;
  poster: string | null;
}

const ADMIN_HEROES = '/api/admin/site-config/homepage-heroes';
const ADMIN_UPLOADS = `${ADMIN_HEROES}/uploads`;
const PUBLIC_HEROES = '/api/site/homepage-heroes';

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_MIMES = ['video/mp4'];
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

export const homepageHeroKeys = {
  all: ['homepage-heroes'] as const,
  admin: () => [...homepageHeroKeys.all, 'admin'] as const,
  public: () => [...homepageHeroKeys.all, 'public'] as const,
};

export function isPlayableHeroUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

export function selectPlayableHeroSlides(
  items: HomepageHeroPublic[] | undefined,
): HeroSlide[] {
  if (!items?.length) return [];
  return items
    .filter((item) => isPlayableHeroUrl(item.media_url))
    .map((item) => ({
      id: item.id,
      mediaType: item.media_type === 'image' ? 'image' : 'video',
      src: item.media_url.trim(),
      poster: isPlayableHeroUrl(item.poster_url) ? item.poster_url!.trim() : null,
    }));
}

export function fetchPublicHomepageHeroes(scene: HomepageHeroScene = 'homepage') {
  return http.get<HomepageHeroPublic[]>(`${PUBLIC_HEROES}?scene=${scene}`, { silent: true });
}

export function fetchAdminHomepageHeroes(scene: HomepageHeroScene = 'homepage') {
  return http.get<HomepageHeroAdmin[]>(`${ADMIN_HEROES}?scene=${scene}`, { silent: true });
}

export function publicHomepageHeroesOptions(scene: HomepageHeroScene = 'homepage') {
  return queryOptions({
    queryKey: [...homepageHeroKeys.public(), scene],
    queryFn: () => fetchPublicHomepageHeroes(scene),
  });
}

export function adminHomepageHeroesOptions(scene: HomepageHeroScene = 'homepage') {
  return queryOptions({
    queryKey: [...homepageHeroKeys.admin(), scene],
    queryFn: () => fetchAdminHomepageHeroes(scene),
  });
}

export function createHomepageHero(body: HomepageHeroPayload, init?: ApiRequestInit) {
  return http.post<{ id: string }>(ADMIN_HEROES, body, init);
}

export function updateHomepageHero(
  id: string,
  body: Partial<HomepageHeroPayload>,
  init?: ApiRequestInit,
) {
  return http.patch<{ id: string }>(`${ADMIN_HEROES}/${id}`, body, init);
}

export function deleteHomepageHero(id: string, init?: ApiRequestInit) {
  return http.del<{ id: string }>(`${ADMIN_HEROES}/${id}`, init);
}

export function sortHomepageHero(id: string, direction: 'up' | 'down', init?: ApiRequestInit) {
  return http.put<{ id: string }>(`${ADMIN_HEROES}/${id}/sort`, { direction }, init);
}

export function presignHomepageHeroUpload(
  params: { type: HomepageHeroMediaType; mime: string; size: number },
  init?: ApiRequestInit,
) {
  return http.post<PresignData>(`${ADMIN_UPLOADS}/presign`, params, init);
}

export function completeHomepageHeroUpload(
  params: { type: HomepageHeroMediaType; mime: string; size: number; storage_key: string },
  init?: ApiRequestInit,
) {
  return http.post<{ url: string }>(`${ADMIN_UPLOADS}/complete`, params, init);
}

export async function uploadHomepageHeroFile(
  file: File,
  type: HomepageHeroMediaType,
): Promise<string> {
  const mimes = type === 'image' ? IMAGE_MIMES : VIDEO_MIMES;
  if (!mimes.includes(file.type)) {
    throw new Error(type === 'image' ? '图片仅支持 jpeg / png / webp / gif' : '视频仅支持 mp4');
  }
  const max = type === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
  if (file.size > max) {
    throw new Error(type === 'image' ? '图片大小不能超过 20MB' : '视频大小不能超过 200MB');
  }
  const silent = { silent: true } as const;
  const presign = await presignHomepageHeroUpload(
    { type, mime: file.type, size: file.size },
    silent,
  );
  await putToPresignedUrl(presign, file);
  const done = await completeHomepageHeroUpload(
    { type, mime: file.type, size: file.size, storage_key: presign.storage_key },
    silent,
  );
  return done.url;
}
