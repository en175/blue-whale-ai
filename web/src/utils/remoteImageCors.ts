/** 开发模式把跨域远程图片/音视频地址转到 Vite 同域代理，避免本地直连被 CORS 拦截 */
export function resolveMediaSrc(src?: string | null): string {
  if (!src) return '';
  // Vitest 同样是 DEV，但 vite.config 不会注册 /__tos-fetch；改写后测试断言裸 URL 会红，且代理实际不存在
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

/** TOS 等 http(s) 图从加载起走 CORS，让缓存里永远是带 ACAO 的那份 */
export function remoteImageCrossOrigin(src?: string | null): 'anonymous' | undefined {
  return src && (/^https?:\/\//.test(src) || src.startsWith('/__tos-fetch')) ? 'anonymous' : undefined;
}
