import { resolveMediaSrc } from '@/utils/remoteImageCors';

/**
 * 资产库媒体展示地址。
 *
 * TOS 预签名把整段 query 纳入签名。历史实现用 `_reload=` 做缓存破坏，
 * 对已带 `X-Tos-*` 的 Seedream / Ark ACG 临时地址会 403 SignatureDoesNotMatch。
 * 重试只换 React key 重挂节点，不改 URL。
 */
export function assetMediaDisplay(
  url: string,
  reloadGeneration = 0,
): { src: string; nodeKey: string } {
  return { src: resolveMediaSrc(url), nodeKey: `${url}::${reloadGeneration}` };
}
