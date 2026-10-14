export function resolveMediaSrc(src?: string | null): string {
  if (!src) return '';
  if (
    import.meta.env.DEV &&
    !import.meta.env.VITEST &&
    /^https?:\/\//.test(src) &&
    (typeof window === 'undefined' || !src.startsWith(window.location.origin)) &&
    !src.startsWith('/__tos-fetch')
  ) {
    return `/__tos-fetch?url=${encodeURIComponent(src)}`;
  }
  return src;
}

export function remoteImageCrossOrigin(src?: string | null): 'anonymous' | undefined {
  return src && (/^https?:\/\//.test(src) || src.startsWith('/__tos-fetch')) ? 'anonymous' : undefined;
}
