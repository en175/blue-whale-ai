import { afterEach, describe, expect, it } from "vitest";

import { assertNotRealEnvironment, getPrismaClient } from "./db.js";

const ORIGINAL_VITEST = process.env.VITEST;

afterEach(() => {
  if (ORIGINAL_VITEST === undefined) delete process.env.VITEST;
  else process.env.VITEST = ORIGINAL_VITEST;
});

describe("测试期库名闸门", () => {
  it("跑在测试进程里连开发库 → 拒绝", () => {
    process.env.VITEST = "true";
    expect(() =>
      assertNotRealEnvironment("mysql://root:localdev@127.0.0.1:13306/blue_whale"),
    ).toThrow(/blue_whale/);
  });

  it("blue_whale_* 这些历史变体同样拒绝（web / server / default）", () => {
    process.env.VITEST = "true";
    for (const name of ["blue_whale_web", "blue_whale_server", "blue_whale_default"]) {
      expect(() => assertNotRealEnvironment(`mysql://root:x@127.0.0.1:13306/${name}`)).toThrow();
    }
  });

  it("专用测试库放行（bw_gate_* / tz_caliber / 动态建名）", () => {
    process.env.VITEST = "true";
    for (const name of [
      "bw_gate_IKFCXC",
      "tz_caliber",
      "ikfcxc-" + "abc123",
    ]) {
      expect(() => assertNotRealEnvironment(`mysql://root:x@127.0.0.1:13306/${name}`)).not.toThrow();
    }
  });

  it("**不在测试进程里就一律放行**（产品路径不能被它挡住）", () => {
    delete process.env.VITEST;
    expect(() =>
      assertNotRealEnvironment("mysql://root:real@prod-host:3306/blue_whale"),
    ).not.toThrow();
  });

  it("★ 闸门**真的接在连接入口上**（不是只写了个没人调的函数）", () => {
    process.env.VITEST = "true";
    expect(() =>
      getPrismaClient("mysql://root:x@127.0.0.1:13306/blue_whale"),
    ).toThrow(/blue_whale/);
  });

  it("解析不出库名时不拦（连不上会在别处炸，不该在这里误报）", () => {
    process.env.VITEST = "true";
    expect(() => assertNotRealEnvironment("not-a-url")).not.toThrow();
  });
});
