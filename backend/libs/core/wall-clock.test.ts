import { afterEach, describe, expect, it } from "vitest";
import {
  wallClockDay,
  wallClockHuman,
  wallClockHumanFromIso,
  wallClockMillis,
  wallClockOffset,
  wallClockRfc3339,
  wallClockRfc3339OrNull,
} from "./wall-clock.js";

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("wall-clock —— 读进程时区，源码零偏移", () => {
  it("北京时间下产出 +08:00 墙钟", () => {
    process.env.TZ = "Asia/Shanghai";
    const instant = new Date("2026-09-29T06:32:00Z");

    expect(wallClockOffset(instant)).toBe("+08:00");
    expect(wallClockRfc3339(instant)).toBe("2026-09-29T14:32:00+08:00");
    expect(wallClockDay(instant)).toBe("2026-09-29");
    expect(wallClockHuman(instant)).toBe("2026-09-29 14:32");
    expect(wallClockMillis(instant)).toBe("2026-09-29T14:32:00.000+08:00");
  });

  it("同一瞬时换个进程时区就换个墙钟，偏移跟着变", () => {
    const instant = new Date("2026-09-29T06:32:00Z");

    process.env.TZ = "UTC";
    expect(wallClockOffset(instant)).toBe("+00:00");
    expect(wallClockRfc3339(instant)).toBe("2026-09-29T06:32:00+00:00");
    expect(wallClockDay(instant)).toBe("2026-09-29");
  });

  it("空值走 OrNull", () => {
    expect(wallClockRfc3339OrNull(null)).toBeNull();
    expect(wallClockRfc3339OrNull(undefined)).toBeNull();
    expect(wallClockRfc3339OrNull(new Date("2026-09-29T06:32:00Z"))).toBe(
      "2026-09-29T14:32:00+08:00",
    );
  });

  it("人读格式化只吃墙钟字面量的前两位，不重算时区", () => {
    expect(wallClockHumanFromIso("2026-09-29T14:32:00+08:00")).toBe("2026-09-29 14:32");
    expect(wallClockHumanFromIso("2026-09-29T14:32:41.982+08:00")).toBe("2026-09-29 14:32");
    expect(wallClockHumanFromIso("")).toBe("");
  });
});
