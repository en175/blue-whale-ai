/* ============================================
 * 幂等键（Idempotency-Key）的铸造：一个客户端 UUID v4
 *
 * 本来长在 `jobs.ts` 里，但它的消费者不止 jobs 那几个接口——conversation / sceneCards /
 * agentSessions 与画布的提交意图台账（`pages/CanvasPage/submitIntentKeys`）都在用。
 * 「谁在造钥匙」是横跨这些模块的一件独立小事，就在自己这一篇里。
 * ============================================ */

/** 生成一把新的幂等键（**一次用户意图一把**，不是一次 HTTP 调用一把）。
 *  crypto.randomUUID() 仅在安全上下文（HTTPS/localhost）可用；
 *  测试站 HTTP 下不存在，降级为 getRandomValues 手动拼 v4 UUID。
 *  ⚠️ 不要在请求函数里调用它——每次调用现造一把等于没有幂等（服务端拿到的永远是
 *  新钥匙，「双击生成」「响应丢了再发一次」照样是两个 job、两笔预扣）。调用方在**发起
 *  那一刻**造一把，并在该次意图的重试路径上复用；`submitIntentKeys` 是画布的持有台账。 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 UUID fallback
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
