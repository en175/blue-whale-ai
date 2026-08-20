import { describe, expect, it } from 'vitest';
import { advanceReveal, hasPendingReveal } from './streamPacing';

/** 按帧推进到追平为止，返回每帧露出的字数，用来看节奏而不是看终值。 */
function play(received: number, options: { frameMs?: number; maxFrames?: number } = {}) {
  const frameMs = options.frameMs ?? 16;
  const perFrame: number[] = [];
  let revealed = 0;
  for (let i = 0; i < (options.maxFrames ?? 600) && hasPendingReveal(revealed, received); i += 1) {
    const next = advanceReveal({ revealed, received, elapsedMs: frameMs, done: false });
    perFrame.push(Math.floor(next) - Math.floor(revealed));
    revealed = next;
  }
  return { perFrame, revealed, frames: perFrame.length };
}

describe('streamPacing', () => {
  it('把一次到达的一整句拆成多帧露出，而不是一帧全给', () => {
    // 实测的一条 delta：约 40 个中文字，一次到齐。
    const { frames, revealed } = play(40);

    expect(frames).toBeGreaterThan(1);
    expect(revealed).toBe(40);
  });

  it('积压越大追得越快，不会越落越远', () => {
    const small = advanceReveal({ revealed: 0, received: 20, elapsedMs: 16, done: false });
    const large = advanceReveal({ revealed: 0, received: 400, elapsedMs: 16, done: false });

    expect(large).toBeGreaterThan(small);
  });

  it('积压再大也有速度上限，避免一闪而过', () => {
    const huge = advanceReveal({ revealed: 0, received: 100_000, elapsedMs: 1000, done: false });

    expect(huge).toBeLessThanOrEqual(240);
  });

  it('积压很小也有速度下限，画面不会停住', () => {
    const tiny = advanceReveal({ revealed: 0, received: 2, elapsedMs: 1000, done: false });

    expect(tiny).toBe(2);
  });

  it('不足一个字的进度会累积到下一帧，低速时不会卡死', () => {
    // 4ms 一帧、下限 24 字/秒，单帧推进不到 0.1 个字。
    // 如果实现每帧把它截断成整数，revealed 会永远停在 0，这个循环再多帧也追不平。
    let revealed = 0;
    for (let i = 0; i < 10; i += 1) {
      revealed = advanceReveal({ revealed, received: 5, elapsedMs: 4, done: false });
    }
    expect(revealed).toBeGreaterThan(0);
    expect(Math.floor(revealed)).toBe(0);

    for (let i = 0; i < 20; i += 1) {
      revealed = advanceReveal({ revealed, received: 5, elapsedMs: 4, done: false });
    }
    expect(Math.floor(revealed)).toBeGreaterThanOrEqual(1);
  });

  it('结束时一次给全，绝不会因为没播完而少显示', () => {
    expect(advanceReveal({ revealed: 3, received: 396, elapsedMs: 16, done: true })).toBe(396);
  });

  it('永远不会超过已收到的字数', () => {
    expect(advanceReveal({ revealed: 0, received: 5, elapsedMs: 10_000, done: false })).toBe(5);
    expect(advanceReveal({ revealed: 9, received: 5, elapsedMs: 16, done: false })).toBe(5);
  });
});
