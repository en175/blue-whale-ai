/* ============================================
 * 画廊卡片形态：只看请求入参 tagCode，禁止用 images 是否为空推断视频。
 * ============================================ */

export type GalleryMediaKind = 'video' | 'image';

/** 与 GET /api/agent/templates/page?tagCode= 的入参对齐 */
export function mediaKindFromTagCode(tagCode: string): GalleryMediaKind {
  return tagCode === 'video' ? 'video' : 'image';
}

/** 三图堆叠封面：第二张优先，否则第一张；空数组不升格为视频。 */
export function galleryCoverSrc(images: string[] | null | undefined): string {
  const [first, second] = images ?? [];
  return second ?? first ?? '';
}

export function shouldShowVideoChrome(kind: GalleryMediaKind): boolean {
  return kind === 'video';
}
