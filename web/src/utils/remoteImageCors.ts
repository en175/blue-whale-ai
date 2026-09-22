/** TOS 等 http(s) 图从加载起走 CORS，让缓存里永远是带 ACAO 的那份 */
export function remoteImageCrossOrigin(src?: string | null): 'anonymous' | undefined {
  return src && /^https?:\/\//.test(src) ? 'anonymous' : undefined;
}
