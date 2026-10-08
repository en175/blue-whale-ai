import { resolveMediaSrc } from '@/utils/remoteImageCors';

export function assetMediaDisplay(
  url: string,
  reloadGeneration = 0,
): { src: string; nodeKey: string } {
  return { src: resolveMediaSrc(url), nodeKey: `${url}::${reloadGeneration}` };
}
