import { resolveMediaSrc } from '@/utils/remoteImageCors';

export function remoteMediaFetchUrl(src: string): string {
  return resolveMediaSrc(src);
}

export async function fetchRemoteMedia(src: string, init?: RequestInit): Promise<Response> {
  const fetchUrl = remoteMediaFetchUrl(src);
  const crossOrigin =
    typeof window !== 'undefined' &&
    /^https?:\/\//.test(fetchUrl) &&
    !fetchUrl.startsWith(window.location.origin);
  return fetch(fetchUrl, {
    ...init,
    credentials: init?.credentials ?? 'omit',
    mode: crossOrigin ? 'cors' : init?.mode,
    cache: crossOrigin ? 'reload' : init?.cache,
  });
}
