import { describe, expect, it } from "vitest";

import { loadAudioConcurrency } from "./rocketmq-audio.consumer.js";

describe("loadAudioConcurrency", () => {
  it("uses an explicit AUDIO_CONCURRENCY env override", () => {
    expect(loadAudioConcurrency({ AUDIO_CONCURRENCY: "3" } as never)).toBe(3);
    expect(loadAudioConcurrency({ AUDIO_CONCURRENCY: "1" } as never)).toBe(1);
    expect(loadAudioConcurrency({ AUDIO_CONCURRENCY: "64" } as never)).toBe(64);
  });

  it("falls back to default 5 for invalid or missing env", () => {
    // 越界 / 非数字 / 缺省 → 默认 5
    for (const raw of ["0", "65", "abc", "-1", ""]) {
      expect(
        loadAudioConcurrency({ AUDIO_CONCURRENCY: raw } as never),
      ).toBe(5);
    }
    expect(loadAudioConcurrency({} as never)).toBe(5);
  });
});
