/** 开发模式把跨域 TOS 地址转到 Vite 同域代理，避免本地直连被 CORS 拦截 */
export function remoteMediaFetchUrl(src: string): string {
  if (
    import.meta.env.DEV &&
    /^https?:\/\//.test(src) &&
    (typeof window === 'undefined' || !src.startsWith(window.location.origin))
  ) {
    return `/__tos-fetch?url=${encodeURIComponent(src)}`;
  }
  return src;
}

/**
 * 拉取远程素材。
 * 画布 <img>/<video> 默认无 CORS 加载，浏览器会把「没有 ACAO」的响应写入 HTTP 缓存；
 * 测试/生产再 fetch 同一 URL 会命中该缓存并报跨域（DevTools Disable cache 后消失）。
 * 跨域请求用 cache: 'reload' 强制走网络，拿到带 CORS 头的响应。
 */
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
