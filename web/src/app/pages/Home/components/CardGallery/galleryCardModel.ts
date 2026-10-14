
export type GalleryMediaKind = 'video' | 'image';

export function mediaKindFromTagCode(tagCode: string): GalleryMediaKind {
  return tagCode === 'video' ? 'video' : 'image';
}

export function galleryCoverSrc(images: string[] | null | undefined): string {
  const [first, second] = images ?? [];
  return second ?? first ?? '';
}

export function shouldShowVideoChrome(kind: GalleryMediaKind): boolean {
  return kind === 'video';
}
