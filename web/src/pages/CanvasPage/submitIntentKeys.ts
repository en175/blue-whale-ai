/* ============================================
 * 生成提交的幂等键台账：一次用户意图一把 key
 *
 * 服务端的建任务/重试幂等（`Idempotency-Key`）**只有在客户端复用同一把钥匙时才成立**。
 * 此前请求函数每次调用都现造一把，于是「用户双击生成」「响应丢了再点一次」仍是两个 job、
 * 两笔预扣——幂等头对客户端成了摆设。
 *
 * 台账的口径（`retryAudioMix` 那套「调用方持有钥匙」的推广）：
 *   · 同 scope（同一张卡的同一个提交位）＋ 同签名（这次提交的是什么）→ **同一把**。
 *     双击、响应丢失后原样重发、401 登录后续跑都是同一次意图，复用才能让服务端重放。
 *   · 签名变了（用户改了参数再点）→ **换新钥匙**。复用会撞服务端「同键异载荷」判 409，
 *     把一次正常提交变成报错。
 *   · {@link SubmitIntentKeys.settle}：任务已受理，这次意图就结束了。之后再提交是另一次
 *     意图（用户想再要一张），复用会直接重放旧任务、他拿不到新作品。
 *
 * 不变量：一把钥匙只活在「某次意图尚未受理」的窗口里，受理即忘。
 * ============================================ */
import { newIdempotencyKey } from '@/api/idempotencyKey';

export interface SubmitIntentKeys {
  /** 取本次提交的幂等键：同 scope 同签名复用，签名变了换新。 */
  keyFor(scope: string, signature: string): string;
  /** 任务已受理：忘掉该 scope 的钥匙，下次提交是全新意图。 */
  settle(scope: string): void;
}

export function createSubmitIntentKeys(): SubmitIntentKeys {
  const held = new Map<string, { signature: string; key: string }>();
  return {
    keyFor(scope, signature) {
      const current = held.get(scope);
      if (current?.signature === signature) return current.key;
      const key = newIdempotencyKey();
      held.set(scope, { signature, key });
      return key;
    },
    settle(scope) {
      held.delete(scope);
    },
  };
}
