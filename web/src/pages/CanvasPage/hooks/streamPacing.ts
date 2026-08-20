/**
 * 把"收到多少字"和"显示多少字"分开，让正文以连续速度露出来。
 *
 * 模型并不是逐字吐的。实测一次回复的尾部是每 ~200ms 到一条 delta、每条约 40 个字，
 * 中文 40 个字就是一整句——所以照单渲染永远是"一句一句往外蹦"，不可能像在打字。
 * 服务端改不掉这件事：那是模型和网关的分块方式，跟传输无关。
 *
 * 这里做的是标准做法：收到的文本先进缓冲，渲染按每帧固定速率追赶。
 * 速率跟着积压走——积压多就快、积压少就慢——这样既不会越落越远，
 * 也不会在两条 delta 之间干等着不动。
 */

/** 积压期望在多少毫秒内追平。越小越贴近原始节奏，越大越平滑。 */
const CATCH_UP_MS = 400;
/** 每秒最少露出的字数，避免积压很小时画面看着卡住。 */
const MIN_CHARS_PER_SECOND = 24;
/** 每秒最多露出的字数，快到这个程度再快也只是闪一下。 */
const MAX_CHARS_PER_SECOND = 240;

export interface RevealInput {
  /** 已露出的字数，允许是小数：不足一个字的进度要留到下一帧，否则低速时会停住。 */
  revealed: number;
  /** 已收到的字数。 */
  received: number;
  /** 距上一帧的毫秒数。 */
  elapsedMs: number;
  /** 本次交付已结束（终态或被丢弃），此时不再平滑，直接给全部。 */
  done: boolean;
}

export function advanceReveal({ revealed, received, elapsedMs, done }: RevealInput): number {
  // 结束时必须一次给全：动画是表现，文本是事实，任何情况下都不能因为没播完而少显示。
  if (done) return received;
  const pending = received - revealed;
  if (pending <= 0) return Math.min(revealed, received);
  const charsPerSecond = Math.min(
    MAX_CHARS_PER_SECOND,
    Math.max(MIN_CHARS_PER_SECOND, pending / (CATCH_UP_MS / 1000)),
  );
  return Math.min(received, revealed + (charsPerSecond * Math.max(0, elapsedMs)) / 1000);
}

/** 是否还有没露出的文本，用来决定动画循环要不要继续跑。 */
export function hasPendingReveal(revealed: number, received: number): boolean {
  return Math.floor(revealed) < received;
}
