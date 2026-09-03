/* ============================================
 * 首页背景图/视频：公开轮播 + admin 通用配置
 * 管理端包络 {success, data}，公开面 {code, data, msg}；http 层均已解包
 * 上传路径以后端控制器为准：/api/admin/site-config/homepage-heroes/uploads/*
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { http, type ApiRequestInit } from './http';
import { putToPresignedUrl, type PresignData } from './assets';

export const HOMEPAGE_HERO_MAX_ENABLED = 8;

export type HomepageHeroMediaType = 'image' | 'video';

/** 公开轮播条目（不含 enabled） */
export interface HomepageHeroPublic {
  id: string;
  media_type: HomepageHeroMediaType;
  media_url: string;
  poster_url: string | null;
  sort_order: number;
}

/** 管理端条目（含启停与时间） */
export interface HomepageHeroAdmin extends HomepageHeroPublic {
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface HomepageHeroPayload {
  media_type: HomepageHeroMediaType;
  media_url?: string;
  poster_url?: string | null;
  sort_order?: number;
  enabled?: number;
}

/** 轮播可播放片源（已过滤空地址 / 非 http(s)） */
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

/** 公开列表 → 轮播片源：空 media_url / 非 http(s) 丢弃，避免迁移期占位打挂首页 */
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

export function fetchPublicHomepageHeroes() {
  return http.get<HomepageHeroPublic[]>(PUBLIC_HEROES, { silent: true });
}

export function fetchAdminHomepageHeroes() {
  return http.get<HomepageHeroAdmin[]>(ADMIN_HEROES, { silent: true });
}

export function publicHomepageHeroesOptions() {
  return queryOptions({
    queryKey: homepageHeroKeys.public(),
    queryFn: fetchPublicHomepageHeroes,
  });
}

export function adminHomepageHeroesOptions() {
  return queryOptions({
    queryKey: homepageHeroKeys.admin(),
    queryFn: fetchAdminHomepageHeroes,
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

/** 三段式上传：presign → putToPresignedUrl（dev 走 /__tos-upload）→ complete，返回公网 URL */
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
