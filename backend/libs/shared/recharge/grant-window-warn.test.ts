import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGrantWindowWarnGate,
  GRANT_WINDOW_WARN_COOLDOWN_MS,
} from "./grant-window-warn.js";


describe("createGrantWindowWarnGate — 超窗 WARN 的频次闸", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("★ 同一笔单在冷却窗口内只放行一次（这就是「2880 条/天」的解法）", () => {
    const gate = createGrantWindowWarnGate();

    let allowed = 0;
    for (let i = 0; i < 120; i += 1) {
      if (gate.shouldWarn("RC1")) allowed += 1;
      vi.advanceTimersByTime(30 * 1000);
    }

    expect(allowed).toBe(1);
  });

  it("★ 过了冷却窗口**还会再报**：超窗不会自己好，一笔被忘掉的单比一笔吵的单更糟", () => {
    const gate = createGrantWindowWarnGate();

    expect(gate.shouldWarn("RC1")).toBe(true);
    vi.advanceTimersByTime(GRANT_WINDOW_WARN_COOLDOWN_MS + 1);

    expect(gate.shouldWarn("RC1")).toBe(true);
  });

  it("冷却窗口可配（默认值不是写死的唯一取值）", () => {
    const gate = createGrantWindowWarnGate(60_000);

    expect(gate.shouldWarn("RC1")).toBe(true);
    vi.advanceTimersByTime(59_000);
    expect(gate.shouldWarn("RC1")).toBe(false);
    vi.advanceTimersByTime(2_000);
    expect(gate.shouldWarn("RC1")).toBe(true);
  });

  it("按 tradeNo 各自独立：一笔单的冷却不影响另一笔", () => {
    const gate = createGrantWindowWarnGate();

    expect(gate.shouldWarn("RC1")).toBe(true);
    expect(gate.shouldWarn("RC2")).toBe(true);
    expect(gate.shouldWarn("RC1")).toBe(false);
  });

  it("★ 表**有界**：已经过了冷却的条目会被清掉，不会随历史单数无限长", () => {
    const gate = createGrantWindowWarnGate(60_000);

    for (let i = 0; i < 50; i += 1) gate.shouldWarn(`RC${i}`);
    expect(gate.size()).toBe(50);

    vi.advanceTimersByTime(61_000);
    gate.shouldWarn("RC-new");

    expect(gate.size()).toBe(1);
  });

  it("默认冷却明显大于扫描器的一轮（5 分钟）：它不该成为新的噪声源", () => {
    expect(GRANT_WINDOW_WARN_COOLDOWN_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});
